import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { HooksController } from './hooks/hooks.controller';
import { MeController } from './me.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { TraccarService } from './traccar/traccar.service';
import { RolesController } from './users/roles.controller';

@Module({
  imports: [DbModule],
  controllers: [HealthController, HooksController, MeController, NotificationsController, RolesController],
  providers: [TraccarService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
