import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth';
import { DbModule } from './db/db.module';
import { ErpModule } from './erp/erp.module';
import { InventoryModule } from './inventory/inventory.module';
import { OperationsModule } from './operations/operations.module';
import { PeopleModule } from './people/people.module';
import { TyresModule } from './tyres/tyres.module';
import { WorkshopModule } from './workshop/workshop.module';
import { HealthController } from './health/health.controller';
import { HooksController } from './hooks/hooks.controller';
import { FlespiService } from './integrations/flespi.service';
import { IntegrationsController } from './integrations/integrations.controller';
import { MeController } from './me.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { TraccarModule } from './traccar/traccar.module';
import { RolesController } from './users/roles.controller';

@Module({
  imports: [DbModule, TraccarModule, ErpModule, InventoryModule, OperationsModule, WorkshopModule, TyresModule, PeopleModule],
  controllers: [HealthController, HooksController, MeController, NotificationsController, RolesController, IntegrationsController],
  providers: [FlespiService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
