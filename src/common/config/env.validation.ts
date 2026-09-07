import { Type, plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Fail fast on a missing/malformed environment rather than discovering it at request time —
 * `security-standards`' "Secrets" principle assumes secrets are actually configured, not
 * silently undefined and read as `undefined` deep in a service.
 */
class EnvironmentVariables {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.Development;

  // `@Type(() => Number)` explicitly, rather than relying on `enableImplicitConversion`'s
  // reflected `design:type` metadata: that metadata is only reliable under a real `tsc` pass —
  // esbuild/SWC-based transpilation (Vite/vitest's default, and ts-node in transpile-only mode)
  // doesn't compute it for a property whose type is only inferred from its initializer, so PORT
  // silently stayed a string and failed `@IsInt()` under those runners. Explicit `@Type()` has no
  // such dependency.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  REDIS_URL!: string;

  @IsString()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_TTL = '15m';

  @IsString()
  @IsOptional()
  JWT_REFRESH_TTL = '30d';

  @IsString()
  CORS_ORIGINS!: string; // comma-separated

  // Required as of Phase 3: `documents/` (the shared upload primitive `students`/`admissions`
  // depend on) mounts unconditionally in AppModule, not behind a feature flag, so a boot with no
  // storage configured should fail loudly at startup — same "fail fast" reasoning as DATABASE_URL/
  // REDIS_URL above — rather than StorageService discovering it's misconfigured on the first real
  // upload request. Optional through Phase 0–2, when nothing used them yet.
  @IsString()
  S3_ENDPOINT!: string;

  @IsString()
  S3_BUCKET!: string;

  @IsString()
  S3_ACCESS_KEY_ID!: string;

  @IsString()
  S3_SECRET_ACCESS_KEY!: string;

  // No real region in dev (MinIO ignores it); required by the AWS SDK client constructor
  // regardless, so give it a harmless default rather than making every dev set it.
  @IsString()
  @IsOptional()
  S3_REGION = 'us-east-1';
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Invalid environment configuration: ${messages}`);
  }

  return validated;
}

export { EnvironmentVariables, NodeEnv };
