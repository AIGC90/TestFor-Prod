import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test-utils';

describe('auth', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });
  afterAll(() => app.close());

  it('health is public', async () => {
    await request(app.getHttpServer()).get('/erp/health').expect(200, { status: 'ok' });
  });

  it('rejects requests without a session', async () => {
    await request(app.getHttpServer()).get('/erp/me').expect(401);
  });

  it('rejects an unknown session', async () => {
    await request(app.getHttpServer()).get('/erp/me').set('Cookie', 'JSESSIONID=nope').expect(401);
  });

  it('maps a Traccar administrator to the admin role', async () => {
    const res = await request(app.getHttpServer()).get('/erp/me').set('Cookie', 'JSESSIONID=admin-session').expect(200);
    expect(res.body).toMatchObject({ id: 1, role: 'admin', administrator: true });
    expect(res.body.cookie).toBeUndefined();
  });

  it('defaults a non-admin without an ERP role to viewer', async () => {
    const res = await request(app.getHttpServer()).get('/erp/me').set('Cookie', 'JSESSIONID=user-session').expect(200);
    expect(res.body.role).toBe('viewer');
  });

  it('hook endpoint requires the shared secret', async () => {
    await request(app.getHttpServer()).post('/erp/hooks/traccar-event').send({ event: { type: 'alarm' } }).expect(401);
    await request(app.getHttpServer())
      .post('/erp/hooks/traccar-event')
      .set('X-Hook-Secret', 'dev-hook-secret')
      .send({ event: { type: 'alarm', deviceId: 3 }, device: { name: 'MH-12-AB-1234' } })
      .expect(204);
  });
});
