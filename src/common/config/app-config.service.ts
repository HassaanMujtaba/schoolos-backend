import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeEnv } from './env.validation';

/**
 * Thin typed wrapper around ConfigService so the rest of the app never calls `process.env`
 * directly (and never spells a config key as a raw string more than once).
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): NodeEnv {
    return this.config.get<NodeEnv>('NODE_ENV', NodeEnv.Development);
  }

  get isProduction(): boolean {
    return this.nodeEnv === NodeEnv.Production;
  }

  get port(): number {
    return this.config.get<number>('PORT', 3000);
  }

  get databaseUrl(): string {
    return this.getOrThrow('DATABASE_URL');
  }

  get redisUrl(): string {
    return this.getOrThrow('REDIS_URL');
  }

  get jwtAccessSecret(): string {
    return this.getOrThrow('JWT_ACCESS_SECRET');
  }

  get jwtRefreshSecret(): string {
    return this.getOrThrow('JWT_REFRESH_SECRET');
  }

  get jwtAccessTtl(): string {
    return this.config.get<string>('JWT_ACCESS_TTL', '15m');
  }

  get jwtRefreshTtl(): string {
    return this.config.get<string>('JWT_REFRESH_TTL', '30d');
  }

  get corsOrigins(): string[] {
    return this.getOrThrow('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  private getOrThrow(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  }
}
