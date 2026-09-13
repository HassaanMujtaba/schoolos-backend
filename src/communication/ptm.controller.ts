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
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { PtmService } from './ptm.service';
import { PtmSlotDto } from './dto/ptm-slot.dto';
import { PtmBookDto } from './dto/ptm-book.dto';
import { PtmNotesDto } from './dto/ptm-notes.dto';
import { PtmAvailabilityQueryDto } from './dto/ptm-availability-query.dto';
import { PtmMineQueryDto } from './dto/ptm-mine-query.dto';
import { PtmSlotResponseDto } from './dto/ptm-response.dto';

/** `frontend/src/features/communication/api.ts`'s `/ptm` surface — §30. */
@ApiTags('communication')
@Controller('ptm')
export class PtmController {
  constructor(private readonly ptm: PtmService) {}

  @Get('availability')
  listAvailability(
    @Query() query: PtmAvailabilityQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PtmSlotResponseDto[]> {
    return this.ptm.listAvailability(query, user?.id ?? null);
  }

  @Post('slots')
  @RequirePermission('ptm.manage')
  createSlot(
    @Body() dto: PtmSlotDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PtmSlotResponseDto> {
    return this.ptm.createSlot(dto, user);
  }

  @Delete('slots/:id')
  @RequirePermission('ptm.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSlot(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.ptm.deleteSlot(id, user);
  }

  @Post('book')
  @RequirePermission('ptm.book')
  book(
    @Body() dto: PtmBookDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PtmSlotResponseDto> {
    return this.ptm.book(dto, user);
  }

  @Get('bookings/mine')
  listMine(
    @Query() query: PtmMineQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PtmSlotResponseDto[]> {
    return this.ptm.listMine(query, user);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.ptm.cancelBooking(id, user);
  }

  @Patch('bookings/:id')
  @RequirePermission('ptm.manage')
  updateNotes(
    @Param('id') id: string,
    @Body() dto: PtmNotesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PtmSlotResponseDto> {
    return this.ptm.updateNotes(id, dto, user);
  }
}
