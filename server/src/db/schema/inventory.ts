import { sql } from 'drizzle-orm';
import { index, integer, numeric, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { items, stores } from './erp';

const money = (name: string) => numeric(name, { precision: 16, scale: 2, mode: 'number' });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: 'number' });

/** Current quantity and value of each item in each store (moving-average cost). */
export const stockBalances = pgTable(
  'stock_balances',
  {
    itemId: integer('item_id').notNull().references(() => items.id),
    storeId: integer('store_id').notNull().references(() => stores.id),
    qty: qty('qty').notNull().default(0),
    value: money('value').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.storeId] })],
);

/** Every change of stock. Nothing changes stock any other way. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: serial('id').primaryKey(),
    docNo: text('doc_no').notNull(),
    kind: text('kind').notNull(), // receipt | issue | transfer | adjustment | write_off | opening | sale | return
    status: text('status').notNull().default('completed'), // completed | in_transit
    itemId: integer('item_id').notNull().references(() => items.id),
    storeId: integer('store_id').notNull().references(() => stores.id),
    toStoreId: integer('to_store_id').references(() => stores.id),
    /** Signed for adjustments; positive for every other kind. */
    qty: qty('qty').notNull(),
    unitRate: money('unit_rate').notNull().default(0),
    value: money('value').notNull().default(0),
    serials: text('serials').array().notNull().default(sql`'{}'::text[]`),
    vehicleNo: text('vehicle_no'),
    lrNo: text('lr_no'),
    refType: text('ref_type'),
    refId: integer('ref_id'),
    refNo: text('ref_no'),
    remarks: text('remarks'),
    movedAt: timestamp('moved_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    glVoucherId: integer('gl_voucher_id'),
    createdBy: integer('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('stock_movements_item_store').on(t.itemId, t.storeId), index('stock_movements_ref').on(t.refType, t.refId)],
);

/** Individually tracked pieces (tyres, GPS units, batteries) by serial number. */
export const stockPieces = pgTable(
  'stock_pieces',
  {
    id: serial('id').primaryKey(),
    itemId: integer('item_id').notNull().references(() => items.id),
    serial: text('serial').notNull(),
    storeId: integer('store_id').references(() => stores.id),
    state: text('state').notNull().default('in_stock'), // in_stock | damaged | in_transit | issued | written_off | sold
    vehicleNo: text('vehicle_no'),
    lastMovementId: integer('last_movement_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('stock_pieces_item_serial').on(t.itemId, t.serial)],
);

/** Accounting vouchers generated from stock movements when GL posting is on. */
export const glVouchers = pgTable('gl_vouchers', {
  id: serial('id').primaryKey(),
  voucherNo: text('voucher_no').notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  movementId: integer('movement_id').notNull().unique(),
  debitAccount: text('debit_account').notNull(),
  creditAccount: text('credit_account').notNull(),
  amount: money('amount').notNull(),
  narration: text('narration'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
