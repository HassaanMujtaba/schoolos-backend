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
import { TimetableService } from './timetable.service';
import { TimetableEntryDto } from './dto/timetable-entry.dto';
import { ListTimetableQueryDto } from './dto/list-timetable-query.dto';
import { GenerateTimetableDto } from './dto/generate-timetable.dto';
import { SubstitutionDto } from './dto/substitution.dto';
import {
  SubstitutionResponseDto,
  TimetableEntryResponseDto,
} from './dto/timetable-response.dto';

@ApiTags('timetable')
@Controller('timetable')
export class TimetableController {
  constructor(private readonly timetableService: TimetableService) {}

  // Declared before the plain `GET /timetable` filter route below — same "literal segment before
  // a catch-all" ordering as `StudentsController.export`, though here every route is a distinct
  // literal path (`entries`/`generate`/`substitutions`), not a `:id` param, so there's no actual
  // ambiguity; kept in this order for readability (views, then editing, then substitutions).
  @Get('entries')
  @RequirePermission('timetable.read')
  listAll(): Promise<TimetableEntryResponseDto[]> {
    return this.timetableService.listAll();
  }

  @Get()
  @RequirePermission('timetable.read')
  list(
    @Query() query: ListTimetableQueryDto,
  ): Promise<TimetableEntryResponseDto[]> {
    return this.timetableService.list(query);
  }

  @Post('entries')
  @RequirePermission('timetable.update')
  createEntry(
    @Body() dto: TimetableEntryDto,
  ): Promise<TimetableEntryResponseDto> {
    return this.timetableService.createEntry(dto);
  }

  @Patch('entries/:id')
  @RequirePermission('timetable.update')
  updateEntry(
    @Param('id') id: string,
    @Body() dto: TimetableEntryDto,
  ): Promise<TimetableEntryResponseDto> {
    return this.timetableService.updateEntry(id, dto);
  }

  @Delete('entries/:id')
  @RequirePermission('timetable.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeEntry(@Param('id') id: string): Promise<void> {
    return this.timetableService.removeEntry(id);
  }

  @Post('generate')
  @RequirePermission('timetable.update')
  @HttpCode(HttpStatus.OK)
  generate(
    @Body() dto: GenerateTimetableDto,
  ): Promise<TimetableEntryResponseDto[]> {
    return this.timetableService.generate(dto);
  }

  @Get('substitutions')
  @RequirePermission('timetable.read')
  listSubstitutions(
    @Query('date') date: string,
  ): Promise<SubstitutionResponseDto[]> {
    return this.timetableService.listSubstitutions(date);
  }

  @Post('substitutions')
  @RequirePermission('timetable.update')
  createSubstitution(
    @Body() dto: SubstitutionDto,
  ): Promise<SubstitutionResponseDto> {
    return this.timetableService.createSubstitution(dto);
  }

  @Delete('substitutions/:id')
  @RequirePermission('timetable.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeSubstitution(@Param('id') id: string): Promise<void> {
    return this.timetableService.removeSubstitution(id);
  }
}
