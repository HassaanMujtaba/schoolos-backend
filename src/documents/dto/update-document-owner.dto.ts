import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The two-step upload flow's second step (`../../../implementation-plan.md`'s Phase 3 problem #2):
 * a document uploaded with `ownerId: null` (the owning entity — a new student, a new admission —
 * didn't exist yet) gets attached here once it does. Not yet called by the built frontend (its
 * `documents/api.ts` has no `updateDocument`/attach function) — this is the backend half of that
 * still-open frontend wiring item.
 */
export class UpdateDocumentOwnerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  ownerId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  ownerLabel?: string;
}
