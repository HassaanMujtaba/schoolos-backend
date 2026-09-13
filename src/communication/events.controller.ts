import {
  Body,
  Controller,
  Delete,
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
import { EventsService } from './events.service';
import { EventDto } from './dto/event.dto';
import { EventListQueryDto } from './dto/event-list-query.dto';
import { EventResponseDto } from './dto/event-response.dto';

/** `frontend/src/features/communication/api.ts`'s `/events` surface — §29. */
@ApiTags('communication')
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@Query() query: EventListQueryDto): Promise<EventResponseDto[]> {
    return this.events.list(query);
  }

  @Post()
  @RequirePermission('events.manage')
  create(@Body() dto: EventDto): Promise<EventResponseDto> {
    return this.events.create(dto);
  }

  @Patch(':id')
  @RequirePermission('events.manage')
  update(
    @Param('id') id: string,
    @Body() dto: EventDto,
  ): Promise<EventResponseDto> {
    return this.events.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('events.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.events.remove(id);
  }
}
