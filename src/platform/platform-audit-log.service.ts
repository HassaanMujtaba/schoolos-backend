import { Injectable } from '@nestjs/common';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { RequestContextService } from '../common/context/request-context.service';
import { PagedResult, ListQueryDto } from '../common/pagination/list-query.dto';
import { paginate, toSkipTake } from '../common/pagination/paginate';
import { PlatformAuditLogEntryDto } from './dto/platform-audit-log.dto';

/**
 * PRD §54's platform-level audit trail. Every `platform/*.service.ts` calls `record()` directly
 * from within its own mutation, the way `results.publish`/`fees.refund` write their own richer
 * audit row per `AuditInterceptor`'s own doc comment — the generic interceptor can't help here at
 * all: it writes to the tenant-scoped `AuditLog` table keyed by `RequestContextService.tenantId`,
 * and every platform mutation runs with no single tenant in context (that's the whole point of
 * this module). Every platform route is `@SkipAudit()`-annotated for exactly this reason — see
 * each controller's own comment.
 */
@Injectable()
export class PlatformAuditLogService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async record(input: {
    action: string;
    target: string;
    tenantId?: string | null;
    tenantName?: string | null;
  }): Promise<void> {
    const actorUserId = this.requestContext.userId;
    // `RequestContextStore` only carries `userId`, not a display name — one cheap indexed lookup
    // here beats threading a name through every one of this module's call sites, or showing a
    // raw uuid in `PlatformAuditLogPage`'s "Actor" column.
    const actor = actorUserId
      ? await this.platformPrisma.user.findUnique({
          where: { id: actorUserId },
          select: { name: true, email: true },
        })
      : null;

    await this.platformPrisma.platformAuditLog.create({
      data: {
        actorUserId,
        actorLabel: actor?.name ?? actor?.email ?? actorUserId ?? 'system',
        action: input.action,
        target: input.target,
        tenantId: input.tenantId ?? null,
        tenantName: input.tenantName ?? null,
      },
    });
  }

  async list(
    query: ListQueryDto,
  ): Promise<PagedResult<PlatformAuditLogEntryDto>> {
    const { skip, take } = toSkipTake(query.page, query.pageSize);
    const result = await paginate(
      () =>
        this.platformPrisma.platformAuditLog.findMany({
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
      () => this.platformPrisma.platformAuditLog.count(),
    );
    return {
      items: result.items.map((entry) => ({
        id: entry.id,
        actor: entry.actorLabel,
        action: entry.action,
        target: entry.target,
        tenantName: entry.tenantName ?? undefined,
        createdAt: entry.createdAt.toISOString(),
      })),
      total: result.total,
    };
  }
}
