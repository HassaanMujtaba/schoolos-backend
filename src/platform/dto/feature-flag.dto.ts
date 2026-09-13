import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export const FEATURE_FLAG_SCOPES = ['platform', 'tenant'] as const;

/** `PATCH /platform/feature-flags/:id` — the only mutation this console makes (`schema.prisma`'s own `FeatureFlag` doc comment: self-service flag *creation* isn't built this phase). */
export class UpdateFeatureFlagDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

/** `frontend/src/features/platform/api.ts`'s `FeatureFlag`. */
export class FeatureFlagResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: FEATURE_FLAG_SCOPES })
  scope!: (typeof FEATURE_FLAG_SCOPES)[number];
  @ApiPropertyOptional() tenantName?: string;
  @ApiProperty() enabled!: boolean;
}
