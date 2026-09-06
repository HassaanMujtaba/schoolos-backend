import { RequestContextService } from '../context/request-context.service';
import { TENANT_SCOPED_MODELS } from './tenant-scoped-models';

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

export interface OperationParams {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

/**
 * The actual tenant-isolation logic (PRD §3 / §52 / security-standards), factored out of
 * `PrismaService` so it can be unit-tested without a live database — see
 * `tenant-scoping.spec.ts`'s two-tenant test for the isolation proof this file's own doc comment
 * on `PrismaService` refers to. `PrismaService` wires this into `$extends()`'s
 * `query.$allModels.$allOperations` hook; nothing here is Prisma-specific beyond the shape of
 * `OperationParams`, which mirrors `$allOperations`'s callback signature.
 *
 * Fails **closed**: a tenant-scoped query with no tenant in context throws, it does not silently
 * run unscoped. Use `RequestContextService.runAsPlatform()` for the deliberate cross-tenant case
 * (the Platform Console, PRD §54) — never by leaving context empty.
 */
export function applyTenantScoping(
  requestContext: RequestContextService,
  { model, operation, args, query }: OperationParams,
): Promise<unknown> {
  if (!model || !TENANT_SCOPED_MODELS.has(model)) {
    return query(args);
  }

  const tenantId = requestContext.tenantId;
  if (!tenantId) {
    throw new Error(
      `Refusing unscoped ${operation} on tenant-scoped model "${model}" — no tenant in request ` +
        'context. If this is a deliberate cross-tenant read (Platform Console), run it inside ' +
        'RequestContextService.runAsPlatform().',
    );
  }

  const scopedArgs = { ...(args as Record<string, unknown>) };

  if (WHERE_OPERATIONS.has(operation)) {
    const existingWhere = (scopedArgs.where ?? {}) as Record<string, unknown>;
    scopedArgs.where = { AND: [existingWhere, { tenantId }] };
  }

  switch (operation) {
    case 'create':
    case 'update':
      scopedArgs.data = stampTenantId(scopedArgs.data, tenantId);
      break;
    case 'createMany':
      scopedArgs.data = stampTenantId(scopedArgs.data, tenantId);
      break;
    case 'updateMany':
      // `data` on updateMany is a partial patch, not a full row — stamping tenantId here would
      // be a no-op at best; the `where` injection above is what scopes it.
      break;
    case 'upsert':
      scopedArgs.create = stampTenantId(scopedArgs.create, tenantId);
      scopedArgs.update = stampTenantId(scopedArgs.update, tenantId);
      break;
    default:
      break;
  }

  return query(scopedArgs);
}

function stampTenantId(data: unknown, tenantId: string): unknown {
  if (Array.isArray(data)) {
    return (data as unknown[]).map((item) =>
      item && typeof item === 'object'
        ? { ...(item as Record<string, unknown>), tenantId }
        : item,
    );
  }
  if (data && typeof data === 'object') {
    return { ...(data as Record<string, unknown>), tenantId };
  }
  return data;
}
