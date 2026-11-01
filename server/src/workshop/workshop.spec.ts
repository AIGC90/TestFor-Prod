import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type FakeTraccar } from '../test-utils';
import { billTotals } from './docs';
import { pmDue } from './workshop.service';

const admin = { Cookie: 'JSESSIONID=admin-session' };
const run = Date.now().toString(36).toUpperCase();
const VEH = `MH12WS${run.slice(-4)}`;

describe('workshop', () => {
  let app: INestApplication;
  let traccar: FakeTraccar;
  let http: ReturnType<typeof request>;
  let garage: number;
  let store: number;
  let pad: number;

  beforeAll(async () => {
    ({ app, traccar } = await createTestApp());
    http = request(app.getHttpServer());
    traccar.data.set('/devices', [{ id: 41, name: VEH }]);
    traccar.data.set('/positions', [{ deviceId: 41, attributes: { totalDistance: 48_200_000 } }]);
    garage = (await http.post('/erp/masters/parties').set(admin).send({ name: `Patel Diesel ${run}`, kinds: ['garage'] }).expect(201)).body.id;
    store = (await http.post('/erp/masters/stores').set(admin).send({ code: `WK${run}`, name: 'Workshop' }).expect(201)).body.id;
    const cat = (await http.post('/erp/masters/item-categories').set(admin).send({ name: `Brakes ${run}`, countingMode: 'standard' }).expect(201)).body.id;
    pad = (await http.post('/erp/masters/items').set(admin).send({ name: `Brake pad ${run}`, categoryId: cat }).expect(201)).body.id;
    await http.post('/erp/stock/movements').set(admin).send({ kind: 'receipt', itemId: pad, storeId: store, qty: 10, unitRate: 1800 }).expect(201);
    for (const [docType, minAmount] of [['job_card', 25000], ['gate_pass', 0], ['repair_bill', 10000], ['driver_charge', 2000]] as const) {
      await http.put('/erp/approvals/rules').set(admin).send({ docType, enabled: true, minAmount, approverRole: 'workshop_manager' }).expect(200);
    }
  });
  afterAll(() => app.close());

  const approve = async (docType: string, docId: number) => {
    const req = (await http.get(`/erp/approvals?docType=${docType}`).set(admin).expect(200)).body.find((a: { docId: number }) => a.docId === docId);
    await http.post(`/erp/approvals/${req.id}/approve`).set(admin).send({}).expect(201);
    return req;
  };

  it('works out GST and TDS on repair bills', () => {
    expect(billTotals({ taxable: 24500, gstRate: 18, interState: 0, tdsRate: 2 })).toEqual({ cgst: 2205, sgst: 2205, igst: 0, tds: 490, netPayable: 28420 });
    expect(billTotals({ taxable: 15000, gstRate: 18, interState: 1, tdsRate: 1 })).toEqual({ cgst: 0, sgst: 0, igst: 2700, tds: 150, netPayable: 17550 });
  });

  it('decides PM status by km or days, whichever comes first', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    const base = { intervalKm: 15000, intervalDays: 90, lastDoneKm: 32000, lastDoneAt: new Date('2026-09-01T00:00:00Z') };
    expect(pmDue(base, 48200, now)).toMatchObject({ nextDueKm: 47000, kmLeft: -1200, status: 'overdue' });
    expect(pmDue(base, 46000, now)).toMatchObject({ kmLeft: 1000, status: 'due_soon' });
    expect(pmDue(base, 35000, now)).toMatchObject({ daysLeft: 29, status: 'ok' }); // due 30 Nov
    expect(pmDue({ ...base, lastDoneAt: new Date('2026-07-01T00:00:00Z') }, 35000, now).status).toBe('overdue');
    expect(pmDue({ intervalKm: 10000, intervalDays: null, lastDoneKm: null, lastDoneAt: null }, 1000, now).status).toBe('unknown');
  });

  it('runs a job card from PM schedule through approval, parts and completion', async () => {
    const seeded = (await http.post('/erp/workshop/pm-seed').set(admin).send({ vehicleNo: VEH.toLowerCase() }).expect(201)).body;
    expect(seeded.length).toBe(8);
    expect(seeded[0]).toMatchObject({ vehicleNo: VEH, lastDoneKm: 48200 });
    await http.post('/erp/workshop/pm-seed').set(admin).send({ vehicleNo: VEH }).expect(409);

    // make one task overdue: last done 20,000 km ago
    const oil = seeded[0];
    await http.put(`/erp/workshop/pm-schedules/${oil.id}`).set(admin).send({ lastDoneKm: 28200 }).expect(200);
    const due = (await http.get(`/erp/workshop/pm-due?vehicleNo=${VEH}`).set(admin).expect(200)).body;
    expect(due[0]).toMatchObject({ id: oil.id, status: 'overdue', currentKm: 48200, kmLeft: -5000 });

    const jc = (await http.post(`/erp/workshop/pm-schedules/${oil.id}/job-card`).set(admin).expect(201)).body;
    expect(jc).toMatchObject({ status: 'draft', serviceType: 'Preventive Maintenance', runningKm: 48200, pmScheduleId: oil.id });
    await http.put(`/erp/workshop/job-cards/${jc.id}`).set(admin).send({ estimatedCost: 38500, priority: 'high', storeId: store }).expect(200);
    expect((await http.post(`/erp/workshop/job-cards/${jc.id}/submit`).set(admin).expect(201)).body.status).toBe('pending_approval');
    await http.post(`/erp/workshop/job-cards/${jc.id}/parts`).set(admin).send({ lines: [{ itemId: pad, qty: 2 }] }).expect(409);
    const req = await approve('job_card', jc.id);
    expect(req).toMatchObject({ priority: 'high', amount: 38500 });

    await http.post(`/erp/workshop/job-cards/${jc.id}/start`).set(admin).expect(201);
    const withParts = (await http.post(`/erp/workshop/job-cards/${jc.id}/parts`).set(admin).send({ lines: [{ itemId: pad, qty: 2 }] }).expect(201)).body;
    expect(withParts).toMatchObject({ partsCost: 3600, parts: [{ itemId: pad, qty: 2, value: 3600 }] });
    await http.post(`/erp/workshop/job-cards/${jc.id}/parts`).set(admin).send({ lines: [{ itemId: pad, qty: 50 }] }).expect(409); // not in stock

    await http.post(`/erp/workshop/job-cards/${jc.id}/complete`).set(admin).send({}).expect(400);
    const done = (await http.post(`/erp/workshop/job-cards/${jc.id}/complete`).set(admin).send({ workDone: 'Oil and filters replaced', labourCost: 1200 }).expect(201)).body;
    expect(done).toMatchObject({ status: 'completed', labourCost: 1200 });
    const after = (await http.get(`/erp/workshop/pm-due?vehicleNo=${VEH}`).set(admin).expect(200)).body.find((p: { id: number }) => p.id === oil.id);
    expect(after).toMatchObject({ lastDoneKm: 48200, status: 'ok' });

    const issues = (await http.get(`/erp/stock/movements?itemId=${pad}&kind=issue`).set(admin).expect(200)).body;
    expect(issues[0]).toMatchObject({ vehicleNo: VEH, refNo: jc.jcNo });
  });

  it('approves gate passes, then tracks their return', async () => {
    await http.post('/erp/workshop/gate-passes').set(admin).send({ kind: 'returnable', fromStoreId: store, partyId: garage, lines: [{ description: 'Turbocharger core', qty: 1 }] }).expect(400); // needs return date
    const gp = (await http
      .post('/erp/workshop/gate-passes')
      .set(admin)
      .send({ kind: 'returnable', fromStoreId: store, partyId: garage, vehicleNo: VEH, expectedReturn: '2026-11-05', estimatedValue: 6200, lines: [{ description: 'Turbocharger core', qty: 1, reason: 'Reconditioning' }] })
      .expect(201)).body;
    expect(gp.status).toBe('pending_approval');
    await http.post(`/erp/workshop/gate-passes/${gp.id}/return`).set(admin).expect(409);
    await approve('gate_pass', gp.id);
    expect((await http.post(`/erp/workshop/gate-passes/${gp.id}/return`).set(admin).expect(201)).body.status).toBe('returned');
  });

  it('auto-approves small repair bills and routes big ones', async () => {
    const small = (await http.post('/erp/workshop/repair-bills').set(admin).send({ partyId: garage, vehicleNo: VEH, taxable: 5000, tdsRate: 1 }).expect(201)).body;
    expect(small).toMatchObject({ status: 'approved', cgst: 450, sgst: 450, tds: 50, netPayable: 5850 });
    expect((await http.post(`/erp/workshop/repair-bills/${small.id}/pay`).set(admin).send({ paymentRef: 'NEFT-1' }).expect(201)).body).toMatchObject({ status: 'paid', paymentRef: 'NEFT-1' });

    const big = (await http.post('/erp/workshop/repair-bills').set(admin).send({ partyId: garage, vehicleNo: VEH, taxable: 24500 }).expect(201)).body;
    expect(big).toMatchObject({ status: 'pending_approval', netPayable: 28420 });
    await http.post(`/erp/workshop/repair-bills/${big.id}/pay`).set(admin).send({}).expect(409);
    await http.post('/erp/workshop/repair-bills').set(admin).send({ partyId: garage, vehicleNo: VEH, taxable: 100, gstRate: 7 }).expect(400);
  });

  it('records tool checklists and recovers driver charges in instalments', async () => {
    const tc = (await http
      .post('/erp/workshop/tool-checklists')
      .set(admin)
      .send({ auditType: 'return', vehicleNo: VEH, driverName: 'Suresh Patil', tools: [{ tool: 'Jack', present: true }, { tool: 'Torch', present: false }] })
      .expect(201)).body;
    expect(tc).toMatchObject({ tcNo: expect.stringMatching(/^TC-/), missingCount: 1 });

    const charge = (await http
      .post('/erp/workshop/driver-charges')
      .set(admin)
      .send({ driverName: 'Suresh Patil', category: 'missing_tool', vehicleNo: VEH, amount: 4800, refNo: tc.tcNo, description: 'LED torch missing on return', recoveryPlan: 'instalments', instalments: 3 })
      .expect(201)).body;
    expect(charge.status).toBe('pending_approval');
    await approve('driver_charge', charge.id);
    await http.post(`/erp/workshop/driver-charges/${charge.id}/recover`).set(admin).send({ amount: 1600 }).expect(201);
    await http.post(`/erp/workshop/driver-charges/${charge.id}/recover`).set(admin).send({ amount: 5000 }).expect(400);
    const done = (await http.post(`/erp/workshop/driver-charges/${charge.id}/recover`).set(admin).send({ amount: 3200 }).expect(201)).body;
    expect(done).toMatchObject({ status: 'recovered', recovered: 4800 });
  });

  it('summarises the workshop', async () => {
    const s = (await http.get('/erp/workshop/summary?days=30').set(admin).expect(200)).body;
    expect(s.closed).toBeGreaterThan(0);
    expect(s.spend).toBeGreaterThanOrEqual(4800);
    expect(s.costliestVehicles.find((v: { vehicleNo: string }) => v.vehicleNo === VEH)).toBeTruthy();
  });
});
