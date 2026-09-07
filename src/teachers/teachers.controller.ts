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
import { TeachersService } from './teachers.service';
import { TeacherDto } from './dto/teacher.dto';
import { AssignmentDto } from './dto/assignment.dto';
import {
  AssignmentResponseDto,
  PagedTeachersDto,
  TeacherResponseDto,
} from './dto/teacher-response.dto';

@ApiTags('teachers')
@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachersService: TeachersService) {}

  @Get()
  @RequirePermission('teachers.read')
  list(@Query() query: ListQueryDto): Promise<PagedTeachersDto> {
    return this.teachersService.list(query);
  }

  @Get(':id')
  @RequirePermission('teachers.read')
  get(@Param('id') id: string): Promise<TeacherResponseDto> {
    return this.teachersService.get(id);
  }

  @Post()
  @RequirePermission('teachers.create')
  create(@Body() dto: TeacherDto): Promise<TeacherResponseDto> {
    return this.teachersService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('teachers.update')
  update(
    @Param('id') id: string,
    @Body() dto: TeacherDto,
  ): Promise<TeacherResponseDto> {
    return this.teachersService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('teachers.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.teachersService.remove(id);
  }

  @Get(':id/assignments')
  @RequirePermission('teachers.read')
  listAssignments(@Param('id') id: string): Promise<AssignmentResponseDto[]> {
    return this.teachersService.listAssignments(id);
  }

  @Post(':id/assignments')
  @RequirePermission('teachers.assign')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignmentDto,
  ): Promise<AssignmentResponseDto> {
    return this.teachersService.assign(id, dto);
  }

  @Delete(':id/assignments/:assignmentId')
  @RequirePermission('teachers.assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  unassign(
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
  ): Promise<void> {
    return this.teachersService.unassign(id, assignmentId);
  }
}
