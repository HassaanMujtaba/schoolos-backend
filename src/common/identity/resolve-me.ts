import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The `me` idiom (`../../../implementation-plan.md`'s Phase 4 "platform-wide convention"): any
 * endpoint accepting a `studentId`/`teacherId` query param also accepts the literal string `'me'`,
 * resolved server-side from the authenticated session — never trusted from a client-supplied id
 * (PRD §52). Used by `GET /attendance?studentId=me`, `GET /homework?studentId=me`, and
 * `GET /timetable?teacherId=me` this phase; Phase 7+ modules that reuse this idiom (HR & Payroll's
 * `employeeId=me`, Library's portal `studentId=me`) should call these same helpers rather than
 * reinventing the resolution, per that doc's own note.
 *
 * Mirrors `ParentsService.getMyChildren`'s existing `Parent.userId` resolution exactly,
 * generalized to `Student`/`Teacher`'s own (also-unprovisioned, see each field's own schema doc
 * comment) `userId` link. 404s today for every caller, same documented gap as
 * `GET /parents/me/children` — nothing provisions `Student.userId`/`Teacher.userId` yet (no
 * student/teacher portal-invite flow exists). Once one does, these need no change: they already
 * resolve entirely from the authenticated user's id.
 */
export async function resolveStudentId(
  prisma: PrismaService,
  rawStudentId: string,
  currentUserId: string | null,
): Promise<string> {
  if (rawStudentId !== 'me') return rawStudentId;
  const student =
    currentUserId &&
    (await prisma.student.findUnique({ where: { userId: currentUserId } }));
  if (!student) {
    throw new NotFoundException('No student profile linked to this account');
  }
  return student.id;
}

export async function resolveTeacherId(
  prisma: PrismaService,
  rawTeacherId: string,
  currentUserId: string | null,
): Promise<string> {
  if (rawTeacherId !== 'me') return rawTeacherId;
  const teacher =
    currentUserId &&
    (await prisma.teacher.findUnique({ where: { userId: currentUserId } }));
  if (!teacher) {
    throw new NotFoundException('No teacher profile linked to this account');
  }
  return teacher.id;
}

/** Phase 7.6 — HR & Payroll's `employeeId=me`, exactly the reuse this file's own header comment earmarked. */
export async function resolveEmployeeId(
  prisma: PrismaService,
  rawEmployeeId: string,
  currentUserId: string | null,
): Promise<string> {
  if (rawEmployeeId !== 'me') return rawEmployeeId;
  const employee =
    currentUserId &&
    (await prisma.employee.findUnique({ where: { userId: currentUserId } }));
  if (!employee) {
    throw new NotFoundException('No employee profile linked to this account');
  }
  return employee.id;
}
