import { Global, Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { ItemCategoriesController, ItemsController, PartiesController, PlantsController, StoresController } from './masters';
import { NumberingService } from './numbering.service';

@Global()
@Module({
  controllers: [AccessController, PlantsController, StoresController, PartiesController, ItemCategoriesController, ItemsController],
  providers: [AccessService, AuditService, NumberingService],
  exports: [AccessService, AuditService, NumberingService],
})
export class ErpModule {}
