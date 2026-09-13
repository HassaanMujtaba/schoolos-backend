import { ApiProperty } from '@nestjs/swagger';

export const SERVICE_HEALTH_STATUSES = [
  'operational',
  'degraded',
  'down',
] as const;

/** `frontend/src/features/platform/api.ts`'s `SystemHealthService`. */
export class SystemHealthServiceDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: SERVICE_HEALTH_STATUSES })
  status!: (typeof SERVICE_HEALTH_STATUSES)[number];
  @ApiProperty() latencyMs!: number;
  @ApiProperty() errorRatePct!: number;
}

/** `frontend/src/features/platform/api.ts`'s `BackgroundJobQueueHealth`. */
export class BackgroundJobQueueHealthDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() pending!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ enum: SERVICE_HEALTH_STATUSES })
  status!: (typeof SERVICE_HEALTH_STATUSES)[number];
}

/** `GET /platform/system-health` — `frontend/src/features/platform/api.ts`'s `SystemHealth`. */
export class SystemHealthResponseDto {
  @ApiProperty({ type: [SystemHealthServiceDto] })
  services!: SystemHealthServiceDto[];
  @ApiProperty({ type: [BackgroundJobQueueHealthDto] })
  jobQueues!: BackgroundJobQueueHealthDto[];
}
