import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { SkipAudit } from '../common/decorators/skip-audit.decorator';
import { SchoolsService } from './schools.service';
import {
  ListSchoolsQueryDto,
  PagedSchoolsDto,
  SchoolDetailResponseDto,
  SchoolOnboardingDto,
  SchoolResponseDto,
  UpdateSchoolStatusDto,
} from './dto/school.dto';

/** Every mutating route here is `@SkipAudit()` — `PlatformAuditLogService.record` is called explicitly from within `SchoolsService` instead (see its own doc comment on why the generic tenant-scoped audit interceptor can't help here). */
@ApiTags('platform')
@Controller('platform/schools')
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Get()
  @RequirePermission('platform.schools.manage')
  list(@Query() query: ListSchoolsQueryDto): Promise<PagedSchoolsDto> {
    return this.schools.list(query);
  }

  @Get(':id')
  @RequirePermission('platform.schools.manage')
  get(@Param('id') id: string): Promise<SchoolDetailResponseDto> {
    return this.schools.get(id);
  }

  @Post()
  @RequirePermission('platform.schools.manage')
  @SkipAudit()
  create(@Body() dto: SchoolOnboardingDto): Promise<SchoolResponseDto> {
    return this.schools.create(dto);
  }

  @Patch(':id')
  @RequirePermission('platform.schools.manage')
  @SkipAudit()
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSchoolStatusDto,
  ): Promise<SchoolResponseDto> {
    return this.schools.updateStatus(id, dto);
  }

  @Post(':id/resend-invite')
  @RequirePermission('platform.schools.manage')
  @SkipAudit()
  @HttpCode(HttpStatus.OK)
  resendInvite(@Param('id') id: string): Promise<void> {
    return this.schools.resendInvite(id);
  }
}
