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
import { EmployeeLeaveService } from './employee-leave.service';
import {
  LeaveBalancesQueryDto,
  ListEmployeeLeaveQueryDto,
  ReviewEmployeeLeaveRequestDto,
  SubmitEmployeeLeaveRequestDto,
} from './dto/employee-leave.dto';
import {
  EmployeeLeaveResponseDto,
  LeaveBalanceResponseDto,
  PagedEmployeeLeaveDto,
} from './dto/employee-leave-response.dto';

/** §14 Employee Leave — `frontend/src/features/hr/api.ts`'s `/leave/employee` surface. */
@ApiTags('hr')
@Controller('leave/employee')
export class EmployeeLeaveController {
  constructor(private readonly leave: EmployeeLeaveService) {}

  // No `@RequirePermission` — see `EmployeeLeaveService`'s own doc comment for why: the frontend
  // gates the submit button on `leave.request` in-component only, not at the route level
  // (`router.tsx`'s "`leave` has no gate at all" comment).
  @Post()
  submit(
    @Body() dto: SubmitEmployeeLeaveRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EmployeeLeaveResponseDto> {
    return this.leave.submit(dto, user);
  }

  @Get()
  list(
    @Query() query: ListEmployeeLeaveQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EmployeeLeaveResponseDto[] | PagedEmployeeLeaveDto> {
    return this.leave.list(query, user.id);
  }

  @Get('balances')
  getBalances(
    @Query() query: LeaveBalancesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LeaveBalanceResponseDto[]> {
    return this.leave.getBalances(query.employeeId, user.id);
  }

  @Patch(':id')
  @RequirePermission('leave.approve')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewEmployeeLeaveRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EmployeeLeaveResponseDto> {
    return this.leave.review(id, dto, user);
  }
}
