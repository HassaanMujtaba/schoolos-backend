import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdmissionApplication,
  FeeStructure,
  Invoice,
  Payment,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import {
  discountRulesOf,
  FeeStructuresService,
} from './fee-structures.service';
import { DiscountRule } from './fee-calc';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { OutstandingQueryDto } from './dto/outstanding-query.dto';
import {
  InvoiceLineItem,
  InvoiceResponseDto,
  OutstandingRowDto,
  OutstandingSummaryDto,
  PagedInvoiceDto,
  PagedPaymentDto,
  PaymentResponseDto,
  ReceiptResponseDto,
} from './dto/fee-response.dto';
import {
  computeDiscountedAmount,
  computeInvoiceStatus,
  round2,
} from './fee-calc';

const UNSET_LABEL = '—';

/**
 * `frontend/src/features/fees/api.ts`'s invoice/payment/outstanding surface. `FeeStructuresService`
 * is a constructor dependency (not the other way round) — structures are the input to invoice
 * generation, never the reverse. `generateAdmissionInvoice`/`isInvoicePaid`/
 * `reconcileAdmissionInvoices` are the three methods `AdmissionsModule` imports this module for
 * (`../../implementation-plan.md`'s resolved Phase 3 admissions↔fees ordering decision).
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feeStructures: FeeStructuresService,
  ) {}

  // ---------------------------------------------------------------------------
  // Invoices
  // ---------------------------------------------------------------------------

  async list(query: ListInvoicesQueryDto): Promise<PagedInvoiceDto> {
    const where: Prisma.InvoiceWhereInput = {
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.classId ? { student: { is: { classId: query.classId } } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.invoice.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.invoice.count({ where }),
    );
    return { items: await this.toResponses(result.items), total: result.total };
  }

  async get(id: string): Promise<InvoiceResponseDto> {
    const invoice = await this.findOrThrow(id);
    const [response] = await this.toResponses([invoice]);
    return response;
  }

  /**
   * `POST /fees/invoices` — `mode: 'student'` returns one `InvoiceResponseDto`, `mode: 'class'`
   * bulk-generates one invoice per student in that class/section and returns the array, matching
   * `api.ts generateInvoice`'s own `Invoice | Invoice[]` return type and
   * `InvoicesListPage`/`InvoiceGenerateForm`'s own branch-on-array handling.
   */
  async generate(
    dto: GenerateInvoiceDto,
  ): Promise<InvoiceResponseDto | InvoiceResponseDto[]> {
    const structure = await this.feeStructures.findEntityOrThrow(
      dto.feeStructureId,
    );
    const dueDate = parseDateOnly(dto.dueDate);

    if (dto.mode === 'student') {
      const studentId = dto.studentId as string;
      const student = await this.prisma.student.findUnique({
        where: { id: studentId },
      });
      if (!student) {
        throw new BadRequestException(`Student ${studentId} not found`);
      }
      this.assertStructureAppliesToClass(structure, student.classId);
      const invoice = await this.createInvoiceForStudent(
        this.prisma,
        studentId,
        structure,
        dueDate,
      );
      const [response] = await this.toResponses([invoice]);
      return response;
    }

    const classId = dto.classId as string;
    await this.assertClassExists(classId);
    if (dto.sectionId) {
      await this.assertSectionInClass(dto.sectionId, classId);
    }
    this.assertStructureAppliesToClass(structure, classId);

    const students = await this.prisma.student.findMany({
      where: {
        classId,
        ...(dto.sectionId ? { sectionId: dto.sectionId } : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    if (students.length === 0) {
      return [];
    }

    const invoices = await this.prisma.$transaction((tx) =>
      Promise.all(
        students.map((student) =>
          this.createInvoiceForStudent(tx, student.id, structure, dueDate),
        ),
      ),
    );
    return this.toResponses(invoices);
  }

  // ---------------------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------------------

  async listPayments(query: ListPaymentsQueryDto): Promise<PagedPaymentDto> {
    const where: Prisma.PaymentWhereInput = {
      ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);

    const result = await paginate(
      () =>
        this.prisma.payment.findMany({
          where,
          orderBy: { paidAt: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.payment.count({ where }),
    );
    return {
      items: await this.toPaymentResponses(result.items),
      total: result.total,
    };
  }

  /** `POST /fees/invoices/:id/payments` — recomputes `paidAmount`/`status` from real rows. */
  async recordPayment(
    invoiceId: string,
    dto: RecordPaymentDto,
  ): Promise<PaymentResponseDto> {
    if (dto.invoiceId !== invoiceId) {
      throw new BadRequestException(
        'invoiceId in body does not match the route',
      );
    }
    const invoice = await this.findOrThrow(invoiceId);

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          invoiceId,
          amount: dto.amount,
          method: dto.method,
          referenceId: dto.referenceId,
          receiptNumber: generateReceiptNumber(),
        } as unknown as Prisma.PaymentUncheckedCreateInput,
      });
      await this.recomputeInvoiceTotals(tx, invoice.id);
      return created;
    });
    const [response] = await this.toPaymentResponses([payment]);
    return response;
  }

  /** `POST /fees/payments/:id/refund` — all-or-nothing, see `Payment`'s own schema doc comment. */
  async refundPayment(paymentId: string): Promise<PaymentResponseDto> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }
    if (payment.refunded) {
      throw new ConflictException(
        `Payment ${paymentId} has already been refunded`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const refunded = await tx.payment.update({
        where: { id: paymentId },
        data: { refunded: true, refundedAt: new Date() },
      });
      await this.recomputeInvoiceTotals(tx, payment.invoiceId);
      return refunded;
    });
    const [response] = await this.toPaymentResponses([updated]);
    return response;
  }

  async getReceipt(paymentId: string): Promise<ReceiptResponseDto> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }
    const invoice = await this.findOrThrow(payment.invoiceId);
    const [paymentResponse] = await this.toPaymentResponses([payment]);
    const [invoiceResponse] = await this.toResponses([invoice]);

    return {
      payment: paymentResponse,
      invoice: {
        id: invoiceResponse.id,
        lineItems: invoiceResponse.lineItems,
        totalAmount: invoiceResponse.totalAmount,
        dueDate: invoiceResponse.dueDate,
      },
      studentName: invoiceResponse.studentName,
      admissionNumber: invoiceResponse.admissionNumber,
      className: invoiceResponse.className,
    };
  }

  // ---------------------------------------------------------------------------
  // Outstanding balances
  // ---------------------------------------------------------------------------

  async getOutstanding(
    query: OutstandingQueryDto,
  ): Promise<OutstandingSummaryDto> {
    const invoices = await this.prisma.invoice.findMany({
      where: { status: { not: 'cancelled' } },
    });

    const totalCollected = round2(
      invoices.reduce((sum, invoice) => sum + invoice.paidAmount, 0),
    );
    const totalOutstanding = round2(
      invoices.reduce(
        (sum, invoice) =>
          sum + Math.max(0, invoice.totalAmount - invoice.paidAmount),
        0,
      ),
    );

    const rows =
      query.groupBy === 'class'
        ? await this.groupByClass(invoices)
        : await this.groupByStudent(invoices);

    return { totalCollected, totalOutstanding, rows };
  }

  // ---------------------------------------------------------------------------
  // Admissions integration (`../../implementation-plan.md`'s resolved Phase 3 ordering decision)
  // ---------------------------------------------------------------------------

  /**
   * Called from `AdmissionsService.update` when a `PATCH /admissions/:id { stage: 'fee_payment' }`
   * transition goes through. Generates the real `Invoice` against the tenant's `type: 'admission'`
   * `FeeStructure` applicable to the applicant's target class — idempotent (a retried PATCH, or one
   * that somehow re-enters this stage, reuses the existing invoice rather than creating a second
   * one).
   */
  async generateAdmissionInvoice(
    admission: AdmissionApplication,
  ): Promise<Invoice> {
    if (admission.admissionFeeInvoiceId) {
      const existing = await this.prisma.invoice.findUnique({
        where: { id: admission.admissionFeeInvoiceId },
      });
      if (existing) return existing;
    }

    const structure = await this.prisma.feeStructure.findFirst({
      where: {
        type: 'admission',
        applicableClasses: { has: admission.classAppliedFor },
      },
    });
    if (!structure) {
      // `classAppliedFor` is a raw classId (`AdmissionsService`/the frontend's own `InquiryForm`
      // resolve it to a name for display everywhere else — see that call site's own comment) —
      // resolve it here too rather than leaking a UUID into this user-facing error message.
      const schoolClass = await this.prisma.schoolClass.findUnique({
        where: { id: admission.classAppliedFor },
      });
      throw new BadRequestException(
        `No admission fee structure is configured for class ${schoolClass?.name ?? 'Unknown class'} yet — ` +
          'add one under Fee Structures (type: Admission) before moving this application to Fee Payment',
      );
    }

    // Due immediately — the admissions flow has no due-date input of its own, unlike
    // `GenerateInvoiceDto.dueDate` (a staff-picked field for ordinary invoices).
    return this.createInvoiceForAdmission(
      this.prisma,
      admission.id,
      structure,
      new Date(),
    );
  }

  async isInvoicePaid(invoiceId: string): Promise<boolean> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    return invoice?.status === 'paid';
  }

  /**
   * `AdmissionsService.enroll`'s own doc comment: once the `Student` row exists, every `Invoice`
   * generated against this admission gets `studentId` backfilled — `admissionApplicationId` stays
   * set too, as the historical link, per `Invoice`'s own schema doc comment on the CHECK
   * constraint this deliberately satisfies (both may be set, never neither).
   */
  async reconcileAdmissionInvoices(
    tx: Prisma.TransactionClient,
    admissionApplicationId: string,
    studentId: string,
  ): Promise<void> {
    await tx.invoice.updateMany({
      where: { admissionApplicationId },
      data: { studentId },
    });
  }

  // ---------------------------------------------------------------------------

  private async createInvoiceForStudent(
    tx: Prisma.TransactionClient | PrismaService,
    studentId: string,
    structure: FeeStructure,
    dueDate: Date,
  ): Promise<Invoice> {
    return this.createInvoice(tx, { studentId }, structure, dueDate);
  }

  private async createInvoiceForAdmission(
    tx: Prisma.TransactionClient | PrismaService,
    admissionApplicationId: string,
    structure: FeeStructure,
    dueDate: Date,
  ): Promise<Invoice> {
    return this.createInvoice(
      tx,
      { admissionApplicationId },
      structure,
      dueDate,
    );
  }

  private async createInvoice(
    tx: Prisma.TransactionClient | PrismaService,
    owner: { studentId: string } | { admissionApplicationId: string },
    structure: FeeStructure,
    dueDate: Date,
  ): Promise<Invoice> {
    const discountRules = discountRulesOf(structure);
    const totalAmount = computeDiscountedAmount(
      structure.amount,
      discountRules,
    );
    const lineItems = buildLineItems(structure, discountRules);
    return tx.invoice.create({
      data: {
        ...owner,
        feeStructureId: structure.id,
        lineItems: lineItems as unknown as Prisma.InputJsonValue,
        dueDate,
        totalAmount,
        paidAmount: 0,
        status: computeInvoiceStatus(totalAmount, 0, dueDate),
      } as unknown as Prisma.InvoiceUncheckedCreateInput,
    });
  }

  /** Recomputes `paidAmount`/`status` from every non-refunded `Payment` — never incremented in place. */
  private async recomputeInvoiceTotals(
    tx: Prisma.TransactionClient,
    invoiceId: string,
  ): Promise<void> {
    const [invoice, payments] = await Promise.all([
      tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } }),
      tx.payment.findMany({ where: { invoiceId, refunded: false } }),
    ]);
    const paidAmount = round2(
      payments.reduce((sum, payment) => sum + payment.amount, 0),
    );
    const status = computeInvoiceStatus(
      invoice.totalAmount,
      paidAmount,
      invoice.dueDate,
    );
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { paidAmount, status },
    });
  }

  private assertStructureAppliesToClass(
    structure: FeeStructure,
    classId: string,
  ): void {
    if (!structure.applicableClasses.includes(classId)) {
      throw new BadRequestException(
        `Fee structure "${structure.name}" does not apply to class ${classId}`,
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

  private async assertSectionInClass(
    sectionId: string,
    classId: string,
  ): Promise<void> {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.classId !== classId) {
      throw new BadRequestException(
        `Section ${sectionId} not found in class ${classId}`,
      );
    }
  }

  private async findOrThrow(id: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }
    return invoice;
  }

  /** Batch-resolves student/admission/class labels — no N+1 across a list page. */
  private async toResponses(
    invoices: Invoice[],
  ): Promise<InvoiceResponseDto[]> {
    const studentIds = [
      ...new Set(
        invoices.map((i) => i.studentId).filter((id): id is string => !!id),
      ),
    ];
    const admissionIds = [
      ...new Set(
        invoices
          .map((i) => i.admissionApplicationId)
          .filter((id): id is string => !!id),
      ),
    ];

    const [students, admissions] = await Promise.all([
      studentIds.length
        ? this.prisma.student.findMany({ where: { id: { in: studentIds } } })
        : Promise.resolve([]),
      admissionIds.length
        ? this.prisma.admissionApplication.findMany({
            where: { id: { in: admissionIds } },
          })
        : Promise.resolve([]),
    ]);
    const studentById = new Map(students.map((s) => [s.id, s]));
    const admissionById = new Map(admissions.map((a) => [a.id, a]));

    const classIds = [
      ...new Set(
        [
          ...students.map((s) => s.classId),
          ...admissions.map((a) => a.classAppliedFor),
        ].filter(Boolean),
      ),
    ];
    const classes = classIds.length
      ? await this.prisma.schoolClass.findMany({
          where: { id: { in: classIds } },
        })
      : [];
    const classNameById = new Map(classes.map((c) => [c.id, c.name]));

    const now = new Date();
    return invoices.map((invoice) => {
      const student = invoice.studentId
        ? studentById.get(invoice.studentId)
        : undefined;
      const admission = invoice.admissionApplicationId
        ? admissionById.get(invoice.admissionApplicationId)
        : undefined;
      const status = computeInvoiceStatus(
        invoice.totalAmount,
        invoice.paidAmount,
        invoice.dueDate,
        now,
      );

      return {
        id: invoice.id,
        studentId: invoice.studentId,
        admissionApplicationId: invoice.admissionApplicationId,
        studentName: student?.name ?? admission?.applicantName ?? UNSET_LABEL,
        admissionNumber: student?.admissionNumber ?? UNSET_LABEL,
        classId: student?.classId ?? admission?.classAppliedFor ?? '',
        className:
          classNameById.get(
            student?.classId ?? admission?.classAppliedFor ?? '',
          ) ?? UNSET_LABEL,
        feeStructureId: invoice.feeStructureId,
        lineItems: invoice.lineItems as unknown as InvoiceLineItem[],
        dueDate: formatDateOnly(invoice.dueDate),
        status: invoice.status === 'cancelled' ? invoice.status : status,
        totalAmount: invoice.totalAmount,
        paidAmount: invoice.paidAmount,
        createdAt: invoice.createdAt.toISOString(),
      };
    });
  }

  private async toPaymentResponses(
    payments: Payment[],
  ): Promise<PaymentResponseDto[]> {
    const invoiceIds = [...new Set(payments.map((p) => p.invoiceId))];
    const invoices = invoiceIds.length
      ? await this.prisma.invoice.findMany({
          where: { id: { in: invoiceIds } },
        })
      : [];
    const invoiceResponses = await this.toResponses(invoices);
    const invoiceById = new Map(invoiceResponses.map((i) => [i.id, i]));

    return payments.map((payment) => {
      const invoice = invoiceById.get(payment.invoiceId);
      return {
        id: payment.id,
        invoiceId: payment.invoiceId,
        studentName: invoice?.studentName ?? UNSET_LABEL,
        admissionNumber: invoice?.admissionNumber ?? UNSET_LABEL,
        amount: payment.amount,
        method: payment.method,
        referenceId: payment.referenceId,
        receiptNumber: payment.receiptNumber,
        paidAt: payment.paidAt.toISOString(),
        refunded: payment.refunded,
      };
    });
  }

  private async groupByStudent(
    invoices: Invoice[],
  ): Promise<OutstandingRowDto[]> {
    const studentIds = [
      ...new Set(
        invoices.map((i) => i.studentId).filter((id): id is string => !!id),
      ),
    ];
    const admissionIds = [
      ...new Set(
        invoices
          .filter((i) => !i.studentId)
          .map((i) => i.admissionApplicationId)
          .filter((id): id is string => !!id),
      ),
    ];
    const [students, admissions] = await Promise.all([
      studentIds.length
        ? this.prisma.student.findMany({ where: { id: { in: studentIds } } })
        : Promise.resolve([]),
      admissionIds.length
        ? this.prisma.admissionApplication.findMany({
            where: { id: { in: admissionIds } },
          })
        : Promise.resolve([]),
    ]);
    const studentById = new Map(students.map((s) => [s.id, s]));
    const admissionById = new Map(admissions.map((a) => [a.id, a]));

    // Group by student when there is one; otherwise by the admission application (a pre-
    // enrollment admission-fee invoice has no student to key on yet — see `Invoice`'s own schema
    // doc comment).
    const buckets = new Map<
      string,
      { label: string; totalInvoiced: number; totalPaid: number }
    >();
    for (const invoice of invoices) {
      const key =
        invoice.studentId ?? `admission:${invoice.admissionApplicationId}`;
      const label = invoice.studentId
        ? (studentById.get(invoice.studentId)?.name ?? UNSET_LABEL)
        : (admissionById.get(invoice.admissionApplicationId ?? '')
            ?.applicantName ?? UNSET_LABEL);
      const bucket = buckets.get(key) ?? {
        label,
        totalInvoiced: 0,
        totalPaid: 0,
      };
      bucket.totalInvoiced += invoice.totalAmount;
      bucket.totalPaid += invoice.paidAmount;
      buckets.set(key, bucket);
    }
    return toRows(buckets);
  }

  private async groupByClass(
    invoices: Invoice[],
  ): Promise<OutstandingRowDto[]> {
    const studentIds = [
      ...new Set(
        invoices.map((i) => i.studentId).filter((id): id is string => !!id),
      ),
    ];
    const admissionIds = [
      ...new Set(
        invoices
          .filter((i) => !i.studentId)
          .map((i) => i.admissionApplicationId)
          .filter((id): id is string => !!id),
      ),
    ];
    const [students, admissions] = await Promise.all([
      studentIds.length
        ? this.prisma.student.findMany({ where: { id: { in: studentIds } } })
        : Promise.resolve([]),
      admissionIds.length
        ? this.prisma.admissionApplication.findMany({
            where: { id: { in: admissionIds } },
          })
        : Promise.resolve([]),
    ]);
    const studentById = new Map(students.map((s) => [s.id, s]));
    const admissionById = new Map(admissions.map((a) => [a.id, a]));

    const classIdOf = (invoice: Invoice): string =>
      (invoice.studentId
        ? studentById.get(invoice.studentId)?.classId
        : undefined) ??
      (invoice.admissionApplicationId
        ? admissionById.get(invoice.admissionApplicationId)?.classAppliedFor
        : undefined) ??
      '';

    const classIds = [...new Set(invoices.map(classIdOf).filter(Boolean))];
    const classes = classIds.length
      ? await this.prisma.schoolClass.findMany({
          where: { id: { in: classIds } },
        })
      : [];
    const classNameById = new Map(classes.map((c) => [c.id, c.name]));

    const buckets = new Map<
      string,
      { label: string; totalInvoiced: number; totalPaid: number }
    >();
    for (const invoice of invoices) {
      const classId = classIdOf(invoice);
      const key = classId || 'unassigned';
      const label = classNameById.get(classId) ?? UNSET_LABEL;
      const bucket = buckets.get(key) ?? {
        label,
        totalInvoiced: 0,
        totalPaid: 0,
      };
      bucket.totalInvoiced += invoice.totalAmount;
      bucket.totalPaid += invoice.paidAmount;
      buckets.set(key, bucket);
    }
    return toRows(buckets);
  }
}

function buildLineItems(
  structure: FeeStructure,
  discountRules: DiscountRule[],
): InvoiceLineItem[] {
  const items: InvoiceLineItem[] = [
    { label: structure.name, amount: round2(structure.amount) },
  ];
  for (const rule of discountRules) {
    const amount =
      rule.kind === 'percentage'
        ? structure.amount * (rule.value / 100)
        : rule.value;
    if (amount > 0) {
      items.push({ label: `Discount: ${rule.label}`, amount: -round2(amount) });
    }
  }
  return items;
}

function generateReceiptNumber(): string {
  return `R${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

function toRows(
  buckets: Map<
    string,
    { label: string; totalInvoiced: number; totalPaid: number }
  >,
): OutstandingRowDto[] {
  return [...buckets.entries()].map(([id, bucket]) => ({
    id,
    label: bucket.label,
    totalInvoiced: round2(bucket.totalInvoiced),
    totalPaid: round2(bucket.totalPaid),
    totalOutstanding: round2(
      Math.max(0, bucket.totalInvoiced - bucket.totalPaid),
    ),
  }));
}
