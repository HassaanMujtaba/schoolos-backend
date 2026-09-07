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
import { ClassesService } from './classes.service';
import { ClassDto } from './dto/class.dto';
import { ClassResponseDto, PagedClassesDto } from './dto/class-response.dto';

@ApiTags('classes')
@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Get()
  @RequirePermission('classes.read')
  list(@Query() query: ListQueryDto): Promise<PagedClassesDto> {
    return this.classesService.list(query);
  }

  @Get(':id')
  @RequirePermission('classes.read')
  get(@Param('id') id: string): Promise<ClassResponseDto> {
    return this.classesService.get(id);
  }

  @Post()
  @RequirePermission('classes.create')
  create(@Body() dto: ClassDto): Promise<ClassResponseDto> {
    return this.classesService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('classes.update')
  update(
    @Param('id') id: string,
    @Body() dto: ClassDto,
  ): Promise<ClassResponseDto> {
    return this.classesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('classes.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.classesService.remove(id);
  }
}
