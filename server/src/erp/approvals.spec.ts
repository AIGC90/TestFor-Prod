import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, createTestApp, STAFF } from '../test-utils';
import { ApprovalsService, type Decision } from './approvals.service';

const admin = { Cookie: 'JSESSIONID=admin-session' };
const staff = { Cookie: 'JSESSIONID=staff-session' };
const authUser = (u: typeof ADMIN, role: string) => ({ id: u.id, name: u.name, email: u.email, administrator: u.administrator, role: role as 'admin', cookie: '' });

describe('approvals', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let approvals: ApprovalsService;
  const decided: { docId: number; decision: Decision }[] = [];
  const docBase = Date.now() % 1_000_000;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    http = request(app.getHttpServer());
    approvals = app.get(ApprovalsService);
    approvals.onDecision('gate_pass', (req, decision) => {
      decided.push({ docId: req.docId, decision });
    });
    await http.put('/erp/approvals/rules').set(admin).send({ docType: 'gate_pass', enabled: true, minAmount: 5000, approverRole: 'workshop_manager' }).expect(200);
  });
  afterAll(() => app.close());

  it('skips approval below the rule amount and routes it above', async () => {
    const small = await approvals.submit(authUser(ADMIN, 'admin'), { docType: 'gate_pass', docId: docBase, title: 'small', amount: 100 });
    expect(small).toBeNull();
    const big = await approvals.submit(authUser(STAFF, 'storekeeper'), { docType: 'gate_pass', docId: docBase + 1, docNo: 'GP-T-1', title: 'Turbo out for repair', amount: 6200, priority: 'high' });
    expect(big).toMatchObject({ status: 'pending', approverRole: 'workshop_manager', requestedBy: STAFF.id });
    await expect(approvals.submit(authUser(STAFF, 'storekeeper'), { docType: 'gate_pass', docId: docBase + 1, title: 'again', amount: 9000 })).rejects.toThrow(/already waiting/);
  });

  it('shows pending items only to roles that may approve them', async () => {
    await http.put('/erp/users/3/role').set(admin).send({ role: 'technician' }).expect(200);
    const tech = await http.get('/erp/approvals').set(staff).expect(200);
    expect(tech.body).toEqual([]);
    const inbox = await http.get('/erp/approvals?docType=gate_pass').set(admin).expect(200);
    expect(inbox.body.some((r: { docId: number }) => r.docId === docBase + 1)).toBe(true);
    const normal = await approvals.submit(authUser(ADMIN, 'admin'), { docType: 'gate_pass', docId: docBase + 9, title: 'normal', amount: 5000 });
    const order = (await http.get('/erp/approvals?docType=gate_pass').set(admin).expect(200)).body.map((r: { id: number }) => r.id);
    expect(order.indexOf(normal!.id)).toBeGreaterThan(order.findIndex((id: number) => id !== normal!.id));
    await http.post(`/erp/approvals/${normal!.id}/approve`).set(admin).send({}).expect(201);
  });

  it('blocks self-approval, requires a reject reason, and calls the module on decision', async () => {
    const [req] = (await http.get('/erp/approvals?docType=gate_pass').set(admin).expect(200)).body.filter((r: { docId: number }) => r.docId === docBase + 1);
    await http.put('/erp/users/3/role').set(admin).send({ role: 'workshop_manager' }).expect(200);
    const own = await http.post(`/erp/approvals/${req.id}/approve`).set(staff).send({}).expect(403);
    expect(own.body.message).toMatch(/own request/);
    await http.post(`/erp/approvals/${req.id}/reject`).set(admin).send({}).expect(400);

    const done = await http.post(`/erp/approvals/${req.id}/approve`).set(admin).send({ comment: 'ok' }).expect(201);
    expect(done.body).toMatchObject({ status: 'approved', decidedBy: ADMIN.id, comment: 'ok' });
    expect(decided).toContainEqual({ docId: docBase + 1, decision: 'approved' });
    await http.post(`/erp/approvals/${req.id}/reject`).set(admin).send({ comment: 'late' }).expect(409);

    const history = await http.get('/erp/approvals?status=history&docType=gate_pass').set(admin).expect(200);
    expect(history.body[0].id).toBe(req.id);
  });

  it('bulk-approves and reports each result', async () => {
    const a = await approvals.submit(authUser(STAFF, 'storekeeper'), { docType: 'gate_pass', docId: docBase + 2, title: 'a', amount: 7000 });
    const b = await approvals.submit(authUser(ADMIN, 'admin'), { docType: 'gate_pass', docId: docBase + 3, title: 'b', amount: 8000 });
    const res = await http.post('/erp/approvals/approve-bulk').set(staff).send({ ids: [a!.id, b!.id] }).expect(201);
    expect(res.body).toEqual([
      { id: a!.id, ok: false, error: 'You cannot approve or reject your own request' },
      { id: b!.id, ok: true },
    ]);
    await http.post(`/erp/approvals/${a!.id}/approve`).set(admin).send({}).expect(201);
    await http.put('/erp/users/3/role').set(admin).send({ role: 'viewer' }).expect(200);
  });
});
