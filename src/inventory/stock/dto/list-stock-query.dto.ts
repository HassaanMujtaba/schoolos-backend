import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../../common/pagination/list-query.dto';

/** `api.ts`'s `listStock`'s `ListStockParams` — the standard list query plus a `categoryId` filter. */
export class ListStockQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;
}
