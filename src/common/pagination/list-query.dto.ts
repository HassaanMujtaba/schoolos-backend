import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * The standard list-query shape every `frontend/modules/*.md` "Backend dependencies" section
 * assumes (first written out in `modules/school-setup.md`, per
 * `../../../implementation-plan.md`'s Phase 2 note that this phase's list→form→detail pattern is
 * reused by every later module): `{ page, pageSize, sortBy?, sortDir?, search? }`, 1-indexed
 * `page`, matching `frontend/src/features/school-setup/api.ts`'s `ListParams`/`toListQuery`
 * exactly. Every controller's list endpoint accepts this (or a narrow subclass adding its own
 * filter fields, e.g. `sections.controller.ts`'s `classId`).
 */
export class ListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  // 200, not 100: frontend/src/features/school-setup/hooks.ts's `useClassesQuery`/
  // `useSubjectsQuery` deliberately over-fetch `pageSize: 200` in one page to populate an
  // in-memory picker (Sections' class select, Subjects' classIds picker, ClassDetailPage's
  // subjects tab) rather than paginating a dropdown — found live (a 400 on that exact call)
  // clicking through Phase 2's own screens against this real backend. A tighter cap here would
  // silently break every one of those pickers.
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
}
