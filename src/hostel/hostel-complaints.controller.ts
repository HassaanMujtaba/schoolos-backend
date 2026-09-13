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
import { HostelComplaintsService } from './hostel-complaints.service';
import {
  ComplaintDto,
  ComplaintResolutionDto,
  ListComplaintsQueryDto,
} from './dto/complaint.dto';
import {
  ComplaintResponseDto,
  PagedComplaintsDto,
} from './dto/hostel-response.dto';

/** `api.ts`'s complaints surface — `hostel.manage` gates both create and resolve. */
@ApiTags('hostel')
@Controller('hostel/complaints')
export class HostelComplaintsController {
  constructor(private readonly complaints: HostelComplaintsService) {}

  @Get()
  @RequirePermission('hostel.read')
  list(@Query() query: ListComplaintsQueryDto): Promise<PagedComplaintsDto> {
    return this.complaints.list(query);
  }

  @Post()
  @RequirePermission('hostel.manage')
  create(@Body() dto: ComplaintDto): Promise<ComplaintResponseDto> {
    return this.complaints.create(dto);
  }

  @Patch(':id')
  @RequirePermission('hostel.manage')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: ComplaintResolutionDto,
  ): Promise<ComplaintResponseDto> {
    return this.complaints.updateStatus(id, dto);
  }
}
