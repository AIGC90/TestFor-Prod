import { Global, Module } from '@nestjs/common';
import { DriverChargesController, GatePassesController, JobCardsController, PmSchedulesController, RepairBillsController, ToolChecklistsController } from './docs';
import { WorkshopActionsController, WorkshopService } from './workshop.service';

@Global()
@Module({
  controllers: [WorkshopActionsController, JobCardsController, PmSchedulesController, GatePassesController, RepairBillsController, ToolChecklistsController, DriverChargesController],
  providers: [WorkshopService],
  exports: [WorkshopService],
})
export class WorkshopModule {}
