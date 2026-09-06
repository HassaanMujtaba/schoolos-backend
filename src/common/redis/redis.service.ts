import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

/**
 * One shared Redis connection for the whole app — same "extend the client, don't wrap it"
 * pattern as `PrismaService`. Backs Phase 1's session/refresh-token store (`auth/session.service.ts`)
 * and `health/redis-health.indicator.ts`; later phases (BullMQ queues, the Socket.IO adapter) reuse
 * this connection rather than opening their own, per `../../../implementation-plan.md`'s "Cache /
 * queues" tech choice.
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(config: AppConfigService) {
    super(config.redisUrl);
    // ioredis throws if an 'error' event has no listener — this keeps a transient connection
    // blip from crashing the process; callers still see failures via rejected commands.
    this.on('error', (error) => {
      this.logger.error(
        'Redis connection error',
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  onModuleDestroy(): void {
    this.disconnect();
  }
}
