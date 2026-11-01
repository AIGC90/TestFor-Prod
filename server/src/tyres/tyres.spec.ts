import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type FakeTraccar } from '../test-utils';
import { costPerKm, tyreKm } from './tyres.service';

const admin = { Cookie: 'JSESSIONID=admin-session' };
const run = Date.now().toString(36).toUpperCase();
const A = `MH12TY${run.slice(-4)}`;
const B = `GJ06TY${run.slice(-4)}`;

describe('tyres', () => {
  let app: INestApplication;
  let traccar: FakeTraccar;
  let http: ReturnType<typeof request>;
  const odo = (a: number, b: number) =>
    traccar.data.set('/positions', [
      { deviceId: 1, attributes: { totalDistance: a * 1000 } },
      { deviceId: 2, attributes: { totalDistance: b * 1000 } },
    ]);
  const newTyre = async (suffix: string, extra: Record<string, unknown> = {}) =>
    (await http.post('/erp/tyres/register').set(admin).send({ serial: `${run}-${suffix}`, brand: 'MRF', model: 'Steel Muscle', size: '295/80 R22.5', purchaseCost: 26000, ...extra }).expect(201)).body;

  beforeAll(async () => {
    ({ app, traccar } = await createTestApp());
    http = request(app.getHttpServer());
    traccar.data.set('/devices', [{ id: 1, name: A }, { id: 2, name: B }]);
    odo(40000, 30000);
  });
  afterAll(() => app.close());

  it('computes tyre km and cost per km', () => {
    expect(tyreKm({ status: 'fitted', closedKm: 5000, fittedKm: 40000 }, 52000)).toBe(17000);
    expect(tyreKm({ status: 'in_store', closedKm: 5000, fittedKm: null }, 52000)).toBe(5000);
    expect(costPerKm(26000, 80000)).toBe(0.33);
    expect(costPerKm(26000, 0)).toBeNull();
  });

  it('fits, rotates across vehicles, removes and retreads a tyre with GPS km', async () => {
    const t1 = await newTyre('1');
    const t2 = await newTyre('2', { brand: 'Apollo', model: 'EnduRace' });
    expect(t1).toMatchObject({ status: 'in_store', lastNsd: 16 });

    await http.post('/erp/tyres/fit').set(admin).send({ tyreId: t1.id, vehicleNo: A, position: 'D2RO' }).expect(400); // 6w has no D2RO
    await http.put(`/erp/tyres/vehicle/${A}/layout`).set(admin).send({ layout: '10w' }).expect(200);
    expect((await http.post('/erp/tyres/fit').set(admin).send({ tyreId: t1.id, vehicleNo: A, position: 'FL' }).expect(201)).body).toMatchObject({ status: 'fitted', fittedKm: 40000 });
    await http.post('/erp/tyres/fit').set(admin).send({ tyreId: t2.id, vehicleNo: A, position: 'FL' }).expect(409); // occupied
    await http.post('/erp/tyres/fit').set(admin).send({ tyreId: t2.id, vehicleNo: A, position: 'FR' }).expect(201);
    await http.post('/erp/tyres/fit').set(admin).send({ tyreId: t1.id, vehicleNo: A, position: 'D1LO' }).expect(409); // already fitted
    await http.put(`/erp/tyres/vehicle/${A}/layout`).set(admin).send({ layout: '4w' }).expect(200); // FL/FR exist in 4w too

    // 12,000 km later: swap FL and FR, then move FL to the other truck
    odo(52000, 31000);
    await http.post('/erp/tyres/interchanges').set(admin).send({ lines: [{ tyreId: t1.id, toVehicleNo: A, toPosition: 'FR' }] }).expect(409); // FR is taken and not vacated
    const swap = (await http.post('/erp/tyres/interchanges').set(admin).send({ lines: [{ tyreId: t1.id, toVehicleNo: A, toPosition: 'FR' }, { tyreId: t2.id, toVehicleNo: A, toPosition: 'FL' }] }).expect(201)).body;
    expect(swap).toMatchObject({ kind: 'rotation', tiNo: expect.stringMatching(/^TI-/) });
    const cross = (await http.post('/erp/tyres/interchanges').set(admin).send({ lines: [{ tyreId: t1.id, toVehicleNo: B, toPosition: 'FL' }] }).expect(201)).body;
    expect(cross.kind).toBe('cross');

    odo(52000, 34000); // B runs 3,000 km
    await http.post(`/erp/tyres/${t1.id}/inspect`).set(admin).send({ nsd: 2.5, pressure: 95 }).expect(201);
    const map = (await http.get(`/erp/tyres/vehicle/${B}`).set(admin).expect(200)).body;
    expect(map.tyres[0]).toMatchObject({ serial: `${run}-1`, position: 'FL', kmRun: 15000, lastNsd: 2.5 });

    const alerts = (await http.get('/erp/tyres/nsd-alerts?threshold=3').set(admin).expect(200)).body;
    expect(alerts.find((a: { id: number }) => a.id === t1.id)).toMatchObject({ severity: 'warning' });

    const removed = (await http.post(`/erp/tyres/${t1.id}/remove`).set(admin).send({ to: 'retreader', nsd: 2.4 }).expect(201)).body;
    expect(removed).toMatchObject({ status: 'at_retreader', closedKm: 15000, vehicleNo: null });
    await http.post(`/erp/tyres/${t1.id}/retread-in`).set(admin).send({ cost: 8400, nsd: 14 }).expect(201);
    const back = (await http.get(`/erp/tyres/register/${t1.id}`).set(admin).expect(200)).body;
    expect(back).toMatchObject({ status: 'in_store', retreadCount: 1, upkeepCost: 8400, lastNsd: 14 });

    const events = (await http.get(`/erp/tyres/events?tyreId=${t1.id}`).set(admin).expect(200)).body.map((e: { type: string }) => e.type);
    expect(events.reverse()).toEqual(['purchase', 'fit', 'rotate', 'rotate', 'inspect', 'remove', 'retread_out', 'retread_in']);
  });

  it('refuses to scrap a fitted tyre and reports analytics', async () => {
    const t3 = await newTyre('3', { brand: 'JK Tyre', purchaseCost: 23800 });
    await http.post('/erp/tyres/fit').set(admin).send({ tyreId: t3.id, vehicleNo: B, position: 'FR' }).expect(201);
    await http.post(`/erp/tyres/${t3.id}/scrap`).set(admin).send({}).expect(409);
    await http.put(`/erp/tyres/vehicle/${B}/layout`).set(admin).send({ layout: '4w' }).expect(200);

    const overview = (await http.get('/erp/tyres/overview').set(admin).expect(200)).body;
    expect(overview.inService).toBeGreaterThanOrEqual(2);
    expect(overview.spend).toHaveLength(12);
    const perf = (await http.get('/erp/tyres/performance?groupBy=brand').set(admin).expect(200)).body;
    expect(perf.map((p: { group: string }) => p.group)).toEqual(expect.arrayContaining(['MRF', 'Apollo', 'JK Tyre']));
    const cost = (await http.get('/erp/tyres/cost-by-vehicle').set(admin).expect(200)).body;
    expect(cost.find((c: { vehicleNo: string }) => c.vehicleNo === A)).toMatchObject({ tyres: 1 });
    await http.get('/erp/tyres/performance?groupBy=colour').set(admin).expect(400);
  });
});
