import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ComplaintCategory } from '@prisma/client';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/**
 * `schemas.ts`'s `COMPLAINT_STATUSES` — a plain string, not a Prisma enum, see `schema.prisma`'s
 * `Complaint.status` doc comment (and `Asset.status`'s, the first place this lesson was learned)
 * for why: `"in-progress"` is hyphenated and a Prisma enum member name can't hold that.
 */
export const COMPLAINT_STATUSES = ['open', 'in-progress', 'resolved'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** `schemas.ts`'s `complaintSchema` — `roomId`/`residentStudentId`/`residentLabel` are optional (empty-string sentinel from the form, normalized to `null` here, same convention `transport`'s `feeStructureId` already set). */
export class ComplaintDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Select a hostel' })
  hostelId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  roomId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  residentStudentId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  residentLabel?: string;

  @ApiProperty({ enum: ComplaintCategory })
  @IsIn(['maintenance', 'food', 'discipline', 'other'])
  category!: ComplaintCategory;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Description is required' })
  @MaxLength(1000)
  description!: string;
}

/** `schemas.ts`'s `complaintResolutionSchema` — `PATCH /hostel/complaints/:id`'s body. */
export class ComplaintResolutionDto {
  @ApiProperty({ enum: COMPLAINT_STATUSES })
  @IsIn(COMPLAINT_STATUSES)
  status!: ComplaintStatus;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  resolutionNotes!: string;
}

/** `api.ts`'s `ComplaintListParams`. */
export class ListComplaintsQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hostelId?: string;

  @ApiPropertyOptional({ enum: COMPLAINT_STATUSES })
  @IsOptional()
  @IsIn(COMPLAINT_STATUSES)
  status?: ComplaintStatus;
}
