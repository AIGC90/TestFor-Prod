import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test-utils';

describe('notification read state', () => {
  let app: INestApplication;
  const admin = { Cookie: 'JSESSIONID=admin-session' };
  const user = { Cookie: 'JSESSIONID=user-session' };

  beforeAll(async () => {
    ({ app } = await createTestApp());
    await request(app.getHttpServer()).post('/erp/notifications/unread').set(admin).send({ ids: [9001, 9002, 9003] });
  });
  afterAll(() => app.close());

  it('marks events read per user and reports them back', async () => {
    await request(app.getHttpServer()).post('/erp/notifications/read').set(admin).send({ ids: [9001, 9002] }).expect(204);
    // idempotent
    await request(app.getHttpServer()).post('/erp/notifications/read').set(admin).send({ ids: [9001] }).expect(204);
    const res = await request(app.getHttpServer()).get('/erp/notifications/read?ids=9001,9002,9003').set(admin).expect(200);
    expect(res.body.sort()).toEqual([9001, 9002]);
    const other = await request(app.getHttpServer()).get('/erp/notifications/read?ids=9001,9002').set(user).expect(200);
    expect(other.body).toEqual([]);
  });

  it('marks events unread again', async () => {
    await request(app.getHttpServer()).post('/erp/notifications/unread').set(admin).send({ ids: [9002] }).expect(204);
    const res = await request(app.getHttpServer()).get('/erp/notifications/read?ids=9001,9002').set(admin).expect(200);
    expect(res.body).toEqual([9001]);
  });

  it('validates input', async () => {
    await request(app.getHttpServer()).post('/erp/notifications/read').set(admin).send({ ids: ['x'] }).expect(400);
    await request(app.getHttpServer()).get('/erp/notifications/read?ids=1,abc').set(admin).expect(400);
  });
});
