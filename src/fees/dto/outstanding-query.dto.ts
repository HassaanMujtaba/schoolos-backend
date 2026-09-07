import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const OUTSTANDING_GROUP_BYS = ['student', 'class'] as const;
export type OutstandingGroupBy = (typeof OUTSTANDING_GROUP_BYS)[number];

/** `GET /fees/outstanding?groupBy=student|class`. */
export class OutstandingQueryDto {
  @ApiPropertyOptional({ enum: OUTSTANDING_GROUP_BYS, default: 'student' })
  @IsOptional()
  @IsIn(OUTSTANDING_GROUP_BYS)
  groupBy: OutstandingGroupBy = 'student';
}
