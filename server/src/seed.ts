// Seeds ERP reference data for demos. Safe to re-run: existing codes / names are kept.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, eq, isNull } from 'drizzle-orm';
import { AppModule } from './app.module';
import { DB, type Db } from './db/db.module';
import { approvalRules, itemCategories, items, parties, plants, stores } from './db/schema';

const PLANTS = [
  { code: 'RUH', name: 'Riyadh Central Depot', city: 'Riyadh', state: 'Riyadh Region' },
  { code: 'DMM', name: 'Dammam Port Yard', city: 'Dammam', state: 'Eastern Province' },
  { code: 'JED', name: 'Jeddah Logistics Hub', city: 'Jeddah', state: 'Makkah Region' },
  { code: 'JUB', name: 'Jubail Workshop', city: 'Jubail', state: 'Eastern Province' },
];

const STORES = [
  { code: 'CD', name: 'Central Depot', plant: 'RUH', kind: 'central' },
  { code: 'WS', name: 'Workshop Store', plant: 'JUB', kind: 'workshop' },
  { code: 'TY', name: 'Tyre & Spare Yard', plant: 'DMM', kind: 'tyre' },
] as const;

// Fictional Saudi companies for demos.
const PARTIES: { code: string; name: string; kinds: string[]; city?: string; state?: string; creditDays?: number }[] = [
  { code: 'C-NAJDCEM', name: 'Najd Cement Company', kinds: ['customer'], city: 'Riyadh', creditDays: 45 },
  { code: 'C-REDSEA', name: 'Red Sea Steel Industries', kinds: ['customer'], city: 'Jeddah', creditDays: 30 },
  { code: 'C-EASTPET', name: 'Eastern Petrochemical Supplies', kinds: ['customer'], city: 'Jubail', creditDays: 60 },
  { code: 'C-WAHA', name: 'Al Waha Food Distribution', kinds: ['customer'], city: 'Dammam', creditDays: 30 },
  { code: 'V-JAZPARTS', name: 'Al Jazirah Auto Parts Trading', kinds: ['vendor'], city: 'Riyadh' },
  { code: 'V-GULFLUBE', name: 'Gulf Lubricants Co.', kinds: ['vendor'], city: 'Dammam' },
  { code: 'V-ARABTYRE', name: 'Arabian Tyre Distributors', kinds: ['vendor'], city: 'Jeddah' },
  { code: 'V-SMARTTRK', name: 'Smart Track Telematics KSA', kinds: ['vendor'], city: 'Riyadh' },
  { code: 'G-FAISALIAH', name: 'Al Faisaliah Diesel Workshop', kinds: ['garage', 'vendor'], city: 'Riyadh' },
  { code: 'G-HIGHWAY', name: 'Highway Truck Service Centre', kinds: ['garage', 'vendor'], city: 'Dammam' },
  { code: 'G-MADINAH', name: 'Al Madinah Spring & Axle Works', kinds: ['garage'], city: 'Madinah' },
  { code: 'B-SAHARA', name: 'Sahara Transport & Logistics', kinds: ['broker', 'transporter'], city: 'Riyadh' },
  { code: 'B-QASSIM', name: 'Qassim Freight Carriers', kinds: ['broker'], city: 'Buraidah' },
  { code: 'S-WEST', name: 'FleetOne Logistics (Western Region)', kinds: ['sister_company'], city: 'Jeddah' },
  { code: 'X-GULFMET', name: 'Gulf Metal Recycling Est.', kinds: ['buyer'], city: 'Dammam' },
];

// [path, settings] - settings flow down to children and items.
const CATEGORIES: [string[], { unit?: string; gstRate?: number; hsn?: string; countingMode?: string }][] = [
  [['Spares & Braking'], { unit: 'pcs', gstRate: 18, hsn: '870830', countingMode: 'standard' }],
  [['Spares & Braking', 'Brake Discs & Rotors'], {}],
  [['Spares & Braking', 'Brake Pads & Liners'], { unit: 'sets' }],
  [['Tyres & Wheels'], { unit: 'pcs', gstRate: 28, hsn: '401120', countingMode: 'serial' }],
  [['Tyres & Wheels', 'Radial Tyres'], {}],
  [['Tyres & Wheels', 'Radial Tyres', '315/80 R22.5'], {}],
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

// Prices in SAR.
const ITEMS: { code: string; name: string; category: string[]; partNo?: string; rate: number; reorderLevel?: number; unit?: string; tags?: string[] }[] = [
  { code: 'BRK-OEM-01', name: 'Front Brake Disc Rotor 430mm', category: ['Spares & Braking', 'Brake Discs & Rotors'], partNo: 'BRK-2240', rate: 950, reorderLevel: 10 },
  { code: 'BRK-LIN-88', name: 'Heavy Duty Brake Liner Set', category: ['Spares & Braking', 'Brake Pads & Liners'], partNo: 'BRK-7701', rate: 320, reorderLevel: 20 },
  { code: 'BRK-SLK-10', name: 'Slack Adjuster Auto (WABCO compatible)', category: ['Spares & Braking'], partNo: 'BRK-1090', rate: 480, reorderLevel: 6 },
  { code: 'TYR-BS-315', name: 'Bridgestone R249 315/80 R22.5', category: ['Tyres & Wheels', 'Radial Tyres', '315/80 R22.5'], partNo: 'TYR-9901', rate: 1450, reorderLevel: 15, tags: ['tyre'] },
  { code: 'TYR-MI-315', name: 'Michelin X Multi Z 315/80 R22.5', category: ['Tyres & Wheels', 'Radial Tyres', '315/80 R22.5'], rate: 1650, reorderLevel: 10, tags: ['tyre'] },
  { code: 'WHL-3310', name: 'Wheel Rim 9.00x22.5 Heavy Duty', category: ['Tyres & Wheels', 'Wheel Rims'], rate: 520, reorderLevel: 4 },
  { code: 'LUB-RIM-208', name: 'Shell Rimula R4 X 15W-40 (209L drum)', category: ['Lubricants & Fluids', 'Engine Oil'], partNo: 'OIL-5020', rate: 3900, unit: 'drums', reorderLevel: 3 },
  { code: 'LUB-3301', name: 'Coolant Long Life Concentrate (20L)', category: ['Lubricants & Fluids', 'Coolants'], rate: 190, unit: 'pails', reorderLevel: 5 },
  { code: 'ELE-FMB920', name: '4G GPS Tracker FMB920', category: ['Electrical & Sensors', 'GPS Trackers'], partNo: 'TEL-FMB920', rate: 320, reorderLevel: 10, tags: ['gps'] },
  { code: 'ELE-DCAM-2', name: 'AI Dual Dashcam (ADAS + DMS)', category: ['Electrical & Sensors'], rate: 1100, reorderLevel: 2, tags: ['dashcam'] },
  { code: 'ELE-8812', name: 'Heavy Duty Battery 12V 150Ah', category: ['Electrical & Sensors', 'Batteries'], rate: 650, reorderLevel: 4 },
  { code: 'SUS-LS-04', name: 'Rear Helper Leaf Spring Set', category: ['Suspension & Chassis', 'Leaf Springs'], rate: 780, reorderLevel: 2 },
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
      { docType: 'job_card', minAmount: 5000, approverRole: 'workshop_manager' },
      { docType: 'gate_pass', minAmount: 0, approverRole: 'workshop_manager' },
      { docType: 'repair_bill', minAmount: 2000, approverRole: 'accountant' },
      { docType: 'stock_request', minAmount: 0, approverRole: 'storekeeper' },
      { docType: 'fuel_indent', minAmount: 0, approverRole: 'fleet_supervisor' },
      { docType: 'stock_sale', minAmount: 0, approverRole: 'accountant' },
      { docType: 'driver_charge', minAmount: 300, approverRole: 'fleet_supervisor' },
      { docType: 'payroll', minAmount: 0, approverRole: 'accountant' },
      { docType: 'expense_claim', minAmount: 200, approverRole: 'fleet_supervisor' },
    ])
    .onConflictDoNothing();

  await app.close();
  console.log(`ERP seed complete: ${PLANTS.length} plants, ${STORES.length} stores, ${PARTIES.length} partners, ${CATEGORIES.length} categories, ${ITEMS.length} items`);
}
seed();
