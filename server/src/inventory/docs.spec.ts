import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test-utils';
import { gstSplit } from './docs';

const admin = { Cookie: 'JSESSIONID=admin-session' };
const staff = { Cookie: 'JSESSIONID=staff-session' };
const run = Date.now().toString(36).toUpperCase();

describe('inventory documents', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let central: number;
  let workshop: number;
  let brake: number;
  let casing: number;
  let localBuyer: number;
  let outstationBuyer: number;
  const qtyAt = async (itemId: number, storeId: number) =>
    ((await http.get(`/erp/stock/balances?itemId=${itemId}&storeId=${storeId}`).set(admin).expect(200)).body[0]?.qty ?? 0) as number;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    http = request(app.getHttpServer());
    const plant = (await http.post('/erp/masters/plants').set(admin).send({ code: `PL${run}`, name: 'Pune', state: 'Maharashtra' }).expect(201)).body.id;
    central = (await http.post('/erp/masters/stores').set(admin).send({ code: `CD${run}`, name: 'Central', plantId: plant }).expect(201)).body.id;
    workshop = (await http.post('/erp/masters/stores').set(admin).send({ code: `WS${run}`, name: 'Workshop', plantId: plant }).expect(201)).body.id;
    const cat = (await http.post('/erp/masters/item-categories').set(admin).send({ name: `Spares ${run}`, countingMode: 'standard', gstRate: 18 }).expect(201)).body.id;
    const tcat = (await http.post('/erp/masters/item-categories').set(admin).send({ name: `Casings ${run}`, countingMode: 'serial', gstRate: 28 }).expect(201)).body.id;
    brake = (await http.post('/erp/masters/items').set(admin).send({ name: `Brake ${run}`, categoryId: cat, rate: 1800 }).expect(201)).body.id;
    casing = (await http.post('/erp/masters/items').set(admin).send({ name: `Casing ${run}`, categoryId: tcat, rate: 1300 }).expect(201)).body.id;
    localBuyer = (await http.post('/erp/masters/parties').set(admin).send({ name: `Local scrap ${run}`, kinds: ['buyer'], state: 'maharashtra' }).expect(201)).body.id;
    outstationBuyer = (await http.post('/erp/masters/parties').set(admin).send({ name: `Gujarat scrap ${run}`, kinds: ['buyer'], state: 'Gujarat' }).expect(201)).body.id;
    for (const docType of ['stock_request', 'stock_sale']) {
      await http.put('/erp/approvals/rules').set(admin).send({ docType, enabled: true, minAmount: 0, approverRole: 'storekeeper' }).expect(200);
    }
    await http.put('/erp/users/3/role').set(admin).send({ role: 'storekeeper' }).expect(200);
  });
  afterAll(async () => {
    await http.put('/erp/users/3/role').set(admin).send({ role: 'viewer' });
    await app.close();
  });

  it('splits GST within and across states', () => {
    expect(gstSplit(1000, 18, true)).toEqual({ cgst: 90, sgst: 90, igst: 0 });
    expect(gstSplit(1000, 18, false)).toEqual({ cgst: 0, sgst: 0, igst: 180 });
    expect(gstSplit(10.01, 5, true)).toEqual({ cgst: 0.25, sgst: 0.25, igst: 0 });
  });

  it('posts opening stock once per batch id', async () => {
    const body = { batchId: `B-${run}`, storeId: central, lines: [{ itemId: brake, qty: 40, rate: 1800 }] };
    const first = (await http.post('/erp/inventory/opening/post').set(admin).send(body).expect(201)).body;
    expect(first).toMatchObject({ alreadyPosted: false, totalQty: 40, totalValue: 72000 });
    const again = (await http.post('/erp/inventory/opening/post').set(admin).send(body).expect(201)).body;
    expect(again).toMatchObject({ alreadyPosted: true, id: first.id });
    expect(await qtyAt(brake, central)).toBe(40);
    await http.post('/erp/inventory/opening/post').set(admin).send({ storeId: central, lines: [{ itemId: casing, qty: 2, rate: 1300, serials: ['only-one'] }] }).expect(400);
  });

  it('runs a transfer request through approval to stock movement', async () => {
    await http.post('/erp/inventory/requests').set(staff).send({ kind: 'transfer', storeId: workshop, fromStoreId: workshop, lines: [{ itemId: brake, qty: 5 }] }).expect(400);
    const req = (await http.post('/erp/inventory/requests').set(staff).send({ kind: 'transfer', storeId: workshop, fromStoreId: central, lines: [{ itemId: brake, qty: 5 }] }).expect(201)).body;
    expect(req).toMatchObject({ status: 'open', reqNo: expect.stringMatching(/^REQ-/), requestedByName: 'Staff User' });

    await http.post(`/erp/inventory/requests/${req.id}/fulfil`).set(admin).expect(409); // not approved yet
    const submitted = (await http.post(`/erp/inventory/requests/${req.id}/submit`).set(staff).expect(201)).body;
    expect(submitted.status).toBe('pending_approval');
    await http.put(`/erp/inventory/requests/${req.id}`).set(staff).send({ notes: 'edit' }).expect(400);

    const pending = (await http.get('/erp/approvals?docType=stock_request').set(admin).expect(200)).body.find((a: { docId: number }) => a.docId === req.id);
    await http.post(`/erp/approvals/${pending.id}/approve`).set(admin).send({}).expect(201);
    await http.post(`/erp/inventory/requests/${req.id}/fulfil`).set(staff).expect(201);
    expect(await qtyAt(brake, workshop)).toBe(5);
    expect(await qtyAt(brake, central)).toBe(35);
  });

  it('turns a buy request into a goods receipt that lands stock', async () => {
    await http.put('/erp/approvals/rules').set(admin).send({ docType: 'stock_request', enabled: false, minAmount: 0, approverRole: 'storekeeper' }).expect(200);
    const req = (await http.post('/erp/inventory/requests').set(staff).send({ kind: 'buy', storeId: central, lines: [{ itemId: casing, qty: 2 }, { itemId: brake, qty: 10 }] }).expect(201)).body;
    expect((await http.post(`/erp/inventory/requests/${req.id}/submit`).set(staff).expect(201)).body.status).toBe('approved');
    const { receipt } = (await http.post(`/erp/inventory/requests/${req.id}/fulfil`).set(staff).expect(201)).body;
    expect(receipt).toMatchObject({ status: 'expected', recNo: expect.stringMatching(/^REC-/) });

    await http.post(`/erp/inventory/receipts/${receipt.id}/land`).set(staff).expect(400); // nothing arrived yet
    const lines = [
      { itemId: casing, expected: 2, received: 2, rate: 1300, serials: [`C1-${run}`, `C2-${run}`] },
      { itemId: brake, expected: 10, received: 10, rate: 1900, serials: [] },
    ];
    expect((await http.put(`/erp/inventory/receipts/${receipt.id}`).set(staff).send({ lines }).expect(200)).body.status).toBe('ready');
    expect((await http.post(`/erp/inventory/receipts/${receipt.id}/land`).set(staff).expect(201)).body.status).toBe('landed');
    await http.post(`/erp/inventory/receipts/${receipt.id}/land`).set(staff).expect(409);
    expect(await qtyAt(casing, central)).toBe(2);
    expect(await qtyAt(brake, central)).toBe(45);
    const r = (await http.get(`/erp/inventory/requests/${req.id}`).set(admin).expect(200)).body;
    expect(r.status).toBe('fulfilled');
  });

  it('prices sales with the right GST and takes stock out on invoice', async () => {
    const local = (await http.post('/erp/inventory/sales').set(staff).send({ buyerId: localBuyer, storeId: central, lines: [{ itemId: casing, qty: 1, rate: 1000, gstRate: 28, serials: [`C1-${run}`] }] }).expect(201)).body;
    expect(local).toMatchObject({ taxable: 1000, cgst: 140, sgst: 140, igst: 0, total: 1280, status: 'draft' });
    const away = (await http.post('/erp/inventory/sales').set(staff).send({ buyerId: outstationBuyer, storeId: central, lines: [{ itemId: brake, qty: 2, rate: 500, gstRate: 18 }] }).expect(201)).body;
    expect(away).toMatchObject({ taxable: 1000, igst: 180, cgst: 0, total: 1180 });

    await http.post(`/erp/inventory/sales/${local.id}/invoice`).set(staff).expect(409);
    await http.post(`/erp/inventory/sales/${local.id}/submit`).set(staff).expect(201);
    const pending = (await http.get('/erp/approvals?docType=stock_sale').set(admin).expect(200)).body.find((a: { docId: number }) => a.docId === local.id);
    expect(pending.amount).toBe(1280);
    await http.post(`/erp/approvals/${pending.id}/approve`).set(admin).send({}).expect(201);
    expect((await http.post(`/erp/inventory/sales/${local.id}/invoice`).set(staff).expect(201)).body.status).toBe('invoiced');
    expect(await qtyAt(casing, central)).toBe(1);
    await http.post(`/erp/inventory/sales/${local.id}/paid`).set(staff).expect(201);
    await http.delete(`/erp/inventory/sales/${local.id}`).set(admin).expect(409);
  });

  it('records group loans only with sister companies', async () => {
    const sister = (await http.post('/erp/masters/parties').set(admin).send({ name: `Sister ${run}`, kinds: ['sister_company'] }).expect(201)).body.id;
    const base = { direction: 'lent', tyreSerial: `MRF-${run}`, tyreSpec: 'MRF Steel Muscle 295/80 R22.5', loanDate: '2026-10-18' };
    await http.post('/erp/inventory/loans').set(admin).send({ ...base, sisterId: localBuyer }).expect(400);
    const loan = (await http.post('/erp/inventory/loans').set(admin).send({ ...base, sisterId: sister, expectedReturn: '2026-11-15' }).expect(201)).body;
    expect(loan).toMatchObject({ status: 'active', loanNo: expect.stringMatching(/^LN-/) });
    const back = (await http.post(`/erp/inventory/loans/${loan.id}/return`).set(admin).send({ remarks: 'inspected' }).expect(201)).body;
    expect(back).toMatchObject({ status: 'returned', remarks: 'inspected' });
  });
});
