import { BadRequestException } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { complaints, freightMemos, fuelIndents, incomingVehicles, lorryReceipts, materialReturns, orders, parties, tariffs, trips } from '../db/schema';
import { ApprovalsService } from '../erp/approvals.service';
import { type CrudContext, crudController } from '../erp/crud';
import { PAN, pattern, requiredText, text } from '../erp/zod-helpers';

const id = z.coerce.number().int().positive();
const optId = id.nullish().transform((v) => v ?? null);
const optNum = z.coerce.number().min(0).nullish().transform((v) => (v === undefined ? null : v));
/** Optional date: blank/null stays null (coercing null would give 1 Jan 1970). */
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullish()).transform((v) => v ?? null);
/** Required-ish date where blank means now. */
const dateOrNow = z.preprocess((v) => (v === null || v === '' ? undefined : v), z.coerce.date().optional());
const vehicle = z.string().trim().toUpperCase().min(4, 'enter the vehicle number').max(20);
const phone = z.string().trim().regex(/^\+?[0-9 -]{8,16}$/, 'enter a valid mobile number');
const r2 = (n: number) => Math.round(n * 100) / 100;

async function requireParty(ctx: CrudContext, partyId: unknown, kind: string, field: string) {
  const [p] = await ctx.db.select().from(parties).where(eq(parties.id, Number(partyId)));
  if (!p || !p.kinds.includes(kind)) throw new BadRequestException(`${field}: choose a ${kind.replace('_', ' ')}`);
}

/* ----------------------------------------------------------------- orders */

export function orderValue(o: { rateBasis?: unknown; rate?: unknown; weightT?: unknown; distanceKm?: unknown }) {
  const rate = Number(o.rate ?? 0);
  const w = Number(o.weightT ?? 0);
  const d = Number(o.distanceKm ?? 0);
  if (o.rateBasis === 'per_tonne_km') return r2(rate * w * d);
  if (o.rateBasis === 'per_tonne') return r2(rate * w);
  return r2(rate);
}

export const OrdersController = crudController({
  path: 'ops/orders',
  docType: 'order',
  table: orders,
  searchColumns: [orders.orderNo, orders.origin, orders.destination, orders.material, orders.consignee],
  filters: { status: orders.status, billingStatus: orders.billingStatus, customerId: orders.customerId },
  orderBy: [desc(orders.bookedOn), desc(orders.id)],
  numbering: { prefix: 'ORD', column: 'orderNo' },
  schema: z.object({
    bookedOn: dateOrNow,
    customerId: id,
    consignee: text(200),
    origin: requiredText(),
    destination: requiredText(),
    material: text(200),
    weightT: optNum,
    distanceKm: optNum,
    rateBasis: z.enum(['per_tonne_km', 'per_tonne', 'fixed']).default('fixed'),
    rate: z.coerce.number().min(0).default(0),
    status: z.enum(['booked', 'dispatched', 'in_transit', 'delivered', 'cancelled']).default('booked'),
    billingStatus: z.enum(['pending', 'advance_received', 'invoiced', 'paid']).default('pending'),
    notes: text(1000),
  }),
  beforeCreate: async (input, ctx) => {
    await requireParty(ctx, input.customerId, 'customer', 'customerId');
    return { ...input, value: orderValue(input) };
  },
  beforeUpdate: (input, existing) => ({ ...input, value: orderValue({ ...existing, ...input }) }),
});

export const TariffsController = crudController({
  path: 'ops/tariffs',
  docType: 'order',
  table: tariffs,
  searchColumns: [tariffs.cargoCategory, tariffs.notes],
  filters: { customerId: tariffs.customerId },
  orderBy: [desc(tariffs.id)],
  schema: z.object({
    customerId: id,
    cargoCategory: requiredText(),
    basis: z.enum(['per_tonne_km', 'per_tonne', 'fixed']),
    rate: z.coerce.number().min(0),
    detentionPerDay: optNum,
    creditDays: z.coerce.number().int().min(0).max(365).nullish(),
    minTonnage: optNum,
    validFrom: optDate,
    validTo: optDate,
    notes: text(1000),
  }),
  beforeCreate: async (input, ctx) => {
    await requireParty(ctx, input.customerId, 'customer', 'customerId');
    return input;
  },
});

export const ComplaintsController = crudController({
  path: 'ops/complaints',
  docType: 'order',
  table: complaints,
  searchColumns: [complaints.ticketNo, complaints.category, complaints.description],
  filters: { status: complaints.status, priority: complaints.priority, customerId: complaints.customerId },
  orderBy: [desc(complaints.id)],
  numbering: { prefix: 'TKT', column: 'ticketNo' },
  schema: z.object({
    customerId: id,
    orderId: optId,
    category: requiredText(100),
    description: requiredText(2000),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).default('open'),
    resolution: text(2000),
  }),
});

/* ------------------------------------------------------------------ trips */

export const TripsController = crudController({
  path: 'ops/trips',
  docType: 'trip',
  table: trips,
  searchColumns: [trips.tripNo, trips.vehicleNo, trips.driverName, trips.origin, trips.destination, trips.lrNo, trips.material],
  filters: { status: trips.status, customerId: trips.customerId, deviceId: trips.deviceId },
  orderBy: [desc(trips.id)],
  numbering: { prefix: 'TRP', column: 'tripNo' },
  schema: z.object({
    orderId: optId,
    customerId: optId,
    deviceId: optId,
    vehicleNo: vehicle,
    driverName: requiredText(100),
    driverPhone: phone,
    origin: requiredText(),
    destination: requiredText(),
    destGeofenceId: optId,
    corridor: text(200),
    plannedKm: optNum,
    material: text(200),
    weightT: optNum,
    freight: optNum,
    driverAdvance: optNum,
    lrNo: text(40),
    scheduledAt: optDate,
    plannedArrival: optDate,
    exceptionNote: text(500),
  }),
  beforeUpdate: (input, existing) => {
    if (existing.status === 'completed' || existing.status === 'cancelled') throw new BadRequestException(`A ${existing.status} trip cannot be edited`);
    return input;
  },
  afterWrite: async (row, { db }, op) => {
    if (op === 'create' && row.orderId) {
      await db.update(orders).set({ tripId: row.id as number, status: 'dispatched', updatedAt: new Date() }).where(eq(orders.id, row.orderId as number));
    }
  },
  canDelete: (row) => (row.status === 'scheduled' || row.status === 'cancelled' ? null : `A ${row.status} trip cannot be deleted; cancel it instead`),
});

/* ------------------------------------------------------- lorry receipts */

export const lrSchema = z.object({
  lrNo: z.string().trim().toUpperCase().min(1).max(40).optional(),
  plantId: optId,
  loadingDate: optDate,
  vehicleNo: vehicle,
  fleetType: z.enum(['own', 'market']).default('own'),
  product: text(200),
  consignor: text(200),
  consignee: text(200),
  fromPlace: text(120),
  toPlace: text(120),
  chargedWeight: optNum,
  qty: optNum,
  invoiceNo: text(60),
  ewayBillNo: z.preprocess((v) => (v === '' ? null : v), z.string().trim().regex(/^\d{12}$/, 'E-Way bill number has 12 digits').nullish()).transform((v) => v ?? null),
  ewayExpiry: optDate,
  deliveryNo: text(60),
  driverName: text(100),
  driverContact: text(30),
  ownerName: text(200),
  ownerPan: pattern(PAN, 'PAN'),
  brokerName: text(200),
  brokerPan: pattern(PAN, 'PAN'),
  freightType: text(60),
  rate: optNum,
  advance: optNum,
  status: z.enum(['generated', 'loaded', 'in_transit', 'delivered', 'cancelled']).default('generated'),
  remarks: text(1000),
  extra: z.record(z.string(), z.string().max(500)).default({}),
});

export const LorryReceiptsController = crudController({
  path: 'ops/lrs',
  docType: 'lr',
  table: lorryReceipts,
  searchColumns: [lorryReceipts.lrNo, lorryReceipts.vehicleNo, lorryReceipts.consignor, lorryReceipts.consignee, lorryReceipts.invoiceNo, lorryReceipts.ewayBillNo, lorryReceipts.product],
  filters: { status: lorryReceipts.status, plantId: lorryReceipts.plantId, fleetType: lorryReceipts.fleetType, vehicleNo: lorryReceipts.vehicleNo },
  orderBy: [desc(lorryReceipts.loadingDate), desc(lorryReceipts.id)],
  numbering: { prefix: 'LR', column: 'lrNo' },
  schema: lrSchema,
});

/* --------------------------------------------------------- freight memos */

export function memoTotals(m: { rateBasis?: unknown; rate?: unknown; weightMt?: unknown; totalFreight?: unknown; advance?: unknown; commission?: unknown; tds?: unknown }) {
  const total = m.rateBasis === 'per_mt' ? r2(Number(m.rate ?? 0) * Number(m.weightMt ?? 0)) : r2(Number(m.totalFreight ?? m.rate ?? 0));
  const balance = r2(total - Number(m.advance ?? 0) - Number(m.commission ?? 0) - Number(m.tds ?? 0));
  if (balance < 0) throw new BadRequestException('Advance, commission and TDS exceed the total freight');
  return { totalFreight: total, balance };
}

export const FreightMemosController = crudController({
  path: 'ops/freight-memos',
  docType: 'freight_memo',
  table: freightMemos,
  searchColumns: [freightMemos.memoNo, freightMemos.vehicleNo, freightMemos.origin, freightMemos.destination, freightMemos.material],
  filters: { status: freightMemos.status, brokerId: freightMemos.brokerId, vehicleNo: freightMemos.vehicleNo },
  orderBy: [desc(freightMemos.memoDate), desc(freightMemos.id)],
  numbering: { prefix: 'FM', column: 'memoNo' },
  schema: z.object({
    memoDate: dateOrNow,
    vehicleNo: vehicle,
    driverName: text(100),
    driverPhone: text(30),
    brokerId: id,
    origin: text(120),
    destination: text(120),
    material: text(200),
    weightMt: optNum,
    rateBasis: z.enum(['fixed', 'per_mt']).default('fixed'),
    rate: z.coerce.number().min(0).default(0),
    totalFreight: optNum,
    advance: z.coerce.number().min(0).default(0),
    advanceMode: text(40),
    commission: z.coerce.number().min(0).default(0),
    tds: z.coerce.number().min(0).default(0),
    lrNos: z.array(z.string().trim().toUpperCase().max(40)).max(50).default([]),
    status: z.enum(['issued', 'loaded', 'in_transit', 'settled']).default('issued'),
    remarks: text(1000),
  }),
  beforeCreate: async (input, ctx) => {
    await requireParty(ctx, input.brokerId, 'broker', 'brokerId');
    return { ...input, ...memoTotals(input) };
  },
  beforeUpdate: (input, existing) => {
    if (existing.status === 'settled' && input.status !== 'settled') throw new BadRequestException('A settled memo cannot be changed');
    return { ...input, ...memoTotals({ ...existing, ...input, totalFreight: input.totalFreight ?? (existing.rateBasis === 'fixed' ? existing.totalFreight : undefined) }) };
  },
});

/* ----------------------------------------------------------- fuel indents */

export const FuelIndentsController = crudController({
  path: 'ops/fuel-indents',
  docType: 'fuel_indent',
  table: fuelIndents,
  searchColumns: [fuelIndents.indentNo, fuelIndents.vehicleNo, fuelIndents.driverName, fuelIndents.pump, fuelIndents.lrNo],
  filters: { status: fuelIndents.status, vehicleNo: fuelIndents.vehicleNo },
  orderBy: [desc(fuelIndents.indentDate), desc(fuelIndents.id)],
  numbering: { prefix: 'IND', column: 'indentNo' },
  schema: z
    .object({
      vehicleNo: vehicle,
      lrNo: text(40),
      isEquipment: z.boolean().default(false),
      driverName: text(100),
      driverMobile: z.preprocess((v) => (v === '' ? null : v), phone.nullish()).transform((v) => v ?? null),
      pump: requiredText(120),
      indentDate: dateOrNow,
      amount: z.coerce.number().positive('enter an amount'),
      rate: optNum,
    }),
  beforeCreate: (input) => {
    if (!input.isEquipment && (!input.driverName || !input.driverMobile)) {
      throw new BadRequestException('Driver name and mobile are required unless the vehicle is equipment');
    }
    const litres = input.rate ? Math.round((Number(input.amount) / Number(input.rate)) * 100) / 100 : null;
    return { ...input, litres, status: 'pending_approval' };
  },
  beforeUpdate: (input, existing) => {
    if (existing.status !== 'pending_approval' && existing.status !== 'rejected') throw new BadRequestException(`An ${existing.status} indent cannot be edited`);
    const merged = { ...existing, ...input };
    const litres = merged.rate ? Math.round((Number(merged.amount) / Number(merged.rate)) * 100) / 100 : null;
    return { ...input, litres };
  },
  // Every new indent goes to approval (or is approved at once when no rule applies).
  afterWrite: async (row, ctx, op) => {
    if (op !== 'create') return;
    const approval = await ctx.get(ApprovalsService).submit(ctx.user, {
      docType: 'fuel_indent',
      docId: row.id as number,
      docNo: row.indentNo as string,
      title: `Fuel for ${row.vehicleNo}`,
      summary: `${row.pump}${row.litres ? ` · ${row.litres} L` : ''}`,
      amount: row.amount as number,
      meta: { vehicle: row.vehicleNo as string, link: '/fuel-indents' },
    });
    if (!approval) {
      await ctx.db.update(fuelIndents).set({ status: 'approved' }).where(eq(fuelIndents.id, row.id as number));
      row.status = 'approved';
    }
  },
  canDelete: (row) => (row.status === 'approved' ? 'An approved indent cannot be deleted' : null),
});

/* ------------------------------------------------------ incoming vehicles */

export const IncomingVehiclesController = crudController({
  path: 'ops/incoming',
  docType: 'incoming_vehicle',
  table: incomingVehicles,
  searchColumns: [incomingVehicles.vehicleNo, incomingVehicles.vendorName, incomingVehicles.doNo, incomingVehicles.driverName, incomingVehicles.material],
  filters: { status: incomingVehicles.status, plantId: incomingVehicles.plantId },
  orderBy: [asc(incomingVehicles.sentAt)],
  schema: z.object({
    vehicleNo: vehicle,
    plantId: id,
    vendorName: text(200),
    doNo: text(60),
    driverName: text(100),
    driverPhone: text(30),
    material: text(200),
    weightMt: optNum,
    sentAt: dateOrNow,
    status: z.enum(['in_transit', 'approaching', 'at_gate', 'arrived', 'received']).default('in_transit'),
  }),
  beforeUpdate: (input, existing) => {
    if (existing.status === 'received') throw new BadRequestException('A received vehicle cannot be changed');
    return input.status === 'received' ? { ...input, receivedAt: new Date() } : input;
  },
});

/* ------------------------------------------------------- material returns */

export const MaterialReturnsController = crudController({
  path: 'ops/returns',
  docType: 'material_return',
  table: materialReturns,
  searchColumns: [materialReturns.returnNo, materialReturns.vehicleNo, materialReturns.lrNo, materialReturns.indentNo],
  filters: { storeId: materialReturns.storeId, vehicleNo: materialReturns.vehicleNo },
  orderBy: [desc(materialReturns.returnDate), desc(materialReturns.id)],
  // created through POST /ops/returns/receive so the stock posts in the same transaction
  schema: z.object({}),
  beforeCreate: () => {
    throw new BadRequestException('Use POST /erp/ops/returns/receive');
  },
  beforeUpdate: () => {
    throw new BadRequestException('A received return cannot be changed; record an adjustment instead');
  },
  canDelete: () => 'A received return cannot be deleted; record an adjustment instead',
});
