import {
  Body,
  Controller,
  Get,
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
  CreateSubscriptionDto,
  PagedSubscriptionsDto,
  SubscriptionResponseDto,
  UpdateSubscriptionDto,
} from './dto/subscription.dto';

/** See `plans.controller.ts`'s own comment on why every route here is `@SkipAudit()`. */
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
}
