import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBooleanString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/**
 * `schemas.ts`'s `visitorSchema` — `residentLabel` is genuinely accepted from the client here
 * (unlike `AllocateDto`), see `schema.prisma`'s `Visitor` doc comment for why.
 */
export class VisitorDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Select the resident being visited' })
  residentStudentId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  residentLabel!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: "Visitor's name is required" })
  @MaxLength(200)
  visitorName!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Relation to resident is required' })
  @MaxLength(100)
  relation!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  purpose!: string;
}

/**
 * `api.ts`'s `VisitorListParams` — `open` arrives as the string `"true"`/`"false"` over the wire
 * (axios serializes a boolean query param that way); `@IsBooleanString` validates that shape
 * without class-transformer's `Boolean(...)` coercion footgun (`Boolean('false') === true`), and
 * `HostelVisitorsService` compares against the literal string itself.
 */
export class ListVisitorsQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBooleanString()
  open?: string;
}
