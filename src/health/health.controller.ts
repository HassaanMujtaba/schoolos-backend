import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { SkipAudit } from '../common/decorators/skip-audit.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisHealthIndicator } from './redis-health.indicator';

/**
 * PRD §61 Observability: liveness/readiness for infra checks and deploy health gates. Public and
 * unauthenticated by design — an orchestrator polling this shouldn't need a service account.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Public()
  @SkipAudit()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma),
      () => this.redisIndicator.pingCheck('redis'),
    ]);
  }
}
