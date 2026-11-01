import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test-utils';
import { glAccounts } from './stock.service';

const admin = { Cookie: 'JSESSIONID=admin-session' };
const run = Date.now().toString(36).toUpperCase();

describe('stock engine', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let storeA: number;
  let storeB: number;
  let oil: number; // standard quantity
  let tyre: number; // serial-tracked via its category
  const move = (body: Record<string, unknown>) => http.post('/erp/stock/movements').set(admin).send(body);
  const balance = async (itemId: number, storeId: number) => {
    const rows = (await http.get(`/erp/stock/balances?itemId=${itemId}&storeId=${storeId}`).set(admin).expect(200)).body;
    return rows[0] ?? { qty: 0, value: 0 };
  };

  beforeAll(async () => {
    ({ app } = await createTestApp());
    http = request(app.getHttpServer());
    storeA = (await http.post('/erp/masters/stores').set(admin).send({ code: `A${run}`, name: `Store A ${run}` }).expect(201)).body.id;
    storeB = (await http.post('/erp/masters/stores').set(admin).send({ code: `B${run}`, name: `Store B ${run}` }).expect(201)).body.id;
    const lube = (await http.post('/erp/masters/item-categories').set(admin).send({ name: `Lube ${run}`, countingMode: 'volume', unit: 'ltr' }).expect(201)).body.id;
    const tyres = (await http.post('/erp/masters/item-categories').set(admin).send({ name: `Tyres ${run}`, countingMode: 'serial' }).expect(201)).body.id;
    oil = (await http.post('/erp/masters/items').set(admin).send({ name: `Oil ${run}`, categoryId: lube, rate: 300 }).expect(201)).body.id;
    tyre = (await http.post('/erp/masters/items').set(admin).send({ name: `Tyre ${run}`, categoryId: tyres, rate: 26000 }).expect(201)).body.id;
    await http.put('/erp/stock/gl').set(admin).send({ enabled: false }).expect(200);
  });
  afterAll(() => app.close());

  it('keeps a moving-average cost across receipts and issues', async () => {
    await move({ kind: 'receipt', itemId: oil, storeId: storeA, qty: 100, unitRate: 300 }).expect(201);
    await move({ kind: 'receipt', itemId: oil, storeId: storeA, qty: 100, unitRate: 400 }).expect(201);
    expect(await balance(oil, storeA)).toMatchObject({ qty: 200, value: 70000, avgRate: 350 });

    const issue = (await move({ kind: 'issue', itemId: oil, storeId: storeA, qty: 50, vehicleNo: 'MH-12-AB-1234', lrNo: 'LR-1' }).expect(201)).body;
    expect(issue).toMatchObject({ docNo: expect.stringMatching(/^ISS-/), unitRate: 350, value: 17500, status: 'completed' });
    expect(await balance(oil, storeA)).toMatchObject({ qty: 150, value: 52500 });
  });

  it('never lets stock go negative and validates input', async () => {
    const res = await move({ kind: 'issue', itemId: oil, storeId: storeA, qty: 1000, vehicleNo: 'X' }).expect(409);
    expect(res.body.message).toMatch(/Only 150 of Oil/);
    await move({ kind: 'issue', itemId: oil, storeId: storeA, qty: 5 }).expect(400); // no vehicle
    await move({ kind: 'transfer', itemId: oil, storeId: storeA, qty: 5 }).expect(400); // no destination
    await move({ kind: 'receipt', itemId: oil, storeId: storeA, qty: -5 }).expect(400);
    await move({ kind: 'receipt', itemId: oil, storeId: storeA, qty: 5, serials: ['X1'] }).expect(400);
  });

  it('moves stock between stores, optionally via in-transit', async () => {
    const t = (await move({ kind: 'transfer', itemId: oil, storeId: storeA, toStoreId: storeB, qty: 30, status: 'in_transit' }).expect(201)).body;
    expect(await balance(oil, storeA)).toMatchObject({ qty: 120 });
    expect((await balance(oil, storeB)).qty).toBe(0);
    await http.post(`/erp/stock/movements/${t.id}/receive`).set(admin).expect(201);
    expect(await balance(oil, storeB)).toMatchObject({ qty: 30, value: 10500 });
    await http.post(`/erp/stock/movements/${t.id}/receive`).set(admin).expect(409);
  });

  it('tracks serial pieces through receipt, issue, return and write-off', async () => {
    await move({ kind: 'receipt', itemId: tyre, storeId: storeA, qty: 2, serials: [`T1-${run}`] }).expect(400);
    await move({ kind: 'receipt', itemId: tyre, storeId: storeA, qty: 3, unitRate: 26000, serials: [`T1-${run}`, `T2-${run}`, `T3-${run}`] }).expect(201);
    const dup = await move({ kind: 'receipt', itemId: tyre, storeId: storeA, qty: 1, serials: [`T1-${run}`] }).expect(409);
    expect(dup.body.message).toMatch(/already in stock/);

    await move({ kind: 'issue', itemId: tyre, storeId: storeA, qty: 1, serials: [`T1-${run}`], vehicleNo: 'RJ-14-GH-4920' }).expect(201);
    await move({ kind: 'issue', itemId: tyre, storeId: storeA, qty: 1, serials: [`T1-${run}`], vehicleNo: 'RJ-14-GH-4920' }).expect(409);
    let pieces = (await http.get(`/erp/stock/pieces?itemId=${tyre}`).set(admin).expect(200)).body;
    expect(pieces.find((p: { serial: string }) => p.serial === `T1-${run}`)).toMatchObject({ state: 'issued', vehicleNo: 'RJ-14-GH-4920', storeId: null });

    // a casing comes back from the vehicle
    await move({ kind: 'return', itemId: tyre, storeId: storeB, qty: 1, serials: [`T1-${run}`], unitRate: 9000 }).expect(201);
    const t2 = pieces.find((p: { serial: string }) => p.serial === `T2-${run}`);
    await http.post(`/erp/stock/pieces/${t2.id}/state`).set(admin).send({ state: 'damaged' }).expect(201);
    await move({ kind: 'issue', itemId: tyre, storeId: storeA, qty: 1, serials: [`T2-${run}`], vehicleNo: 'X' }).expect(409);
    await move({ kind: 'write_off', itemId: tyre, storeId: storeA, qty: 1, serials: [`T2-${run}`] }).expect(201);

    pieces = (await http.get(`/erp/stock/pieces?itemId=${tyre}`).set(admin).expect(200)).body;
    const state = Object.fromEntries(pieces.map((p: { serial: string; state: string }) => [p.serial, p.state]));
    expect(state).toEqual({ [`T1-${run}`]: 'in_stock', [`T2-${run}`]: 'written_off', [`T3-${run}`]: 'in_stock' });
    expect(await balance(tyre, storeA)).toMatchObject({ qty: 1 });
    expect(await balance(tyre, storeB)).toMatchObject({ qty: 1, value: 9000 });
  });

  it('records signed adjustments', async () => {
    await move({ kind: 'adjustment', itemId: oil, storeId: storeB, qty: -10, remarks: 'count shortage' }).expect(201);
    const found = (await move({ kind: 'adjustment', itemId: oil, storeId: storeB, qty: 2 }).expect(201)).body;
    expect(found.qty).toBe(2);
    expect(await balance(oil, storeB)).toMatchObject({ qty: 22 });
  });

  it('posts GL vouchers when enabled and backfills older movements', async () => {
    const before = (await http.get('/erp/stock/gl').set(admin).expect(200)).body;
    expect(before.enabled).toBe(false);
    expect(before.unposted).toBeGreaterThan(0);
    const dry = (await http.post('/erp/stock/gl/backfill').set(admin).send({ dryRun: true }).expect(201)).body;
    expect(dry).toMatchObject({ dryRun: true, count: before.unposted });

    await http.put('/erp/stock/gl').set(admin).send({ enabled: true }).expect(200);
    const m = (await move({ kind: 'receipt', itemId: oil, storeId: storeA, qty: 1, unitRate: 500 }).expect(201)).body;
    const list = (await http.get(`/erp/stock/movements?itemId=${oil}&kind=receipt`).set(admin).expect(200)).body;
    expect(list.find((x: { id: number }) => x.id === m.id).glVoucherId).toBeTruthy();

    const done = (await http.post('/erp/stock/gl/backfill').set(admin).send({ dryRun: false }).expect(201)).body;
    expect(done.count).toBe(before.unposted);
    expect((await http.get('/erp/stock/gl').set(admin).expect(200)).body.unposted).toBe(0);
    await http.put('/erp/stock/gl').set(admin).send({ enabled: false }).expect(200);
  });

  it('maps movements to accounts', () => {
    expect(glAccounts('issue', 1)).toEqual({ debit: 'Vehicle Maintenance Expense', credit: 'Inventory' });
    expect(glAccounts('adjustment', -1)).toEqual({ debit: 'Stock Adjustment', credit: 'Inventory' });
    expect(glAccounts('transfer', 1)).toBeNull();
  });

  it('summarises stock per store', async () => {
    const s = (await http.get('/erp/stock/summary').set(admin).expect(200)).body;
    const a = s.perStore.find((x: { storeId: number }) => x.storeId === storeA);
    expect(a.lines).toBeGreaterThan(0);
    expect(s.pieces.in_stock).toBeGreaterThan(0);
  });
});
