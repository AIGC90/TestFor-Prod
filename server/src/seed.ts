// Seeds ERP reference data for demos. Safe to re-run: existing codes / names are kept.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, eq, isNull } from 'drizzle-orm';
import { AppModule } from './app.module';
import { DB, type Db } from './db/db.module';
import { approvalRules, itemCategories, items, parties, plants, stores } from './db/schema';

const PLANTS = [
  { code: 'PUN', name: 'Pune Central Plant', city: 'Pune', state: 'Maharashtra', gstin: '27AAPFU0939F1ZV' },
  { code: 'NAG', name: 'Nagpur Depot', city: 'Nagpur', state: 'Maharashtra' },
  { code: 'RGD', name: 'Raigad Grinding Unit', city: 'Raigad', state: 'Maharashtra' },
  { code: 'BHW', name: 'Bhiwandi Logistics Hub', city: 'Bhiwandi', state: 'Maharashtra' },
];

const STORES = [
  { code: 'CD', name: 'Central Depot', plant: 'PUN', kind: 'central' },
  { code: 'WS', name: 'Workshop Store', plant: 'PUN', kind: 'workshop' },
  { code: 'TY', name: 'Tyre & Spare Yard', plant: 'BHW', kind: 'tyre' },
] as const;

const PARTIES: { code: string; name: string; kinds: string[]; city?: string; gstin?: string; creditDays?: number }[] = [
  { code: 'C-TATASTEEL', name: 'Tata Steel Ltd', kinds: ['customer'], city: 'Jamshedpur', creditDays: 45 },
  { code: 'C-ULTRATECH', name: 'UltraTech Cement Ltd', kinds: ['customer'], city: 'Mumbai', creditDays: 30 },
  { code: 'C-RELIANCE', name: 'Reliance Industries Logistics', kinds: ['customer'], city: 'Jamnagar', creditDays: 60 },
  { code: 'C-HUL', name: 'Hindustan Unilever (HUL)', kinds: ['customer'], city: 'Mumbai', creditDays: 30 },
  { code: 'V-BREMBO', name: 'Brembo India Automotive Pvt Ltd', kinds: ['vendor'], city: 'Pune' },
  { code: 'V-CASTROL', name: 'Castrol India Industrial Hub', kinds: ['vendor'], city: 'Navi Mumbai' },
  { code: 'V-APOLLO', name: 'Apollo Tyres Regional Logistics', kinds: ['vendor'], city: 'Vadodara' },
  { code: 'V-TELTONIKA', name: 'Teltonika Telematics India', kinds: ['vendor'], city: 'Bengaluru' },
  { code: 'G-PATEL', name: 'Patel Diesel & Turbo Works', kinds: ['garage', 'vendor'], city: 'Pune' },
  { code: 'G-HIGHWAY', name: 'Highway Auto Repairs & Retreading', kinds: ['garage', 'vendor'], city: 'Surat' },
  { code: 'G-GANESH', name: 'Shree Ganesh Spring & Axle Works', kinds: ['garage'], city: 'Jaipur' },
  { code: 'B-PATIL', name: 'Patil Transport & Logistics', kinds: ['broker', 'transporter'], city: 'Pune' },
  { code: 'B-SGFC', name: 'Shree Ganesh Freight Carriers', kinds: ['broker'], city: 'Indore' },
  { code: 'S-SOUTH', name: 'FleetOne Logistics (South) Pvt Ltd', kinds: ['sister_company'], city: 'Chennai' },
  { code: 'X-GMR', name: 'Gujarat Metal Recyclers & Scrap Traders', kinds: ['buyer'], city: 'Ahmedabad' },
];

// [path, settings] - settings flow down to children and items.
const CATEGORIES: [string[], { unit?: string; gstRate?: number; hsn?: string; countingMode?: string }][] = [
  [['Spares & Braking'], { unit: 'pcs', gstRate: 18, hsn: '870830', countingMode: 'standard' }],
  [['Spares & Braking', 'Brake Discs & Rotors'], {}],
  [['Spares & Braking', 'Brake Pads & Liners'], { unit: 'sets' }],
  [['Tyres & Wheels'], { unit: 'pcs', gstRate: 28, hsn: '401120', countingMode: 'serial' }],
  [['Tyres & Wheels', 'Radial Tyres'], {}],
  [['Tyres & Wheels', 'Radial Tyres', '295/80 R22.5'], {}],
  [['Tyres & Wheels', 'Wheel Rims'], { countingMode: 'standard', hsn: '870870' }],
  [['Lubricants & Fluids'], { unit: 'ltr', gstRate: 18, hsn: '271019', countingMode: 'volume' }],
  [['Lubricants & Fluids', 'Engine Oil'], {}],
  [['Lubricants & Fluids', 'Coolants'], {}],
  [['Electrical & Sensors'], { unit: 'pcs', gstRate: 18, hsn: '852692', countingMode: 'serial' }],
  [['Electrical & Sensors', 'GPS Trackers'], {}],
  [['Electrical & Sensors', 'Batteries'], { hsn: '850710' }],
  [['Suspension & Chassis'], { unit: 'pcs', gstRate: 28, hsn: '870880', countingMode: 'standard' }],
  [['Suspension & Chassis', 'Leaf Springs'], { unit: 'sets' }],
];

const ITEMS: { code: string; name: string; category: string[]; partNo?: string; rate: number; reorderLevel?: number; unit?: string; tags?: string[] }[] = [
  { code: 'BRK-OEM-01', name: 'Front Brake Disc Rotor 430mm', category: ['Spares & Braking', 'Brake Discs & Rotors'], partNo: 'BRK-2240', rate: 4800, reorderLevel: 10 },
  { code: 'BRK-LIN-88', name: 'Heavy Duty Brake Liner Set', category: ['Spares & Braking', 'Brake Pads & Liners'], partNo: 'BRK-7701', rate: 1800, reorderLevel: 20 },
  { code: 'BRK-SLK-10', name: 'Slack Adjuster Auto (WABCO compatible)', category: ['Spares & Braking'], partNo: 'BRK-1090', rate: 2650, reorderLevel: 6 },
  { code: 'TYR-AP-295', name: 'Apollo EnduRace RD Radial 295/80 R22.5', category: ['Tyres & Wheels', 'Radial Tyres', '295/80 R22.5'], partNo: 'TYR-9901', rate: 26000, reorderLevel: 15, tags: ['tyre'] },
  { code: 'TYR-MRF-295', name: 'MRF Steel Muscle 295/80 R22.5', category: ['Tyres & Wheels', 'Radial Tyres', '295/80 R22.5'], rate: 26500, reorderLevel: 10, tags: ['tyre'] },
  { code: 'WHL-3310', name: 'Wheel Rim 8.25x22.5 Heavy Duty', category: ['Tyres & Wheels', 'Wheel Rims'], rate: 7200, reorderLevel: 4 },
  { code: 'LUB-CAS-210', name: 'Castrol CRB Turbomax 15W-40 CI-4 (210L drum)', category: ['Lubricants & Fluids', 'Engine Oil'], partNo: 'OIL-5020', rate: 49500, unit: 'drums', reorderLevel: 3 },
  { code: 'LUB-3301', name: 'Coolant Long Life Concentrate (20L)', category: ['Lubricants & Fluids', 'Coolants'], rate: 3200, unit: 'pails', reorderLevel: 5 },
  { code: 'ELE-FMB920', name: 'AIS-140 4G GPS Tracker FMB920', category: ['Electrical & Sensors', 'GPS Trackers'], partNo: 'TEL-FMB920', rate: 5400, reorderLevel: 10, tags: ['gps'] },
  { code: 'ELE-DCAM-2', name: 'AI Dual Dashcam (ADAS + DMS)', category: ['Electrical & Sensors'], rate: 18500, reorderLevel: 2, tags: ['dashcam'] },
  { code: 'ELE-8812', name: 'Heavy Duty Battery 12V 150Ah', category: ['Electrical & Sensors', 'Batteries'], rate: 11800, reorderLevel: 4 },
  { code: 'SUS-LS-04', name: 'Rear Helper Leaf Spring Set', category: ['Suspension & Chassis', 'Leaf Springs'], rate: 9400, reorderLevel: 2 },
];

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get<Db>(DB);

  await db.insert(plants).values(PLANTS).onConflictDoNothing();
  const plantId = new Map((await db.select().from(plants)).map((p) => [p.code, p.id]));
  await db
    .insert(stores)
    .values(STORES.map((s) => ({ code: s.code, name: s.name, kind: s.kind, plantId: plantId.get(s.plant) ?? null })))
    .onConflictDoNothing();
  await db.insert(parties).values(PARTIES).onConflictDoNothing();

  const categoryIds = new Map<string, number>();
  for (const [path, settings] of CATEGORIES) {
    const parentId = path.length > 1 ? categoryIds.get(path.slice(0, -1).join('>'))! : null;
    const name = path[path.length - 1];
    const [existing] = await db
      .select()
      .from(itemCategories)
      .where(and(eq(itemCategories.name, name), parentId ? eq(itemCategories.parentId, parentId) : isNull(itemCategories.parentId)));
    const id = existing?.id ?? (await db.insert(itemCategories).values({ name, parentId, level: path.length, ...settings }).returning())[0].id;
    categoryIds.set(path.join('>'), id);
  }
  await db
    .insert(items)
    .values(ITEMS.map(({ category, ...i }) => ({ ...i, tags: i.tags ?? [], categoryId: categoryIds.get(category.join('>'))! })))
    .onConflictDoNothing();

  // Default approval routing; admins tune it on the Pending Inbox > Rules tab.
  await db
    .insert(approvalRules)
    .values([
      { docType: 'job_card', minAmount: 25000, approverRole: 'workshop_manager' },
      { docType: 'gate_pass', minAmount: 0, approverRole: 'workshop_manager' },
      { docType: 'repair_bill', minAmount: 10000, approverRole: 'accountant' },
      { docType: 'stock_request', minAmount: 0, approverRole: 'storekeeper' },
      { docType: 'fuel_indent', minAmount: 0, approverRole: 'fleet_supervisor' },
      { docType: 'stock_sale', minAmount: 0, approverRole: 'accountant' },
      { docType: 'driver_charge', minAmount: 2000, approverRole: 'fleet_supervisor' },
    ])
    .onConflictDoNothing();

  await app.close();
  console.log(`ERP seed complete: ${PLANTS.length} plants, ${STORES.length} stores, ${PARTIES.length} partners, ${CATEGORIES.length} categories, ${ITEMS.length} items`);
}
seed();
