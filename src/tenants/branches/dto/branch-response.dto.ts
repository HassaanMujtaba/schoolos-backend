import { ApiProperty } from '@nestjs/swagger';

/** A nested building/department item as returned to the client — `id` is additive (not in `frontend`'s `BuildingFormValues`/`DepartmentFormValues` type, but harmless to include and useful as a stable `useFieldArray` key). */
export class NamedChildDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

/** `GET/POST/PATCH /branches` response — `frontend/src/features/school-setup/api.ts`'s `Branch`. */
export class BranchResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() campus!: string;
  @ApiProperty() address!: string;
  @ApiProperty({ type: [NamedChildDto] }) buildings!: NamedChildDto[];
  @ApiProperty({ type: [NamedChildDto] }) departments!: NamedChildDto[];
}

export class PagedBranchesDto {
  @ApiProperty({ type: [BranchResponseDto] }) items!: BranchResponseDto[];
  @ApiProperty() total!: number;
}
