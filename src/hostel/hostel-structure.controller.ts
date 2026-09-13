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
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ListQueryDto } from '../common/pagination/list-query.dto';
import { HostelStructureService } from './hostel-structure.service';
import { HostelDto } from './dto/hostel.dto';
import {
  AvailableRoomsQueryDto,
  ListRoomsQueryDto,
  RoomDto,
} from './dto/room.dto';
import {
  HostelResponseDto,
  PagedHostelsDto,
  PagedRoomsDto,
  RoomOccupancyDto,
  RoomResponseDto,
} from './dto/hostel-response.dto';

/** `frontend/src/features/hostel/api.ts`'s hostel + room surface — `hostel.read`/`hostel.manage` gating, per that module doc's own permission catalog. */
@ApiTags('hostel')
@Controller('hostel')
export class HostelStructureController {
  constructor(private readonly structure: HostelStructureService) {}

  @Get('hostels')
  @RequirePermission('hostel.read')
  listHostels(@Query() query: ListQueryDto): Promise<PagedHostelsDto> {
    return this.structure.listHostels(query);
  }

  @Post('hostels')
  @RequirePermission('hostel.manage')
  createHostel(@Body() dto: HostelDto): Promise<HostelResponseDto> {
    return this.structure.createHostel(dto);
  }

  @Patch('hostels/:id')
  @RequirePermission('hostel.manage')
  updateHostel(
    @Param('id') id: string,
    @Body() dto: HostelDto,
  ): Promise<HostelResponseDto> {
    return this.structure.updateHostel(id, dto);
  }

  @Delete('hostels/:id')
  @RequirePermission('hostel.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeHostel(@Param('id') id: string): Promise<void> {
    return this.structure.removeHostel(id);
  }

  @Get('rooms')
  @RequirePermission('hostel.read')
  listRooms(@Query() query: ListRoomsQueryDto): Promise<PagedRoomsDto> {
    return this.structure.listRooms(query);
  }

  @Post('rooms')
  @RequirePermission('hostel.manage')
  createRoom(@Body() dto: RoomDto): Promise<RoomResponseDto> {
    return this.structure.createRoom(dto);
  }

  @Patch('rooms/:id')
  @RequirePermission('hostel.manage')
  updateRoom(
    @Param('id') id: string,
    @Body() dto: RoomDto,
  ): Promise<RoomResponseDto> {
    return this.structure.updateRoom(id, dto);
  }

  @Delete('rooms/:id')
  @RequirePermission('hostel.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRoom(@Param('id') id: string): Promise<void> {
    return this.structure.removeRoom(id);
  }

  // No bare `GET rooms/:id` exists in this contract (`RoomsPage` has no per-room detail route),
  // so neither of these two collides with anything above regardless of declaration order.
  @Get('rooms/available')
  @RequirePermission('hostel.read')
  listAvailableRooms(
    @Query() query: AvailableRoomsQueryDto,
  ): Promise<RoomResponseDto[]> {
    return this.structure.listAvailableRooms(query.hostelId);
  }

  @Get('rooms/:id/occupancy')
  @RequirePermission('hostel.read')
  getRoomOccupancy(@Param('id') id: string): Promise<RoomOccupancyDto> {
    return this.structure.getRoomOccupancy(id);
  }
}
