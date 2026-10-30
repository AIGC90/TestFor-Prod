import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('erp');
  app.use(cookieParser());
  app.enableShutdownHooks();
  await app.listen(config.port);
}
bootstrap();
