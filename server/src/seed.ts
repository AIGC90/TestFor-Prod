// Seeds ERP reference data. Grows as modules are added; safe to re-run.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  // Module seeders register here (masters, stores, item categories...).
  await app.close();
  console.log('ERP seed complete');
}
seed();
