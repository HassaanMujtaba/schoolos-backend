import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { MessagesService } from './messages.service';
import { NewThreadDto } from './dto/new-thread.dto';
import { ReplyDto } from './dto/reply.dto';
import {
  MessageResponseDto,
  MessageThreadDetailResponseDto,
  PagedMessageThreadsDto,
} from './dto/message-response.dto';

/** `frontend/src/features/communication/api.ts`'s `/messages/threads` surface. Only starting a new thread is gated — everything else is a self-service "my inbox" operation (module doc "Resolved from the original Open questions"). */
@ApiTags('communication')
@Controller('messages/threads')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(
    @Query() query: ListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PagedMessageThreadsDto> {
    return this.messages.listThreads(query, user.id);
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MessageThreadDetailResponseDto> {
    return this.messages.getThread(id, user.id);
  }

  @Post()
  @RequirePermission('messages.send')
  create(
    @Body() dto: NewThreadDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MessageThreadDetailResponseDto> {
    return this.messages.createThread(dto, user);
  }

  @Post(':id/messages')
  reply(
    @Param('id') id: string,
    @Body() dto: ReplyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    return this.messages.reply(id, dto, user);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.messages.markThreadRead(id, user.id);
  }
}
