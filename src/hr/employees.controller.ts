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
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { EmployeesService } from './employees.service';
import { EmployeeDto } from './dto/employee.dto';
import { LifecycleActionDto } from './dto/lifecycle-action.dto';
import {
  EmployeeResponseDto,
  PagedEmployeesDto,
} from './dto/employee-response.dto';

/** `frontend/src/features/hr/api.ts`'s employee directory + lifecycle surface. No `DELETE` — an employee record is never destroyed, only moved through a lifecycle action (module doc "Backend dependencies"). */
@ApiTags('hr')
@Controller()
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get('hr/employees')
  @RequirePermission('hr.read')
  list(@Query() query: ListQueryDto): Promise<PagedEmployeesDto> {
    return this.employees.list(query);
  }

  @Get('hr/employees/:id')
  @RequirePermission('hr.read')
  get(@Param('id') id: string): Promise<EmployeeResponseDto> {
    return this.employees.get(id);
  }

  @Post('hr/employees')
  @RequirePermission('hr.manage')
  create(@Body() dto: EmployeeDto): Promise<EmployeeResponseDto> {
    return this.employees.create(dto);
  }

  @Patch('hr/employees/:id')
  @RequirePermission('hr.manage')
  update(
    @Param('id') id: string,
    @Body() dto: EmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employees.update(id, dto);
  }

  @Post('hr/transfers')
  @RequirePermission('hr.manage')
  transfer(@Body() dto: LifecycleActionDto): Promise<EmployeeResponseDto> {
    return this.employees.recordLifecycleAction('transfer', dto);
  }

  @Post('hr/resignations')
  @RequirePermission('hr.manage')
  resign(@Body() dto: LifecycleActionDto): Promise<EmployeeResponseDto> {
    return this.employees.recordLifecycleAction('resignation', dto);
  }

  @Post('hr/terminations')
  @RequirePermission('hr.manage')
  terminate(@Body() dto: LifecycleActionDto): Promise<EmployeeResponseDto> {
    return this.employees.recordLifecycleAction('termination', dto);
  }
}
