import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/** The shape this gateway stamps onto `client.data` — `socket.io`'s own type for that bag is `any`, so every read/write here goes through this interface instead of an unsafe member access. */
interface ConnectionData {
  userId: string;
  tenantId: string;
}
import { AppConfigService } from '../../common/config/app-config.service';
import { AccessTokenPayload } from '../../auth/jwt-payload.interface';
import { RealtimeService } from './realtime.service';

/**
 * Phase 7.7's `/ws` realtime layer (`../../../implementation-plan.md`'s Phase 7.7 section:
 * "Build REST first anyway ... then add the gateway"). Authenticated the same way the HTTP side
 * is — a verified access token — but read from the Socket.IO handshake's `auth.token` (or a
 * `token` query param, for a client that can't set handshake auth) rather than an
 * `Authorization` header, since a WS handshake has no such header on the browser side. This API
 * has no session cookie usable here either (only the httpOnly refresh-token cookie, which a `/ws`
 * handshake can't read cross-origin anyway) — the same short-lived access token the frontend
 * already holds for REST calls is what gets handed to the socket.
 *
 * Every authenticated socket joins its own `user:<userId>` room; `RealtimeService` is the only
 * thing that emits into it, called from `NotificationsService`/`MessagesService`/`PtmService`'s
 * own mutations — this class owns connection lifecycle only, never messaging logic.
 *
 * `cors: { origin: true }` reflects the request origin rather than reading
 * `AppConfigService.corsOrigins` — `@WebSocketGateway`'s options are evaluated at class-definition
 * time, before Nest's DI container exists, so they can't inject config the way every other
 * CORS-sensitive place in this app does. Acceptable here because the actual authorization
 * boundary is the handshake token check below, not CORS.
 */
@WebSocketGateway({
  namespace: '/ws',
  cors: { origin: true, credentials: true },
})
export class CommunicationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CommunicationGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attachServer(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.jwtAccessSecret,
      });
      if (!payload.sub || !payload.tenantId) {
        throw new Error('Access token missing sub/tenantId');
      }
      const data: ConnectionData = {
        userId: payload.sub,
        tenantId: payload.tenantId,
      };
      client.data = data;
      await client.join(`user:${payload.sub}`);
    } catch (error) {
      this.logger.warn(
        `Rejected unauthenticated /ws connection: ${error instanceof Error ? error.message : String(error)}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    // Socket.IO cleans up this socket's room membership automatically on disconnect — nothing to
    // do here.
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token as unknown;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
    const fromQuery = client.handshake.query?.token;
    if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
    return null;
  }
}
