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

  // S3/MinIO — documents/ (Phase 3). Optional at the env-validation level (a deploy that never
  // touches file upload shouldn't be forced to configure storage), but `StorageService` throws its
  // own clear error the first time something actually needs it and a value is missing, same
  // "fail fast, not deep in a service with `undefined`" reasoning as `getOrThrow` below.
  get s3Endpoint(): string {
    return this.getOrThrow('S3_ENDPOINT');
  }

  get s3Bucket(): string {
    return this.getOrThrow('S3_BUCKET');
  }

  get s3AccessKeyId(): string {
    return this.getOrThrow('S3_ACCESS_KEY_ID');
  }

  get s3SecretAccessKey(): string {
    return this.getOrThrow('S3_SECRET_ACCESS_KEY');
  }

  get s3Region(): string {
    return this.config.get<string>('S3_REGION', 'us-east-1');
  }

  // Phase 7.1 — see `env.validation.ts`'s own doc comment on `FRONTEND_BASE_URL`.
  get frontendBaseUrl(): string {
    return this.config.get<string>(
      'FRONTEND_BASE_URL',
      'http://localhost:5173',
    );
  }

  // See `env.validation.ts`'s own doc comment for why this is optional (unlike the S3_* getters
  // above, which throw): `undefined` `resendApiKey` just means `MailerService` logs instead of
  // sending. Raw SMTP (this project's original approach) turned out to be unreliable from
  // Render's network reaching Gmail specifically — connections either timed out or, for Gmail's
  // IPv6 address, failed immediately with ENETUNREACH — so mail goes through Resend's HTTPS API
  // instead, which isn't subject to the outbound port-25/465/587 restrictions PaaS hosts commonly
  // apply.
  get resendApiKey(): string | undefined {
    return this.config.get<string>('RESEND_API_KEY');
  }

  get resendFrom(): string {
    return this.config.get<string>(
      'RESEND_FROM',
      'SchoolOS <onboarding@resend.dev>',
    );
  }

  private getOrThrow(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  }
}
