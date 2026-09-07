import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DocumentCategory } from '@prisma/client';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/** `GET /documents?category=&ownerId=` — `documents/api.ts`'s `DocumentListParams`. */
export class ListDocumentsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: DocumentCategory })
  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerId?: string;
}
