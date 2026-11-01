import { sql } from 'drizzle-orm';
import { index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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

export interface RequestLine {
  itemId: number;
  qty: number;
  note?: string | null;
}
export interface ReceiptLine {
  itemId: number;
  expected: number;
  received: number;
  rate: number | null;
  serials: string[];
}
export interface OpeningLine {
  itemId: number;
  qty: number;
  rate: number;
  serials: string[];
}
export interface SaleLine {
  itemId: number;
  qty: number;
  rate: number;
  gstRate: number;
  serials: string[];
}

const docAudit = {
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** "Buy this for the store" or "send me stock from another store". */
export const stockRequests = pgTable('stock_requests', {
  id: serial('id').primaryKey(),
  reqNo: text('req_no').notNull().unique(),
  kind: text('kind').notNull(), // buy | transfer
  storeId: integer('store_id').notNull().references(() => stores.id),
  fromStoreId: integer('from_store_id').references(() => stores.id),
  neededBy: timestamp('needed_by', { withTimezone: true }),
  lines: jsonb('lines').$type<RequestLine[]>().notNull(),
  notes: text('notes'),
  status: text('status').notNull().default('open'), // open | pending_approval | approved | rejected | in_procurement | fulfilled | cancelled
  requestedByName: text('requested_by_name'),
  ...docAudit,
});

/** Expected deliveries (purchase orders); landing them puts the stock in the store. */
export const goodsReceipts = pgTable('goods_receipts', {
  id: serial('id').primaryKey(),
  recNo: text('rec_no').notNull().unique(),
  poNo: text('po_no'),
  supplierId: integer('supplier_id'),
  storeId: integer('store_id').notNull().references(() => stores.id),
  lrNo: text('lr_no'),
  requestId: integer('request_id'),
  lines: jsonb('lines').$type<ReceiptLine[]>().notNull(),
  status: text('status').notNull().default('expected'), // expected | ready | landed
  expectedAt: timestamp('expected_at', { withTimezone: true }),
  landedAt: timestamp('landed_at', { withTimezone: true }),
  notes: text('notes'),
  ...docAudit,
});

/** Posted opening balances; batchId makes re-posting the same batch harmless. */
export const openingBatches = pgTable('opening_batches', {
  id: serial('id').primaryKey(),
  batchId: text('batch_id').notNull().unique(),
  storeId: integer('store_id').notNull().references(() => stores.id),
  lines: jsonb('lines').$type<OpeningLine[]>().notNull(),
  totalQty: qty('total_qty').notNull(),
  totalValue: money('total_value').notNull(),
  ...docAudit,
});

/** Sales of scrap tyres and surplus spares to outside parties, with GST. */
export const stockSales = pgTable('stock_sales', {
  id: serial('id').primaryKey(),
  saleNo: text('sale_no').notNull().unique(),
  saleDate: timestamp('sale_date', { withTimezone: true }).notNull().defaultNow(),
  buyerId: integer('buyer_id').notNull(),
  storeId: integer('store_id').notNull().references(() => stores.id),
  lines: jsonb('lines').$type<SaleLine[]>().notNull(),
  taxable: money('taxable').notNull().default(0),
  cgst: money('cgst').notNull().default(0),
  sgst: money('sgst').notNull().default(0),
  igst: money('igst').notNull().default(0),
  total: money('total').notNull().default(0),
  remarks: text('remarks'),
  status: text('status').notNull().default('draft'), // draft | pending_approval | approved | rejected | invoiced | dispatched | paid
  ...docAudit,
});

/** Tyres lent to or borrowed from sister companies. */
export const groupLoans = pgTable('group_loans', {
  id: serial('id').primaryKey(),
  loanNo: text('loan_no').notNull().unique(),
  direction: text('direction').notNull(), // lent | borrowed
  sisterId: integer('sister_id').notNull(),
  tyreSerial: text('tyre_serial').notNull(),
  tyreSpec: text('tyre_spec').notNull(),
  loanDate: timestamp('loan_date', { withTimezone: true }).notNull(),
  expectedReturn: timestamp('expected_return', { withTimezone: true }),
  location: text('location'),
  challanNo: text('challan_no'),
  remarks: text('remarks'),
  status: text('status').notNull().default('active'), // active | returned
  returnedAt: timestamp('returned_at', { withTimezone: true }),
  ...docAudit,
});
