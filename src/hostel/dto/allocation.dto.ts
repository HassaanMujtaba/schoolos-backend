import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { AllocationStatus } from '@prisma/client';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/**
 * `api.ts`'s `createAllocation` payload — deliberately just the student/room/bed, no
 * `studentLabel` (see `schema.prisma`'s `Allocation` doc comment for why).
 */
export class AllocateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Select a student' })
  studentId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Select a room' })
  roomId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bedNumber!: number;
}

/** `reassignAllocation`'s payload — same room/bed pair, no student (the allocation already has one). */
export class ReassignDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Select a room' })
  roomId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bedNumber!: number;
}

/** `api.ts`'s `AllocationListParams`. */
export class ListAllocationsQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hostelId?: string;

  @ApiPropertyOptional({ enum: ['active', 'vacated'] })
  @IsOptional()
  @IsIn(['active', 'vacated'])
  status?: AllocationStatus;
}
