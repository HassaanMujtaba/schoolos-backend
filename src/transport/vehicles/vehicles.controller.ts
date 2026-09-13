import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ListQueryDto } from '../../common/pagination/list-query.dto';
import { VehiclesService } from './vehicles.service';
import { VehicleDto } from './dto/vehicle.dto';
import {
  PagedVehiclesDto,
  VehicleResponseDto,
} from './dto/vehicle-response.dto';

/**
 * `frontend/src/features/transport/api.ts`'s vehicles surface (`modules/transport.md` "Backend
 * dependencies"). `transport.manage` gates every create/update/delete action — the module doc's
 * own note: this module doesn't split into per-action permission strings the way most later
 * modules do.
 */
@ApiTags('transport-vehicles')
@Controller('transport/vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get()
  @RequirePermission('transport.read')
  list(@Query() query: ListQueryDto): Promise<PagedVehiclesDto> {
    return this.vehiclesService.list(query);
  }

  @Get(':id')
  @RequirePermission('transport.read')
  get(@Param('id') id: string): Promise<VehicleResponseDto> {
    return this.vehiclesService.get(id);
  }

  @Post()
  @RequirePermission('transport.manage')
  create(@Body() dto: VehicleDto): Promise<VehicleResponseDto> {
    return this.vehiclesService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('transport.manage')
  update(
    @Param('id') id: string,
    @Body() dto: VehicleDto,
  ): Promise<VehicleResponseDto> {
    return this.vehiclesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('transport.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.vehiclesService.remove(id);
  }
}
