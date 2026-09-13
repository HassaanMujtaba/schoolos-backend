import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { SkipAudit } from '../common/decorators/skip-audit.decorator';
import { BillingService } from './billing.service';

/**
 * `POST /platform/billing/webhook` — Stripe calls this, not the frontend (it isn't in
 * `modules/platform-console.md`'s endpoint list, same "internal, not a frontend contract" status
 * `GET /certificates/verify/:code` has). `@Public()` because Stripe can't attach our access
 * tokens — `BillingService.handleStripeWebhook` verifies Stripe's own signature instead, which is
 * this route's actual authentication. `@ApiExcludeController()` keeps it out of the Swagger doc
 * `main.ts` builds from `frontend/modules/*.md` contracts — this isn't one.
 */
@ApiExcludeController()
@Controller('platform/billing')
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Post('webhook')
  @Public()
  @SkipAudit()
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing Stripe signature or request body');
    }
    await this.billing.handleStripeWebhook(req.rawBody, signature);
    return { received: true };
  }
}
