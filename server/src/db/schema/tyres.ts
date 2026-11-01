import { sql } from 'drizzle-orm';
import { integer, jsonb, numeric, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const km = (name: string) => numeric(name, { precision: 12, scale: 1, mode: 'number' });
const mm = (name: string) => numeric(name, { precision: 5, scale: 1, mode: 'number' });
const ts = (name: string) => timestamp(name, { withTimezone: true });

/** One tyre casing, tracked by serial for its whole life. */
export const tyres = pgTable('tyres', {
  id: serial('id').primaryKey(),
  serial: text('serial').notNull().unique(),
  brand: text('brand').notNull(),
  model: text('model'),
  size: text('size').notNull(),
  tyreType: text('tyre_type').notNull().default('radial'), // radial | bias
  purchaseCost: money('purchase_cost').notNull().default(0),
  purchaseDate: ts('purchase_date'),
  vendorId: integer('vendor_id'),
  status: text('status').notNull().default('in_store'), // in_store | fitted | at_retreader | scrapped | sold
  vehicleNo: text('vehicle_no'),
  position: text('position'),
  fittedAt: ts('fitted_at'),
  fittedKm: km('fitted_km'),
  /** Km run in earlier fitments; current fitment km comes from the GPS odometer. */
  closedKm: km('closed_km').notNull().default(0),
  originalNsd: mm('original_nsd').notNull().default(16),
  lastNsd: mm('last_nsd'),
  lastNsdAt: ts('last_nsd_at'),
  targetPressure: numeric('target_pressure', { precision: 5, scale: 1, mode: 'number' }),
  lastPressure: numeric('last_pressure', { precision: 5, scale: 1, mode: 'number' }),
  retreadCount: integer('retread_count').notNull().default(0),
  /** Retreads and repairs spent on this casing. */
  upkeepCost: money('upkeep_cost').notNull().default(0),
  notes: text('notes'),
  createdBy: integer('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Audit trail for every tyre: fitments, removals, inspections, rotations, retreads, scrap. */
export const tyreEvents = pgTable('tyre_events', {
  id: serial('id').primaryKey(),
  tyreId: integer('tyre_id').notNull().references(() => tyres.id),
  type: text('type').notNull(), // purchase | fit | remove | inspect | rotate | retread_out | retread_in | repair | scrap | sale
  vehicleNo: text('vehicle_no'),
  position: text('position'),
  toVehicleNo: text('to_vehicle_no'),
  toPosition: text('to_position'),
  odometerKm: km('odometer_km'),
  nsd: mm('nsd'),
  pressure: numeric('pressure', { precision: 5, scale: 1, mode: 'number' }),
  cost: money('cost'),
  technician: text('technician'),
  refNo: text('ref_no'),
  remarks: text('remarks'),
  at: ts('at').notNull().defaultNow(),
  createdBy: integer('created_by'),
});

/** Wheel layout per vehicle (which positions exist). */
export const tyreLayouts = pgTable('tyre_layouts', {
  vehicleNo: text('vehicle_no').primaryKey(),
  layout: text('layout').notNull(),
  positions: text('positions').array().notNull().default(sql`'{}'::text[]`),
});

export interface InterchangeLine {
  tyreId: number;
  serial: string;
  fromVehicleNo: string;
  fromPosition: string;
  toVehicleNo: string;
  toPosition: string;
}

/** Rotations within a vehicle and swaps between vehicles (no stock impact). */
export const tyreInterchanges = pgTable('tyre_interchanges', {
  id: serial('id').primaryKey(),
  tiNo: text('ti_no').notNull().unique(),
  kind: text('kind').notNull(), // rotation | cross
  lines: jsonb('lines').$type<InterchangeLine[]>().notNull(),
  remarks: text('remarks'),
  at: ts('at').notNull().defaultNow(),
  createdBy: integer('created_by'),
});
