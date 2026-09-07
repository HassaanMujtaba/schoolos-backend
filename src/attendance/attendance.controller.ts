import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { AttendanceService } from './attendance.service';
import { BulkAttendanceDto } from './dto/bulk-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance-query.dto';
import { AttendanceAnalyticsQueryDto } from './dto/attendance-analytics-query.dto';
import {
  AttendanceAnalyticsResponseDto,
  AttendanceRecordResponseDto,
} from './dto/attendance-response.dto';

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  // Declared before the plain `GET /attendance` filter route — same literal-segment-first
  // ordering as `StudentsController.export`.
  @Get('analytics')
  @RequirePermission('attendance.read')
  getAnalytics(
    @Query() query: AttendanceAnalyticsQueryDto,
  ): Promise<AttendanceAnalyticsResponseDto> {
    return this.attendanceService.getAnalytics(query);
  }

  @Get('export')
  @RequirePermission('attendance.export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="attendance.csv"')
  export(@Query() query: AttendanceAnalyticsQueryDto): Promise<string> {
    return this.attendanceService.exportCsv(query);
  }

  @Get()
  @RequirePermission('attendance.read')
  list(
    @Query() query: ListAttendanceQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttendanceRecordResponseDto[]> {
    return this.attendanceService.getFiltered(query, user.id);
  }

  @Post('bulk')
  @RequirePermission('attendance.mark')
  bulkSubmit(
    @Body() dto: BulkAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttendanceRecordResponseDto[]> {
    return this.attendanceService.bulkSubmit(dto, user);
  }

  @Patch(':id')
  @RequirePermission('attendance.modify')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttendanceRecordResponseDto> {
    return this.attendanceService.updateRecord(id, dto, user);
  }
}
