import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { createTestApp, type FakeTraccar } from '../test-utils';
import { ComplianceService, daysLeft, docStatus } from './compliance';
import { attendanceTotals, driverAt, driverScore, drivingByDriver, payrollLine } from './drivers';

const admin = { Cookie: 'JSESSIONID=admin-session' };
const run = Date.now().toString(36).toUpperCase();
const n = parseInt(run.slice(-4), 36);
const VEH = `MH14PP${run.slice(-4)}`;
const VEH2 = `GJ01PP${run.slice(-4)}`;
// payroll months are unique across the shared test DB, so spread runs over ~12,000 past months
const YEAR = 1000 + (n % 1026);
const MONTH = `${YEAR}-${String(1 + (Math.floor(n / 1026) % 12)).padStart(2, '0')}`;
const LICENCE = new Date(Date.now() + 19 * 86_400_000).toISOString().slice(0, 10);

describe('people: pure rules', () => {
  it('works out document status from expiry', () => {
    const today = new Date('2026-11-01T10:00:00');
    expect(daysLeft('2026-11-01', today)).toBe(0);
    expect(docStatus('2026-10-31', today)).toBe('expired');
    expect(docStatus('2026-12-01', today)).toBe('expiring');
    expect(docStatus('2026-12-02', today)).toBe('valid');
    expect(docStatus(null, today)).toBe('valid');
  });

  it('counts attendance and pay, capping charge recovery at gross', () => {
    expect(attendanceTotals(['P', 'P', 'H', 'L', 'A', 'WO'])).toMatchObject({ present: 2.5, paid: 4.5, absent: 1 });
    const line = payrollLine({ id: 1, name: 'A', monthlySalary: 30000, dailyBata: 300, tripAllowance: 500 }, Array(26).fill('P').concat(Array(4).fill('WO')), 4, [{ id: 9, dcNo: 'DC-1', amount: 4800, recovered: 1600, instalments: 3 }], 30);
    expect(line).toMatchObject({ paidDays: 30, basic: 30000, bata: 7800, tripPay: 2000, gross: 39800, deductions: 1600, net: 38200 });
    const poor = payrollLine({ id: 2, name: 'B', monthlySalary: 0, dailyBata: 300, tripAllowance: 0 }, ['P', 'P'], 0, [{ id: 9, dcNo: 'DC-2', amount: 5000, recovered: 0, instalments: 1 }], 30);
    expect(poor).toMatchObject({ gross: 600, deductions: 600, net: 0 });
  });

  it('attributes GPS trips and events to the driver who had the truck', () => {
    const a = [
      { driverId: 1, vehicleNo: 'MH-12-AB-1', fromAt: new Date('2026-10-01'), toAt: new Date('2026-10-10') },
      { driverId: 2, vehicleNo: 'MH12AB1', fromAt: new Date('2026-10-10'), toAt: null },
    ];
    expect(driverAt(a, 'mh12ab1', new Date('2026-10-05'))).toBe(1);
    expect(driverAt(a, 'MH12AB1', new Date('2026-10-12'))).toBe(2);
    const by = drivingByDriver(
      [
        { deviceId: 7, startTime: '2026-10-12T02:00:00Z', endTime: '', distance: 300_000, duration: 6 * 3_600_000 },
        { deviceId: 7, startTime: '2026-10-12T10:00:00Z', endTime: '', distance: 200_000, duration: 4 * 3_600_000 },
      ],
      new Map([[7, 'MH-12-AB-1']]),
      a,
    );
    expect(by.get(2)?.get('2026-10-12')).toEqual({ hours: 10, km: 500 });
    expect(driverScore(0, 0, 0, 5000)).toBe(100);
    expect(driverScore(5, 2, 0, 2000)).toBe(92);
  });
});

describe('people API', () => {
  let app: INestApplication;
  let traccar: FakeTraccar;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app, traccar } = await createTestApp());
    http = request(app.getHttpServer());
    traccar.data.set('/devices', [{ id: 71, name: VEH }, { id: 72, name: VEH2 }]);
    traccar.data.set('/drivers', [
      { id: 1_000_000 + n * 2, name: `Ramesh ${run}`, uniqueId: `R${run}`, attributes: { licenceNo: 'MH1420110012345', licenceExpiry: `${LICENCE}T00:00:00Z`, aadhar: '1234 5678 9012', phone: '+91 98220 11111' } },
      { id: 1_000_001 + n * 2, name: `Sukhdev ${run}`, uniqueId: `S${run}`, attributes: {} },
    ]);
    for (const docType of ['payroll', 'expense_claim']) {
      await http.put('/erp/approvals/rules').set(admin).send({ docType, enabled: true, minAmount: 1000, approverRole: 'accountant' }).expect(200);
    }
  });
  afterAll(() => app.close());

  const approve = async (docType: string, docId: number) => {
    const req = (await http.get(`/erp/approvals?docType=${docType}`).set(admin).expect(200)).body.find((a: { docId: number }) => a.docId === docId);
    await http.post(`/erp/approvals/${req.id}/approve`).set(admin).send({}).expect(201);
  };

  it('tracks compliance documents, renewals and missing papers', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    await http.post('/erp/compliance/documents').set(admin).send({ subjectType: 'vehicle', subject: VEH, docType: 'driving_licence' }).expect(400);
    const ins = (await http.post('/erp/compliance/documents').set(admin).send({ subjectType: 'vehicle', subject: VEH.toLowerCase(), docType: 'insurance', docNo: 'POL-1', authority: 'ICICI Lombard', issueDate: '2025-11-11', expiryDate: soon }).expect(201)).body;
    expect(ins.subject).toBe(VEH);
    await http.post('/erp/compliance/documents').set(admin).send({ subjectType: 'vehicle', subject: VEH, docType: 'puc', expiryDate: past }).expect(201);

    const expiring = (await http.get('/erp/compliance/status?status=expiring').set(admin).expect(200)).body;
    expect(expiring.find((d: { id: number }) => d.id === ins.id)).toMatchObject({ status: 'expiring', daysLeft: 10 });
    const s = (await http.get('/erp/compliance/summary').set(admin).expect(200)).body;
    const v = s.vehicles.find((x: { vehicleNo: string }) => x.vehicleNo === VEH);
    expect(v).toMatchObject({ grounded: true, expired: ['puc'], expiring: ['insurance'], compliant: false });
    expect(v.missing).toEqual(['rc', 'fitness', 'national_permit']);
    expect(s.vehicles.find((x: { vehicleNo: string }) => x.vehicleNo === VEH2).missing).toHaveLength(5);

    await http.post(`/erp/compliance/documents/${ins.id}/renew`).set(admin).send({ expiryDate: '2020-01-01' }).expect(400);
    const renewed = (await http.post(`/erp/compliance/documents/${ins.id}/renew`).set(admin).send({ docNo: 'POL-2', issueDate: soon, expiryDate: '2099-01-01' }).expect(201)).body;
    expect(renewed).toMatchObject({ status: 'valid', docNo: 'POL-2', authority: 'ICICI Lombard' });
    await http.post(`/erp/compliance/documents/${ins.id}/renew`).set(admin).send({ expiryDate: '2099-06-01' }).expect(400);
    const current = (await http.get(`/erp/compliance/documents?subject=${VEH}`).set(admin).expect(200)).body;
    expect(current.map((d: { docType: string }) => d.docType).sort()).toEqual(['insurance', 'puc']);
    expect((await http.get(`/erp/compliance/documents/${renewed.id}/history`).set(admin).expect(200)).body).toHaveLength(2);
  });

  it('syncs papers from Vahan when an aggregator is configured', async () => {
    await http.post('/erp/compliance/vahan-sync').set(admin).send({ vehicleNo: VEH2 }).expect(400); // not configured
    const svc = app.get(ComplianceService);
    const spy = vi.spyOn(svc, 'fetchVahan').mockResolvedValue({ rcNo: VEH2, rto: 'GJ01 Ahmedabad', registeredAt: '2021-04-02', insurer: 'New India', insurancePolicyNo: 'NI-77', insuranceUpto: '2099-03-31', fitnessUpto: '2099-04-01', pucUpto: '2099-01-15', permitType: 'National Permit', permitNo: 'NP-1', permitUpto: '2099-04-01' });
    const first = (await http.post('/erp/compliance/vahan-sync').set(admin).send({ vehicleNo: VEH2 }).expect(201)).body;
    expect(first.result.map((r: { action: string }) => r.action)).toEqual(['added', 'added', 'added', 'added', 'added']);
    spy.mockResolvedValue({ rcNo: VEH2, insuranceUpto: '2099-12-31', fitnessUpto: '2099-04-01' });
    const second = (await http.post('/erp/compliance/vahan-sync').set(admin).send({ vehicleNo: VEH2 }).expect(201)).body;
    expect(second.result).toEqual([{ docType: 'rc', action: 'unchanged' }, { docType: 'insurance', action: 'renewed' }, { docType: 'fitness', action: 'unchanged' }]);
    spy.mockRestore();
    const s = (await http.get('/erp/compliance/summary').set(admin).expect(200)).body;
    expect(s.vehicles.find((x: { vehicleNo: string }) => x.vehicleNo === VEH2)).toMatchObject({ compliant: true, missing: [] });
  });

  it('stores attachments up to the size limit', async () => {
    const doc = (await http.get(`/erp/compliance/documents?subject=${VEH}`).set(admin).expect(200)).body[0];
    const big = Buffer.alloc(3 * 1024 * 1024, 7).toString('base64');
    const a = (await http.post('/erp/attachments').set(admin).send({ docType: 'compliance_doc', docId: doc.id, filename: 'policy.pdf', mime: 'application/pdf', data: big }).expect(201)).body;
    expect(a).toMatchObject({ size: 3 * 1024 * 1024, filename: 'policy.pdf' });
    expect(a.data).toBeUndefined();
    await http.post('/erp/attachments').set(admin).send({ docType: 'compliance_doc', docId: doc.id, filename: 'x.exe', mime: 'application/x-msdownload', data: 'AAAA' }).expect(400);
    await http.post('/erp/attachments').set(admin).send({ docType: 'nope', docId: doc.id, filename: 'x.pdf', mime: 'application/pdf', data: 'AAAA' }).expect(400);
    const list = (await http.get(`/erp/attachments?docType=compliance_doc&docId=${doc.id}`).set(admin).expect(200)).body;
    expect(list).toHaveLength(1);
    const file = await http.get(`/erp/attachments/${a.id}`).set(admin).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(Number(file.headers['content-length'])).toBe(3 * 1024 * 1024);
    await http.delete(`/erp/attachments/${a.id}`).set(admin).expect(204);
  });

  let ramesh: { id: number; name: string };
  let sukhdev: { id: number; name: string };

  it('syncs drivers from Traccar and assigns them to trucks', async () => {
    const sync = (await http.post('/erp/drivers/sync').set(admin).expect(201)).body;
    expect(sync.created).toBe(2);
    expect((await http.post('/erp/drivers/sync').set(admin).expect(201)).body.created).toBe(0);
    const profiles = (await http.get(`/erp/drivers/profiles?search=${run}`).set(admin).expect(200)).body;
    ramesh = profiles.find((p: { name: string }) => p.name.startsWith('Ramesh'));
    sukhdev = profiles.find((p: { name: string }) => p.name.startsWith('Sukhdev'));
    expect(ramesh).toMatchObject({ aadhar: '123456789012', licenceExpiry: LICENCE, phone: '+91 98220 11111' });
    await http.put(`/erp/drivers/profiles/${ramesh.id}`).set(admin).send({ monthlySalary: 30000, dailyBata: 300, tripAllowance: 500 }).expect(200);

    await http.post('/erp/drivers/assign').set(admin).send({ driverId: ramesh.id, vehicleNo: VEH }).expect(201);
    await http.post('/erp/drivers/assign').set(admin).send({ driverId: sukhdev.id, vehicleNo: VEH }).expect(201); // takes the truck
    let roster = (await http.get('/erp/drivers/roster').set(admin).expect(200)).body;
    expect(roster.drivers.find((d: { id: number }) => d.id === sukhdev.id).vehicleNo).toBe(VEH);
    expect(roster.standby.map((d: { id: number }) => d.id)).toContain(ramesh.id);
    expect(roster.vehiclesWithoutDriver.map((v: { vehicleNo: string }) => v.vehicleNo)).toContain(VEH2);
    await http.post('/erp/drivers/assign').set(admin).send({ driverId: ramesh.id, vehicleNo: VEH }).expect(201);
    await http.post('/erp/drivers/assign').set(admin).send({ driverId: sukhdev.id, vehicleNo: VEH2 }).expect(201);
    roster = (await http.get('/erp/drivers/roster').set(admin).expect(200)).body;
    expect(roster.drivers.find((d: { id: number }) => d.id === ramesh.id).vehicleNo).toBe(VEH);
    const hist = (await http.get(`/erp/drivers/assignments?vehicleNo=${VEH}`).set(admin).expect(200)).body;
    expect(hist.map((h: { driverName: string }) => h.driverName.split(' ')[0])).toEqual(['Ramesh', 'Sukhdev', 'Ramesh']);
  });

  it('reports driving hours from GPS trips', async () => {
    const t = Date.now() + 60_000;
    traccar.data.set('/reports/trips', [
      { deviceId: 71, startTime: new Date(t).toISOString(), endTime: '', distance: 420_000, duration: 7 * 3_600_000 },
      { deviceId: 71, startTime: new Date(t + 8 * 3_600_000).toISOString(), endTime: '', distance: 180_000, duration: 3 * 3_600_000 },
    ]);
    traccar.data.set('/reports/events', [{ deviceId: 71, type: 'deviceOverspeed', eventTime: new Date(t).toISOString() }]);
    const hours = (await http.get('/erp/drivers/hours?days=7').set(admin).expect(200)).body.find((h: { driverId: number }) => h.driverId === ramesh.id);
    expect(hours).toMatchObject({ totalHours: 10, km: 600 });
    expect(hours.daysOverLimit + hours.daysWorked).toBeGreaterThanOrEqual(2); // 10 h in one day, or split over midnight
    const score = (await http.get('/erp/drivers/scores').set(admin).expect(200)).body.find((s: { driverId: number }) => s.driverId === ramesh.id);
    expect(score).toMatchObject({ overspeed: 1, km: 600, score: 98 });
    traccar.data.delete('/reports/trips');
    traccar.data.delete('/reports/events');
  });

  it('runs payroll from attendance and recovers driver charges when paid', async () => {
    const days = new Date(Date.UTC(YEAR, Number(MONTH.slice(5)), 0)).getUTCDate();
    const entries = Array.from({ length: days }, (_, i) => ({ driverId: ramesh.id, date: `${MONTH}-${String(i + 1).padStart(2, '0')}`, code: i % 7 === 6 ? 'WO' : i === 0 ? 'A' : 'P' }));
    await http.put('/erp/drivers/attendance').set(admin).send({ entries: [{ driverId: ramesh.id, date: '2999-01-01', code: 'P' }] }).expect(400);
    await http.put('/erp/drivers/attendance').set(admin).send({ entries }).expect(200);
    const grid = (await http.get(`/erp/drivers/attendance?month=${MONTH}`).set(admin).expect(200)).body;
    const row = grid.drivers.find((d: { driverId: number }) => d.driverId === ramesh.id);
    expect(row.codes[`${MONTH}-01`]).toBe('A');
    expect(row.totals.absent).toBe(1);

    const charge = (await http.post('/erp/workshop/driver-charges').set(admin).send({ driverName: ramesh.name, category: 'missing_tool', amount: 3000, description: 'Jack missing', recoveryPlan: 'instalments', instalments: 3 }).expect(201)).body;
    if (charge.status === 'pending_approval') await approve('driver_charge', charge.id);

    const preview = (await http.get(`/erp/drivers/payroll/preview?month=${MONTH}`).set(admin).expect(200)).body;
    const line = preview.lines.find((l: { driverId: number }) => l.driverId === ramesh.id);
    expect(line.chargeDeductions).toEqual([{ chargeId: charge.id, dcNo: charge.dcNo, amount: 1000 }]);
    expect(line.basic).toBe(Math.round((30000 * (days - 1)) / days * 100) / 100);
    expect(line.net).toBe(Math.round((line.gross - 1000) * 100) / 100);

    const pr = (await http.post('/erp/drivers/payroll').set(admin).send({ month: MONTH }).expect(201)).body;
    expect(pr).toMatchObject({ status: 'pending_approval', prNo: expect.stringMatching(/^PAY-/) });
    await http.post(`/erp/drivers/payroll/${pr.id}/pay`).set(admin).send({}).expect(409);
    await approve('payroll', pr.id);
    await http.put('/erp/drivers/attendance').set(admin).send({ entries: [{ driverId: ramesh.id, date: `${MONTH}-02`, code: 'A' }] }).expect(409); // locked
    await http.post('/erp/drivers/payroll').set(admin).send({ month: MONTH }).expect(409);
    const paid = (await http.post(`/erp/drivers/payroll/${pr.id}/pay`).set(admin).send({ paymentRef: 'NEFT-PAY-1' }).expect(201)).body;
    expect(paid).toMatchObject({ status: 'paid', paymentRef: 'NEFT-PAY-1' });
    const after = (await http.get(`/erp/workshop/driver-charges/${charge.id}`).set(admin).expect(200)).body;
    expect(after).toMatchObject({ recovered: 1000, status: 'approved' });
  });

  it('raises SOS from Traccar alarms once, then responds and escalates', async () => {
    const hook = (alarm: string, id: number) =>
      http
        .post('/erp/hooks/traccar-event')
        .set('x-hook-secret', config.hookSecret)
        .send({ event: { id, type: 'alarm', deviceId: 71, eventTime: new Date().toISOString(), attributes: { alarm } }, position: { latitude: 19.07, longitude: 72.88, speed: 27, attributes: { ignition: true } }, device: { name: VEH } })
        .expect(204);
    const base = n * 10 + 7_000_000;
    await hook('sos', base);
    await hook('sos', base + 1); // same burst
    await hook('overspeed', base + 2); // not an emergency
    const list = (await http.get('/erp/safety/sos?status=active').set(admin).expect(200)).body.filter((s: { vehicleNo: string }) => s.vehicleNo === VEH);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ trigger: 'sos', severity: 'critical', driverName: ramesh.name, speedKmh: 50, ignition: 'on' });

    const sos = list[0];
    await http.post(`/erp/safety/sos/${sos.id}/resolve`).set(admin).send({ resolution: 'x', falseAlarm: true, createIncident: true }).expect(400);
    expect((await http.post(`/erp/safety/sos/${sos.id}/respond`).set(admin).send({ responder: 'Control room' }).expect(201)).body.status).toBe('responding');
    await http.post(`/erp/safety/sos/${sos.id}/respond`).set(admin).send({}).expect(409);
    const done = (await http.post(`/erp/safety/sos/${sos.id}/resolve`).set(admin).send({ resolution: 'Minor collision, no injuries', createIncident: true }).expect(201)).body;
    expect(done.status).toBe('resolved');
    const inc = (await http.get(`/erp/safety/incidents/${done.incidentId}`).set(admin).expect(200)).body;
    expect(inc).toMatchObject({ vehicleNo: VEH, severity: 'major', sosId: sos.id, type: 'accident' });

    const manual = (await http.post('/erp/safety/sos').set(admin).send({ vehicleNo: VEH2, address: 'NH48 near Vapi' }).expect(201)).body;
    expect(manual).toMatchObject({ trigger: 'manual', severity: 'high', driverName: sukhdev.name });
    const s = (await http.get('/erp/safety/sos/summary').set(admin).expect(200)).body;
    expect(s.active).toBeGreaterThanOrEqual(1);
    expect(s.triggers.sos.label).toBe('Panic button');
  });

  it('tracks insurance claims through settlement', async () => {
    const inc = (await http.post('/erp/safety/incidents').set(admin).send({ vehicleNo: VEH2, type: 'accident', severity: 'major', narrative: 'Rear-ended at toll plaza', location: 'Khed Shivapur toll', rsaProvider: 'TVS Auto Assist', rsaStatus: 'dispatched' }).expect(201)).body;
    expect(inc.incNo).toMatch(/^INC-/);
    await http.post('/erp/safety/claims').set(admin).send({ incidentId: inc.id, vehicleNo: VEH, insurer: 'ICICI Lombard', estimatedDamage: 85000 }).expect(400);
    const clm = (await http.post('/erp/safety/claims').set(admin).send({ incidentId: inc.id, vehicleNo: VEH2, insurer: 'ICICI Lombard', estimatedDamage: 85000 }).expect(201)).body;
    await http.put(`/erp/safety/claims/${clm.id}`).set(admin).send({ status: 'approved' }).expect(400);
    await http.put(`/erp/safety/claims/${clm.id}`).set(admin).send({ status: 'approved', approvedPayout: 70000 }).expect(200);
    await http.put(`/erp/safety/claims/${clm.id}`).set(admin).send({ status: 'settled', settledAmount: 90000 }).expect(400);
    expect((await http.put(`/erp/safety/claims/${clm.id}`).set(admin).send({ status: 'settled', settledAmount: 70000 }).expect(200)).body.settledAt).toBeTruthy();
    await http.delete(`/erp/safety/incidents/${inc.id}`).set(admin).expect(409);
    const s = (await http.get('/erp/safety/summary').set(admin).expect(200)).body;
    expect(s.recovered).toBeGreaterThanOrEqual(70000);
    expect(s.incidentFreeDays).toBe(0);
  });

  it('runs field staff tasks, attendance and expense claims', async () => {
    const staff = (await http.post('/erp/field/staff').set(admin).send({ name: `Anil ${run}`, role: 'collection', team: 'Collections', city: 'Pune', monthlyTarget: 60 }).expect(201)).body;
    const task = (await http.post('/erp/field/tasks').set(admin).send({ staffId: staff.id, kind: 'collection', title: 'Collect March dues', dueAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(201)).body;
    expect(task).toMatchObject({ ftNo: expect.stringMatching(/^FT-/), city: 'Pune', status: 'assigned' });
    await http.post(`/erp/field/tasks/${task.id}/complete`).set(admin).send({ outcome: 'Met accounts' }).expect(400); // collection needs an amount
    await http.post(`/erp/field/tasks/${task.id}/start`).set(admin).expect(201);
    const done = (await http.post(`/erp/field/tasks/${task.id}/complete`).set(admin).send({ outcome: 'Cheque collected', amountCollected: 42000, rating: 5 }).expect(201)).body;
    expect(done.status).toBe('done');

    await http.post('/erp/field/check-out').set(admin).send({ staffId: staff.id }).expect(409);
    await http.post('/erp/field/check-in').set(admin).send({ staffId: staff.id, latitude: 18.52, longitude: 73.85 }).expect(201);
    await http.post('/erp/field/check-in').set(admin).send({ staffId: staff.id }).expect(409);
    await http.post('/erp/field/check-out').set(admin).send({ staffId: staff.id, km: 38 }).expect(201);
    const att = (await http.get('/erp/field/attendance?days=7').set(admin).expect(200)).body.staff.find((s: { staffId: number }) => s.staffId === staff.id);
    expect(att).toMatchObject({ present: 1, km: 38 });

    const small = (await http.post('/erp/field/claims').set(admin).send({ staffId: staff.id, date: new Date().toISOString().slice(0, 10), category: 'food', description: 'Lunch', amount: 250 }).expect(201)).body;
    expect(small.status).toBe('approved');
    const big = (await http.post('/erp/field/claims').set(admin).send({ staffId: staff.id, date: new Date().toISOString().slice(0, 10), category: 'travel', description: 'Pune–Satara bus and auto', amount: 1850 }).expect(201)).body;
    expect(big.status).toBe('pending_approval');
    await http.post(`/erp/field/claims/${big.id}/pay`).set(admin).expect(409);
    await approve('expense_claim', big.id);
    expect((await http.post(`/erp/field/claims/${big.id}/pay`).set(admin).expect(201)).body.status).toBe('paid');

    const perf = (await http.get('/erp/field/performance').set(admin).expect(200)).body.find((p: { staffId: number }) => p.staffId === staff.id);
    expect(perf).toMatchObject({ visits: 1, completion: 100, onTime: 100, rating: 5, collected: 42000, km: 38 });
    const o = (await http.get('/erp/field/overview').set(admin).expect(200)).body;
    expect(o.collectedToday).toBeGreaterThanOrEqual(42000);
    expect(o.team.find((t: { staffId: number }) => t.staffId === staff.id).status).toBe('checked_out');
  });

  it('gives a driver overview', async () => {
    const o = (await http.get('/erp/drivers/overview').set(admin).expect(200)).body;
    expect(o.onRoll).toBeGreaterThanOrEqual(2);
    expect(o.licence.find((l: { driverId: number }) => l.driverId === ramesh.id)).toMatchObject({ issue: 'Licence expires within 30 days' });
    expect(o.licence.find((l: { driverId: number }) => l.driverId === sukhdev.id)).toMatchObject({ issue: 'No licence on file' });
    expect(o.attendance30).toHaveLength(30);
  });
});
