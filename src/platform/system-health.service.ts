import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { StorageService } from '../common/storage/storage.service';
import {
  BackgroundJobQueueHealthDto,
  SystemHealthResponseDto,
  SystemHealthServiceDto,
} from './dto/system-health.dto';

type Status = 'operational' | 'degraded' | 'down';

// Purely a "is this obviously slow" signal, not a tuned SLO — there's no real traffic history in
// this environment to derive a percentile threshold from.
const DEGRADED_LATENCY_MS = 500;

/**
 * `GET /platform/system-health`. `services` are real timed pings against this app's own actual
 * infra (`PrismaService`/`RedisService`/`StorageService` — the same three `health.controller.ts`'s
 * `/health` already checks, reused here for latency numbers Terminus's boolean up/down doesn't
 * give). `errorRatePct` per service is `0` — there's no per-service error-rate tracker anywhere in
 * this codebase to read a real one from (`usage.service.ts`'s own doc comment on the same gap).
 *
 * `jobQueues` is always `[]` — this codebase has no background job queue (no BullMQ, no cron
 * worker; PRD §46's background workers are still Phase 7.7's TODO'd notifications worker). An
 * honest empty list, not a fabricated queue that doesn't exist.
 */
@Injectable()
export class SystemHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async get(): Promise<SystemHealthResponseDto> {
    const services = await Promise.all([
      this.check(
        'postgres',
        'PostgreSQL',
        () => this.prisma.$queryRaw`SELECT 1`,
      ),
      this.check('redis', 'Redis', () => this.redis.ping()),
      this.check('storage', 'Object storage', () => this.storage.ping()),
    ]);

    const jobQueues: BackgroundJobQueueHealthDto[] = [];

    return { services, jobQueues };
  }

  private async check(
    id: string,
    name: string,
    probe: () => Promise<unknown>,
  ): Promise<SystemHealthServiceDto> {
    const startedAt = Date.now();
    let status: Status = 'operational';
    try {
      await probe();
      const latencyMs = Date.now() - startedAt;
      if (latencyMs > DEGRADED_LATENCY_MS) status = 'degraded';
      return { id, name, status, latencyMs, errorRatePct: 0 };
    } catch {
      return {
        id,
        name,
        status: 'down',
        latencyMs: Date.now() - startedAt,
        errorRatePct: 0,
      };
    }
  }
}
