import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { RequestContextService } from './request-context.service';

/**
 * Opens the async-local-storage context for every request, before any guard runs, so a request
 * id exists for error responses and audit rows even on a request that never reaches auth (a 404,
 * a validation failure). `TenantContextGuard` (Phase 1) later calls `requestContext.patch(...)`
 * to fill in `tenantId`/`userId`/`permissions` once the token is verified — see
 * `RequestContextService`'s own doc comment for why that's a patch, not a second `run()`.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    res.setHeader('x-request-id', requestId);

    this.requestContext.run(
      {
        requestId,
        tenantId: null,
        branchId: null,
        userId: null,
        permissions: [],
        ip: req.ip,
      },
      () => next(),
    );
  }
}
