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
import { AssetsService } from './assets.service';
import { AssetDto } from './dto/asset.dto';
import { AssetResponseDto, PagedAssetsDto } from './dto/asset-response.dto';

/**
 * `frontend/src/features/inventory/api.ts`'s assets surface (`modules/inventory.md` "Backend
 * dependencies") — served at the top-level `/assets` prefix (matching `api.ts` exactly, not
 * `/inventory/assets`), `assets.read`/`assets.manage` gating.
 */
@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  @RequirePermission('assets.read')
  list(@Query() query: ListQueryDto): Promise<PagedAssetsDto> {
    return this.assetsService.list(query);
  }

  @Get(':id')
  @RequirePermission('assets.read')
  get(@Param('id') id: string): Promise<AssetResponseDto> {
    return this.assetsService.get(id);
  }

  @Post()
  @RequirePermission('assets.manage')
  create(@Body() dto: AssetDto): Promise<AssetResponseDto> {
    return this.assetsService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('assets.manage')
  update(
    @Param('id') id: string,
    @Body() dto: AssetDto,
  ): Promise<AssetResponseDto> {
    return this.assetsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('assets.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.assetsService.remove(id);
  }
}
