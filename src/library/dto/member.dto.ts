import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Max,
} from 'class-validator';
import { LibraryMemberStatus, LibraryMemberType } from '@prisma/client';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/** `schemas.ts`'s `memberSchema`. */
export class MemberDto {
  @ApiProperty({ enum: LibraryMemberType })
  @IsEnum(LibraryMemberType)
  memberType!: LibraryMemberType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Select a student or teacher' })
  personId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  personLabel!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @IsPositive({ message: 'Must be at least 1' })
  @Max(50)
  maxBooks!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @IsPositive({ message: 'Must be at least 1' })
  @Max(180)
  loanPeriodDays!: number;
}

export class UpdateMemberStatusDto {
  @ApiProperty({ enum: LibraryMemberStatus })
  @IsEnum(LibraryMemberStatus)
  status!: LibraryMemberStatus;
}

/** `GET /library/members?memberType=` — `api.ts`'s `MemberListParams`. */
export class ListMembersQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: LibraryMemberType })
  @IsOptional()
  @IsEnum(LibraryMemberType)
  memberType?: LibraryMemberType;
}
