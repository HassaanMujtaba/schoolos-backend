import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** `replySchema` — `POST /messages/threads/:id/messages`'s body. */
export class ReplyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Message cannot be empty' })
  @MaxLength(4000)
  body!: string;
}
