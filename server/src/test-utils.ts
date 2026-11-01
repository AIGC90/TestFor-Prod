import { setupApp } from './app.setup';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { TraccarService, type TraccarUser } from './traccar/traccar.service';

/** Fake Traccar: any JSESSIONID listed in `sessions` is a valid login for that user. */
export class FakeTraccar {
  sessions = new Map<string, TraccarUser>();
  data = new Map<string, unknown>();

  async sessionUser(cookie: string) {
    return this.sessions.get(cookie.replace('JSESSIONID=', '')) ?? null;
  }

  posted: { path: string; body: unknown }[] = [];

  async get<T>(_cookie: string, path: string): Promise<T> {
    return (this.data.get(path) ?? this.data.get(path.split('?')[0]) ?? []) as T;
  }

  async post<T>(_cookie: string, path: string, body: unknown): Promise<T> {
    this.posted.push({ path, body });
    return { id: 1000 + this.posted.length, ...(body as object) } as T;
  }
}

export const ADMIN: TraccarUser = {
  id: 1, name: 'Admin', email: 'admin@test', administrator: true, readonly: false, disabled: false,
};
export const USER: TraccarUser = {
  id: 2, name: 'Store User', email: 'store@test', administrator: false, readonly: false, disabled: false,
};
/** A third account whose ERP role tests set as needed. */
export const STAFF: TraccarUser = {
  id: 3, name: 'Staff User', email: 'staff@test', administrator: false, readonly: false, disabled: false,
};

export async function createTestApp(): Promise<{ app: INestApplication; traccar: FakeTraccar }> {
  const traccar = new FakeTraccar();
  traccar.sessions.set('admin-session', ADMIN);
  traccar.sessions.set('user-session', USER);
  traccar.sessions.set('staff-session', STAFF);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TraccarService)
    .useValue(traccar)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app);
  await app.init();
  return { app, traccar };
}
