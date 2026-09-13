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
import { RoutesService } from './routes.service';
import { RouteDto } from './dto/route.dto';
import { PagedRoutesDto, RouteResponseDto } from './dto/route-response.dto';

/** `frontend/src/features/transport/api.ts`'s routes surface (`modules/transport.md` "Backend dependencies") — same `transport.read`/`transport.manage` gating as `VehiclesController`. */
@ApiTags('transport-routes')
@Controller('transport/routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  @Get()
  @RequirePermission('transport.read')
  list(@Query() query: ListQueryDto): Promise<PagedRoutesDto> {
    return this.routesService.list(query);
  }

  @Get(':id')
  @RequirePermission('transport.read')
  get(@Param('id') id: string): Promise<RouteResponseDto> {
    return this.routesService.get(id);
  }

  @Post()
  @RequirePermission('transport.manage')
  create(@Body() dto: RouteDto): Promise<RouteResponseDto> {
    return this.routesService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('transport.manage')
  update(
    @Param('id') id: string,
    @Body() dto: RouteDto,
  ): Promise<RouteResponseDto> {
    return this.routesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('transport.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.routesService.remove(id);
  }
}
