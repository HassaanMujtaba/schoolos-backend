import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** `GET/PATCH /platform/settings` — `modules/platform-console.md`'s system-wide config, starting with just the subscription grace period (PRD item #3: "configurable by the Platform Admin"). A single-row table (`PlatformSettings`, id `"singleton"`), not per-school — see that model's own doc comment. */
export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 60 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  subscriptionGracePeriodDays?: number;
}

export class PlatformSettingsResponseDto {
  @ApiProperty() subscriptionGracePeriodDays!: number;
}
