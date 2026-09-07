import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ExaminationsService } from './examinations.service';
import { ReportCardResponseDto } from './dto/exam-response.dto';

/**
 * `GET /report-cards/:studentId?examId=` — shared by the back office and the Parent/Student
 * portal. No `@RequirePermission` here, same reason `LeaveController`'s shared `/leave/student`
 * routes have none: a portal caller has no `results.*` grant in the seeded catalog at all, so
 * gating the route itself would 403 every parent/student before the service ever runs its own
 * ownership + publish-state check — see `ExaminationsService.getReportCard`'s own doc comment for
 * that check.
 */
@ApiTags('examinations')
@Controller('report-cards')
export class ReportCardsController {
  constructor(private readonly examinationsService: ExaminationsService) {}

  @Get(':studentId')
  get(
    @Param('studentId') studentId: string,
    @Query('examId') examId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReportCardResponseDto> {
    return this.examinationsService.getReportCard(studentId, examId, user);
  }
}
