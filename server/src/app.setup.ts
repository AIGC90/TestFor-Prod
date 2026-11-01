import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { config } from './config';

/** Shared HTTP setup for the server and the tests. Attachments arrive as base64 JSON, hence the larger body limit. */
export function setupApp(app: INestApplication) {
  app.setGlobalPrefix('erp');
  app.use(cookieParser());
  (app as NestExpressApplication).useBodyParser('json', { limit: Math.ceil(config.maxUploadBytes * 1.4) + 65536 });
}
