import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdmissionApplication, AdmissionStage, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { InvoicesService } from '../fees/invoices.service';
import { PagedResult } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { UpdateAdmissionDto } from './dto/update-admission.dto';
import { ScoreApplicationDto } from './dto/score-application.dto';
import { DecideAdmissionDto } from './dto/decide-admission.dto';
import { SubmitDocumentsDto } from './dto/submit-documents.dto';
import { ListAdmissionsQueryDto } from './dto/list-admissions-query.dto';
import { AdmissionResponseDto } from './dto/admission-response.dto';

/**
 * Ordered pipeline (PRD §7, `ADMISSION_STAGES` in `admissions/schemas.ts`) and the permission each
 * transition *into* a given stage needs, beyond the baseline `admissions.update` every
 * `PATCH /admissions/:id` caller already has (`AdmissionsController`'s route-level decorator) —
 * matches `StagePanels.tsx`'s per-panel `usePermission` calls exactly (see
 * `../../implementation-plan.md`'s Phase 3 correction note for why these are distinct from
 * `admissions.update`). `enrollment` has no entry: reaching it is a `PATCH` like any other, but
 * *leaving* it (actually creating the `Student`) is `POST /admissions/:id/enroll`, a separate
 * action below.
 */
const STAGE_ORDER: AdmissionStage[] = [
  'inquiry',
  'application',
  'documents',
  'review',
  'entrance_test',
  'interview',
  'acceptance',
  'fee_payment',
  'enrollment',
];

const STAGE_ENTRY_PERMISSION: Partial<Record<AdmissionStage, string>> = {
  entrance_test: 'admissions.review',
  fee_payment: 'admissions.approve',
};

@Injectable()
export class AdmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    private readonly invoicesService: InvoicesService,
  ) {}

  async list(
    query: ListAdmissionsQueryDto,
  ): Promise<PagedResult<AdmissionResponseDto>> {
    const where: Prisma.AdmissionApplicationWhereInput = {
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.search
        ? {
            OR: [
              {
                applicantName: { contains: query.search, mode: 'insensitive' },
              },
              { contactPhone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.admissionApplication.findMany({
          where,
          orderBy: { createdAt: query.sortDir ?? 'desc' },
          skip,
          take,
        }),
      () => this.prisma.admissionApplication.count({ where }),
    );

    return { items: result.items.map(toResponse), total: result.total };
  }

  async get(id: string): Promise<AdmissionResponseDto> {
    return toResponse(await this.findOrThrow(id));
  }

  async createInquiry(dto: CreateInquiryDto): Promise<AdmissionResponseDto> {
    await this.assertClassExists(dto.classAppliedFor);
    const admission = await this.prisma.admissionApplication.create({
      data: {
        stage: 'inquiry',
        applicantName: dto.name,
        applicantDob: parseDateOnly(dto.dob),
        classAppliedFor: dto.classAppliedFor,
        contactPhone: dto.contactPhone,
        contactEmail: dto.contactEmail,
      } as unknown as Prisma.AdmissionApplicationUncheckedCreateInput,
    });
    return toResponse(admission);
  }

  async update(
    id: string,
    dto: UpdateAdmissionDto,
  ): Promise<AdmissionResponseDto> {
    const existing = await this.findOrThrow(id);

    if (dto.stage) {
      this.assertStageTransitionAllowed(existing, dto.stage);
    }
    if (dto.applicant?.classAppliedFor) {
      await this.assertClassExists(dto.applicant.classAppliedFor);
    }

    // `../../implementation-plan.md`'s resolved Phase 3 admissions↔fees ordering decision: moving
    // into `fee_payment` is what generates the real `Invoice` (there is no separate "mark fee
    // payment" endpoint — this generic `PATCH` is where that state-machine action lives).
    // `generateAdmissionInvoice` is idempotent, so a stage transition that somehow re-enters this
    // once (it can't via `assertStageTransitionAllowed`'s one-step-forward rule today, but nothing
    // stops a future stage-machine change relying on that) reuses the existing invoice.
    const admissionFeeInvoiceId =
      dto.stage === 'fee_payment'
        ? (await this.invoicesService.generateAdmissionInvoice(existing)).id
        : undefined;

    const admission = await this.prisma.admissionApplication.update({
      where: { id },
      data: {
        ...(dto.stage ? { stage: dto.stage } : {}),
        ...(admissionFeeInvoiceId ? { admissionFeeInvoiceId } : {}),
        ...(dto.applicant
          ? {
              applicantName: dto.applicant.name,
              applicantDob: parseDateOnly(dto.applicant.dob),
              classAppliedFor: dto.applicant.classAppliedFor,
              contactPhone: dto.applicant.contactPhone,
              contactEmail: dto.applicant.contactEmail,
            }
          : {}),
        ...(dto.applicationDetails
          ? {
              address: dto.applicationDetails.address,
              previousSchool: dto.applicationDetails.previousSchool,
              notes: dto.applicationDetails.notes,
            }
          : {}),
      },
    });
    return toResponse(admission);
  }

  async submitDocuments(
    id: string,
    dto: SubmitDocumentsDto,
  ): Promise<AdmissionResponseDto> {
    await this.findOrThrow(id);
    const admission = await this.prisma.admissionApplication.update({
      where: { id },
      data: { documentNames: dto.fileNames },
    });
    return toResponse(admission);
  }

  async scoreApplication(
    id: string,
    dto: ScoreApplicationDto,
  ): Promise<AdmissionResponseDto> {
    await this.findOrThrow(id);
    const admission = await this.prisma.admissionApplication.update({
      where: { id },
      data: {
        entranceTestScore: dto.entranceTestScore ?? null,
        interviewNotes: dto.interviewNotes,
      },
    });
    return toResponse(admission);
  }

  async decide(
    id: string,
    dto: DecideAdmissionDto,
  ): Promise<AdmissionResponseDto> {
    await this.findOrThrow(id);
    // `AnyPermissionsGuard` (route-level `@RequireAnyPermission('admissions.approve',
    // 'admissions.reject')`) only proves the caller has *one of* the two — which one this
    // specific `decision` value needs is checked here, same "guard for the coarse gate, service
    // for the payload-specific one" split as `assertStageTransitionAllowed` below.
    const requiredPermission =
      dto.decision === 'rejected' ? 'admissions.reject' : 'admissions.approve';
    if (!this.requestContext.permissions.includes(requiredPermission)) {
      throw new ForbiddenException(
        `Missing required permission: ${requiredPermission}`,
      );
    }

    const admission = await this.prisma.admissionApplication.update({
      where: { id },
      data: {
        decision: dto.decision,
        decisionReason: dto.decisionReason,
        applicationScore: dto.applicationScore ?? null,
      },
    });
    return toResponse(admission);
  }

  /**
   * §7 "Enrollment" — creates the `Student` record and hands off to Fees for the admission
   * invoice (`../../implementation-plan.md`'s resolved admissions↔fees ordering decision; Phase 6
   * fills in the real invoice, this phase leaves `admissionFeeInvoiceId` unset).
   *
   * **A real, currently-unresolved data gap**, not a guess made silently: the admissions pipeline
   * never collects a student's gender, or which *section* (only which class) they're joining, or
   * an admission number — `InquiryFormValues`/`ApplicationDetailsFormValues` have no fields for
   * any of them, and `POST /admissions/:id/enroll` takes no request body on the frontend side to
   * supply them either. Rather than blocking enrollment on a contract change nobody's asked for
   * yet, this creates a real `Student` row with clearly-flagged interim defaults (gender
   * `'other'`, the target class's first section, an auto-generated admission number) that staff
   * are expected to correct immediately via the already-built Student edit form — the enrolled
   * student is real and fully functional, just needs a follow-up edit. Flagging this explicitly in
   * `../../implementation-plan.md`'s Phase 3 notes rather than leaving it to be discovered later.
   */
  async enroll(id: string): Promise<{ studentId: string }> {
    const admission = await this.findOrThrow(id);
    if (admission.stage !== 'enrollment') {
      throw new BadRequestException(
        `${admission.applicantName}'s admission must reach the enrollment stage before enrolling (currently: ${admission.stage})`,
      );
    }
    if (admission.enrolledStudentId) {
      throw new ConflictException(
        `${admission.applicantName} is already enrolled`,
      );
    }
    // PRD §7's order enforced as a real business rule, not just client stepper sequencing — see
    // `../../implementation-plan.md`'s resolved Phase 3 admissions↔fees ordering decision. Reaching
    // the `enrollment` stage already requires having passed through `fee_payment`
    // (`assertStageTransitionAllowed`'s one-step-forward rule), which is what generates
    // `admissionFeeInvoiceId` — a missing one here means that never actually happened (a stale
    // admission created before this integration existed, say), fail closed either way.
    if (
      !admission.admissionFeeInvoiceId ||
      !(await this.invoicesService.isInvoicePaid(
        admission.admissionFeeInvoiceId,
      ))
    ) {
      throw new BadRequestException(
        `${admission.applicantName}'s admission fee has not been paid yet`,
      );
    }

    const [section, academicYear] = await Promise.all([
      this.prisma.section.findFirst({
        where: { classId: admission.classAppliedFor },
        orderBy: { name: 'asc' },
      }),
      this.prisma.academicYear.findFirst({
        orderBy: { startDate: 'desc' },
      }),
    ]);
    if (!section) {
      throw new BadRequestException(
        `Class ${admission.classAppliedFor} has no sections to enroll into yet`,
      );
    }
    if (!academicYear) {
      throw new BadRequestException('No academic year configured yet');
    }

    const tenantId = this.requireTenantId();
    const studentId = randomUUID();

    const student = await this.prisma.$transaction(async (tx) => {
      const created = await tx.student.create({
        data: {
          id: studentId,
          admissionNumber: `A${Date.now().toString(36).toUpperCase()}`,
          name: admission.applicantName,
          dob: admission.applicantDob,
          // Placeholder — not collected anywhere in the admissions pipeline, see this method's
          // own doc comment.
          gender: 'other',
          address: admission.address,
          nationality: '',
          language: '',
          classId: admission.classAppliedFor,
          sectionId: section.id,
          academicYearId: academicYear.id,
          status: 'active',
          medicalInfo: '',
          emergencyContacts: [],
          enrollments: {
            create: [
              {
                tenantId,
                academicYearId: academicYear.id,
                classId: admission.classAppliedFor,
                sectionId: section.id,
              },
            ],
          },
        } as unknown as Prisma.StudentUncheckedCreateInput,
      });
      await tx.admissionApplication.update({
        where: { id },
        data: { enrolledStudentId: created.id },
      });
      // Backfills `studentId` onto the admission-fee invoice(s) without clearing
      // `admissionApplicationId` — see `Invoice`'s own schema.prisma doc comment on why the CHECK
      // constraint permits both being set.
      await this.invoicesService.reconcileAdmissionInvoices(tx, id, created.id);
      return created;
    });

    return { studentId: student.id };
  }

  async funnel(): Promise<Record<AdmissionStage, number>> {
    const counts = await this.prisma.admissionApplication.groupBy({
      by: ['stage'],
      _count: { stage: true },
    });
    const result = Object.fromEntries(
      STAGE_ORDER.map((stage) => [stage, 0]),
    ) as Record<AdmissionStage, number>;
    for (const row of counts) {
      result[row.stage] = row._count.stage;
    }
    return result;
  }

  /**
   * Server-side state-machine enforcement — a `PATCH` may only move a stage exactly one step
   * forward in `STAGE_ORDER` (no skipping, no going backward; rejection is a separate `decision`
   * field, not a stage), and the target stage's entry permission (`STAGE_ENTRY_PERMISSION`) must
   * be held beyond the route's baseline `admissions.update`. `fee_payment` additionally requires
   * `decision === 'accepted'` already set — matches `DecisionPanel.tsx`'s own sequencing (decide,
   * *then* move the stage), enforced here rather than trusted from the client.
   */
  private assertStageTransitionAllowed(
    existing: AdmissionApplication,
    targetStage: AdmissionStage,
  ): void {
    const currentIndex = STAGE_ORDER.indexOf(existing.stage);
    const targetIndex = STAGE_ORDER.indexOf(targetStage);
    if (targetIndex !== currentIndex + 1) {
      throw new BadRequestException(
        `Cannot move admission ${existing.id} from "${existing.stage}" to "${targetStage}"`,
      );
    }

    // `targetStage` is a validated `AdmissionStage` enum member (already passed the transition
    // check above), not arbitrary input.
    // eslint-disable-next-line security/detect-object-injection
    const requiredPermission = STAGE_ENTRY_PERMISSION[targetStage];
    if (
      requiredPermission &&
      !this.requestContext.permissions.includes(requiredPermission)
    ) {
      throw new ForbiddenException(
        `Missing required permission: ${requiredPermission}`,
      );
    }

    if (targetStage === 'fee_payment' && existing.decision !== 'accepted') {
      throw new BadRequestException(
        `${existing.applicantName}'s admission must be accepted before moving to fee payment`,
      );
    }
  }

  private async assertClassExists(classId: string): Promise<void> {
    const schoolClass = await this.prisma.schoolClass.findUnique({
      where: { id: classId },
    });
    if (!schoolClass) {
      throw new BadRequestException(`Class ${classId} not found`);
    }
  }

  private requireTenantId(): string {
    const tenantId = this.requestContext.tenantId;
    if (!tenantId) {
      throw new Error(
        'AdmissionsService called with no tenant in request context',
      );
    }
    return tenantId;
  }

  private async findOrThrow(id: string): Promise<AdmissionApplication> {
    const admission = await this.prisma.admissionApplication.findUnique({
      where: { id },
    });
    if (!admission) {
      throw new NotFoundException(`Admission ${id} not found`);
    }
    return admission;
  }
}

function toResponse(admission: AdmissionApplication): AdmissionResponseDto {
  return {
    id: admission.id,
    stage: admission.stage,
    applicant: {
      name: admission.applicantName,
      dob: formatDateOnly(admission.applicantDob),
      classAppliedFor: admission.classAppliedFor,
      contactPhone: admission.contactPhone,
      contactEmail: admission.contactEmail,
    },
    applicationDetails: {
      address: admission.address,
      previousSchool: admission.previousSchool,
      notes: admission.notes,
    },
    // Placeholder shape — no real `url`/stable `id` per file, see `SubmitDocumentsDto`'s comment.
    documents: admission.documentNames.map((name) => ({
      id: name,
      name,
      url: '',
    })),
    entranceTestScore: admission.entranceTestScore,
    interviewNotes: admission.interviewNotes,
    applicationScore: admission.applicationScore,
    decision: admission.decision,
    decisionReason: admission.decisionReason,
    admissionFeeInvoiceId: admission.admissionFeeInvoiceId,
    enrolledStudentId: admission.enrolledStudentId,
    createdAt: admission.createdAt.toISOString(),
  };
}
