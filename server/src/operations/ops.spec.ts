import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../config';
import { createTestApp, type FakeTraccar } from '../test-utils';
import { memoTotals, orderValue } from './docs';
import { tripProgress } from './ops.service';

const admin = { Cookie: 'JSESSIONID=admin-session' };
const run = Date.now().toString(36).toUpperCase();

describe('transport operations', () => {
  let app: INestApplication;
  let traccar: FakeTraccar;
  let http: ReturnType<typeof request>;
  let customer: number;
  let broker: number;
  let store: number;
  let plant: number;

  beforeAll(async () => {
    ({ app, traccar } = await createTestApp());
    http = request(app.getHttpServer());
    customer = (await http.post('/erp/masters/parties').set(admin).send({ name: `Steel Co ${run}`, kinds: ['customer'] }).expect(201)).body.id;
    broker = (await http.post('/erp/masters/parties').set(admin).send({ name: `Broker ${run}`, kinds: ['broker'] }).expect(201)).body.id;
    plant = (await http.post('/erp/masters/plants').set(admin).send({ code: `OP${run}`, name: 'Ops plant' }).expect(201)).body.id;
    store = (await http.post('/erp/masters/stores').set(admin).send({ code: `OS${run}`, name: 'Ops store', plantId: plant }).expect(201)).body.id;
    await http.put('/erp/approvals/rules').set(admin).send({ docType: 'fuel_indent', enabled: true, minAmount: 1000, approverRole: 'fleet_supervisor' }).expect(200);
  });
  afterAll(() => app.close());

  it('computes order values by rate basis', () => {
    expect(orderValue({ rateBasis: 'per_tonne_km', rate: 4.2, weightT: 28.5, distanceKm: 1480 })).toBe(177156);
    expect(orderValue({ rateBasis: 'per_tonne', rate: 1200, weightT: 32 })).toBe(38400);
    expect(orderValue({ rateBasis: 'fixed', rate: 38400 })).toBe(38400);
  });

  it('works out trip progress, ETA and delay', () => {
    const now = new Date('2026-11-01T10:00:00Z');
    const trip = { status: 'in_transit', plannedKm: 100, startOdometerM: 1_000_000, plannedArrival: new Date('2026-11-01T11:00:00Z') };
    const pos = { deviceId: 1, speed: 27, fixTime: '', attributes: { totalDistance: 1_040_000 } }; // 40 km done, ~50 km/h
    const p = tripProgress(trip, pos, now);
    expect(p).toMatchObject({ travelledKm: 40, progressPct: 40, delayed: true });
    expect(new Date(p.eta!).getTime()).toBeGreaterThan(now.getTime());
    expect(tripProgress({ ...trip, status: 'arrived' }, pos, now).progressPct).toBe(100);
  });

  it('runs an order through a GPS-tracked trip to proof of delivery', async () => {
    await http.post('/erp/ops/orders').set(admin).send({ customerId: broker, origin: 'A', destination: 'B' }).expect(400);
    const order = (await http.post('/erp/ops/orders').set(admin).send({ customerId: customer, origin: 'Jamshedpur', destination: 'Pune', weightT: 28.5, distanceKm: 1480, rateBasis: 'per_tonne_km', rate: 4.2 }).expect(201)).body;
    expect(order).toMatchObject({ orderNo: expect.stringMatching(/^ORD-/), value: 177156, status: 'booked' });

    await http.post('/erp/ops/trips').set(admin).send({ vehicleNo: 'MH12', driverName: 'R', driverPhone: 'abc', origin: 'x', destination: 'y' }).expect(400);
    const trip = (await http
      .post('/erp/ops/trips')
      .set(admin)
      .send({ orderId: order.id, customerId: customer, deviceId: 7, vehicleNo: 'mh 12 qx 4521', driverName: 'Rameshwar Yadav', driverPhone: '+91 98221 44510', origin: 'Jamshedpur', destination: 'Pune', destGeofenceId: 55, plannedKm: 1480 })
      .expect(201)).body;
    expect(trip).toMatchObject({ tripNo: expect.stringMatching(/^TRP-/), vehicleNo: 'MH 12 QX 4521', status: 'scheduled' });
    expect((await http.get(`/erp/ops/orders/${order.id}`).set(admin)).body).toMatchObject({ status: 'dispatched', tripId: trip.id });

    traccar.data.set('/positions', [{ deviceId: 7, speed: 30, fixTime: '', attributes: { totalDistance: 5_000_000 } }]);
    expect((await http.post(`/erp/ops/trips/${trip.id}/start`).set(admin).expect(201)).body).toMatchObject({ status: 'in_transit', startOdometerM: 5_000_000 });
    traccar.data.set('/positions', [{ deviceId: 7, speed: 30, fixTime: '', attributes: { totalDistance: 5_740_000 } }]);
    const live = (await http.get('/erp/ops/trips-live').set(admin).expect(200)).body.find((t: { id: number }) => t.id === trip.id);
    expect(live).toMatchObject({ travelledKm: 740, progressPct: 50 });

    // Traccar reports the truck entering the destination geofence
    await http
      .post('/erp/hooks/traccar-event')
      .set('X-Hook-Secret', config.hookSecret)
      .send({ event: { id: Date.now() % 1e9, type: 'geofenceEnter', deviceId: 7, geofenceId: 55 }, device: { name: 'MH 12 QX 4521' } })
      .expect(204);
    expect((await http.get(`/erp/ops/trips/${trip.id}`).set(admin)).body.status).toBe('arrived');

    await http.post(`/erp/ops/trips/${trip.id}/pod`).set(admin).send({}).expect(400);
    const done = (await http.post(`/erp/ops/trips/${trip.id}/pod`).set(admin).send({ receivedBy: 'Gate officer, Chakan' }).expect(201)).body;
    expect(done).toMatchObject({ status: 'completed', podStatus: 'verified', podReceivedBy: 'Gate officer, Chakan' });
    expect((await http.get(`/erp/ops/orders/${order.id}`).set(admin)).body.status).toBe('delivered');
    await http.delete(`/erp/ops/trips/${trip.id}`).set(admin).expect(409);
  });

  it('routes fuel indents to approval above the threshold', async () => {
    await http.post('/erp/ops/fuel-indents').set(admin).send({ vehicleNo: 'RJ14GC6789', pump: 'IOCL Kotputli', amount: 5000 }).expect(400); // no driver
    const small = (await http.post('/erp/ops/fuel-indents').set(admin).send({ vehicleNo: 'JCB-01', isEquipment: true, pump: 'Cash', amount: 800, rate: 95 }).expect(201)).body;
    expect((await http.get(`/erp/ops/fuel-indents/${small.id}`).set(admin)).body).toMatchObject({ status: 'approved', litres: 8.42 });

    const big = (await http.post('/erp/ops/fuel-indents').set(admin).send({ vehicleNo: 'RJ14GC6789', driverName: 'Sukhdev', driverMobile: '+91 94140 88219', pump: 'IOCL Kotputli', amount: 9500, rate: 95 }).expect(201)).body;
    expect(big).toMatchObject({ status: 'pending_approval', litres: 100 });
    const req = (await http.get('/erp/approvals?docType=fuel_indent').set(admin).expect(200)).body.find((a: { docId: number }) => a.docId === big.id);
    expect(req).toMatchObject({ amount: 9500, title: 'Fuel for RJ14GC6789' });
    await http.post(`/erp/approvals/${req.id}/approve`).set(admin).send({}).expect(201);
    expect((await http.get(`/erp/ops/fuel-indents/${big.id}`).set(admin)).body.status).toBe('approved');
  });

  it('works out freight memo balances', async () => {
    expect(memoTotals({ rateBasis: 'per_mt', rate: 1850, weightMt: 26.5, advance: 35000, commission: 2000 })).toEqual({ totalFreight: 49025, balance: 12025 });
    await http.post('/erp/ops/freight-memos').set(admin).send({ vehicleNo: 'MH12QX4521', brokerId: customer, totalFreight: 100 }).expect(400);
    const memo = (await http.post('/erp/ops/freight-memos').set(admin).send({ vehicleNo: 'MH12QX4521', brokerId: broker, rateBasis: 'per_mt', rate: 1850, weightMt: 26.5, advance: 35000, commission: 2000, lrNos: ['lr-1'] }).expect(201)).body;
    expect(memo).toMatchObject({ memoNo: expect.stringMatching(/^FM-/), totalFreight: 49025, balance: 12025, lrNos: ['LR-1'] });
    await http.post('/erp/ops/freight-memos').set(admin).send({ vehicleNo: 'MH12QX4521', brokerId: broker, totalFreight: 1000, advance: 2000 }).expect(400);
  });

  it('imports loading-sheet rows and reports bad ones', async () => {
    const res = (await http
      .post('/erp/ops/lrs/bulk')
      .set(admin)
      .send({
        rows: [
          { lrNo: `LRB-${run}-1`, vehicleNo: 'GJ01AX4589', plantId: plant, fleetType: 'market', chargedWeight: 26, ewayBillNo: '241811223344', extra: { coilId: 'C-77' } },
          { lrNo: `LRB-${run}-1`, vehicleNo: 'GJ01AX4589' },
          { vehicleNo: 'X' },
          { vehicleNo: 'MH12AB1234', ewayBillNo: '123' },
        ],
      })
      .expect(201)).body;
    expect(res.created).toBe(1);
    expect(res.errors.map((e: { row: number }) => e.row)).toEqual([2, 3, 4]);
    expect(res.errors[0].error).toMatch(/already exists/);
    const lr = (await http.get(`/erp/ops/lrs?search=LRB-${run}`).set(admin).expect(200)).body[0];
    expect(lr).toMatchObject({ fleetType: 'market', extra: { coilId: 'C-77' } });
  });

  it('receives material returned from a vehicle into stock', async () => {
    const cat = (await http.post('/erp/masters/item-categories').set(admin).send({ name: `GPS ${run}`, countingMode: 'serial' }).expect(201)).body.id;
    const gps = (await http.post('/erp/masters/items').set(admin).send({ name: `Tracker ${run}`, categoryId: cat, rate: 5400 }).expect(201)).body.id;
    const ret = (await http
      .post('/erp/ops/returns/receive')
      .set(admin)
      .send({ storeId: store, vehicleNo: 'mh12rn4589', condition: 'damaged', lines: [{ itemId: gps, qty: 1, serials: [`IMEI-${run}`] }] })
      .expect(201)).body;
    expect(ret).toMatchObject({ returnNo: expect.stringMatching(/^MR-/), vehicleNo: 'MH12RN4589' });
    const pieces = (await http.get(`/erp/stock/pieces?itemId=${gps}`).set(admin).expect(200)).body;
    expect(pieces[0]).toMatchObject({ serial: `IMEI-${run}`, state: 'damaged', storeId: store });
    await http.post('/erp/ops/returns').set(admin).send({}).expect(400);
  });

  it('receives incoming vehicles once', async () => {
    const v = (await http.post('/erp/ops/incoming').set(admin).send({ vehicleNo: 'KA01MJ8820', plantId: plant, material: 'Steel pipes', weightMt: 24 }).expect(201)).body;
    expect((await http.post(`/erp/ops/incoming/${v.id}/receive`).set(admin).expect(201)).body.status).toBe('received');
    await http.post(`/erp/ops/incoming/${v.id}/receive`).set(admin).expect(409);
  });
});
