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
import { SectionsService } from './sections.service';
import { ListSectionsQueryDto } from './dto/list-sections-query.dto';
import { SectionDto } from './dto/section.dto';
import {
  PagedSectionsDto,
  SectionResponseDto,
} from './dto/section-response.dto';

@ApiTags('sections')
@Controller('sections')
export class SectionsController {
  constructor(private readonly sectionsService: SectionsService) {}

  @Get()
  @RequirePermission('sections.read')
  list(@Query() query: ListSectionsQueryDto): Promise<PagedSectionsDto> {
    return this.sectionsService.list(query);
  }

  @Get(':id')
  @RequirePermission('sections.read')
  get(@Param('id') id: string): Promise<SectionResponseDto> {
    return this.sectionsService.get(id);
  }

  @Post()
  @RequirePermission('sections.create')
  create(@Body() dto: SectionDto): Promise<SectionResponseDto> {
    return this.sectionsService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('sections.update')
  update(
    @Param('id') id: string,
    @Body() dto: SectionDto,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('sections.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.sectionsService.remove(id);
  }
}
