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
import { AcademicYearsService } from './academic-years.service';
import { AcademicYearDto } from './dto/academic-year.dto';
import {
  AcademicYearResponseDto,
  PagedAcademicYearsDto,
} from './dto/academic-year-response.dto';

@ApiTags('academic-years')
@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly academicYearsService: AcademicYearsService) {}

  @Get()
  @RequirePermission('academic-years.read')
  list(@Query() query: ListQueryDto): Promise<PagedAcademicYearsDto> {
    return this.academicYearsService.list(query);
  }

  @Get(':id')
  @RequirePermission('academic-years.read')
  get(@Param('id') id: string): Promise<AcademicYearResponseDto> {
    return this.academicYearsService.get(id);
  }

  @Post()
  @RequirePermission('academic-years.create')
  create(@Body() dto: AcademicYearDto): Promise<AcademicYearResponseDto> {
    return this.academicYearsService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('academic-years.update')
  update(
    @Param('id') id: string,
    @Body() dto: AcademicYearDto,
  ): Promise<AcademicYearResponseDto> {
    return this.academicYearsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('academic-years.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.academicYearsService.remove(id);
  }
}
