import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Explicitly opts a route out of authentication entirely — `/health`, `/auth/login`, and (Phase
 * 7) the certificate-verification endpoint per `modules/documents-certificates.md`. Every other
 * route is auth-required by default once `JwtAuthGuard` is wired globally in Phase 1; this
 * decorator exists so "no auth" is always a visible, deliberate annotation on the handler, never
 * an accidental omission of a guard.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
