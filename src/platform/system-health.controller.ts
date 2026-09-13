import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { SystemHealthService } from './system-health.service';
import { SystemHealthResponseDto } from './dto/system-health.dto';

/** Same baseline-permission reasoning as `usage.controller.ts`. */
@ApiTags('platform')
@Controller('platform/system-health')
export class SystemHealthController {
  constructor(private readonly systemHealth: SystemHealthService) {}

  @Get()
  @RequirePermission('platform.schools.manage')
  get(): Promise<SystemHealthResponseDto> {
    return this.systemHealth.get();
  }
}
