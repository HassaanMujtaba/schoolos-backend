import { ApiProperty } from '@nestjs/swagger';
import { PagedResult } from '../../common/pagination/list-query.dto';

/** `parents/api.ts`'s `Child`. */
export class ChildDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() admissionNumber!: string;
  @ApiProperty() classId!: string;
  @ApiProperty() sectionId!: string;
  @ApiProperty() relation!: string;
}

/** `parents/api.ts`'s `Parent`. */
export class ParentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() address!: string;
  @ApiProperty({ type: [ChildDto] }) children!: ChildDto[];
}

export class PagedParentsDto implements PagedResult<ParentResponseDto> {
  @ApiProperty({ type: [ParentResponseDto] }) items!: ParentResponseDto[];
  @ApiProperty() total!: number;
}
