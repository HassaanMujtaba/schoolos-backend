import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { SalaryStructuresService } from './salary-structures.service';
import { SalaryStructureDto } from './dto/salary-structure.dto';
import { SalaryStructureResponseDto } from './dto/payroll-response.dto';

@ApiTags('payroll')
@Controller('payroll/salary-structures')
export class SalaryStructuresController {
  constructor(private readonly salaryStructures: SalaryStructuresService) {}

  /**
   * `frontend/src/features/payroll/api.ts`'s `getSalaryStructure` types this as
   * `SalaryStructureValues | null`. **A real, flagged nuance, not a bug:** returning JS `null`
   * from a Nest handler sends an empty `200` body, not the literal JSON string `"null"`
   * (`isNil(body) → response.send()` in `@nestjs/platform-express`'s adapter — Nest's own
   * documented behavior, not something worth working around with manual `@Res()` control for one
   * endpoint). Axios parses that empty body as `''`, not `null` — still falsy, so
   * `EmployeeSalaryPanel`'s `!structureQuery.data` check still takes the right branch, but a
   * caller doing a strict `=== null` check downstream would not match. Worth a real fix (explicit
   * `res.json(null)`) if a future caller ever needs the literal value.
   */
  @Get(':employeeId')
  @RequirePermission('payroll.read')
  get(
    @Param('employeeId') employeeId: string,
  ): Promise<SalaryStructureResponseDto | null> {
    return this.salaryStructures.get(employeeId);
  }

  @Put(':employeeId')
  @RequirePermission('payroll.run')
  upsert(
    @Param('employeeId') employeeId: string,
    @Body() dto: SalaryStructureDto,
  ): Promise<SalaryStructureResponseDto> {
    return this.salaryStructures.upsert(employeeId, dto);
  }
}
