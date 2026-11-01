// Loads ~60 days of Saudi demo activity (SAR) for showing and testing the app: trips and freight,
// diesel, invoices and receipts, workshop jobs, tyres, documents, drivers, payroll and field staff.
// Run after `seed` and the Traccar seeder. It refuses to run twice (looks for its marker customer order).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { AppModule } from './app.module';
import { config } from './config';
import { DB, type Db } from './db/db.module';
import {
  complianceDocs, deviceLicenses, driverAssignments, driverAttendance, driverProfiles, emergencyContacts, fieldStaff, fieldTasks,
  fuelIndents, incidents, payrollRuns, insuranceClaims, invoiceReceipts, invoices, jobCards, orders, parties, pmSchedules, repairBills, sosIncidents,
  items, stores, trips, tyreEvents, tyres,
} from './db/schema';
import { NumberingService } from './erp/numbering.service';
import { gstSplit } from './inventory/docs';
import { StockService } from './inventory/stock.service';
import { DriversService } from './people/drivers';
import { DEFAULT_CONTACTS } from './people/safety';

const DAY = 86_400_000;
const MARKER = 'DEMO-KSA';
const DIESEL = 1.66; // SAR per litre
const r2 = (n: number) => Math.round(n * 100) / 100;
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const daysAgo = (d: number, hour = 9) => {
  const t = new Date(Date.now() - d * DAY);
  t.setUTCHours(hour - 3, Math.floor(rnd() * 60), 0, 0); // KSA is UTC+3
  return t;
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);

// [origin, destination, km, freight SAR, customer code]
const LANES: [string, string, number, number, string][] = [
  ['Riyadh Dry Port', 'Dammam King Abdulaziz Port', 410, 1500, 'C-NAJDCEM'],
  ['Jeddah Islamic Port', 'Riyadh Dry Port', 950, 3600, 'C-REDSEA'],
  ['Jubail Industrial City', 'Riyadh Dry Port', 480, 1700, 'C-EASTPET'],
  ['Dammam King Abdulaziz Port', 'Jeddah Islamic Port', 1350, 4800, 'C-EASTPET'],
  ['Jeddah Islamic Port', 'Madinah Logistics Hub', 420, 1500, 'C-WAHA'],
  ['Riyadh Dry Port', 'Hail Agricultural Depot', 640, 2200, 'C-WAHA'],
  ['Makkah Distribution Centre', 'Jeddah Islamic Port', 85, 600, 'C-REDSEA'],
];

async function traccarDevices(): Promise<{ id: number; name: string; uniqueId: string; phone: string | null }[]> {
  const email = config.traccarServiceEmail || 'admin@fleet.local';
  const password = config.traccarServicePassword || 'admin';
  const res = await fetch(`${config.traccarUrl}/api/devices`, { headers: { Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}` } });
  if (!res.ok) throw new Error(`Traccar login failed (HTTP ${res.status}); set TRACCAR_SERVICE_EMAIL / TRACCAR_SERVICE_PASSWORD`);
  return res.json() as Promise<{ id: number; name: string; uniqueId: string; phone: string | null }[]>;
}
async function traccarDrivers(): Promise<{ id: number; name: string; uniqueId: string }[]> {
  const email = config.traccarServiceEmail || 'admin@fleet.local';
  const password = config.traccarServicePassword || 'admin';
  const res = await fetch(`${config.traccarUrl}/api/drivers`, { headers: { Authorization: `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}` } });
  return res.json() as Promise<{ id: number; name: string; uniqueId: string }[]>;
}

async function demo() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get<Db>(DB);
  const no = app.get(NumberingService);
  const [done] = await db.select({ id: orders.id }).from(orders).where(eq(orders.orderNo, MARKER));
  if (done) {
    console.log('Demo data is already loaded.');
    await app.close();
    return;
  }
  const party = new Map((await db.select().from(parties)).map((p) => [p.code, p.id]));
  if (!party.get('C-NAJDCEM')) throw new Error('Run the ERP seed first (pnpm --filter server seed)');
  const vehicles = (await traccarDevices()).sort((a, b) => a.name.localeCompare(b.name));
  if (!vehicles.length) throw new Error('No Traccar devices; run tools/seed-traccar.mjs first');
  const tDrivers = await traccarDrivers();

  // marker order, so a second run stops early
  await db.insert(orders).values({ orderNo: MARKER, customerId: party.get('C-NAJDCEM')!, origin: 'Demo data', destination: 'Demo data', status: 'cancelled' });

  /* drivers: profiles, salaries (SAR), assignments, attendance */
  const profiles = [];
  for (const [i, d] of tDrivers.entries()) {
    const [p] = await db
      .insert(driverProfiles)
      .values({
        traccarDriverId: d.id,
        name: d.name,
        phone: `+9665${String(50000000 + i * 1234567).slice(0, 8)}`,
        licenceNo: `DL-${1000000 + i * 7919}`,
        licenceExpiry: ymd(new Date(Date.now() + (i % 5 === 0 ? 20 : 200 + i * 30) * DAY)),
        monthlySalary: pick([3800, 4200, 4500, 5000]),
        dailyBata: 60,
        tripAllowance: 150,
        joinedOn: ymd(new Date(Date.now() - (200 + i * 40) * DAY)),
      })
      .onConflictDoNothing()
      .returning();
    if (p) profiles.push(p);
  }
  const assigned = new Map<string, (typeof profiles)[number]>();
  for (const [i, p] of profiles.entries()) {
    const v = vehicles[i];
    if (!v) break;
    await db.insert(driverAssignments).values({ driverId: p.id, vehicleNo: v.name, fromAt: new Date(Date.now() - 70 * DAY) });
    assigned.set(v.name, p);
  }
  for (const p of profiles) {
    for (let d = 1; d <= 40; d++) {
      const date = new Date(Date.now() - d * DAY);
      const code = date.getUTCDay() === 5 ? 'WO' : rnd() < 0.05 ? 'A' : rnd() < 0.05 ? 'L' : 'P'; // Friday off
      await db.insert(driverAttendance).values({ driverId: p.id, date: ymd(date), code }).onConflictDoNothing();
    }
  }

  /* trips over 60 days, fuel for each, invoices and receipts */
  const tripRows = [];
  for (let d = 60; d >= 1; d--) {
    const perDay = 4 + Math.floor(rnd() * 3);
    for (let k = 0; k < perDay; k++) {
      const [origin, destination, km, freight, cust] = pick(LANES);
      const v = pick(vehicles);
      const driver = assigned.get(v.name);
      const started = daysAgo(d, 6 + Math.floor(rnd() * 6));
      const hours = km / 65;
      const completed = new Date(started.getTime() + hours * 3_600_000 + 2 * 3_600_000);
      const [t] = await db
        .insert(trips)
        .values({
          tripNo: await no.next('TRP', started),
          customerId: party.get(cust)!,
          deviceId: v.id,
          vehicleNo: v.name,
          driverName: driver?.name ?? 'Relief driver',
          driverPhone: driver?.phone ?? '+966500000000',
          origin,
          destination,
          plannedKm: km,
          material: pick(['Cement bags', 'Steel coils', 'Polymer granules', 'Packaged food', 'Containers (40ft)']),
          weightT: 20 + Math.floor(rnd() * 12),
          freight: Math.round(freight * (0.92 + rnd() * 0.16)),
          scheduledAt: started,
          startedAt: started,
          arrivedAt: completed,
          completedAt: completed,
          status: 'completed',
          podStatus: 'verified',
          podReceivedBy: 'Gate officer',
          podAt: completed,
        })
        .returning();
      tripRows.push(t);
      const litres = Math.round(km / (2.6 + rnd() * 0.6));
      await db.insert(fuelIndents).values({ indentNo: await no.next('FI', started), vehicleNo: v.name, driverName: t.driverName, pump: pick(['SASCO', 'Aldrees', 'Petromin', 'NAFT']), indentDate: started, amount: r2(litres * DIESEL), rate: DIESEL, litres, status: 'approved' });
    }
  }
  // a few trips on the road now
  for (const [i, v] of vehicles.slice(0, 5).entries()) {
    const [origin, destination, km, freight, cust] = LANES[i % LANES.length];
    await db.insert(trips).values({ tripNo: await no.next('TRP'), customerId: party.get(cust)!, deviceId: v.id, vehicleNo: v.name, driverName: assigned.get(v.name)?.name ?? 'Relief driver', driverPhone: assigned.get(v.name)?.phone ?? '+966500000000', origin, destination, plannedKm: km, freight, material: 'Steel coils', weightT: 26, scheduledAt: new Date(Date.now() - 4 * 3_600_000), startedAt: new Date(Date.now() - 3 * 3_600_000), plannedArrival: new Date(Date.now() + (km / 65) * 3_600_000), status: 'in_transit' });
  }
  // invoices per customer per week for trips older than a week; older ones are paid
  const byCustWeek = new Map<string, typeof tripRows>();
  for (const t of tripRows) {
    const age = (Date.now() - t.completedAt!.getTime()) / DAY;
    if (age < 7) continue;
    const key = `${t.customerId}|${Math.floor(age / 7)}`;
    byCustWeek.set(key, [...(byCustWeek.get(key) ?? []), t]);
  }
  let invoiceCount = 0;
  for (const list of byCustWeek.values()) {
    const last = list.reduce((m, t) => (t.completedAt! > m ? t.completedAt! : m), list[0].completedAt!);
    const invDate = new Date(last.getTime() + DAY);
    const taxable = list.reduce((s, t) => s + (t.freight ?? 0), 0);
    const tax = gstSplit(taxable, 5, true);
    const total = r2(taxable + tax.cgst + tax.sgst + tax.igst);
    const [cust] = await db.select().from(parties).where(eq(parties.id, list[0].customerId!));
    const age = (Date.now() - invDate.getTime()) / DAY;
    const received = age > 45 ? total : age > 25 ? r2(total * 0.5) : 0;
    const [inv] = await db
      .insert(invoices)
      .values({ invNo: await no.next('INV', invDate), customerId: list[0].customerId!, tripIds: list.map((t) => t.id), lane: list.length === 1 ? `${list[0].origin} → ${list[0].destination}` : null, invoiceDate: ymd(invDate), dueDate: ymd(new Date(invDate.getTime() + (cust.creditDays ?? 30) * DAY)), description: `Freight: ${list.map((t) => t.tripNo).join(', ')}`, taxable, gstRate: 5, ...tax, total, received, status: received >= total ? 'paid' : received ? 'partly_paid' : 'open' })
      .returning();
    if (received) await db.insert(invoiceReceipts).values({ invoiceId: inv.id, receivedOn: ymd(new Date(invDate.getTime() + 20 * DAY)), amount: received, mode: 'neft', reference: `SARIE-${inv.id}${Math.floor(rnd() * 9000 + 1000)}` });
    invoiceCount++;
  }

  /* last month's payroll, paid */
  const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).toISOString().slice(0, 7);
  const pay = await app.get(DriversService).previewPayroll(lastMonth);
  if (pay.lines.length) {
    await db.insert(payrollRuns).values({ prNo: await no.next('PAY'), month: lastMonth, lines: pay.lines, gross: pay.gross, deductions: pay.deductions, net: pay.net, status: 'paid', paidAt: new Date(`${lastMonth}-28T09:00:00Z`), paymentRef: 'WPS-SARIE batch' });
  }

  /* workshop: PM schedules, completed and open job cards, garage bills */
  const pmTasks: [string, string, number, number][] = [
    ['Engine oil, oil filter & fuel filters', 'Engine & fluids', 15000, 90],
    ['Air filter & dryer cartridge', 'Engine & fluids', 30000, 180],
    ['Brake inspection & adjustment', 'Brakes', 20000, 120],
    ['Wheel alignment & tyre rotation', 'Tyres', 25000, 120],
  ];
  for (const [i, v] of vehicles.slice(0, 10).entries()) {
    for (const [j, [task, category, intervalKm, intervalDays]] of pmTasks.entries()) {
      await db.insert(pmSchedules).values({ vehicleNo: v.name, task, category, intervalKm, intervalDays, lastDoneAt: daysAgo(20 + ((i * 17 + j * 29) % 110)), lastDoneKm: null });
    }
  }
  const services = ['Preventive Maintenance', 'Brake Inspection & Overhaul', 'Electrical Work & Wiring', 'Suspension / Leaf Spring Repair', 'Oil & Filter Service', 'Breakdown Repair'];
  for (let k = 0; k < 22; k++) {
    const v = pick(vehicles);
    const opened = daysAgo(2 + Math.floor(rnd() * 55));
    const open = k < 5;
    await db.insert(jobCards).values({
      jcNo: await no.next('JC', opened),
      vehicleNo: v.name,
      driverName: assigned.get(v.name)?.name ?? null,
      jobType: k % 4 === 3 ? 'market_garage' : 'own_workshop',
      partyId: k % 4 === 3 ? party.get('G-FAISALIAH')! : null,
      serviceType: pick(services),
      problem: pick(['Brakes pulling left', 'Scheduled service', 'AC not cooling', 'Air leak at rear axle', 'Warning light on dashboard', 'Leaf spring broken']),
      priority: rnd() < 0.2 ? 'high' : 'normal',
      estimatedCost: 800 + Math.floor(rnd() * 4000),
      labourCost: open ? 0 : 200 + Math.floor(rnd() * 900),
      partsCost: open ? 0 : Math.floor(rnd() * 2500),
      status: open ? pick(['open', 'in_progress', 'awaiting_spares']) : 'completed',
      workDone: open ? null : 'Work completed and road tested',
      openedAt: opened,
      closedAt: open ? null : new Date(opened.getTime() + (1 + Math.floor(rnd() * 3)) * DAY),
    });
  }
  for (let k = 0; k < 6; k++) {
    const billDate = daysAgo(3 + k * 8);
    const taxable = 900 + Math.floor(rnd() * 3500);
    const tax = gstSplit(taxable, 15, true);
    await db.insert(repairBills).values({ rbNo: await no.next('RB', billDate), vendorBillNo: `INV-${4400 + k}`, partyId: party.get(k % 2 ? 'G-HIGHWAY' : 'G-FAISALIAH')!, vehicleNo: pick(vehicles).name, billDate, taxable, gstRate: 15, ...tax, tdsRate: 0, tds: 0, netPayable: r2(taxable + tax.cgst + tax.sgst), description: 'Garage repair', status: k < 2 ? 'approved' : 'paid', paidAt: k < 2 ? null : new Date(billDate.getTime() + 10 * DAY) });
  }

  /* tyres: six fitted on the first eight trucks, a few worn ones */
  let serial = 1;
  for (const v of vehicles.slice(0, 8)) {
    for (const pos of ['FL', 'FR', 'RLO', 'RLI', 'RRI', 'RRO']) {
      const brand = rnd() < 0.5 ? 'Bridgestone' : 'Michelin';
      const nsd = Math.round((2 + rnd() * 13) * 10) / 10;
      const purchase = daysAgo(120 + Math.floor(rnd() * 300));
      const [t] = await db
        .insert(tyres)
        .values({ serial: `KSA${String(serial++).padStart(5, '0')}`, brand, model: brand === 'Bridgestone' ? 'R249' : 'X Multi Z', size: '315/80 R22.5', purchaseCost: brand === 'Bridgestone' ? 1450 : 1650, purchaseDate: purchase, status: 'fitted', vehicleNo: v.name, position: pos, fittedAt: purchase, fittedKm: null, closedKm: Math.round(20000 + rnd() * 90000), originalNsd: 16, lastNsd: nsd, lastNsdAt: daysAgo(Math.floor(rnd() * 20)), targetPressure: 120, lastPressure: Math.round(100 + rnd() * 25) })
        .returning();
      await db.insert(tyreEvents).values([
        { tyreId: t.id, type: 'purchase', cost: t.purchaseCost, nsd: 16, at: purchase },
        { tyreId: t.id, type: 'fit', vehicleNo: v.name, position: pos, nsd: 16, at: purchase },
        { tyreId: t.id, type: 'inspect', vehicleNo: v.name, position: pos, nsd, at: t.lastNsdAt! },
      ]);
    }
  }

  /* statutory documents: registration, insurance, inspection, operating card */
  for (const [i, v] of vehicles.entries()) {
    const ins = 20 + ((i * 37) % 340) - (i % 9 === 4 ? 30 : 0);
    const fahas = 10 + ((i * 53) % 360) - (i % 11 === 6 ? 25 : 0);
    await db.insert(complianceDocs).values([
      { subjectType: 'vehicle', subject: v.name.toUpperCase(), docType: 'rc', docNo: `IST-${700000 + i * 131}`, authority: 'Ministry of Interior (Muroor)', issueDate: ymd(daysAgo(700)), expiryDate: ymd(new Date(Date.now() + (300 + i * 20) * DAY)), description: 'Istimara (vehicle registration)' },
      { subjectType: 'vehicle', subject: v.name.toUpperCase(), docType: 'insurance', docNo: `POL-${880000 + i * 77}`, authority: pick(['Tawuniya', 'Bupa Arabia', 'Walaa Insurance', 'Malath Insurance']), issueDate: ymd(new Date(Date.now() + (ins - 365) * DAY)), expiryDate: ymd(new Date(Date.now() + ins * DAY)), description: 'Comprehensive commercial vehicle cover' },
      { subjectType: 'vehicle', subject: v.name.toUpperCase(), docType: 'fitness', docNo: `FHS-${560000 + i * 91}`, authority: 'MVPI (Fahas)', issueDate: ymd(new Date(Date.now() + (fahas - 365) * DAY)), expiryDate: ymd(new Date(Date.now() + fahas * DAY)), description: 'Periodic technical inspection (Fahas)' },
      ...(i % 6 === 5 ? [] : [{ subjectType: 'vehicle', subject: v.name.toUpperCase(), docType: 'national_permit', docNo: `TGA-${330000 + i * 13}`, authority: 'Transport General Authority', issueDate: ymd(daysAgo(200)), expiryDate: ymd(new Date(Date.now() + (165 + i * 9) * DAY)), description: 'Operating card (Kart Tashgheel)' }]),
    ]);
  }

  /* licences for every tracker */
  for (const [i, v] of vehicles.entries()) {
    const activated = daysAgo(30 + i * 13);
    await db.insert(deviceLicenses).values({ licNo: await no.next('LIC', activated), vehicleNo: v.name.toUpperCase(), deviceId: v.id, imei: v.uniqueId, simOperator: 'Other', simNo: v.phone, plan: i % 5 === 0 ? 'dashcam' : 'standard', activatedOn: ymd(activated), expiresOn: ymd(new Date(activated.getTime() + 365 * DAY)) }).onConflictDoNothing();
  }

  /* safety: an incident with a claim, a resolved SOS, emergency numbers */
  const incVeh = vehicles[3];
  const [inc] = await db.insert(incidents).values({ incNo: await no.next('INC', daysAgo(18)), vehicleNo: incVeh.name, driverName: assigned.get(incVeh.name)?.name ?? null, occurredAt: daysAgo(18), type: 'accident', narrative: 'Rear-ended by a car at the Khurais road junction; rear bumper and lights damaged, no injuries.', location: 'Riyadh–Dammam highway, km 142', severity: 'minor', rsaProvider: 'Najm', rsaStatus: 'completed', repairCost: 4200, status: 'closed', closedAt: daysAgo(10) }).returning();
  await db.insert(insuranceClaims).values({ clmNo: await no.next('CLM', daysAgo(17)), incidentId: inc.id, vehicleNo: incVeh.name, insurer: 'Tawuniya', surveyor: 'Najm assessment', estimatedDamage: 4200, approvedPayout: 3800, settledAmount: 3800, status: 'settled', filedAt: daysAgo(17), settledAt: daysAgo(6) });
  await db.insert(sosIncidents).values({ sosNo: await no.next('SOS', daysAgo(5)), vehicleNo: vehicles[6].name, driverName: assigned.get(vehicles[6].name)?.name ?? null, trigger: 'sos', severity: 'critical', speedKmh: 0, ignition: 'off', latitude: 25.2, longitude: 45.9, address: 'Riyadh–Taif road', status: 'resolved', raisedAt: daysAgo(5), respondedAt: new Date(daysAgo(5).getTime() + 4 * 60_000), responder: 'Control room', resolvedAt: new Date(daysAgo(5).getTime() + 50 * 60_000), resolution: 'Tyre burst; driver safe, roadside assistance changed the tyre.' });
  if (!(await db.select().from(emergencyContacts)).length) await db.insert(emergencyContacts).values(DEFAULT_CONTACTS);

  /* field staff: technicians and collection agents with tasks */
  const staffDefs: [string, string, string][] = [['Hassan Al-Malki', 'technician', 'Riyadh'], ['Waleed Al-Saud', 'collection', 'Riyadh'], ['Arif Rahman', 'technician', 'Dammam'], ['Majed Al-Juhani', 'sales', 'Jeddah']];
  for (const [name, role, city] of staffDefs) {
    const [s] = await db.insert(fieldStaff).values({ name, role, city, team: role === 'technician' ? 'Installation' : role === 'collection' ? 'Collections' : 'Sales', phone: `+9665${Math.floor(10000000 + rnd() * 89999999)}`, monthlyTarget: 60 }).returning();
    for (let d = 20; d >= 0; d--) {
      if (rnd() < 0.4) continue;
      const due = daysAgo(d, 10 + Math.floor(rnd() * 6));
      const doneTask = d > 0 || rnd() < 0.5;
      await db.insert(fieldTasks).values({ ftNo: await no.next('FT', due), staffId: s.id, kind: role === 'technician' ? pick(['installation', 'service']) : role === 'collection' ? 'collection' : 'sales_visit', title: role === 'technician' ? 'Install tracker and dashcam' : role === 'collection' ? 'Collect outstanding invoice' : 'Fleet demo visit', city, dueAt: due, status: doneTask ? 'done' : 'assigned', completedAt: doneTask ? new Date(due.getTime() + (rnd() < 0.8 ? -1 : 1) * 30 * 60_000) : null, amountCollected: role === 'collection' && doneTask ? Math.round(2000 + rnd() * 12000) : null, rating: doneTask ? 4 + Math.round(rnd()) : null, outcome: doneTask ? 'Completed' : null });
    }
  }

  /* opening stock, posted as receipts through the stock engine (serial items get serial numbers) */
  const stock = app.get(StockService);
  const storeRows = await db.select().from(stores);
  for (const it of await db.select().from(items)) {
    const st = storeRows.find((s) => s.code === (it.tags?.includes('tyre') ? 'TY' : 'CD'));
    if (!st) continue;
    const serialised = (await stock.countingMode(db, it.id)).mode === 'serial';
    const qty = serialised ? 6 : Math.round(4 + rnd() * 20);
    await stock.post({ kind: 'receipt', itemId: it.id, storeId: st.id, qty, unitRate: it.rate ?? 0, serials: serialised ? Array.from({ length: qty }, (_, k) => `${it.code}-${String(k + 1).padStart(4, '0')}`) : undefined, refNo: 'Opening (demo)', movedAt: daysAgo(58) }, null);
  }

  console.log(`Demo data loaded: ${tripRows.length} trips, ${invoiceCount} invoices, ${profiles.length} drivers, ${vehicles.length} vehicles' documents and licences.`);
  await app.close();
}

demo().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
