import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Notification,
  NotificationChannel,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto';
import {
  NotificationPreferenceResponseDto,
  NotificationResponseDto,
  PagedNotificationsDto,
} from './dto/notification-response.dto';
import { RealtimeService } from './realtime/realtime.service';

// Same display order as `NOTIFICATION_TYPES` in `frontend/src/features/communication/schemas.ts`
// (and the Prisma enum's own declaration order) — `getPreferences` always returns all nine, same
// "stable order, not a filter" idiom `LEAVE_TYPE_ORDER` already uses.
const NOTIFICATION_TYPE_ORDER: NotificationType[] = [
  'attendance',
  'homework',
  'exam',
  'fees',
  'announcement',
  'message',
  'ptm',
  'library',
  'system',
];

/** Default channel set for a type the caller has never customized — in-app only, the one channel that costs nothing to deliver and needs no provider config (module doc "Delivery channel config ... is a backend/settings concern"). */
const DEFAULT_CHANNELS: NotificationChannel[] = ['inApp'];

/**
 * §28/§36 in-app notification center — `frontend/src/features/communication/api.ts`'s
 * `/notifications` surface. A personal inbox: every method is scoped to the caller's own
 * `userId`, no `@RequirePermission` anywhere (`NotificationsController`'s own doc comment).
 * `notifyUser` is this module's own internal fan-out point, called by `MessagesService`/
 * `PtmService` — see `schema.prisma`'s `Notification` model doc comment for why this phase
 * doesn't retrofit every *other* module's own mutations to call it too.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(
    query: NotificationQueryDto,
    userId: string,
  ): Promise<PagedNotificationsDto> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.unreadOnly === 'true' ? { readAt: null } : {}),
    };
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const result = await paginate(
      () =>
        this.prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
      () => this.prisma.notification.count({ where }),
    );
    return {
      items: result.items.map(toNotificationResponse),
      total: result.total,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(id: string, userId: string): Promise<NotificationResponseDto> {
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    const updated = existing.readAt
      ? existing
      : await this.prisma.notification.update({
          where: { id },
          data: { readAt: new Date() },
        });
    return toNotificationResponse(updated);
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async getPreferences(
    userId: string,
  ): Promise<NotificationPreferenceResponseDto[]> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });
    const byType = new Map(rows.map((r) => [r.type, r.channels]));
    return NOTIFICATION_TYPE_ORDER.map((type) => ({
      type,
      channels: byType.get(type) ?? DEFAULT_CHANNELS,
    }));
  }

  /**
   * `PUT /notifications/preferences` — a full replace of the caller's own preference rows
   * (delete-then-recreate in one transaction), not a per-type upsert: `NotificationPreference`'s
   * compound unique key includes `tenantId` (same convention every other phase's own compound key
   * already follows), which Prisma's `upsert` can't satisfy without threading `tenantId` through
   * this service by hand — same friction `LeaveBalance`'s own compound key sidesteps by never
   * calling `upsert` against it either.
   */
  async updatePreferences(
    dto: UpdateNotificationPreferencesDto,
    userId: string,
  ): Promise<NotificationPreferenceResponseDto[]> {
    await this.prisma.$transaction([
      this.prisma.notificationPreference.deleteMany({ where: { userId } }),
      this.prisma.notificationPreference.createMany({
        data: dto.preferences.map((pref) => ({
          userId,
          type: pref.type,
          channels: pref.channels,
        })) as unknown as Prisma.NotificationPreferenceUncheckedCreateInput[],
      }),
    ]);
    return this.getPreferences(userId);
  }

  /** Internal fan-out helper — creates the row and pushes a live `notification:new` event; never make the caller's own mutation wait on the realtime emit failing. */
  async notifyUser(params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    linkHref?: string | null;
  }): Promise<void> {
    const created = await this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
        linkHref: params.linkHref ?? null,
      } as unknown as Prisma.NotificationUncheckedCreateInput,
    });
    this.realtime.emitToUser(
      params.userId,
      'notification:new',
      toNotificationResponse(created),
    );
  }
}

function toNotificationResponse(
  notification: Notification,
): NotificationResponseDto {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    linkHref: notification.linkHref,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}
