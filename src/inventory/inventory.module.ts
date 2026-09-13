import { Module } from '@nestjs/common';
import { StockController } from './stock/stock.controller';
import { StockService } from './stock/stock.service';
import { AssetsController } from './assets/assets.controller';
import { AssetsService } from './assets/assets.service';

/**
 * PRD §24 Inventory & Asset Management (Phase 7.4, `../implementation-plan.md`). Two
 * controller/service pairs by concern, same split-by-concern-not-by-prefix convention
 * `TransportModule` already set — `stock/` (categories, items, movements) and `assets/` each own
 * their own subdirectory (DTOs included). `AssetsController` deliberately serves the top-level
 * `/assets` prefix, not `/inventory/assets` — matches `frontend/src/features/inventory/api.ts`'s
 * routes exactly.
 */
@Module({
  controllers: [StockController, AssetsController],
  providers: [StockService, AssetsService],
})
export class InventoryModule {}
