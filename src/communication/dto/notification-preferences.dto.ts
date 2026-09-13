import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsEnum, ValidateNested } from 'class-validator';
import { NotificationChannel, NotificationType } from '@prisma/client';

export class NotificationPreferenceItemDto {
  @ApiProperty({ enum: NotificationType })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty({ enum: NotificationChannel, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(NotificationChannel, { each: true })
  channels!: NotificationChannel[];
}

/** `PUT /notifications/preferences`'s body — `notificationPreferencesSchema`. Always a full replace of the caller's own preference set (`NotificationsService.updatePreferences`'s own doc comment), not a per-type patch. */
export class UpdateNotificationPreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceItemDto)
  preferences!: NotificationPreferenceItemDto[];
}
