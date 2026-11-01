import { AttachmentsController } from './attachments.controller';
import { Global, Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { AuditService } from './audit.service';
import { ItemCategoriesController, ItemsController, PartiesController, PlantsController, StoresController } from './masters';
import { NumberingService } from './numbering.service';

@Global()
@Module({
  controllers: [AttachmentsController, AccessController, ApprovalsController, PlantsController, StoresController, PartiesController, ItemCategoriesController, ItemsController],
  providers: [AccessService, ApprovalsService, AuditService, NumberingService],
  exports: [AccessService, ApprovalsService, AuditService, NumberingService],
})
export class ErpModule {}
