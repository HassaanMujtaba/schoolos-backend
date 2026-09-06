import { SetMetadata } from '@nestjs/common';

export const SKIP_AUDIT_KEY = 'skipAudit';

/**
 * Opts a mutating route out of `AuditInterceptor`'s generic logging — for routes where a generic
 * request-body audit row would be actively wrong (e.g. `POST /auth/login`, where the body is
 * credentials, not a business mutation) rather than just imprecise. Use sparingly and say why at
 * the call site.
 */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);
