import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto';
import {
  NotificationPreferenceResponseDto,
  NotificationResponseDto,
  PagedNotificationsDto,
} from './dto/notification-response.dto';

/**
 * `frontend/src/features/communication/api.ts`'s notification-center surface — a personal inbox,
 * no `@RequirePermission` gate anywhere on this controller (module doc "Roles & permissions
 * involved": "All authenticated roles (as recipients)"; `router.tsx`'s own comment: "notifications
 * ... have no route gate at all"). Every method is scoped to the caller's own `userId` inside the
 * service, never a client-suppliable filter.
 */
@ApiTags('communication')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Query() query: NotificationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PagedNotificationsDto> {
    return this.notifications.list(query, user.id);
  }

  @Get('unread-count')
  async unreadCount(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Get('preferences')
  getPreferences(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationPreferenceResponseDto[]> {
    return this.notifications.getPreferences(user.id);
  }

  @Put('preferences')
  updatePreferences(
    @Body() dto: UpdateNotificationPreferencesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationPreferenceResponseDto[]> {
    return this.notifications.updatePreferences(dto, user.id);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.notifications.markAllRead(user.id);
  }

  @Patch(':id/read')
  markRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationResponseDto> {
    return this.notifications.markRead(id, user.id);
  }
}
