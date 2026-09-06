import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../context/request-context.service';
import { SKIP_AUDIT_KEY } from '../decorators/skip-audit.decorator';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REDACTED_FIELDS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
]);

/**
 * PRD §43: "every important action should be recorded... audit logs must be append-only from
 * normal application users." This interceptor is the generic, always-on half of that — it
 * captures who/what/when/where for every mutating request automatically, so no feature module
 * has to remember to call an audit service by hand. It deliberately does **not** try to capture a
 * real old-value/new-value diff (a generic HTTP interceptor can't know a handler's previous
 * state) — `newValue` here is the redacted request body; a module that needs a real before/after
 * diff (e.g. `results.publish`, `fees.refund`) should write a richer audit row itself from within
 * the service, using this table as a supplement, not the only record.
 *
 * The write is fire-and-forget relative to the response (never make a user wait on an audit
 * write, and never fail their request because audit logging failed) — logged loudly on failure
 * instead. Move this onto a queue (PRD §46 background workers) once audit volume matters enough
 * that an in-process write is a real bottleneck.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<Request>();

    if (skip || !MUTATING_METHODS.has(request.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        void this.writeAuditRow(request);
      }),
    );
  }

  private async writeAuditRow(request: Request): Promise<void> {
    const store = this.requestContext.current;
    if (!store?.tenantId) {
      // No tenant context yet (e.g. pre-auth endpoints in Phase 0/1) — nothing to scope this
      // row to. Once every mutating route sits behind the auth guard, this branch should never
      // fire in practice; log it so a genuinely unscoped mutation doesn't go unnoticed.
      this.logger.warn(
        `Mutating request with no tenant context: ${request.method} ${request.url}`,
      );
      return;
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: store.userId,
          action: request.method,
          entityType: inferEntityType(request.url),
          entityId: inferEntityId(request.url),
          newValue: redact(request.body) as Prisma.InputJsonValue,
          ip: store.ip ?? request.ip ?? null,
          userAgent: request.headers['user-agent'] ?? null,
          requestId: store.requestId,
          // `tenantId` is intentionally absent — PrismaService's tenant-scoping extension
          // (`common/prisma/tenant-scoping.ts`) injects it from request context on every write
          // to a TENANT_SCOPED_MODELS model, before this reaches the database. TypeScript can't
          // see that runtime rewrite, hence the cast below rather than a (wrong) `tenant: {
          // connect: {...} }` relation write here.
        } as unknown as Prisma.AuditLogUncheckedCreateInput,
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log for ${request.method} ${request.url}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

function inferEntityType(url: string): string {
  // /v1/students/123 → "students". Good enough for the generic case; a handler that wants a
  // precise entity type should write its own richer audit row instead, per the class doc above.
  const segments = url.split('?')[0].split('/').filter(Boolean);
  return segments[1] ?? segments[0] ?? 'unknown';
}

function inferEntityId(url: string): string | null {
  const segments = url.split('?')[0].split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  return /^[0-9a-fA-F-]{8,}$/.test(last) ? last : null;
}

function redact(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([key, value]) => [
      key,
      REDACTED_FIELDS.has(key) ? '[redacted]' : value,
    ]),
  );
}
