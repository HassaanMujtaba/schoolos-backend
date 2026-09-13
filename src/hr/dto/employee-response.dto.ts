import { ApiProperty } from '@nestjs/swagger';
import {
  EmployeeStatus,
  EmploymentType,
  LifecycleEventType,
} from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

/** `frontend/src/features/hr/api.ts`'s `LifecycleEvent`. */
export class LifecycleEventResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: LifecycleEventType }) type!: LifecycleEventType;
  @ApiProperty() effectiveDate!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ required: false }) newDepartment?: string;
  @ApiProperty({ required: false }) newDesignation?: string;
  @ApiProperty() recordedAt!: string;
}

/** `frontend/src/features/hr/api.ts`'s `Employee`. */
export class EmployeeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() employeeId!: string;
  @ApiProperty() department!: string;
  @ApiProperty() designation!: string;
  @ApiProperty({ enum: EmploymentType }) employmentType!: EmploymentType;
  @ApiProperty() dateOfJoining!: string;
  @ApiProperty({ enum: EmployeeStatus }) status!: EmployeeStatus;
  @ApiProperty({ type: [LifecycleEventResponseDto] })
  lifecycleHistory!: LifecycleEventResponseDto[];
}

export class PagedEmployeesDto implements PagedResult<EmployeeResponseDto> {
  @ApiProperty({ type: [EmployeeResponseDto] }) items!: EmployeeResponseDto[];
  @ApiProperty() total!: number;
}
