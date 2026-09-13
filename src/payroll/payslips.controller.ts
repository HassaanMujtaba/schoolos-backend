import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { PayslipsService } from './payslips.service';
import { ListPayslipsQueryDto } from './dto/payroll-period.dto';
import {
  PagedPayslipsDto,
  PayslipResponseDto,
} from './dto/payroll-response.dto';

/** `frontend/src/features/payroll/api.ts`'s payslip surface — see `PayslipsService`'s own doc comment for why neither route below carries a `@RequirePermission`. */
@ApiTags('payroll')
@Controller('payroll/payslips')
export class PayslipsController {
  constructor(private readonly payslips: PayslipsService) {}

  @Get()
  list(
    @Query() query: ListPayslipsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PagedPayslipsDto> {
    return this.payslips.list(query, user.id);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<PayslipResponseDto> {
    return this.payslips.get(id);
  }
}
