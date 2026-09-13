import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MessageRecipientType } from '@prisma/client';

/**
 * `newThreadSchema` — `POST /messages/threads`'s body. `recipientId` is a `Parent.id`/`Teacher.id`
 * for "individual" (`NewThreadDialog`'s own `useParentsQuery`/`useTeachersQuery` picker sends
 * that real id — there's no separate "which kind" field on the wire, so `MessagesService` tries
 * both), or a `SchoolClass.id` for "class" (fans out to every parent of that class).
 */
export class NewThreadDto {
  @ApiProperty({ enum: MessageRecipientType })
  @IsEnum(MessageRecipientType)
  recipientType!: MessageRecipientType;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Select a recipient' })
  recipientId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  recipientLabel!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Subject is required' })
  @MaxLength(200)
  subject!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Message body is required' })
  @MaxLength(4000)
  body!: string;
}
