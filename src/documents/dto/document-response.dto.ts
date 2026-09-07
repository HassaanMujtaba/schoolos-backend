import { ApiProperty } from '@nestjs/swagger';
import { DocumentCategory } from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

/** `documents/api.ts`'s `DocumentRecord` — the owning record plus its latest version's content. */
export class DocumentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: DocumentCategory }) category!: DocumentCategory;
  @ApiProperty({ nullable: true, type: String }) ownerId!: string | null;
  @ApiProperty({ nullable: true, type: String }) ownerLabel!: string | null;
  @ApiProperty() fileName!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() version!: number;
  @ApiProperty() uploadedAt!: string;
  @ApiProperty() uploadedByLabel!: string;
  /** Presigned, time-limited — never a stable/public URL (`StorageService`'s own doc comment). */
  @ApiProperty() url!: string;
}

export class PagedDocumentsDto implements PagedResult<DocumentResponseDto> {
  @ApiProperty({ type: [DocumentResponseDto] }) items!: DocumentResponseDto[];
  @ApiProperty() total!: number;
}

/** `documents/api.ts`'s `DocumentVersion`. */
export class DocumentVersionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: number;
  @ApiProperty() fileName!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() uploadedAt!: string;
  @ApiProperty() uploadedByLabel!: string;
  @ApiProperty() url!: string;
}
