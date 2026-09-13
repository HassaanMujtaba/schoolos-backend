import { ApiProperty } from '@nestjs/swagger';
import { NotificationChannel, NotificationType } from '@prisma/client';
import { PagedResult } from '../../common/pagination/list-query.dto';

/** `frontend/src/features/communication/api.ts`'s `Notification`. */
export class NotificationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NotificationType }) type!: NotificationType;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ nullable: true }) linkHref!: string | null;
  @ApiProperty({ nullable: true }) readAt!: string | null;
  @ApiProperty() createdAt!: string;
}

export class PagedNotificationsDto implements PagedResult<NotificationResponseDto> {
  @ApiProperty({ type: [NotificationResponseDto] })
  items!: NotificationResponseDto[];
  @ApiProperty() total!: number;
}

/** `frontend/src/features/communication/api.ts`'s `NotificationPreference`. */
export class NotificationPreferenceResponseDto {
  @ApiProperty({ enum: NotificationType }) type!: NotificationType;
  @ApiProperty({ enum: NotificationChannel, isArray: true })
  channels!: NotificationChannel[];
}
