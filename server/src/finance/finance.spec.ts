import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../db/db.module';
import { fuelIndents, trips } from '../db/schema';
import { createTestApp, type FakeTraccar } from '../test-utils';
import { tagStatus } from './fastag';
import { ageing } from './invoices';
import { addMonths, licenceState } from './subscriptions';

const admin = { Cookie: 'JSESSIONID=admin-session' };
const run = Date.now().toString(36).toUpperCase();
const n = parseInt(run.slice(-5), 36);
const VEH = `KA01FN${run.slice(-4)}`;
const DAY = 86_400_000;
const DEV = 100_000 + n;

describe('finance: pure rules', () => {
  it('ages receivables and computes licence dates', () => {
    const b = ageing(
      [
        { dueDate: '2026-11-10', total: 1000, received: 0, status: 'open' },
        { dueDate: '2026-10-20', total: 500, received: 100, status: 'partly_paid' },
        { dueDate: '2026-07-01', total: 900, received: 0, status: 'open' },
        { dueDate: '2026-07-01', total: 900, received: 900, status: 'paid' },
      ],
      '2026-11-01',
    );
    expect(b.map((x) => x.amount)).toEqual([1000, 400, 0, 0, 900]);
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 12)).toBe('2027-11-15');
    expect(licenceState({ status: 'active', expiresOn: '2026-11-20' }, '2026-11-01')).toBe('expiring');
    expect(licenceState({ status: 'active', expiresOn: '2026-10-31' }, '2026-11-01')).toBe('expired');
    expect(tagStatus({ status: 'low_balance', lowBalance: 1000 }, 5000)).toBe('active');
    expect(tagStatus({ status: 'blacklisted', lowBalance: 1000 }, 5000)).toBe('blacklisted');
  });
});

describe('finance API', () => {
  let app: INestApplication;
  let traccar: FakeTraccar;
  let http: ReturnType<typeof request>;
  let db: Db;
  let customer: number;
  let tripA: number;
  let tripB: number;

  beforeAll(async () => {
    ({ app, traccar } = await createTestApp());
    http = request(app.getHttpServer());
    db = app.get(DB);
    traccar.data.set('/devices', [{ id: DEV, name: VEH, uniqueId: String(860000000000000 + n), model: 'Tata Signa 4825' }, { id: DEV + 1, name: `XX${run}`, uniqueId: 'not-an-imei' }]);
    customer = (await http.post('/erp/masters/parties').set(admin).send({ name: `Shree Cement ${run}`, kinds: ['customer'], creditDays: 45 }).expect(201)).body.id;
    const done = new Date(Date.now() - 2 * DAY);
    const mk = (i: number, freight: number) => ({ tripNo: `TRP-T${run}-${i}`, customerId: customer, vehicleNo: VEH, driverName: 'Mahesh', driverPhone: '9000000000', origin: 'Beawar', destination: 'Jaipur', plannedKm: 200, freight, status: 'completed', startedAt: new Date(done.getTime() - DAY), completedAt: done });
    const rows = await db.insert(trips).values([mk(1, 40000), mk(2, 25000), { ...mk(3, 10000), status: 'in_transit', completedAt: null }]).returning();
    [tripA, tripB] = rows.map((r) => r.id);
    await db.insert(fuelIndents).values({ indentNo: `FI-T${run}`, vehicleNo: VEH, pump: 'IOCL', amount: 18000, rate: 90, litres: 200, status: 'approved', indentDate: done });
  });
  afterAll(() => app.close());

  let inv: { id: number; total: number; invNo: string };

  it('invoices completed trips once, with GST and credit terms', async () => {
    const unbilled = (await http.get(`/erp/finance/unbilled-trips?customerId=${customer}`).set(admin).expect(200)).body;
    expect(unbilled.map((t: { id: number }) => t.id).sort()).toEqual([tripA, tripB].sort());
    inv = (await http.post('/erp/finance/invoices').set(admin).send({ customerId: customer, tripIds: [tripA, tripB], invoiceDate: '2026-10-01' }).expect(201)).body;
    expect(inv).toMatchObject({ taxable: 65000, gstRate: 5, cgst: 1625, sgst: 1625, igst: 0, total: 68250, dueDate: '2026-11-15', lane: 'Beawar → Jaipur', status: 'open' });
    await http.post('/erp/finance/invoices').set(admin).send({ customerId: customer, tripIds: [tripA] }).expect(409);
    expect((await http.get(`/erp/finance/unbilled-trips?customerId=${customer}`).set(admin).expect(200)).body).toHaveLength(0);
    const ex = (await http.put(`/erp/finance/invoices/${inv.id}`).set(admin).send({ interState: 1 }).expect(200)).body;
    expect(ex).toMatchObject({ cgst: 0, sgst: 0, igst: 3250, total: 68250 });
  });

  it('records receipts with TDS and ages what is left', async () => {
    await http.post(`/erp/finance/invoices/${inv.id}/receipts`).set(admin).send({ amount: 70000 }).expect(400);
    const part = (await http.post(`/erp/finance/invoices/${inv.id}/receipts`).set(admin).send({ amount: 40000, tds: 650, mode: 'neft', reference: 'UTR1' }).expect(201)).body;
    expect(part).toMatchObject({ received: 40650, status: 'partly_paid' });
    await http.put(`/erp/finance/invoices/${inv.id}`).set(admin).send({ gstRate: 12 }).expect(400);
    await http.post(`/erp/finance/invoices/${inv.id}/cancel`).set(admin).send({ reason: 'x' }).expect(409);
    const r = (await http.get('/erp/finance/receivables').set(admin).expect(200)).body;
    const mine = r.open.find((i: { id: number }) => i.id === inv.id);
    expect(mine).toMatchObject({ outstanding: 27600 });
    expect(r.byCustomer.find((c: { customerId: number }) => c.customerId === customer).outstanding).toBe(27600);
    const paid = (await http.post(`/erp/finance/invoices/${inv.id}/receipts`).set(admin).send({ amount: 27600 }).expect(201)).body;
    expect(paid.status).toBe('paid');
    expect((await http.get(`/erp/finance/invoices/${inv.id}/receipts`).set(admin).expect(200)).body).toHaveLength(2);
  });

  it('imports FASTag statements once and keeps balances current', async () => {
    const tag = `34161FA82033${String(n).padStart(8, '0')}`.slice(0, 24);
    const acct = (await http.post('/erp/fastag/accounts').set(admin).send({ vehicleNo: VEH, tagId: tag, bank: 'ICICI Bank', lowBalance: 1000 }).expect(201)).body;
    const t0 = Date.now() - 2.5 * DAY; // while the trips were running
    const rows = [
      { txnRef: `T${run}1`, tagId: tag, plaza: 'Kishangarh toll plaza', highway: 'NH48', at: new Date(t0).toISOString(), amount: 395, balanceAfter: 1105 },
      { txnRef: `T${run}2`, vehicleNo: VEH, plaza: 'Daulatpura toll plaza', highway: 'NH48', at: new Date(t0 + 3_600_000).toISOString(), amount: 285 },
      { txnRef: `T${run}3`, tagId: 'UNKNOWN-TAG-1', at: new Date().toISOString(), amount: 100 },
      { txnRef: '', at: 'nope', amount: -1 },
    ];
    const res = (await http.post('/erp/fastag/txns/import').set(admin).send({ rows }).expect(201)).body;
    expect(res).toMatchObject({ imported: 2, duplicates: 0 });
    expect(res.errors.map((e: { row: number }) => e.row)).toEqual([3, 4]);
    let a = (await http.get(`/erp/fastag/accounts/${acct.id}`).set(admin).expect(200)).body;
    expect(a).toMatchObject({ balance: 820, status: 'low_balance' });
    expect((await http.post('/erp/fastag/txns/import').set(admin).send({ rows: rows.slice(0, 2) }).expect(201)).body).toMatchObject({ imported: 0, duplicates: 2 });
    a = (await http.post(`/erp/fastag/accounts/${acct.id}/recharge`).set(admin).send({ amount: 5000 }).expect(201)).body;
    expect(a).toMatchObject({ balance: 5820, status: 'active' });
    const txns = (await http.get(`/erp/fastag/txns?vehicleNo=${VEH}&kind=toll`).set(admin).expect(200)).body;
    expect(txns).toHaveLength(2);
    for (const t of txns) expect(t.tripNo).toMatch(new RegExp(`^TRP-T${run}-[12]$`));
    await http.post('/erp/fastag/sync').set(admin).expect(400); // no aggregator configured
    const s = (await http.get('/erp/fastag/summary').set(admin).expect(200)).body;
    expect(s.gateway.configured).toBe(false);
    expect(s.spend30).toBeGreaterThanOrEqual(680);
  });

  it('reports revenue, costs and fleet KPIs for the period', async () => {
    traccar.data.set('/reports/summary', [{ deviceId: DEV, distance: 400_000, engineHours: 10 * 3_600_000 }]);
    traccar.data.set('/reports/trips', [{ deviceId: DEV, duration: 8 * 3_600_000, distance: 400_000 }]);
    const a = (await http.get(`/erp/finance/analytics?vehicleNo=${VEH}&from=${new Date(Date.now() - 7 * DAY).toISOString()}`).set(admin).expect(200)).body;
    expect(a.kpis).toMatchObject({ revenue: 65000, trips: 2, km: 400, kmPerLitre: 2, idleLossPct: 20 });
    const v = a.vehicles[0];
    expect(v).toMatchObject({ vehicleNo: VEH, model: 'Tata Signa 4825', revenue: 65000, runningHours: 10, idleHours: 2 });
    expect(v.costs).toMatchObject({ fuel: 18000, tolls: 680 });
    expect(v.expenses).toBe(18680);
    expect(a.kpis.expenses).toBe(18680);
    expect(a.lanes[0]).toMatchObject({ lane: 'Beawar → Jaipur', trips: 2, km: 400, revenue: 65000 });
    expect(a.lanes[0].cost).toBeCloseTo(18680, 0);
    expect(a.daily.reduce((s: number, d: { revenue: number }) => s + d.revenue, 0)).toBe(65000);
    expect(a.insights.length).toBeGreaterThan(0);
    await http.get('/erp/finance/analytics?from=2020-01-01&to=2026-01-01').set(admin).expect(400);
    traccar.data.delete('/reports/summary');
    traccar.data.delete('/reports/trips');
  });

  it('imports devices as licences, renews and bills them with GST', async () => {
    const imp = (await http.post('/erp/subscriptions/import-devices').set(admin).send({ plan: 'ais140' }).expect(201)).body;
    expect(imp.created).toBe(1);
    expect(imp.skipped).toEqual([{ vehicleNo: `XX${run}`, reason: 'identifier not-an-imei is not a 15-digit IMEI' }]);
    const lic = (await http.get(`/erp/subscriptions/licenses?vehicleNo=${VEH}`).set(admin).expect(200)).body[0];
    expect(lic).toMatchObject({ plan: 'ais140', imei: String(860000000000000 + n) });
    await http.post('/erp/subscriptions/licenses').set(admin).send({ vehicleNo: VEH, imei: '123', plan: 'standard' }).expect(400);
    const inv2 = (await http.post('/erp/subscriptions/renew').set(admin).send({ licenseIds: [lic.id], months: 6 }).expect(201)).body;
    expect(inv2).toMatchObject({ net: 1200, gst: 216, total: 1416, status: 'unpaid' });
    expect(inv2.lines[0]).toMatchObject({ from: lic.expiresOn, to: addMonths(lic.expiresOn, 6) });
    await http.post('/erp/subscriptions/renew').set(admin).send({ licenseIds: [lic.id], months: 5 }).expect(400);
    expect((await http.post(`/erp/subscriptions/invoices/${inv2.id}/pay`).set(admin).send({ paymentMethod: 'upi', paymentRef: 'UPI-1' }).expect(201)).body.status).toBe('paid');
    const s = (await http.get('/erp/subscriptions/summary').set(admin).expect(200)).body;
    expect(s.plans.ais140.pricePerYear).toBe(2400);
    expect((await http.get('/erp/dashcam/config').set(admin).expect(200)).body.configured).toBe(false);
    await http.get(`/erp/dashcam/stream?deviceId=${DEV}`).set(admin).expect(400);
  });
});
