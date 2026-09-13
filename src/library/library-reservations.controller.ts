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
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { LibraryReservationsService } from './library-reservations.service';
import {
  CreateReservationDto,
  FulfillReservationDto,
  ListReservationsQueryDto,
} from './dto/reservation.dto';
import {
  LoanResponseDto,
  PagedReservationsDto,
  ReservationResponseDto,
} from './dto/library-response.dto';

/**
 * `frontend/src/features/library/api.ts`'s reservations surface — one endpoint for both the
 * librarian-run queue and the portal's self-service reservations, so `list`/`create`/`cancel`
 * carry no route-level `@RequirePermission`; see `LibraryReservationsService`'s own doc comment.
 */
@ApiTags('library')
@Controller('library/reservations')
export class LibraryReservationsController {
  constructor(private readonly reservations: LibraryReservationsService) {}

  @Get()
  list(
    @Query() query: ListReservationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PagedReservationsDto> {
    return this.reservations.list(query, user);
  }

  @Post()
  create(
    @Body() dto: CreateReservationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReservationResponseDto> {
    return this.reservations.create(dto, user);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.reservations.cancel(id, user);
  }

  @Post(':id/fulfill')
  @RequirePermission('library.circulate')
  fulfill(
    @Param('id') id: string,
    @Body() dto: FulfillReservationDto,
  ): Promise<LoanResponseDto> {
    return this.reservations.fulfill(id, dto);
  }
}
