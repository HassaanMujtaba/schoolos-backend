import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SchoolsService } from './schools.service';
import { SchoolProfileDto } from './dto/school.dto';
import { SchoolResponseDto } from './dto/school-response.dto';
import { SubscriptionStatusResponseDto } from './dto/subscription-status.dto';

@ApiTags('schools')
@Controller('schools')
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  @Get('current')
  @RequirePermission('school.read')
  getCurrent(): Promise<SchoolResponseDto> {
    return this.schoolsService.getCurrent();
  }

  @Patch('current')
  @RequirePermission('school.update')
  updateCurrent(@Body() dto: SchoolProfileDto): Promise<SchoolResponseDto> {
    return this.schoolsService.updateCurrent(dto);
  }

  /** Drives the tenant portal's subscription/grace-period banner — School Owner/Admin only (`school.billing.read`, seeded for just those two roles). */
  @Get('current/subscription-status')
  @RequirePermission('school.billing.read')
  getSubscriptionStatus(): Promise<SubscriptionStatusResponseDto> {
    return this.schoolsService.getSubscriptionStatus();
  }
}
