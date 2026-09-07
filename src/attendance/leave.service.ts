import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeaveRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PagedResult } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { formatDateOnly, parseDateOnly } from '../common/dates/date-only';
import { resolveStudentId } from '../common/identity/resolve-me';
import { SubmitLeaveRequestDto } from './dto/leave-request.dto';
import { ReviewLeaveRequestDto } from './dto/review-leave-request.dto';
import { ListLeaveQueryDto } from './dto/list-leave-query.dto';
import { LeaveRequestResponseDto } from './dto/leave-response.dto';

/**
 * §14 Student Leave — this module owns the teacher/admin review queue and the record itself; the
 * parent-side submission form renders inside the portal shell (`parents.md`), but lives here per
 * `attendance.md`'s own "Requirements" split.
 */
@Injectable()
export class LeaveService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `POST /leave/student` — "Parent submits — own child only", per `attendance.md`. Not gated by
   * any `@RequirePermission` (nothing in the built frontend's `LeaveRequestForm` checks a
   * permission before rendering it — a Parent has no `leave.*`/`attendance.*` grant at all in the
   * seeded catalog), so ownership is enforced here instead: the caller must either be marking
   * attendance staff (`attendance.mark`/`attendance.modify` — Admin/Teacher data entry on a
   * parent's behalf, a reasonable extension the doc doesn't forbid) or the linked parent of this
   * exact student (`Parent.userId`, same documented-gap resolution as `getMyChildren`).
   */
  async submit(
    dto: SubmitLeaveRequestDto,
    user: AuthenticatedUser,
  ): Promise<LeaveRequestResponseDto> {
    await this.assertStudentExists(dto.studentId);
    await this.assertCanActForStudent(dto.studentId, user);

    const leave = await this.prisma.leaveRequest.create({
      data: {
        studentId: dto.studentId,
        startDate: parseDateOnly(dto.startDate),
        endDate: parseDateOnly(dto.endDate),
        reason: dto.reason,
        status: 'pending',
        submittedByUserId: user.id,
        submittedByLabel: user.name,
      } as unknown as Prisma.LeaveRequestUncheckedCreateInput,
    });
    return (await this.toResponses([leave]))[0];
  }

  /**
   * `GET /leave/student` — two documented shapes on one endpoint, see `ListLeaveQueryDto`'s own
   * comment: `studentId` present → a plain array (own history, `'me'` idiom supported); absent →
   * the paginated review queue, optionally filtered by `status`.
   */
  async list(
    query: ListLeaveQueryDto,
    currentUserId: string | null,
  ): Promise<LeaveRequestResponseDto[] | PagedResult<LeaveRequestResponseDto>> {
    if (query.studentId) {
      const studentId = await resolveStudentId(
        this.prisma,
        query.studentId,
        currentUserId,
      );
      const leaves = await this.prisma.leaveRequest.findMany({
        where: { studentId },
        orderBy: { createdAt: 'desc' },
      });
      return this.toResponses(leaves);
    }

    const where: Prisma.LeaveRequestWhereInput = query.status
      ? { status: query.status }
      : {};
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const result = await paginate(
      () =>
        this.prisma.leaveRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.leaveRequest.count({ where }),
    );
    return { items: await this.toResponses(result.items), total: result.total };
  }

  /** `PATCH /leave/student/:id` — approve/reject, gated by `attendance.modify` at the route level
   * (`attendance.md`'s own resolved decision: "No dedicated leave-review permission string..."). */
  async review(
    id: string,
    dto: ReviewLeaveRequestDto,
    user: AuthenticatedUser,
  ): Promise<LeaveRequestResponseDto> {
    await this.findOrThrow(id);
    const leave = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: dto.status,
        reviewNotes: dto.reviewNotes ?? null,
        reviewedByUserId: user.id,
        reviewedByLabel: user.name,
      },
    });
    return (await this.toResponses([leave]))[0];
  }

  private async assertCanActForStudent(
    studentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const staffPermissions = ['attendance.mark', 'attendance.modify'];
    if (staffPermissions.some((p) => user.permissions.includes(p))) return;

    const parent = await this.prisma.parent.findUnique({
      where: { userId: user.id },
    });
    const link = parent
      ? await this.prisma.parentStudentLink.findFirst({
          where: { parentId: parent.id, studentId },
        })
      : null;
    if (!link) {
      throw new ForbiddenException(
        'Not authorized to submit a leave request for this student',
      );
    }
  }

  private async assertStudentExists(studentId: string): Promise<void> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException(`Student ${studentId} not found`);
    }
  }

  private async findOrThrow(id: string): Promise<LeaveRequest> {
    const leave = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave) {
      throw new NotFoundException(`Leave request ${id} not found`);
    }
    return leave;
  }

  private async toResponses(
    leaves: LeaveRequest[],
  ): Promise<LeaveRequestResponseDto[]> {
    const studentIds = [...new Set(leaves.map((l) => l.studentId))];
    const students = studentIds.length
      ? await this.prisma.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(students.map((s) => [s.id, s.name]));

    return leaves.map((l) => ({
      id: l.id,
      studentId: l.studentId,
      studentName: nameById.get(l.studentId) ?? '',
      dateRange: {
        from: formatDateOnly(l.startDate),
        to: formatDateOnly(l.endDate),
      },
      reason: l.reason,
      status: l.status,
      submittedBy: l.submittedByLabel,
      reviewedBy: l.reviewedByLabel,
      reviewNotes: l.reviewNotes,
    }));
  }
}
