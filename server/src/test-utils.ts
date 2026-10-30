import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { TraccarService, type TraccarUser } from './traccar/traccar.service';

/** Fake Traccar: any JSESSIONID listed in `sessions` is a valid login for that user. */
export class FakeTraccar {
  sessions = new Map<string, TraccarUser>();
  data = new Map<string, unknown>();

  async sessionUser(cookie: string) {
    return this.sessions.get(cookie.replace('JSESSIONID=', '')) ?? null;
  }

  async get<T>(_cookie: string, path: string): Promise<T> {
    return (this.data.get(path) ?? []) as T;
  }
}

export const ADMIN: TraccarUser = {
  id: 1, name: 'Admin', email: 'admin@test', administrator: true, readonly: false, disabled: false,
};
export const USER: TraccarUser = {
  id: 2, name: 'Store User', email: 'store@test', administrator: false, readonly: false, disabled: false,
};

export async function createTestApp(): Promise<{ app: INestApplication; traccar: FakeTraccar }> {
  const traccar = new FakeTraccar();
  traccar.sessions.set('admin-session', ADMIN);
  traccar.sessions.set('user-session', USER);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TraccarService)
    .useValue(traccar)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('erp');
  app.use(cookieParser());
  await app.init();
  return { app, traccar };
}
