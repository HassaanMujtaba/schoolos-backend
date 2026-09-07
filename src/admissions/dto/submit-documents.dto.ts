import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

/**
 * `PATCH /admissions/:id/documents` — `admissions/api.ts`'s `submitDocuments`. Placeholder,
 * name-only shape (no real file upload) — see `AdmissionApplication.documentNames`'s own schema
 * doc comment for why, and `../../../implementation-plan.md`'s Phase 3 notes.
 */
export class SubmitDocumentsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  fileNames!: string[];
}
