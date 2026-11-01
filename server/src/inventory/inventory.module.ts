import { Global, Module } from '@nestjs/common';
import { GoodsReceiptsController, GroupLoansController, OpeningBatchesController, StockRequestsController, StockSalesController } from './docs';
import { InventoryActionsController, InventoryDocsService } from './docs.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

@Global()
@Module({
  // the actions controller comes first so /inventory/opening/post is not taken for an :id
  controllers: [StockController, InventoryActionsController, StockRequestsController, GoodsReceiptsController, OpeningBatchesController, StockSalesController, GroupLoansController],
  providers: [StockService, InventoryDocsService],
  exports: [StockService],
})
export class InventoryModule {}
