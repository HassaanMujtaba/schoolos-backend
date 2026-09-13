import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigModule } from '../common/config/app-config.module';
import { AppConfigService } from '../common/config/app-config.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { PtmController } from './ptm.controller';
import { PtmService } from './ptm.service';
import { CommunicationGateway } from './realtime/communication.gateway';
import { RealtimeService } from './realtime/realtime.service';

/**
 * PRD §28 Communication + §29 Events & Calendar + §30 Parent-Teacher Meetings (Phase 7.7,
 * `../implementation-plan.md`). Five controller/service pairs by sub-area, same split-by-concern
 * convention `HrModule`/`HostelModule` already set, plus the `/ws` realtime layer
 * (`CommunicationGateway`/`RealtimeService`) this phase adds. `NotificationsService` is exported:
 * `MessagesService`/`PtmService` in this same module inject it directly, but exporting keeps the
 * door open for a later phase's own module to push a notification the same way, mirroring
 * `HrModule`'s own `EmployeesService` export.
 *
 * `JwtModule` is registered fresh here (not imported from `AuthModule`, which doesn't export it)
 * purely so `CommunicationGateway` can verify a `/ws` handshake token the same way `JwtStrategy`
 * verifies the HTTP `Authorization` header — same secret, `AppConfigService.jwtAccessSecret`,
 * independently configured because Socket.IO's handshake never goes through Passport.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwtAccessSecret,
      }),
    }),
  ],
  controllers: [
    NotificationsController,
    MessagesController,
    AnnouncementsController,
    EventsController,
    PtmController,
  ],
  providers: [
    NotificationsService,
    MessagesService,
    AnnouncementsService,
    EventsService,
    PtmService,
    CommunicationGateway,
    RealtimeService,
  ],
  exports: [NotificationsService],
})
export class CommunicationModule {}
