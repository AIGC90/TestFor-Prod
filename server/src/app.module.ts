import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth';
import { DbModule } from './db/db.module';
import { ErpModule } from './erp/erp.module';
import { InventoryModule } from './inventory/inventory.module';
import { HealthController } from './health/health.controller';
import { HooksController } from './hooks/hooks.controller';
import { FlespiService } from './integrations/flespi.service';
import { IntegrationsController } from './integrations/integrations.controller';
import { MeController } from './me.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { TraccarService } from './traccar/traccar.service';
import { RolesController } from './users/roles.controller';

@Module({
  imports: [DbModule, ErpModule, InventoryModule],
  controllers: [HealthController, HooksController, MeController, NotificationsController, RolesController, IntegrationsController],
  providers: [TraccarService, FlespiService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
