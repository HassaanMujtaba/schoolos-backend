import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ReturnCondition } from '@prisma/client';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/** `GET /library/copies/lookup?barcode=` — `api.ts`'s `lookupCopyByBarcode`. */
export class LookupCopyQueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  barcode!: string;
}

/** `POST /library/issue` — `api.ts`'s `issueBook` payload. */
export class IssueBookDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  copyId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  memberId!: string;
}

/** `POST /library/return` — `api.ts`'s `returnBook` payload. */
export class ReturnBookDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  loanId!: string;

  @ApiProperty({ enum: ReturnCondition })
  @IsEnum(ReturnCondition)
  condition!: ReturnCondition;
}

/** `GET /library/fines?memberId=` — `api.ts`'s `FineListParams`. */
export class ListFinesQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  memberId?: string;
}
