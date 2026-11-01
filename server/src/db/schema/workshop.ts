import { integer, jsonb, numeric, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { stores } from './erp';

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const km = (name: string) => numeric(name, { precision: 12, scale: 1, mode: 'number' });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const docAudit = {
  createdBy: integer('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export interface JobPart {
  itemId: number;
  qty: number;
  serials: string[];
  value: number;
  movementId: number;
}

/** A vehicle visit to our workshop, a market garage or an AMC provider. */
export const jobCards = pgTable('job_cards', {
  id: serial('id').primaryKey(),
  jcNo: text('jc_no').notNull().unique(),
  vehicleNo: text('vehicle_no').notNull(),
  driverName: text('driver_name'),
  jobType: text('job_type').notNull().default('own_workshop'), // own_workshop | market_garage | amc
  serviceType: text('service_type').notNull(),
  storeId: integer('store_id').references(() => stores.id),
  partyId: integer('party_id'), // garage / AMC provider
  inspectedBy: text('inspected_by'),
  runningKm: km('running_km'),
  pmScheduleId: integer('pm_schedule_id'),
  problem: text('problem').notNull(),
  priority: text('priority').notNull().default('normal'), // normal | high
  estimatedCost: money('estimated_cost'),
  labourCost: money('labour_cost').notNull().default(0),
  partsCost: money('parts_cost').notNull().default(0),
  parts: jsonb('parts').$type<JobPart[]>().notNull().default([]),
  status: text('status').notNull().default('draft'), // draft | pending_approval | open | in_progress | awaiting_spares | completed | rejected | cancelled
  workDone: text('work_done'),
  openedAt: ts('opened_at').notNull().defaultNow(),
  closedAt: ts('closed_at'),
  ...docAudit,
});

/** Preventive maintenance: every N km (GPS odometer) or N days, whichever comes first. */
export const pmSchedules = pgTable('pm_schedules', {
  id: serial('id').primaryKey(),
  vehicleNo: text('vehicle_no').notNull(),
  task: text('task').notNull(),
  category: text('category'),
  intervalKm: km('interval_km'),
  intervalDays: integer('interval_days'),
  lastDoneAt: ts('last_done_at'),
  lastDoneKm: km('last_done_km'),
  ...docAudit,
});

export interface GatePassLine {
  itemId: number | null;
  description: string;
  qty: number;
  serials: string[];
  reason: string | null;
}

/** Material leaving a store: returnable (repair/machining), on a claim, or a plain transfer. */
export const gatePasses = pgTable('gate_passes', {
  id: serial('id').primaryKey(),
  gpNo: text('gp_no').notNull().unique(),
  kind: text('kind').notNull(), // returnable | transfer | claim
  fromStoreId: integer('from_store_id').notNull().references(() => stores.id),
  partyId: integer('party_id').notNull(),
  vehicleNo: text('vehicle_no'),
  jobCardId: integer('job_card_id'),
  expectedReturn: ts('expected_return'),
  remark: text('remark'),
  lines: jsonb('lines').$type<GatePassLine[]>().notNull(),
  estimatedValue: money('estimated_value'),
  status: text('status').notNull().default('pending_approval'), // pending_approval | out | returned | closed | rejected
  returnedAt: ts('returned_at'),
  ...docAudit,
});

/** Market garage bills: GST split and TDS (Sec 194C) worked out on save. */
export const repairBills = pgTable('repair_bills', {
  id: serial('id').primaryKey(),
  rbNo: text('rb_no').notNull().unique(),
  vendorBillNo: text('vendor_bill_no'),
  partyId: integer('party_id').notNull(),
  vehicleNo: text('vehicle_no').notNull(),
  jobCardId: integer('job_card_id'),
  billDate: ts('bill_date').notNull(),
  taxable: money('taxable').notNull(),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2, mode: 'number' }).notNull().default(18),
  interState: integer('inter_state').notNull().default(0),
  cgst: money('cgst').notNull().default(0),
  sgst: money('sgst').notNull().default(0),
  igst: money('igst').notNull().default(0),
  tdsRate: numeric('tds_rate', { precision: 5, scale: 2, mode: 'number' }).notNull().default(2),
  tds: money('tds').notNull().default(0),
  netPayable: money('net_payable').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending_approval'), // pending_approval | approved | rejected | paid
  paidAt: ts('paid_at'),
  paymentRef: text('payment_ref'),
  ...docAudit,
});

export interface ToolLine {
  tool: string;
  present: boolean;
}

/** Driver toolkit handover (out) and return (in) audits. */
export const toolChecklists = pgTable('tool_checklists', {
  id: serial('id').primaryKey(),
  tcNo: text('tc_no').notNull().unique(),
  auditType: text('audit_type').notNull(), // handover | return
  vehicleNo: text('vehicle_no').notNull(),
  driverName: text('driver_name').notNull(),
  inspector: text('inspector'),
  auditDate: ts('audit_date').notNull().defaultNow(),
  tools: jsonb('tools').$type<ToolLine[]>().notNull(),
  missingCount: integer('missing_count').notNull().default(0),
  remarks: text('remarks'),
  ...docAudit,
});

/** Debits against drivers (missing tools, damage) recovered through payroll. */
export const driverCharges = pgTable('driver_charges', {
  id: serial('id').primaryKey(),
  dcNo: text('dc_no').notNull().unique(),
  driverName: text('driver_name').notNull(),
  incidentDate: ts('incident_date').notNull(),
  category: text('category').notNull(), // missing_tool | vehicle_damage | fuel_shortage | other
  vehicleNo: text('vehicle_no'),
  amount: money('amount').notNull(),
  refNo: text('ref_no'),
  description: text('description').notNull(),
  recoveryPlan: text('recovery_plan').notNull().default('one_time'), // one_time | instalments
  instalments: integer('instalments').notNull().default(1),
  recovered: money('recovered').notNull().default(0),
  status: text('status').notNull().default('pending_approval'), // pending_approval | approved | rejected | recovered | waived
  ...docAudit,
});
