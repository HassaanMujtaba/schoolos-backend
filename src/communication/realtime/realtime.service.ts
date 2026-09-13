import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

/**
 * The one thing every other Communication service is allowed to reach for to push a realtime
 * event — `CommunicationGateway.afterInit` hands it the live Socket.IO server the moment the
 * gateway boots; nothing here depends on the gateway back, so `NotificationsService`/
 * `MessagesService`/`PtmService` can inject this without importing gateway machinery. Emits are
 * fire-and-forget best-effort (module doc: REST stays the source of truth, the frontend still
 * polls every 30s until it wires up a `/ws` client — a missed emit here is never a correctness
 * bug, only a delayed push), same "never make the request wait on it" posture
 * `AuditInterceptor`'s own write already takes.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  attachServer(server: Server): void {
    this.server = server;
  }

  /** Every authenticated socket joins its own `user:<userId>` room on connect (`CommunicationGateway.handleConnection`) — this is the only room this phase's gateway uses. */
  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug(
        `No /ws server attached yet — dropped "${event}" for user ${userId}`,
      );
      return;
    }
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}
