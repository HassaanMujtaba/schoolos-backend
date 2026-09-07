import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { PagedResult } from '../common/pagination/list-query.dto';
import { LeaveService } from './leave.service';
import { SubmitLeaveRequestDto } from './dto/leave-request.dto';
import { ReviewLeaveRequestDto } from './dto/review-leave-request.dto';
import { ListLeaveQueryDto } from './dto/list-leave-query.dto';
import { LeaveRequestResponseDto } from './dto/leave-response.dto';

/** §14 Student Leave — `frontend/src/features/attendance/api.ts`'s `/leave/student` surface. */
@ApiTags('attendance')
@Controller('leave/student')
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  // No `@RequirePermission` — see `LeaveService.submit`'s own doc comment for why ownership is
  // enforced in the service instead of a route-level permission gate.
  @Post()
  submit(
    @Body() dto: SubmitLeaveRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeaveRequestResponseDto> {
    return this.leaveService.submit(dto, user);
  }

  // No `@RequirePermission` either: a student/parent's own history (`?studentId=`) needs no
  // special grant, and the admin/teacher review queue's own actions (approve/reject below) are
  // what's actually gated — matches `attendance.md`'s "no dedicated leave-review permission"
  // resolution for the *review* step, while the plain list itself was never gated on the frontend.
  @Get()
  list(
    @Query() query: ListLeaveQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeaveRequestResponseDto[] | PagedResult<LeaveRequestResponseDto>> {
    return this.leaveService.list(query, user.id);
  }

  @Patch(':id')
  @RequirePermission('attendance.modify')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewLeaveRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeaveRequestResponseDto> {
    return this.leaveService.review(id, dto, user);
  }
}
