import { ApiProperty } from '@nestjs/swagger';

/** `frontend/src/features/teachers/api.ts`'s `TeacherDashboardClass`. */
export class TeacherDashboardClassDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectName!: string;
  @ApiProperty() className!: string;
  @ApiProperty() sectionName!: string;
  @ApiProperty() startTime!: string;
}

/** `frontend/src/features/teachers/api.ts`'s `TeacherDashboardTask`. */
export class TeacherDashboardTaskDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() dueLabel!: string;
}

/** `frontend/src/features/teachers/api.ts`'s `TeacherDashboard` — `GET /teachers/me/dashboard`'s
 * response, resolved for the calling user's own `Teacher.userId` link (never a client-supplied
 * teacher id, same `resolveTeacherId('me', ...)` idiom every other "me" endpoint uses). */
export class TeacherDashboardDto {
  @ApiProperty({ type: [TeacherDashboardClassDto] })
  todayClasses!: TeacherDashboardClassDto[];
  @ApiProperty({ type: [TeacherDashboardTaskDto] })
  attendanceTasks!: TeacherDashboardTaskDto[];
  @ApiProperty({ type: [TeacherDashboardTaskDto] })
  pendingAssignments!: TeacherDashboardTaskDto[];
  @ApiProperty({ type: [TeacherDashboardTaskDto] })
  upcomingExams!: TeacherDashboardTaskDto[];
}
