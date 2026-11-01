import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type FakeTraccar } from '../test-utils';
import { ANTHROPIC } from './ai.service';
import { maskPii, toolJson } from './mask';

const admin = { Cookie: 'JSESSIONID=admin-session' };
const staff = { Cookie: 'JSESSIONID=staff-session' };
const run = Date.now().toString(36).toUpperCase();
const VEH = `MH04AI${run.slice(-4)}`;

type Call = { name: string; input: Record<string, unknown> };
type Tool = { name: string; parse: (x: unknown) => unknown; run: (x: unknown) => Promise<string> };
type Params = { model: string; messages: { role: string; content: unknown }[]; tools: Tool[]; system: { text: string; cache_control?: unknown }[]; [k: string]: unknown };

/**
 * Stand-in for the Anthropic client. The tool runner calls the real tools (as the SDK would), so tests
 * cover permissions, masking and proposals end to end without network calls.
 */
class FakeClaude {
  plan: Call[] = [];
  answer = 'Here is what I found.';
  parsed: unknown = null;
  runnerParams: Params[] = [];
  parseParams: Params[] = [];
  toolResults: { name: string; content: string }[] = [];

  beta = {
    messages: {
      toolRunner: (params: Params) => {
        this.runnerParams.push(params);
        const messages = [...params.messages];
        const plan = this.plan;
        this.plan = [];
        const self = this;
        const usage = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 };
        return {
          get params() {
            return { ...params, messages };
          },
          async *[Symbol.asyncIterator]() {
            if (plan.length) {
              const content = plan.map((c, i) => ({ type: 'tool_use', id: `tu_${i}`, name: c.name, input: c.input }));
              yield { content, stop_reason: 'tool_use', usage };
              messages.push({ role: 'assistant', content });
              const results = [];
              for (const [i, c] of plan.entries()) {
                const tool = params.tools.find((t) => t.name === c.name)!;
                let out: string;
                try {
                  out = await tool.run(tool.parse(c.input));
                } catch (e) {
                  out = `Invalid input: ${(e as Error).message}`;
                }
                self.toolResults.push({ name: c.name, content: out });
                results.push({ type: 'tool_result', tool_use_id: `tu_${i}`, content: out });
              }
              messages.push({ role: 'user', content: results });
            }
            const final = { content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: self.answer }], stop_reason: 'end_turn', usage };
            messages.push({ role: 'assistant', content: final.content });
            yield final;
          },
        };
      },
      parse: async (params: Params) => {
        this.parseParams.push(params);
        return { parsed_output: this.parsed, stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 2500 } };
      },
    },
  };
}

describe('AI: masking', () => {
  it('masks Aadhar and mobile numbers but not IMEIs or amounts', () => {
    expect(maskPii('Aadhar 1234 5678 9012, ph +91 98220 11111 / 9822011111')).toBe('Aadhar XXXX-XXXX-9012, ph +91 XXXXXX1111 / XXXXXX1111');
    expect(maskPii('IMEI 867010075167001 paid 125000.50')).toBe('IMEI 867010075167001 paid 125000.50');
    expect(toolJson({ a: 'x'.repeat(50) }, 20)).toMatch(/truncated/);
  });
});

describe('AI: not configured', () => {
  let app: INestApplication;
  beforeAll(async () => ({ app } = await createTestApp()));
  afterAll(() => app.close());

  it('reports AI as off and refuses calls with a clear message', async () => {
    const http = request(app.getHttpServer());
    expect((await http.get('/erp/ai/status').set(admin).expect(200)).body).toMatchObject({ enabled: false, model: 'claude-opus-5-5' });
    const r = await http.post('/erp/ai/chat').set(admin).send({ message: 'hi' }).expect(503);
    expect(r.body.message).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe('AI API', () => {
  let app: INestApplication;
  let traccar: FakeTraccar;
  let http: ReturnType<typeof request>;
  const claude = new FakeClaude();

  beforeAll(async () => {
    ({ app, traccar } = await createTestApp([[ANTHROPIC, claude]]));
    http = request(app.getHttpServer());
    traccar.data.set('/devices', [{ id: 801, name: VEH, status: 'online', lastUpdate: new Date().toISOString() }, { id: 802, name: `KA01AI${run.slice(-4)}`, status: 'offline', lastUpdate: null }]);
    traccar.data.set('/positions', [{ deviceId: 801, latitude: 18.5, longitude: 73.8, speed: 30, address: 'Pune', fixTime: new Date().toISOString(), attributes: { motion: true, totalDistance: 120_000_000 } }]);
    await http.put('/erp/users/3/role').set(admin).send({ role: 'driver' }).expect(200);
  });
  afterAll(() => app.close());

  let conversationId: number;

  it('answers from tools with caching, fallbacks and no forced tool choice', async () => {
    claude.plan = [{ name: 'fleet_status', input: { filter: 'all' } }, { name: 'trips', input: { status: 'in_transit', limit: 5 } }];
    claude.answer = `${VEH} is moving near Pune.`;
    const res = (await http.post('/erp/ai/chat').set(admin).send({ message: `Where is ${VEH}? My number is 9822011111` }).expect(201)).body;
    expect(res).toMatchObject({ answer: `${VEH} is moving near Pune.`, toolsUsed: ['fleet_status', 'trips'], stopReason: 'end_turn' });
    conversationId = res.conversationId;

    const p = claude.runnerParams.at(-1)!;
    expect(p).toMatchObject({ model: 'claude-opus-5-5', thread: false, fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'], output_config: { effort: 'medium' } });
    expect(p.tool_choice).toBeUndefined();
    expect(p.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(p.system[0].text).not.toMatch(/\d{4}-\d{2}-\d{2}/); // nothing volatile in the cached prefix
    expect(JSON.stringify(p.messages.at(-1))).toContain('XXXXXX1111');
    expect(p.tools.map((t) => t.name)).not.toContain('send_command');

    const fleet = JSON.parse(claude.toolResults.find((t) => t.name === 'fleet_status')!.content);
    expect(fleet.counts).toEqual({ moving: 1, offline: 1 });
    expect(fleet.vehicles[0]).toMatchObject({ vehicle: VEH, speedKmh: 56, odometerKm: 120000 });
  });

  it('continues the conversation with the full, unedited history', async () => {
    claude.answer = 'Nothing else is moving.';
    await http.post('/erp/ai/chat').set(admin).send({ conversationId, message: 'Anything else?' }).expect(201);
    const sent = claude.runnerParams.at(-1)!.messages;
    // user, assistant(tool_use), user(tool_result), assistant(final with thinking block), new user
    expect(sent).toHaveLength(5);
    expect(JSON.stringify(sent[3])).toContain('"signature":"sig"');
    const conv = (await http.get(`/erp/ai/conversations/${conversationId}`).set(admin).expect(200)).body;
    expect(conv.turns.map((t: { role: string }) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(conv.turns[0].text).not.toContain('[Context:');
    await http.get(`/erp/ai/conversations/${conversationId}`).set(staff).expect(404); // someone else's
  });

  it('keeps each role inside its permissions', async () => {
    claude.plan = [{ name: 'finance_kpis', input: { days: 30 } }];
    await http.post('/erp/ai/chat').set(staff).send({ message: 'What was our profit?' }).expect(201);
    expect(claude.toolResults.at(-1)!.content).toMatch(/^Not permitted: the driver role cannot view invoice/);
  });

  it('turns proposals into approval requests that run only once approved', async () => {
    claude.plan = [
      { name: 'propose_action', input: { kind: 'create_job_card', params: { vehicleNo: VEH, serviceType: 'Brake Inspection & Overhaul', problem: 'Harsh braking alerts all week', priority: 'high' }, summary: `Brake check for ${VEH}`, reason: '14 harsh braking alarms in 7 days' } },
      { name: 'propose_action', input: { kind: 'create_job_card', params: { vehicleNo: VEH }, summary: 'bad one' } },
      { name: 'propose_action', input: { kind: 'engine_stop', params: { vehicleNo: VEH }, summary: 'stop it' } },
    ];
    const res = (await http.post('/erp/ai/chat').set(admin).send({ message: 'Book a brake check' }).expect(201)).body;
    expect(res.proposedActions).toHaveLength(1);
    const [ok, bad, forbidden] = claude.toolResults.slice(-3).map((r) => r.content);
    expect(ok).toMatch(/^Proposed as AIA-\d{4}-\d{4}; status pending_approval/);
    expect(bad).toMatch(/^Error: serviceType/);
    expect(forbidden).toMatch(/Invalid input/);

    const action = (await http.get('/erp/ai/actions?status=pending_approval').set(admin).expect(200)).body.find((a: { actNo: string }) => a.actNo === res.proposedActions[0]);
    expect(action).toMatchObject({ kind: 'create_job_card', conversationId: res.conversationId });
    const req = (await http.get('/erp/approvals?docType=ai_action').set(admin).expect(200)).body.find((r: { docId: number }) => r.docId === action.id);
    expect(req.title).toBe('AI proposal: Open a job card');
    await http.post(`/erp/approvals/${req.id}/approve`).set(admin).send({}).expect(201);
    const done = (await http.get('/erp/ai/actions?status=executed').set(admin).expect(200)).body.find((a: { id: number }) => a.id === action.id);
    expect(done.result.jcNo).toMatch(/^JC-/);
    const jc = (await http.get(`/erp/workshop/job-cards/${done.result.id}`).set(admin).expect(200)).body;
    expect(jc).toMatchObject({ vehicleNo: VEH, status: 'draft', priority: 'high' });
  });

  it('triages fleet signals into a saved report', async () => {
    await http.post('/erp/safety/sos').set(admin).send({ vehicleNo: VEH, driverPhone: '+91 98220 33333' }).expect(201);
    claude.parsed = { headline: '1 active SOS needs a response', issues: [{ severity: 'critical', category: 'safety', title: `SOS on ${VEH}`, detail: 'Raised by phone', vehicles: [VEH], recommendedAction: 'Call the driver', link: '/sos' }] };
    const report = (await http.post('/erp/ai/triage').set(admin).send({ hours: 12 }).expect(201)).body;
    expect(report).toMatchObject({ kind: 'triage', title: '1 active SOS needs a response' });
    const sent = JSON.stringify(claude.parseParams.at(-1)!.messages);
    expect(sent).toContain(VEH);
    expect(sent).toContain('offlineVehicles');
    expect(claude.parseParams.at(-1)!.output_config).toMatchObject({ effort: 'medium', format: { type: 'json_schema' } });
    await http.post('/erp/ai/triage').set(staff).send({}).expect(403);
    expect((await http.get('/erp/ai/reports?kind=triage').set(admin).expect(200)).body[0].id).toBe(report.id);
  });

  it('writes a briefing', async () => {
    claude.parsed = { title: 'Morning briefing', summary: 'Quiet night.', sections: [{ heading: 'Safety', bullets: ['1 SOS'] }], decisions: ['Approve brake job'] };
    const b = (await http.post('/erp/ai/briefing').set(admin).expect(201)).body;
    expect(b).toMatchObject({ kind: 'briefing', content: { decisions: ['Approve brake job'] } });
  });

  it('reads documents into suggested fields without saving them', async () => {
    const doc = (await http.post('/erp/compliance/documents').set(admin).send({ subjectType: 'vehicle', subject: VEH, docType: 'insurance' }).expect(201)).body;
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
    const att = (await http.post('/erp/attachments').set(admin).send({ docType: 'compliance_doc', docId: doc.id, filename: 'policy.png', mime: 'image/png', data: png }).expect(201)).body;
    claude.parsed = { docType: 'insurance', subjectType: 'vehicle', subject: VEH, docNo: 'POL-77', authority: 'ICICI Lombard', issueDate: '2026-04-01', expiryDate: '2027-03-31', confidence: 'high', notes: null };
    const r = (await http.post('/erp/ai/extract').set(admin).send({ attachmentId: att.id, kind: 'compliance' }).expect(201)).body;
    expect(r.fields).toMatchObject({ docNo: 'POL-77', expiryDate: '2027-03-31' });
    const content = claude.parseParams.at(-1)!.messages[0].content as { type: string; source?: { media_type: string } }[];
    expect(content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
    await http.post('/erp/ai/extract').set(admin).send({ attachmentId: att.id, kind: 'menu' }).expect(400);
    const csv = (await http.post('/erp/attachments').set(admin).send({ docType: 'compliance_doc', docId: doc.id, filename: 'x.csv', mime: 'text/csv', data: 'YSxi' }).expect(201)).body;
    await http.post('/erp/ai/extract').set(admin).send({ attachmentId: csv.id, kind: 'compliance' }).expect(400);
    // the document itself is unchanged until a person saves the form
    expect((await http.get(`/erp/compliance/documents/${doc.id}`).set(admin).expect(200)).body.docNo).toBeNull();
  });

  it('logs usage per feature', async () => {
    const u = (await http.get('/erp/ai/usage?days=1').set(admin).expect(200)).body.features;
    const copilot = u.find((f: { feature: string }) => f.feature === 'copilot');
    expect(copilot.runs).toBeGreaterThanOrEqual(4);
    expect(copilot.cacheReadTokens).toBeGreaterThan(0);
    expect(u.map((f: { feature: string }) => f.feature)).toEqual(expect.arrayContaining(['triage', 'briefing', 'extract']));
  });
});
