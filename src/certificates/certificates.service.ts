import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Certificate, Prisma, Student } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { StorageService } from '../common/storage/storage.service';
import { AppConfigService } from '../common/config/app-config.service';
import { SchoolsService } from '../school-setup/schools/schools.service';
import { PagedResult } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  CERTIFICATE_TEMPLATE_FIELDS,
  CERTIFICATE_TEMPLATE_LABELS,
} from './certificate-templates';
import { renderCertificatePdf } from './pdf/certificate-pdf';
import { GenerateCertificateDto } from './dto/generate-certificate.dto';
import { ListCertificatesQueryDto } from './dto/list-certificates-query.dto';
import {
  CertificateResponseDto,
  CertificateVerificationResponseDto,
} from './dto/certificate-response.dto';

type CertificateWithStudent = Certificate & {
  student: Pick<Student, 'id' | 'name' | 'admissionNumber'>;
};

/**
 * `frontend/src/features/certificates/api.ts`'s REST surface (`modules/
 * documents-certificates.md` "Backend dependencies" — the generation half; the storage half was
 * already built in Phase 3, see `documents/documents.service.ts`).
 */
@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformPrisma: PlatformPrismaService,
    private readonly requestContext: RequestContextService,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
    private readonly schools: SchoolsService,
  ) {}

  async list(
    query: ListCertificatesQueryDto,
  ): Promise<PagedResult<CertificateResponseDto>> {
    const where: Prisma.CertificateWhereInput = {
      ...(query.studentId ? { studentId: query.studentId } : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.certificate.findMany({
          where,
          include: { student: { select: studentSelect } },
          orderBy: { createdAt: query.sortDir ?? 'desc' },
          skip,
          take,
        }),
      () => this.prisma.certificate.count({ where }),
    );

    return {
      items: await Promise.all(result.items.map((c) => this.toResponse(c))),
      total: result.total,
    };
  }

  async generate(
    dto: GenerateCertificateDto,
    user: AuthenticatedUser,
  ): Promise<CertificateResponseDto> {
    const resolvedFields = this.assertFieldsAreValid(dto);
    const title =
      dto.template === 'custom'
        ? dto.customTitle!.trim()
        : CERTIFICATE_TEMPLATE_LABELS[dto.template];

    const student = await this.prisma.student.findUnique({
      where: { id: dto.studentId },
      include: { schoolClass: true, section: true },
    });
    if (!student) {
      throw new NotFoundException(`Student ${dto.studentId} not found`);
    }

    const tenantId = this.requireTenantId();
    const school = await this.schools.getCurrent();
    const certificateId = randomUUID();
    const certificateNumber = generateCertificateNumber();
    // More entropy than `certificateNumber` on purpose — see `Certificate.verifyCode`'s own
    // schema.prisma doc comment on why the two are deliberately different values.
    const verifyCode = randomBytes(16).toString('hex');
    const verifyUrl = `${this.config.frontendBaseUrl}/certificates/verify/${verifyCode}`;

    const pdf = await renderCertificatePdf({
      schoolName: school.name,
      title,
      studentName: student.name,
      admissionNumber: student.admissionNumber,
      className: student.schoolClass.name,
      sectionName: student.section.name,
      templateLabel: CERTIFICATE_TEMPLATE_LABELS[dto.template],
      certificateNumber,
      issuedAt: new Date(),
      fields: resolvedFields,
      verifyUrl,
    });

    const storageKey = `${tenantId}/certificates/${certificateId}.pdf`;
    await this.storage.putObject(storageKey, pdf, 'application/pdf');

    const certificate = await this.prisma.certificate.create({
      data: {
        id: certificateId,
        studentId: dto.studentId,
        template: dto.template,
        title,
        fields: dto.fields,
        certificateNumber,
        verifyCode,
        storageKey,
        generatedByUserId: user.id,
        generatedByLabel: user.name,
      } as unknown as Prisma.CertificateUncheckedCreateInput,
      include: { student: { select: studentSelect } },
    });

    return this.toResponse(certificate);
  }

  /**
   * `GET /certificates/verify/:code` — public, unauthenticated (`@Public()` on the controller
   * route bypasses `JwtAuthGuard`, so there is no per-request tenant in context at all here, not
   * even a wrong one). Reads through `PlatformPrismaService` rather than the normal tenant-scoped
   * `PrismaService` — a genuine cross-tenant-by-design lookup, the third sanctioned call site
   * alongside the two `platform-prisma.service.ts`'s own doc comment already lists. An unknown
   * code 404s (never a `{ valid: false }` 200 — `CertificateVerifyPage.tsx`'s own comment: "an
   * invalid/expired/unknown code is a normal result to show here", and it already treats a fetch
   * error the same as `valid: false`, so a 404 costs nothing on the frontend side).
   */
  async verify(code: string): Promise<CertificateVerificationResponseDto> {
    const certificate = await this.platformPrisma.certificate.findUnique({
      where: { verifyCode: code },
    });
    if (!certificate) {
      throw new NotFoundException('Certificate not found');
    }
    const [student, school] = await Promise.all([
      this.platformPrisma.student.findUnique({
        where: { id: certificate.studentId },
        select: { name: true },
      }),
      this.platformPrisma.school.findFirst({
        where: { tenantId: certificate.tenantId },
        select: { name: true },
      }),
    ]);

    return {
      valid: true,
      certificateNumber: certificate.certificateNumber,
      template: certificate.template,
      studentLabel: student?.name ?? 'Unknown student',
      schoolName: school?.name ?? 'SchoolOS',
      generatedAt: certificate.createdAt.toISOString(),
    };
  }

  /**
   * Enforces the per-template required-field contract server-side (`certificate-templates.ts`'s
   * own doc comment on why this is a fixed, mirrored set) — the frontend's own `superRefine`
   * covers the `custom`-needs-`customTitle` case, but a raw API caller (or a stale client) gets no
   * such check for free, and marks/text data ending up on a printed legal document is exactly the
   * kind of input `security-standards`' validation guidance means to catch server-side, not just
   * in a form.
   */
  private assertFieldsAreValid(
    dto: GenerateCertificateDto,
  ): { label: string; value: string }[] {
    if (dto.template === 'custom') {
      if (!dto.customTitle?.trim()) {
        throw new BadRequestException(
          'customTitle is required for a custom certificate',
        );
      }
      return [];
    }

    const spec = CERTIFICATE_TEMPLATE_FIELDS[dto.template] ?? [];
    return spec.map(({ key, label }) => {
      // `key` comes from our own fixed `CERTIFICATE_TEMPLATE_FIELDS` spec above, never from the
      // request body, so this lookup is safe despite `dto.fields` itself being client-supplied —
      // same reasoning `AdmissionsService`'s `STAGE_ENTRY_PERMISSION[targetStage]` lookup gives.
      // eslint-disable-next-line security/detect-object-injection
      const value = dto.fields?.[key];
      if (typeof value !== 'string' || !value.trim()) {
        throw new BadRequestException(
          `fields.${key} is required for a ${dto.template} certificate`,
        );
      }
      return { label, value: value.trim() };
    });
  }

  private requireTenantId(): string {
    const tenantId = this.requestContext.tenantId;
    if (!tenantId) {
      throw new Error(
        'CertificatesService called with no tenant in request context',
      );
    }
    return tenantId;
  }

  private async toResponse(
    certificate: CertificateWithStudent,
  ): Promise<CertificateResponseDto> {
    return {
      id: certificate.id,
      certificateNumber: certificate.certificateNumber,
      template: certificate.template,
      title: certificate.title,
      studentId: certificate.studentId,
      studentLabel: `${certificate.student.name} (#${certificate.student.admissionNumber})`,
      fields: certificate.fields as Record<string, string>,
      generatedAt: certificate.createdAt.toISOString(),
      generatedByLabel: certificate.generatedByLabel,
      pdfUrl: await this.storage.getSignedDownloadUrl(certificate.storageKey),
      verifyCode: certificate.verifyCode,
    };
  }
}

const studentSelect = { id: true, name: true, admissionNumber: true } as const;

// Same timestamp+random convention as `fees/invoices.service.ts`'s `generateReceiptNumber` — not
// a DB sequence, see that function's own reasoning; `CERT` prefix instead of `R`.
function generateCertificateNumber(): string {
  return `CERT${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}
