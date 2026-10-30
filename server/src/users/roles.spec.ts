import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test-utils';

describe('ERP roles', () => {
  let app: INestApplication;
  const admin = { Cookie: 'JSESSIONID=admin-session' };
  const user = { Cookie: 'JSESSIONID=user-session' };

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });
  afterAll(async () => {
    await request(app.getHttpServer()).put('/erp/users/2/role').set(admin).send({ role: 'viewer' });
    await app.close();
  });

  it('lets an admin assign a role that the user then gets', async () => {
    await request(app.getHttpServer()).put('/erp/users/2/role').set(admin).send({ role: 'storekeeper' }).expect(200);
    const me = await request(app.getHttpServer()).get('/erp/me').set(user).expect(200);
    expect(me.body.role).toBe('storekeeper');
    const list = await request(app.getHttpServer()).get('/erp/users/roles').set(admin).expect(200);
    expect(list.body).toContainEqual({ userId: 2, role: 'storekeeper' });
  });

  it('rejects unknown roles and non-admin callers', async () => {
    await request(app.getHttpServer()).put('/erp/users/2/role').set(admin).send({ role: 'king' }).expect(400);
    await request(app.getHttpServer()).put('/erp/users/2/role').set(user).send({ role: 'admin' }).expect(403);
  });
});
