import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { AppConfigService } from '../config/app-config.service';

export interface MailInput {
  to: string;
  subject: string;
  html: string;
}

/**
 * A real SMTP send via `nodemailer` when `SMTP_HOST` is configured; otherwise a `[dev-only]` log,
 * same discipline as `AuthService.forgotPassword`'s dev-only reset-link log before this module
 * existed — those two call sites, plus `platform/subscription-sweep.service.ts`'s reminder/
 * suspension emails, are this service's only callers. Never throws on a missing address — same
 * "resolves the same way regardless" posture `AuthService.forgotPassword` already documents for
 * why: a mail failure shouldn't surface as a 500 to whatever request triggered it.
 *
 * Configured against Gmail's SMTP at explicit user request, despite this being a known-broken
 * path: live-traced three times from this Render deploy (twice against Gmail, once against
 * Resend's own SMTP relay) and every attempt failed the same way — `ENETUNREACH` against Gmail's
 * IPv6 address, or a bare connection timeout otherwise, never an auth error. That's Render
 * blocking outbound SMTP outright, not a Gmail- or credentials-specific problem, so no SMTP host
 * is expected to work here. Kept as-is anyway per that explicit request — the actual fallback for
 * "testing shouldn't depend on mail delivery" lives in the callers: `SchoolsService.create`/
 * `resendInvite` and `AuthService.issueInviteToken` return the invite/reset link directly in the
 * API response (surfaced in the platform console UI) rather than relying on this method to
 * deliver it. The `connectionTimeout`/`greetingTimeout`/`socketTimeout` below still keep a future
 * attempt here bounded and logged instead of hanging the request that triggered it.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: nodemailer.Transporter | undefined;

  constructor(private readonly config: AppConfigService) {}

  async send(input: MailInput): Promise<void> {
    const host = this.config.smtpHost;
    if (!host) {
      // The full body (not just subject/recipient) is deliberately in this log line — it's how
      // `auth.e2e-spec.ts`/`platform.e2e-spec.ts` recover a real reset/invite link's `token=...`
      // query param in an environment with no SMTP configured, same "log it, don't fail" posture
      // this whole method already follows.
      this.logger.warn(
        `[dev-only] SMTP not configured — would have emailed "${input.subject}" to ${input.to}. Body: ${input.html}`,
      );
      return;
    }

    try {
      await this.client(host).sendMail({
        from: this.config.smtpFrom,
        to: input.to,
        subject: input.subject,
        html: input.html,
      });
    } catch (error) {
      // A mail-provider outage shouldn't fail the request that triggered it (an onboarding, a
      // password-reset request, a scheduled sweep) — log loudly and move on, same as every other
      // best-effort side channel in this codebase (e.g. `AuditInterceptor`'s own failure posture).
      this.logger.error(
        `Failed to send "${input.subject}" to ${input.to}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private client(host: string): nodemailer.Transporter {
    if (!this.transporter) {
      const port = this.config.smtpPort;
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: this.config.smtpUser
          ? { user: this.config.smtpUser, pass: this.config.smtpPass }
          : undefined,
        // Nodemailer's defaults (2min connection, 10min socket) mean a provider that silently
        // drops outbound SMTP — as Gmail did from Render's network — hangs this long instead of
        // hitting the catch block above. `send()`'s whole "log loudly and move on" promise
        // depends on failing fast, and callers like `SchoolsService.create` await this before
        // responding to their own HTTP request.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
      });
    }
    return this.transporter;
  }
}
