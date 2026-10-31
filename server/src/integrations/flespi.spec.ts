import type { INestApplication } from '@nestjs/common';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../config';
import { createTestApp, type FakeTraccar } from '../test-utils';
import { open, seal } from './secret-box';

const TOKEN = 'TestFlespiToken0123456789';
const admin = { Cookie: 'JSESSIONID=admin-session' };
const staff = { Cookie: 'JSESSIONID=staff-session' };

/** Minimal flespi.io stand-in recording every call. */
function mockFlespi() {
  const calls: { method: string; url: string; auth?: string; body?: unknown }[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.headers.authorization !== `FlespiToken ${TOKEN}`) return send(401, { errors: [{ reason: 'invalid token' }] });
    const url = req.url!;
    if (url.startsWith('/auth/info')) return send(200, { result: [{ id: 77, cid: 1 }] });
    if (url.startsWith('/gw/devices/all')) {
      return send(200, {
        result: [
          { id: 1, name: 'MH-12-FL-0001', configuration: { ident: '358000000000001' }, connected: true, last_active: 1793480000 },
          { id: 2, name: 'Already in Traccar', configuration: { ident: '867010075167001' }, connected: false },
          { id: 3, name: 'No ident yet', configuration: {} },
        ],
      });
    }
    if (url.startsWith('/gw/stream-protocols/name=traccar')) return send(200, { result: [{ id: 41, name: 'traccar', config_schema: { properties: { host: {}, port: {} } } }] });
    if (url.startsWith('/gw/streams?') && req.method === 'POST') return send(200, { result: [{ id: 555 }] });
    if (url.startsWith('/gw/streams/555/devices/')) return send(200, { result: [] });
    return send(404, { errors: [{ reason: `no mock for ${req.method} ${url}` }] });
  });
  return { server, calls };
}

describe('flespi connector', () => {
  let app: INestApplication;
  let traccar: FakeTraccar;
  let http: ReturnType<typeof request>;
  const mock = mockFlespi();

  beforeAll(async () => {
    await new Promise<void>((r) => mock.server.listen(0, r));
    config.flespiApiUrl = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
    ({ app, traccar } = await createTestApp());
    traccar.data.set('/devices', [{ id: 9, name: 'Existing', uniqueId: '867010075167001' }]);
    http = request(app.getHttpServer());
  });
  afterAll(async () => {
    await app.close();
    mock.server.close();
  });

  it('encrypts secrets reversibly', () => {
    const sealed = seal('abc');
    expect(sealed).not.toContain('abc');
    expect(open(sealed)).toBe('abc');
  });

  it('is admin only', async () => {
    await http.get('/erp/integrations/flespi').set(staff).expect(403);
  });

  it('rejects a bad token and stores a good one without ever returning it', async () => {
    const bad = await http.put('/erp/integrations/flespi').set(admin).send({ token: 'WrongToken1234', traccarHost: 'gps.example.com' }).expect(400);
    expect(bad.body.message).toMatch(/flespi rejected the token/);
    await http.put('/erp/integrations/flespi').set(admin).send({ token: TOKEN, traccarHost: 'http://x/y' }).expect(400);

    const ok = await http.put('/erp/integrations/flespi').set(admin).send({ token: TOKEN, traccarHost: 'gps.example.com' }).expect(200);
    expect(ok.body).toMatchObject({ configured: true, tokenHint: '••••6789', traccarHost: 'gps.example.com', traccarPort: 5149 });
    expect(JSON.stringify(ok.body)).not.toContain(TOKEN);
    const test = await http.post('/erp/integrations/flespi/test').set(admin).expect(201);
    expect(test.body.ok).toBe(true);
  });

  it('lists flespi devices against Traccar and imports only the missing ones', async () => {
    const list = await http.get('/erp/integrations/flespi/devices').set(admin).expect(200);
    expect(list.body.map((d: { id: number; traccarDeviceId: number | null }) => [d.id, d.traccarDeviceId])).toEqual([[1, null], [2, 9], [3, null]]);

    const res = await http.post('/erp/integrations/flespi/import').set(admin).send({}).expect(201);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.skipped).toEqual([{ flespiId: 3, name: 'No ident yet', reason: 'no ident' }]);
    expect(traccar.posted.at(-1)).toEqual({
      path: '/devices',
      body: { name: 'MH-12-FL-0001', uniqueId: '358000000000001', attributes: { source: 'flespi', flespiId: 1 } },
    });
  });

  it('creates a traccar stream to port 5149 and subscribes devices that exist in Traccar', async () => {
    traccar.data.set('/devices', [
      { id: 9, name: 'Existing', uniqueId: '867010075167001' },
      { id: 10, name: 'MH-12-FL-0001', uniqueId: '358000000000001' },
    ]);
    const res = await http.post('/erp/integrations/flespi/stream').set(admin).send({}).expect(201);
    expect(res.body).toMatchObject({ streamId: 555, subscribed: 2, configuration: { host: 'gps.example.com', port: 5149 } });
    const create = mock.calls.find((c) => c.method === 'POST' && c.url.startsWith('/gw/streams?'));
    expect(create?.body).toEqual([{ name: 'FleetOne to Traccar', protocol_id: 41, configuration: { host: 'gps.example.com', port: 5149 }, enabled: true }]);
    expect(mock.calls.some((c) => c.url === '/gw/streams/555/devices/1,2')).toBe(true);
    expect(mock.calls.every((c) => c.auth === `FlespiToken ${TOKEN}` || c.url.startsWith('/auth/info'))).toBe(true);
    const status = await http.get('/erp/integrations/flespi').set(admin).expect(200);
    expect(status.body).toMatchObject({ streamId: 555, lastImportCount: 1, lastTestOk: true });
  });
});
