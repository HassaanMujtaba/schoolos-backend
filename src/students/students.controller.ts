import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { StudentsService } from './students.service';
import { StudentDto } from './dto/student.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import {
  PagedStudentsDto,
  StudentResponseDto,
} from './dto/student-response.dto';

@ApiTags('students')
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  // Declared before `:id` — otherwise Nest would match `GET /students/export` as
  // `GET /students/:id` with `id: 'export'`.
  @Get('export')
  @RequirePermission('students.export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="students.csv"')
  export(@Query() query: ListStudentsQueryDto): Promise<string> {
    return this.studentsService.exportCsv(query);
  }

  @Get()
  @RequirePermission('students.read')
  list(@Query() query: ListStudentsQueryDto): Promise<PagedStudentsDto> {
    return this.studentsService.list(query);
  }

  @Get(':id')
  @RequirePermission('students.read')
  get(@Param('id') id: string): Promise<StudentResponseDto> {
    return this.studentsService.get(id);
  }

  @Post()
  @RequirePermission('students.create')
  create(@Body() dto: StudentDto): Promise<StudentResponseDto> {
    return this.studentsService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('students.update')
  update(
    @Param('id') id: string,
    @Body() dto: StudentDto,
  ): Promise<StudentResponseDto> {
    return this.studentsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('students.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.studentsService.remove(id);
  }
}
