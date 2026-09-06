import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { AppConfigService } from '../common/config/app-config.service';

@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    config: AppConfigService,
  ) {
    this.client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      if (this.client.status !== 'ready') {
        await this.client.connect();
      }
      await this.client.ping();
      return indicator.up();
    } catch (error) {
      return indicator.down({
        message: error instanceof Error ? error.message : 'unreachable',
      });
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
