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
import { BranchesService } from './branches.service';
import { BranchDto } from './dto/branch.dto';
import { BranchResponseDto, PagedBranchesDto } from './dto/branch-response.dto';

/** `frontend/src/features/school-setup/api.ts`'s branches surface (`modules/school-setup.md` "Backend dependencies"). */
@ApiTags('branches')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @RequirePermission('branches.read')
  list(@Query() query: ListQueryDto): Promise<PagedBranchesDto> {
    return this.branchesService.list(query);
  }

  @Get(':id')
  @RequirePermission('branches.read')
  get(@Param('id') id: string): Promise<BranchResponseDto> {
    return this.branchesService.get(id);
  }

  @Post()
  @RequirePermission('branches.create')
  create(@Body() dto: BranchDto): Promise<BranchResponseDto> {
    return this.branchesService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('branches.update')
  update(
    @Param('id') id: string,
    @Body() dto: BranchDto,
  ): Promise<BranchResponseDto> {
    return this.branchesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('branches.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.branchesService.remove(id);
  }
}
