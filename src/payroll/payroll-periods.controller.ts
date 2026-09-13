import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { PayrollPeriodsService } from './payroll-periods.service';
import { PayrollPeriodDto } from './dto/payroll-period.dto';
import {
  PagedPayrollPeriodsDto,
  PayrollPeriodResponseDto,
} from './dto/payroll-response.dto';

/** `frontend/src/features/payroll/api.ts`'s period surface — `draft → generated → approved`. */
@ApiTags('payroll')
@Controller('payroll/periods')
export class PayrollPeriodsController {
  constructor(private readonly periods: PayrollPeriodsService) {}

  @Get()
  @RequirePermission('payroll.read')
  list(@Query() query: ListQueryDto): Promise<PagedPayrollPeriodsDto> {
    return this.periods.list(query);
  }

  @Get(':id')
  @RequirePermission('payroll.read')
  get(@Param('id') id: string): Promise<PayrollPeriodResponseDto> {
    return this.periods.get(id);
  }

  @Post()
  @RequirePermission('payroll.run')
  create(@Body() dto: PayrollPeriodDto): Promise<PayrollPeriodResponseDto> {
    return this.periods.create(dto);
  }

  @Post(':id/run')
  @RequirePermission('payroll.run')
  run(@Param('id') id: string): Promise<PayrollPeriodResponseDto> {
    return this.periods.run(id);
  }

  @Post(':id/approve')
  @RequirePermission('payroll.approve')
  approve(@Param('id') id: string): Promise<PayrollPeriodResponseDto> {
    return this.periods.approve(id);
  }
}
