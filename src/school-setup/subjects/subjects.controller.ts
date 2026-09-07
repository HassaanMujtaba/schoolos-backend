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
import { SubjectsService } from './subjects.service';
import { SubjectDto } from './dto/subject.dto';
import {
  PagedSubjectsDto,
  SubjectResponseDto,
} from './dto/subject-response.dto';

@ApiTags('subjects')
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Get()
  @RequirePermission('subjects.read')
  list(@Query() query: ListQueryDto): Promise<PagedSubjectsDto> {
    return this.subjectsService.list(query);
  }

  @Get(':id')
  @RequirePermission('subjects.read')
  get(@Param('id') id: string): Promise<SubjectResponseDto> {
    return this.subjectsService.get(id);
  }

  @Post()
  @RequirePermission('subjects.create')
  create(@Body() dto: SubjectDto): Promise<SubjectResponseDto> {
    return this.subjectsService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('subjects.update')
  update(
    @Param('id') id: string,
    @Body() dto: SubjectDto,
  ): Promise<SubjectResponseDto> {
    return this.subjectsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('subjects.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.subjectsService.remove(id);
  }
}
