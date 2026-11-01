import { sql } from 'drizzle-orm';
import { boolean, integer, jsonb, numeric, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { plants, stores } from './erp';

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const qty = (name: string) => numeric(name, { precision: 12, scale: 3, mode: 'number' });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const docAudit = {
  createdBy: integer('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

/** Freight orders booked by customers. */
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  orderNo: text('order_no').notNull().unique(),
  bookedOn: ts('booked_on').notNull().defaultNow(),
  customerId: integer('customer_id').notNull(),
  consignee: text('consignee'),
  origin: text('origin').notNull(),
  destination: text('destination').notNull(),
  material: text('material'),
  weightT: qty('weight_t'),
  distanceKm: qty('distance_km'),
  rateBasis: text('rate_basis').notNull().default('fixed'), // per_tonne_km | per_tonne | fixed
  rate: money('rate').notNull().default(0),
  value: money('value').notNull().default(0),
  status: text('status').notNull().default('booked'), // booked | dispatched | in_transit | delivered | cancelled
  billingStatus: text('billing_status').notNull().default('pending'), // pending | advance_received | invoiced | paid
  tripId: integer('trip_id'),
  notes: text('notes'),
  ...docAudit,
});

/** Contracted rates per customer and cargo. */
export const tariffs = pgTable('tariffs', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  cargoCategory: text('cargo_category').notNull(),
  basis: text('basis').notNull(), // per_tonne_km | per_tonne | fixed
  rate: money('rate').notNull(),
  detentionPerDay: money('detention_per_day'),
  creditDays: integer('credit_days'),
  minTonnage: qty('min_tonnage'),
  validFrom: ts('valid_from'),
  validTo: ts('valid_to'),
  notes: text('notes'),
  ...docAudit,
});

/** Customer service requests and transit exceptions. */
export const complaints = pgTable('complaints', {
  id: serial('id').primaryKey(),
  ticketNo: text('ticket_no').notNull().unique(),
  customerId: integer('customer_id').notNull(),
  orderId: integer('order_id'),
  category: text('category').notNull(),
  description: text('description').notNull(),
  priority: text('priority').notNull().default('medium'), // low | medium | high
  status: text('status').notNull().default('open'), // open | in_progress | resolved | closed
  resolution: text('resolution'),
  ...docAudit,
});

/** A vehicle journey for an order, tracked live through Traccar. */
export const trips = pgTable('trips', {
  id: serial('id').primaryKey(),
  tripNo: text('trip_no').notNull().unique(),
  orderId: integer('order_id'),
  customerId: integer('customer_id'),
  deviceId: integer('device_id'), // Traccar device
  vehicleNo: text('vehicle_no').notNull(),
  driverName: text('driver_name').notNull(),
  driverPhone: text('driver_phone').notNull(),
  origin: text('origin').notNull(),
  destination: text('destination').notNull(),
  destGeofenceId: integer('dest_geofence_id'),
  corridor: text('corridor'),
  plannedKm: qty('planned_km'),
  material: text('material'),
  weightT: qty('weight_t'),
  freight: money('freight'),
  driverAdvance: money('driver_advance'),
  lrNo: text('lr_no'),
  scheduledAt: ts('scheduled_at'),
  plannedArrival: ts('planned_arrival'),
  status: text('status').notNull().default('scheduled'), // scheduled | in_transit | arrived | completed | cancelled
  startedAt: ts('started_at'),
  startOdometerM: numeric('start_odometer_m', { precision: 14, scale: 1, mode: 'number' }),
  arrivedAt: ts('arrived_at'),
  completedAt: ts('completed_at'),
  exceptionNote: text('exception_note'),
  podStatus: text('pod_status').notNull().default('pending'), // pending | verified
  podReceivedBy: text('pod_received_by'),
  podRemarks: text('pod_remarks'),
  podAt: ts('pod_at'),
  ...docAudit,
});

/** Lorry receipts (consignment notes); the loading sheet is the bulk view of these rows. */
export const lorryReceipts = pgTable('lorry_receipts', {
  id: serial('id').primaryKey(),
  lrNo: text('lr_no').notNull().unique(),
  plantId: integer('plant_id').references(() => plants.id),
  loadingDate: ts('loading_date'),
  vehicleNo: text('vehicle_no').notNull(),
  fleetType: text('fleet_type').notNull().default('own'), // own | market
  product: text('product'),
  consignor: text('consignor'),
  consignee: text('consignee'),
  fromPlace: text('from_place'),
  toPlace: text('to_place'),
  chargedWeight: qty('charged_weight'),
  qty: qty('qty'),
  invoiceNo: text('invoice_no'),
  ewayBillNo: text('eway_bill_no'),
  ewayExpiry: ts('eway_expiry'),
  deliveryNo: text('delivery_no'),
  driverName: text('driver_name'),
  driverContact: text('driver_contact'),
  ownerName: text('owner_name'),
  ownerPan: text('owner_pan'),
  brokerName: text('broker_name'),
  brokerPan: text('broker_pan'),
  freightType: text('freight_type'),
  rate: money('rate'),
  advance: money('advance'),
  status: text('status').notNull().default('generated'), // generated | loaded | in_transit | delivered | cancelled
  remarks: text('remarks'),
  /** Plant-specific loading-sheet columns (PO, coil id, STO, DA/DO, GPS no., ...). */
  extra: jsonb('extra').$type<Record<string, string>>().notNull().default({}),
  ...docAudit,
});

/** Hire contract with a market vehicle / broker over attached LRs. */
export const freightMemos = pgTable('freight_memos', {
  id: serial('id').primaryKey(),
  memoNo: text('memo_no').notNull().unique(),
  memoDate: ts('memo_date').notNull().defaultNow(),
  vehicleNo: text('vehicle_no').notNull(),
  driverName: text('driver_name'),
  driverPhone: text('driver_phone'),
  brokerId: integer('broker_id').notNull(),
  origin: text('origin'),
  destination: text('destination'),
  material: text('material'),
  weightMt: qty('weight_mt'),
  rateBasis: text('rate_basis').notNull().default('fixed'), // fixed | per_mt
  rate: money('rate').notNull().default(0),
  totalFreight: money('total_freight').notNull(),
  advance: money('advance').notNull().default(0),
  advanceMode: text('advance_mode'),
  commission: money('commission').notNull().default(0),
  tds: money('tds').notNull().default(0),
  balance: money('balance').notNull().default(0),
  lrNos: text('lr_nos').array().notNull().default(sql`'{}'::text[]`),
  status: text('status').notNull().default('issued'), // issued | loaded | in_transit | settled
  remarks: text('remarks'),
  ...docAudit,
});

/** Fuel requests for vehicles, approved before filling. */
export const fuelIndents = pgTable('fuel_indents', {
  id: serial('id').primaryKey(),
  indentNo: text('indent_no').notNull().unique(),
  vehicleNo: text('vehicle_no').notNull(),
  lrNo: text('lr_no'),
  isEquipment: boolean('is_equipment').notNull().default(false),
  driverName: text('driver_name'),
  driverMobile: text('driver_mobile'),
  pump: text('pump').notNull(), // pump name or "Cash"
  indentDate: ts('indent_date').notNull().defaultNow(),
  amount: money('amount').notNull(),
  rate: money('rate'),
  litres: qty('litres'),
  status: text('status').notNull().default('pending_approval'), // pending_approval | approved | rejected
  ...docAudit,
});

/** Vehicles dispatched toward our plants (inbound material). */
export const incomingVehicles = pgTable('incoming_vehicles', {
  id: serial('id').primaryKey(),
  vehicleNo: text('vehicle_no').notNull(),
  plantId: integer('plant_id').notNull().references(() => plants.id),
  vendorName: text('vendor_name'),
  doNo: text('do_no'),
  driverName: text('driver_name'),
  driverPhone: text('driver_phone'),
  material: text('material'),
  weightMt: qty('weight_mt'),
  sentAt: ts('sent_at').notNull().defaultNow(),
  status: text('status').notNull().default('in_transit'), // in_transit | approaching | at_gate | arrived | received
  receivedAt: ts('received_at'),
  ...docAudit,
});

export interface ReturnLine {
  itemId: number;
  qty: number;
  serials: string[];
}

/** Material (incl. GPS trackers) returned from vehicles into a plant store. */
export const materialReturns = pgTable('material_returns', {
  id: serial('id').primaryKey(),
  returnNo: text('return_no').notNull().unique(),
  storeId: integer('store_id').notNull().references(() => stores.id),
  returnDate: ts('return_date').notNull().defaultNow(),
  vehicleNo: text('vehicle_no').notNull(),
  lrNo: text('lr_no'),
  indentNo: text('indent_no'),
  condition: text('condition').notNull().default('good'), // good | damaged
  lines: jsonb('lines').$type<ReturnLine[]>().notNull(),
  notes: text('notes'),
  ...docAudit,
});
