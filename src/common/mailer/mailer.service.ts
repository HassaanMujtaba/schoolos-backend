import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

export interface MailInput {
  to: string;
  subject: string;
  html: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * A real send via Resend's HTTPS API when `RESEND_API_KEY` is configured; otherwise a
 * `[dev-only]` log, same discipline as `AuthService.forgotPassword`'s dev-only reset-link log
 * before this module existed — those two call sites, plus
 * `platform/subscription-sweep.service.ts`'s reminder/suspension emails, are this service's only
 * callers. Never throws on a missing address — same "resolves the same way regardless" posture
 * `AuthService.forgotPassword` already documents for why: a mail failure shouldn't surface as a
 * 500 to whatever request triggered it.
 *
 * Resend, not raw SMTP: this project originally sent via `nodemailer` straight to Gmail's SMTP,
 * which turned out to be unreliable from Render's network — connections either timed out or (for
 * Gmail's IPv6 address) failed immediately with `ENETUNREACH`. An HTTPS API isn't subject to the
 * outbound port-25/465/587 restrictions PaaS hosts commonly apply.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(private readonly config: AppConfigService) {}

  async send(input: MailInput): Promise<void> {
    const apiKey = this.config.resendApiKey;
    if (!apiKey) {
      // The full body (not just subject/recipient) is deliberately in this log line — it's how
      // `auth.e2e-spec.ts`/`platform.e2e-spec.ts` recover a real reset/invite link's `token=...`
      // query param in an environment with no Resend key configured, same "log it, don't fail"
      // posture this whole method already follows.
      this.logger.warn(
        `[dev-only] RESEND_API_KEY not configured — would have emailed "${input.subject}" to ${input.to}. Body: ${input.html}`,
      );
      return;
    }

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.resendFrom,
          to: input.to,
          subject: input.subject,
          html: input.html,
        }),
        // A provider outage shouldn't hang the request that triggered this send (an onboarding, a
        // password-reset request, a scheduled sweep) any longer than it takes to fail — same
        // reasoning nodemailer's connectionTimeout/socketTimeout previously covered.
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Resend API ${response.status}: ${body}`);
      }
    } catch (error) {
      // A mail-provider outage shouldn't fail the request that triggered it — log loudly and move
      // on, same as every other best-effort side channel in this codebase (e.g.
      // `AuditInterceptor`'s own failure posture).
      this.logger.error(
        `Failed to send "${input.subject}" to ${input.to}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
