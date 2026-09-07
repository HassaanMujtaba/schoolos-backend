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
import { FeeStructuresService } from './fee-structures.service';
import { FeeStructureDto } from './dto/fee-structure.dto';
import { ListFeeStructuresQueryDto } from './dto/list-fee-structures-query.dto';
import {
  FeeStructureResponseDto,
  PagedFeeStructureDto,
} from './dto/fee-response.dto';

/**
 * `frontend/src/features/fees/api.ts`'s fee-structure surface. `fees.create` gates both create
 * and edit — `FeeStructuresTable.tsx`'s own `canWrite = usePermission('fees.create')` covers both
 * actions, there is no separate `fees.update` in the seeded catalog (`../../implementation-plan.md`
 * "Permission catalog").
 */
@ApiTags('fees')
@Controller('fees/structures')
export class FeeStructuresController {
  constructor(private readonly feeStructures: FeeStructuresService) {}

  @Get()
  @RequirePermission('fees.read')
  list(
    @Query() query: ListFeeStructuresQueryDto,
  ): Promise<PagedFeeStructureDto> {
    return this.feeStructures.list(query);
  }

  @Get(':id')
  @RequirePermission('fees.read')
  get(@Param('id') id: string): Promise<FeeStructureResponseDto> {
    return this.feeStructures.get(id);
  }

  @Post()
  @RequirePermission('fees.create')
  create(@Body() dto: FeeStructureDto): Promise<FeeStructureResponseDto> {
    return this.feeStructures.create(dto);
  }

  @Patch(':id')
  @RequirePermission('fees.create')
  update(
    @Param('id') id: string,
    @Body() dto: FeeStructureDto,
  ): Promise<FeeStructureResponseDto> {
    return this.feeStructures.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('fees.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.feeStructures.remove(id);
  }
}
