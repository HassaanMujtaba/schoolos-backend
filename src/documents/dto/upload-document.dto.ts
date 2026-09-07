import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DocumentCategory } from '@prisma/client';

/**
 * The non-file fields of `POST /documents/upload`'s `multipart/form-data` body —
 * `frontend/src/features/documents/schemas.ts`'s `documentUploadSchema`. `ownerId`/`ownerLabel`
 * stay optional per that schema's own comment (free text, not a search-and-pick) — a `null` owner
 * here is the two-step-upload case (`../../../implementation-plan.md`'s Phase 3 problem #2).
 */
export class UploadDocumentDto {
  @ApiProperty({ enum: DocumentCategory })
  @IsEnum(DocumentCategory)
  category!: DocumentCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ownerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  ownerLabel?: string;
}
