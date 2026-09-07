import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** `GET/POST/PATCH /classes` response — `frontend/src/features/school-setup/api.ts`'s `SchoolClass`. */
export class ClassResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() gradeLevel?: number;
}

export class PagedClassesDto {
  @ApiProperty({ type: [ClassResponseDto] }) items!: ClassResponseDto[];
  @ApiProperty() total!: number;
}
