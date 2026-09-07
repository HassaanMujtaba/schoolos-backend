import { ApiProperty } from '@nestjs/swagger';
import { SubjectType } from '@prisma/client';

/** `GET/POST/PATCH /subjects` response — `frontend/src/features/school-setup/api.ts`'s `Subject`. */
export class SubjectResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: SubjectType }) type!: SubjectType;
  @ApiProperty({ type: [String] }) classIds!: string[];
}

export class PagedSubjectsDto {
  @ApiProperty({ type: [SubjectResponseDto] }) items!: SubjectResponseDto[];
  @ApiProperty() total!: number;
}
