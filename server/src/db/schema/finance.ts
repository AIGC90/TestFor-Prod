import { date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const day = (name: string) => date(name, { mode: 'string' });
const docAudit = {
  createdBy: integer('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

/** Customer freight invoice, usually raised from one or more completed trips. */
export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  invNo: text('inv_no').notNull().unique(),
  customerId: integer('customer_id').notNull(),
  tripIds: integer('trip_ids').array().notNull().default([]),
  lane: text('lane'),
  invoiceDate: day('invoice_date').notNull(),
  dueDate: day('due_date').notNull(),
  description: text('description'),
  taxable: money('taxable').notNull(),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2, mode: 'number' }).notNull().default(5),
  interState: integer('inter_state').notNull().default(0),
  cgst: money('cgst').notNull().default(0),
  sgst: money('sgst').notNull().default(0),
  igst: money('igst').notNull().default(0),
  total: money('total').notNull(),
  received: money('received').notNull().default(0),
  status: text('status').notNull().default('open'), // open | partly_paid | paid | cancelled
  ...docAudit,
});

export const invoiceReceipts = pgTable('invoice_receipts', {
  id: serial('id').primaryKey(),
  invoiceId: integer('invoice_id').notNull().references(() => invoices.id),
  receivedOn: day('received_on').notNull(),
  amount: money('amount').notNull(),
  tds: money('tds').notNull().default(0),
  mode: text('mode').notNull().default('neft'), // neft | rtgs | upi | cheque | cash
  reference: text('reference'),
  createdBy: integer('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/* ---------------------------------------------------------------- FASTag */

export const fastagAccounts = pgTable('fastag_accounts', {
  id: serial('id').primaryKey(),
  vehicleNo: text('vehicle_no').notNull(),
  tagId: text('tag_id').notNull().unique(), // RFID EPC / tag serial
  bank: text('bank').notNull(),
  vehicleClass: text('vehicle_class').notNull().default('VC10'),
  balance: money('balance').notNull().default(0),
  lowBalance: money('low_balance').notNull().default(1000),
  status: text('status').notNull().default('active'), // active | low_balance | blacklisted | closed
  balanceAt: ts('balance_at'),
  ...docAudit,
});

export const tollTxns = pgTable(
  'toll_txns',
  {
    id: serial('id').primaryKey(),
    txnRef: text('txn_ref').notNull().unique(),
    npciRef: text('npci_ref'),
    tagId: text('tag_id').notNull(),
    vehicleNo: text('vehicle_no').notNull(),
    kind: text('kind').notNull().default('toll'), // toll | recharge | refund
    plaza: text('plaza'),
    highway: text('highway'),
    lane: text('lane'),
    at: ts('at').notNull(),
    amount: money('amount').notNull(),
    balanceAfter: money('balance_after'),
    status: text('status').notNull().default('debited'), // debited | credited | disputed
    source: text('source').notNull().default('import'), // import | api | manual
    createdBy: integer('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('toll_txns_vehicle_at_idx').on(t.vehicleNo, t.at)],
);

/* --------------------------------------------------------- subscriptions */

export const deviceLicenses = pgTable('device_licenses', {
  id: serial('id').primaryKey(),
  licNo: text('lic_no').notNull().unique(),
  vehicleNo: text('vehicle_no').notNull(),
  deviceId: integer('device_id'),
  imei: text('imei').notNull().unique(),
  simOperator: text('sim_operator'),
  simNo: text('sim_no'),
  plan: text('plan').notNull(), // standard | ais140 | dashcam
  activatedOn: day('activated_on').notNull(),
  expiresOn: day('expires_on').notNull(),
  status: text('status').notNull().default('active'), // active | suspended | cancelled
  ...docAudit,
});

export interface SubscriptionLine {
  licenseId: number;
  licNo: string;
  vehicleNo: string;
  plan: string;
  months: number;
  amount: number;
  from: string;
  to: string;
}

export const subscriptionInvoices = pgTable('subscription_invoices', {
  id: serial('id').primaryKey(),
  sinvNo: text('sinv_no').notNull().unique(),
  invoiceDate: day('invoice_date').notNull(),
  description: text('description').notNull(),
  lines: jsonb('lines').$type<SubscriptionLine[]>().notNull(),
  net: money('net').notNull(),
  gst: money('gst').notNull(),
  total: money('total').notNull(),
  paymentMethod: text('payment_method'),
  paymentRef: text('payment_ref'),
  status: text('status').notNull().default('unpaid'), // unpaid | paid
  paidAt: ts('paid_at'),
  ...docAudit,
});
