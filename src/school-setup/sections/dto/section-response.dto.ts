import { ApiProperty } from '@nestjs/swagger';

/** `GET/POST/PATCH /sections` response — `frontend/src/features/school-setup/api.ts`'s `Section`. */
export class SectionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() classId!: string;
  @ApiProperty() classTeacherName!: string;
  @ApiProperty() roomLabel!: string;
}

export class PagedSectionsDto {
  @ApiProperty({ type: [SectionResponseDto] }) items!: SectionResponseDto[];
  @ApiProperty() total!: number;
}
