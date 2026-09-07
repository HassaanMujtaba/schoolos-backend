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
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ExaminationsService } from './examinations.service';
import { ExamDto } from './dto/exam.dto';
import { ListExamsQueryDto } from './dto/list-exams-query.dto';
import { BulkMarksDto } from './dto/bulk-marks.dto';
import {
  ExamResultsResponseDto,
  ExamResponseDto,
  MarksEntryRowDto,
  MarksEntrySheetResponseDto,
  PagedExamDto,
} from './dto/exam-response.dto';

@ApiTags('examinations')
@Controller('exams')
export class ExamsController {
  constructor(private readonly examinationsService: ExaminationsService) {}

  @Get()
  @RequirePermission('exams.read')
  list(
    @Query() query: ListExamsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PagedExamDto> {
    return this.examinationsService.list(query, user.id);
  }

  @Get(':id')
  @RequirePermission('exams.read')
  get(@Param('id') id: string): Promise<ExamResponseDto> {
    return this.examinationsService.get(id);
  }

  @Post()
  @RequirePermission('exams.create')
  create(@Body() dto: ExamDto): Promise<ExamResponseDto> {
    return this.examinationsService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('exams.update')
  update(
    @Param('id') id: string,
    @Body() dto: ExamDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExamResponseDto> {
    return this.examinationsService.update(id, dto, user);
  }

  @Get(':id/marks-entry-sheet')
  @RequirePermission('results.enter')
  getMarksEntrySheet(
    @Param('id') id: string,
  ): Promise<MarksEntrySheetResponseDto> {
    return this.examinationsService.getMarksEntrySheet(id);
  }

  @Post(':id/marks')
  @RequirePermission('results.enter')
  submitBulkMarks(
    @Param('id') id: string,
    @Body() dto: BulkMarksDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MarksEntryRowDto[]> {
    return this.examinationsService.submitBulkMarks(id, dto, user);
  }

  @Get(':id/results')
  @RequirePermission('results.read')
  getResults(@Param('id') id: string): Promise<ExamResultsResponseDto> {
    return this.examinationsService.getResults(id);
  }

  @Post(':id/publish')
  @RequirePermission('results.publish')
  @HttpCode(HttpStatus.OK)
  publish(@Param('id') id: string): Promise<ExamResultsResponseDto> {
    return this.examinationsService.publish(id);
  }
}
