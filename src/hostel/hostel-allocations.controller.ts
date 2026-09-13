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
import { HostelAllocationsService } from './hostel-allocations.service';
import {
  AllocateDto,
  ListAllocationsQueryDto,
  ReassignDto,
} from './dto/allocation.dto';
import {
  AllocationResponseDto,
  PagedAllocationsDto,
} from './dto/hostel-response.dto';

/** `api.ts`'s allocation surface — `hostel.allocate` gates every mutation (separate from `hostel.manage`, see `HostelAllocationsService`'s own doc comment). */
@ApiTags('hostel')
@Controller('hostel')
export class HostelAllocationsController {
  constructor(private readonly allocations: HostelAllocationsService) {}

  @Get('allocations')
  @RequirePermission('hostel.read')
  list(@Query() query: ListAllocationsQueryDto): Promise<PagedAllocationsDto> {
    return this.allocations.list(query);
  }

  @Post('allocate')
  @RequirePermission('hostel.allocate')
  allocate(@Body() dto: AllocateDto): Promise<AllocationResponseDto> {
    return this.allocations.allocate(dto);
  }

  @Patch('allocations/:id/reassign')
  @RequirePermission('hostel.allocate')
  reassign(
    @Param('id') id: string,
    @Body() dto: ReassignDto,
  ): Promise<AllocationResponseDto> {
    return this.allocations.reassign(id, dto);
  }

  @Post('allocations/:id/vacate')
  @RequirePermission('hostel.allocate')
  @HttpCode(HttpStatus.OK)
  vacate(@Param('id') id: string): Promise<AllocationResponseDto> {
    return this.allocations.vacate(id);
  }
}
