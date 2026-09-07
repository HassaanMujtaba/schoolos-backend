import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { SearchResultDto } from './dto/search-response.dto';

const RESULTS_PER_CATEGORY = 5;
const MIN_QUERY_LENGTH = 2;

/**
 * `GET /search?q=&type=` — `frontend/modules/fees.md` "Global search wiring" /
 * `app/layout/searchApi.ts`. No `@RequirePermission` on the route (`SearchController`'s own
 * comment) — any authenticated user can search, but each category below is gated on the same
 * read permission that category's own list endpoint requires, so a caller never sees a result
 * type their role couldn't otherwise read. `type` narrows to one category when given; omitted
 * means "every category the caller can read."
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    q: string,
    type: string | undefined,
    user: AuthenticatedUser,
  ): Promise<SearchResultDto[]> {
    const query = q?.trim() ?? '';
    if (query.length < MIN_QUERY_LENGTH) return [];

    const wants = (category: string) => !type || type === category;
    const can = (permission: string) => user.permissions.includes(permission);

    const [students, teachers, parents, admissions, invoices] =
      await Promise.all([
        wants('student') && can('students.read')
          ? this.searchStudents(query)
          : Promise.resolve([]),
        wants('teacher') && can('teachers.read')
          ? this.searchTeachers(query)
          : Promise.resolve([]),
        wants('parent') && can('parents.read')
          ? this.searchParents(query)
          : Promise.resolve([]),
        wants('admission') && can('admissions.read')
          ? this.searchAdmissions(query)
          : Promise.resolve([]),
        wants('invoice') && can('fees.read')
          ? this.searchInvoices(query)
          : Promise.resolve([]),
      ]);

    return [...students, ...teachers, ...parents, ...admissions, ...invoices];
  }

  private async searchStudents(q: string): Promise<SearchResultDto[]> {
    const students = await this.prisma.student.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { admissionNumber: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: RESULTS_PER_CATEGORY,
    });
    return students.map((s) => ({
      id: s.id,
      type: 'student',
      label: s.name,
      sublabel: `#${s.admissionNumber}`,
      href: `/dashboard/students/${s.id}`,
    }));
  }

  private async searchTeachers(q: string): Promise<SearchResultDto[]> {
    const teachers = await this.prisma.teacher.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { employeeId: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: RESULTS_PER_CATEGORY,
    });
    return teachers.map((t) => ({
      id: t.id,
      type: 'teacher',
      label: t.name,
      sublabel: t.employeeId,
      href: `/dashboard/teachers/${t.id}`,
    }));
  }

  private async searchParents(q: string): Promise<SearchResultDto[]> {
    const parents = await this.prisma.parent.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: RESULTS_PER_CATEGORY,
    });
    return parents.map((p) => ({
      id: p.id,
      type: 'parent',
      label: p.name,
      sublabel: p.phone,
      href: `/dashboard/parents/${p.id}`,
    }));
  }

  private async searchAdmissions(q: string): Promise<SearchResultDto[]> {
    const admissions = await this.prisma.admissionApplication.findMany({
      where: {
        OR: [
          { applicantName: { contains: q, mode: 'insensitive' } },
          { contactPhone: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: RESULTS_PER_CATEGORY,
    });
    return admissions.map((a) => ({
      id: a.id,
      type: 'admission',
      label: a.applicantName,
      sublabel: a.stage,
      href: `/dashboard/admissions/${a.id}`,
    }));
  }

  private async searchInvoices(q: string): Promise<SearchResultDto[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        OR: [
          { student: { is: { name: { contains: q, mode: 'insensitive' } } } },
          {
            admissionApplication: {
              is: { applicantName: { contains: q, mode: 'insensitive' } },
            },
          },
        ],
      },
      include: { student: true, admissionApplication: true },
      take: RESULTS_PER_CATEGORY,
    });
    return invoices.map((i) => ({
      id: i.id,
      type: 'invoice',
      label:
        i.student?.name ?? i.admissionApplication?.applicantName ?? 'Invoice',
      sublabel: `${i.status} — ${i.totalAmount.toLocaleString()}`,
      href: `/dashboard/fees/invoices/${i.id}`,
    }));
  }
}
