import { ApiProperty } from '@nestjs/swagger';
import { PagedResult } from '../../common/pagination/list-query.dto';

/** `frontend/src/features/communication/api.ts`'s `Message`. `readAt` is always `null` — see `schema.prisma`'s `Message` model doc comment for why. */
export class MessageResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() senderId!: string;
  @ApiProperty() senderLabel!: string;
  @ApiProperty() body!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true }) readAt!: string | null;
}

/** `frontend/src/features/communication/api.ts`'s `MessageThread`. */
export class MessageThreadResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subject!: string;
  @ApiProperty({ type: [String] }) participantLabels!: string[];
  @ApiProperty() lastMessagePreview!: string;
  @ApiProperty() lastMessageAt!: string;
  @ApiProperty() unreadCount!: number;
}

/** `frontend/src/features/communication/api.ts`'s `MessageThreadDetail`. */
export class MessageThreadDetailResponseDto extends MessageThreadResponseDto {
  @ApiProperty({ type: [MessageResponseDto] }) messages!: MessageResponseDto[];
}

export class PagedMessageThreadsDto implements PagedResult<MessageThreadResponseDto> {
  @ApiProperty({ type: [MessageThreadResponseDto] })
  items!: MessageThreadResponseDto[];
  @ApiProperty() total!: number;
}
