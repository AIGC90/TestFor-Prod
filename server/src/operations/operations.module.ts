import { Global, Module } from '@nestjs/common';
import {
  ComplaintsController,
  FreightMemosController,
  FuelIndentsController,
  IncomingVehiclesController,
  LorryReceiptsController,
  MaterialReturnsController,
  OrdersController,
  TariffsController,
  TripsController,
} from './docs';
import { OperationsActionsController, OperationsService } from './ops.service';

@Global()
@Module({
  // actions first so fixed paths such as /ops/lrs/bulk win over /:id routes
  controllers: [
    OperationsActionsController,
    OrdersController,
    TariffsController,
    ComplaintsController,
    TripsController,
    LorryReceiptsController,
    FreightMemosController,
    FuelIndentsController,
    IncomingVehiclesController,
    MaterialReturnsController,
  ],
  providers: [OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
