import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessService } from './access.service';
import { createTestApp } from '../test-utils';

const admin = { Cookie: 'JSESSIONID=admin-session' };
const staff = { Cookie: 'JSESSIONID=staff-session' };
const run = Date.now().toString(36).toUpperCase();

describe('ERP framework and masters', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const setRole = (role: string) => http.put('/erp/users/3/role').set(admin).send({ role }).expect(200);

  beforeAll(async () => {
    ({ app } = await createTestApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('creates, lists, updates and deletes a plant with validation and audit', async () => {
    const bad = await http.post('/erp/masters/plants').set(admin).send({ code: `P${run}`, name: 'Pune', gstin: 'BAD' }).expect(400);
    expect(bad.body.message).toMatch(/gstin: is not a valid GSTIN/);

    const created = await http
      .post('/erp/masters/plants')
      .set(admin)
      .send({ code: `p${run}`, name: 'Pune Central Plant', city: 'Pune', gstin: '27aapfu0939f1zv' })
      .expect(201);
    expect(created.body).toMatchObject({ code: `P${run}`, gstin: '27AAPFU0939F1ZV', active: true, createdBy: 1 });

    await http.post('/erp/masters/plants').set(admin).send({ code: `P${run}`, name: 'dup' }).expect(409);

    const list = await http.get(`/erp/masters/plants?search=${run}`).set(admin).expect(200);
    expect(list.body.map((p: { id: number }) => p.id)).toContain(created.body.id);

    const updated = await http.put(`/erp/masters/plants/${created.body.id}`).set(admin).send({ city: 'Chakan' }).expect(200);
    expect(updated.body).toMatchObject({ city: 'Chakan', name: 'Pune Central Plant' });

    await http.delete(`/erp/masters/plants/${created.body.id}`).set(admin).expect(204);
    await http.get(`/erp/masters/plants/${created.body.id}`).set(admin).expect(404);
  });

  it('numbers parties automatically and filters by kind', async () => {
    const res = await http.post('/erp/masters/parties').set(admin).send({ name: `Garage ${run}`, kinds: ['garage', 'vendor'], pan: 'aapfu0939f' }).expect(201);
    expect(res.body.code).toMatch(/^BP-\d{4}-\d{4}$/);
    const garages = await http.get('/erp/masters/parties?kind=garage').set(admin).expect(200);
    expect(garages.body.some((p: { id: number }) => p.id === res.body.id)).toBe(true);
    const buyers = await http.get('/erp/masters/parties?kind=buyer').set(admin).expect(200);
    expect(buyers.body.some((p: { id: number }) => p.id === res.body.id)).toBe(false);
    await http.post('/erp/masters/parties').set(admin).send({ name: 'No kind', kinds: [] }).expect(400);
    const blank = await http.post('/erp/masters/parties').set(admin).send({ name: `Blank code ${run}`, code: '', kinds: ['buyer'] }).expect(201);
    expect(blank.body.code).toMatch(/^BP-/);
  });

  it('builds a category tree at most four levels deep and protects used categories', async () => {
    let parentId: number | null = null;
    const ids: number[] = [];
    for (let level = 1; level <= 4; level++) {
      const res: { body: { id: number; level: number } } = await http.post('/erp/masters/item-categories').set(admin).send({ name: `L${level} ${run}`, parentId, gstRate: 18 }).expect(201);
      expect(res.body.level).toBe(level);
      parentId = res.body.id;
      ids.push(res.body.id);
    }
    await http.post('/erp/masters/item-categories').set(admin).send({ name: 'too deep', parentId }).expect(400);

    const item = await http.post('/erp/masters/items').set(admin).send({ name: `Brake disc ${run}`, categoryId: parentId, rate: 4800, tags: ['Brakes'] }).expect(201);
    expect(item.body).toMatchObject({ code: expect.stringMatching(/^ITM-/), rate: 4800, tags: ['brakes'] });

    const blocked = await http.delete(`/erp/masters/item-categories/${parentId}`).set(admin).expect(409);
    expect(blocked.body.message).toMatch(/1 items use this category/);
    await http.delete(`/erp/masters/item-categories/${ids[0]}`).set(admin).expect(409);
  });

  it('enforces role permissions per document type', async () => {
    // start from the storekeeper's built-in rights for plants (an earlier run may have customised them)
    await http.put('/erp/access/permissions').set(admin).send({ role: 'storekeeper', docType: 'plant', view: true, create: false, edit: false, delete: false, approve: false }).expect(200);
    await setRole('viewer');
    await http.get('/erp/masters/plants').set(staff).expect(200);
    const denied = await http.post('/erp/masters/plants').set(staff).send({ code: `V${run}`, name: 'x' }).expect(403);
    expect(denied.body.message).toMatch(/viewer.*cannot create plant/);

    await setRole('storekeeper');
    await http.post('/erp/masters/stores').set(staff).send({ code: `S${run}`, name: 'Yard', kind: 'tyre' }).expect(201);
    await http.post('/erp/masters/plants').set(staff).send({ code: `S${run}`, name: 'x' }).expect(403);

    // an admin customises the storekeeper role
    await http.put('/erp/access/permissions').set(admin).send({ role: 'storekeeper', docType: 'plant', view: true, create: true, edit: false, delete: false, approve: false }).expect(200);
    await http.post('/erp/masters/plants').set(staff).send({ code: `K${run}`, name: 'Kolkata' }).expect(201);
    const me = await http.get('/erp/access/me').set(staff).expect(200);
    expect(me.body.docTypes.plant).toMatchObject({ view: true, create: true, edit: false });

    await http.put('/erp/access/permissions').set(staff).send({ role: 'storekeeper', docType: 'plant', view: true, create: true, edit: true, delete: true, approve: true }).expect(403);
  });

  it('applies field masks: hidden fields vanish, read-only fields cannot be changed', async () => {
    await setRole('accountant');
    const party = await http.post('/erp/masters/parties').set(admin).send({ name: `Masked ${run}`, kinds: ['customer'], notes: 'secret', creditDays: 30 }).expect(201);
    const hide = await http.post('/erp/access/field-masks').set(admin).send({ role: 'accountant', docType: 'party', field: 'notes', mode: 'hidden' }).expect(201);
    const lock = await http.post('/erp/access/field-masks').set(admin).send({ role: 'accountant', docType: 'party', field: 'creditDays', mode: 'readonly' }).expect(201);

    const seen = await http.get(`/erp/masters/parties/${party.body.id}`).set(staff).expect(200);
    expect(seen.body.notes).toBeUndefined();
    const after = await http.put(`/erp/masters/parties/${party.body.id}`).set(staff).send({ creditDays: 90, city: 'Surat', notes: 'overwrite' }).expect(200);
    expect(after.body).toMatchObject({ creditDays: 30, city: 'Surat' });
    const raw = await http.get(`/erp/masters/parties/${party.body.id}`).set(admin).expect(200);
    expect(raw.body.notes).toBe('secret');

    await http.delete(`/erp/access/field-masks/${hide.body.id}`).set(admin).expect(204);
    await http.delete(`/erp/access/field-masks/${lock.body.id}`).set(admin).expect(204);
    await setRole('viewer');
  });

  it('redacts and strips with the static helpers', () => {
    const masks = { hidden: new Set(['b']), readonly: new Set(['c']) };
    expect(AccessService.redact({ a: 1, b: 2 }, masks)).toEqual({ a: 1 });
    expect(AccessService.stripInput({ a: 1, b: 2, c: 3 }, masks, false)).toEqual({ a: 1, c: 3 });
    expect(AccessService.stripInput({ a: 1, b: 2, c: 3 }, masks, true)).toEqual({ a: 1 });
  });
});
