import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';
import { HooksController } from './hooks/hooks.controller';
import { MeController } from './me.controller';
import { TraccarService } from './traccar/traccar.service';

@Module({
  imports: [DbModule],
  controllers: [HealthController, HooksController, MeController],
  providers: [TraccarService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
