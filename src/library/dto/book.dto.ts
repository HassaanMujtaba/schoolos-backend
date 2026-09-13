import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/** `schemas.ts`'s `bookSchema` — one DTO for create and edit, same convention as `FeeStructureDto`. */
export class BookDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(300)
  title!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(30)
  isbn!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Author is required' })
  @MaxLength(200)
  author!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  publisher!: string;

  @ApiProperty()
  @IsString()
  categoryId!: string;

  @ApiProperty()
  @IsString()
  shelfId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  edition!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  description!: string;
}

/** `GET /library/books?categoryId=&shelfId=` — `api.ts`'s `BookListParams`. */
export class ListBooksQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shelfId?: string;
}
