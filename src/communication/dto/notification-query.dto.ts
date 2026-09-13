import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsEnum, IsOptional } from 'class-validator';
import { NotificationType } from '@prisma/client';
import { ListQueryDto } from '../../common/pagination/list-query.dto';

/** `frontend/src/features/communication/api.ts`'s `NotificationListParams`. */
export class NotificationQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: NotificationType })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  // Same `@IsBooleanString` idiom `hostel/dto/visitor.dto.ts`'s `ListVisitorsQueryDto.open`
  // already uses — axios serializes a boolean query param as the literal string "true"/"false".
  @ApiPropertyOptional()
  @IsOptional()
  @IsBooleanString()
  unreadOnly?: string;
}
