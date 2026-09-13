import { ApiProperty } from '@nestjs/swagger';
import { AnnouncementAudience } from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

/** `frontend/src/features/communication/api.ts`'s `Announcement`. */
export class AnnouncementResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ enum: AnnouncementAudience }) audience!: AnnouncementAudience;
  @ApiProperty({ type: [String] }) classIds!: string[];
  @ApiProperty({ type: [String] }) classLabels!: string[];
  @ApiProperty() pinned!: boolean;
  @ApiProperty() createdByLabel!: string;
  @ApiProperty() createdAt!: string;
}

export class PagedAnnouncementsDto implements PagedResult<AnnouncementResponseDto> {
  @ApiProperty({ type: [AnnouncementResponseDto] })
  items!: AnnouncementResponseDto[];
  @ApiProperty() total!: number;
}
