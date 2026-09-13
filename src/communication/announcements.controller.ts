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
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementDto } from './dto/announcement.dto';
import {
  AnnouncementResponseDto,
  PagedAnnouncementsDto,
} from './dto/announcement-response.dto';

/** `frontend/src/features/communication/api.ts`'s `/announcements` surface. */
@ApiTags('communication')
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @RequirePermission('announcements.read')
  list(@Query() query: ListQueryDto): Promise<PagedAnnouncementsDto> {
    return this.announcements.list(query);
  }

  @Get(':id')
  @RequirePermission('announcements.read')
  get(@Param('id') id: string): Promise<AnnouncementResponseDto> {
    return this.announcements.get(id);
  }

  @Post()
  @RequirePermission('announcements.create')
  create(
    @Body() dto: AnnouncementDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AnnouncementResponseDto> {
    return this.announcements.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission('announcements.create')
  update(
    @Param('id') id: string,
    @Body() dto: AnnouncementDto,
  ): Promise<AnnouncementResponseDto> {
    return this.announcements.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('announcements.create')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.announcements.remove(id);
  }
}
