import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { HostelVisitorsService } from './hostel-visitors.service';
import { ListVisitorsQueryDto, VisitorDto } from './dto/visitor.dto';
import {
  PagedVisitorsDto,
  VisitorResponseDto,
} from './dto/hostel-response.dto';

/** `api.ts`'s visitor log surface — `hostel.manage` gates both check-in and check-out. */
@ApiTags('hostel')
@Controller('hostel/visitors')
export class HostelVisitorsController {
  constructor(private readonly visitors: HostelVisitorsService) {}

  @Get()
  @RequirePermission('hostel.read')
  list(@Query() query: ListVisitorsQueryDto): Promise<PagedVisitorsDto> {
    return this.visitors.list(query);
  }

  @Post()
  @RequirePermission('hostel.manage')
  checkIn(@Body() dto: VisitorDto): Promise<VisitorResponseDto> {
    return this.visitors.checkIn(dto);
  }

  @Post(':id/check-out')
  @RequirePermission('hostel.manage')
  @HttpCode(HttpStatus.OK)
  checkOut(@Param('id') id: string): Promise<VisitorResponseDto> {
    return this.visitors.checkOut(id);
  }
}
