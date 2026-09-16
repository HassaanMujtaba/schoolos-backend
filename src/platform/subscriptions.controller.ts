import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { SkipAudit } from '../common/decorators/skip-audit.decorator';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { SubscriptionsService } from './subscriptions.service';
import {
  ConfirmPaymentDto,
  CreateSubscriptionDto,
  PagedSubscriptionsDto,
  SubscriptionResponseDto,
  UpdateSubscriptionDto,
} from './dto/subscription.dto';

/** Every route here is `@SkipAudit()` — `PlatformAuditLogService.record` is called explicitly from within `SubscriptionsService` instead (see its own doc comment on why the generic tenant-scoped audit interceptor can't help here). */
@ApiTags('platform')
@Controller('platform/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequirePermission('platform.subscriptions.manage')
  list(@Query() query: ListQueryDto): Promise<PagedSubscriptionsDto> {
    return this.subscriptions.list(query);
  }

  @Post()
  @RequirePermission('platform.subscriptions.manage')
  @SkipAudit()
  create(@Body() dto: CreateSubscriptionDto): Promise<SubscriptionResponseDto> {
    return this.subscriptions.create(dto);
  }

  @Patch(':id')
  @RequirePermission('platform.subscriptions.manage')
  @SkipAudit()
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptions.update(id, dto);
  }

  @Post(':id/confirm-payment')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('platform.subscriptions.manage')
  @SkipAudit()
  confirmPayment(
    @Param('id') id: string,
    @Body() dto: ConfirmPaymentDto,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptions.confirmPayment(id, dto);
  }
}
