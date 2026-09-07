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
import { HomeworkService } from './homework.service';
import { HomeworkDto } from './dto/homework.dto';
import { SubmissionDto } from './dto/submission.dto';
import { GradingDto } from './dto/grading.dto';
import { ListHomeworkQueryDto } from './dto/list-homework-query.dto';
import {
  HomeworkResponseDto,
  PagedHomeworkDto,
  SubmissionResponseDto,
} from './dto/homework-response.dto';

@ApiTags('homework')
@Controller('homework')
export class HomeworkController {
  constructor(private readonly homeworkService: HomeworkService) {}

  @Get()
  @RequirePermission('homework.read')
  list(
    @Query() query: ListHomeworkQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PagedHomeworkDto> {
    return this.homeworkService.list(query, user.id);
  }

  @Get(':id')
  @RequirePermission('homework.read')
  get(@Param('id') id: string): Promise<HomeworkResponseDto> {
    return this.homeworkService.get(id);
  }

  @Post()
  @RequirePermission('homework.create')
  create(
    @Body() dto: HomeworkDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<HomeworkResponseDto> {
    return this.homeworkService.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission('homework.update')
  update(
    @Param('id') id: string,
    @Body() dto: HomeworkDto,
  ): Promise<HomeworkResponseDto> {
    return this.homeworkService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('homework.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.homeworkService.remove(id);
  }

  @Post(':id/submissions')
  @RequirePermission('homework.read')
  submit(
    @Param('id') id: string,
    @Body() dto: SubmissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubmissionResponseDto> {
    return this.homeworkService.submit(id, dto, user);
  }

  /**
   * Two documented shapes on one endpoint, per `homework/api.ts`'s own split: `studentId` present
   * → this student's own submission or `null` (portal, `'me'` idiom); absent → every submission
   * for this assignment (teacher grading queue).
   */
  @Get(':id/submissions')
  @RequirePermission('homework.read')
  listSubmissions(
    @Param('id') id: string,
    @Query('studentId') studentId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubmissionResponseDto[] | SubmissionResponseDto | null> {
    if (studentId) {
      return this.homeworkService.getMySubmission(id, studentId, user.id);
    }
    return this.homeworkService.listSubmissions(id);
  }

  @Patch('submissions/:submissionId')
  @RequirePermission('homework.grade')
  gradeSubmission(
    @Param('submissionId') submissionId: string,
    @Body() dto: GradingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubmissionResponseDto> {
    return this.homeworkService.gradeSubmission(submissionId, dto, user);
  }
}
