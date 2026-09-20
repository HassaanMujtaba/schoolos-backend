import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { PagedResult } from '../../common/pagination/list-query.dto';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/** Matches `frontend/src/features/platform/schemas.ts`'s `SCHOOL_STATUSES` exactly — see `platform.mappers.ts`'s `lowerEnum`/`upperEnum` for the Prisma-enum round trip. */
export const SCHOOL_STATUSES = ['active', 'suspended', 'trial'] as const;

/** `POST /platform/schools` — `frontend/src/features/platform/schemas.ts`'s `schoolOnboardingSchema`. Deliberately minimal: provisioning a tenant, not configuring one (that module doc's own framing). `monthlyAmount` is the PKR price negotiated with this school before onboarding — see `platform/subscriptions.service.ts`. */
export class SchoolOnboardingDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'School name is required' })
  @MaxLength(200)
  name!: string;

  @ApiProperty()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(200)
  contactEmail!: string;

  @ApiProperty({ description: 'Negotiated monthly subscription price, in PKR' })
  @IsNumber()
  @IsPositive()
  monthlyAmount!: number;
}

/** `PATCH /platform/schools/:id` — the frontend only ever sends `{ status }` (suspend/reinstate, `api.ts`'s `suspendSchool`/`reinstateSchool`), never a name/email edit here (that's School Setup's own `/school` endpoint once the owner is inside their tenant). */
export class UpdateSchoolStatusDto {
  @ApiProperty({ enum: SCHOOL_STATUSES })
  @IsIn(SCHOOL_STATUSES)
  status!: (typeof SCHOOL_STATUSES)[number];
}

export class ListSchoolsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: SCHOOL_STATUSES })
  @IsOptional()
  @IsIn(SCHOOL_STATUSES)
  status?: (typeof SCHOOL_STATUSES)[number];
}

/** `frontend/src/features/platform/api.ts`'s `School`. */
export class SchoolResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() contactEmail!: string;
  @ApiProperty({ enum: SCHOOL_STATUSES })
  status!: (typeof SCHOOL_STATUSES)[number];
  @ApiProperty() monthlyAmount!: number;
  @ApiProperty() branchCount!: number;
  @ApiProperty() userCount!: number;
  @ApiProperty() studentCount!: number;
  @ApiProperty() createdAt!: string;
}

/**
 * `POST /platform/schools`'s response — `SchoolResponseDto` plus the owner's "set your password"
 * link. This project's Render deploy currently can't reach any SMTP host (see
 * `MailerService`'s own doc comment), so the link is returned directly rather than relying
 * entirely on email delivery; the platform console surfaces it so onboarding can still be tested
 * end to end. Safe here: this endpoint is already gated on `platform.schools.manage`.
 */
export class SchoolOnboardingResponseDto extends SchoolResponseDto {
  @ApiProperty() inviteLink!: string;
}

/** `POST /platform/schools/:id/resend-invite`'s response — same reasoning as `SchoolOnboardingResponseDto`. */
export class ResendInviteResponseDto {
  @ApiProperty() inviteLink!: string;
}

class SchoolBranchSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

/** `frontend/src/features/platform/api.ts`'s `SchoolDetail`. */
export class SchoolDetailResponseDto extends SchoolResponseDto {
  @ApiProperty({ type: [SchoolBranchSummaryDto] })
  branches!: SchoolBranchSummaryDto[];
}

export class PagedSchoolsDto implements PagedResult<SchoolResponseDto> {
  @ApiProperty({ type: [SchoolResponseDto] }) items!: SchoolResponseDto[];
  @ApiProperty() total!: number;
}
