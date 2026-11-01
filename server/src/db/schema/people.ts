import { customType, date, doublePrecision, index, integer, jsonb, numeric, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const dec = (name: string) => numeric(name, { precision: 10, scale: 2, mode: 'number' });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const day = (name: string) => date(name, { mode: 'string' });
const docAudit = {
  createdBy: integer('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** Files attached to any ERP document (scans, photos, receipts). */
export const attachments = pgTable(
  'attachments',
  {
    id: serial('id').primaryKey(),
    docType: text('doc_type').notNull(),
    docId: integer('doc_id').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    data: bytea('data').notNull(),
    createdBy: integer('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('attachments_doc_idx').on(t.docType, t.docId)],
);

/* ------------------------------------------------------------ compliance */

/** Statutory documents for a vehicle (RC, insurance, permit...) or a driver (licence...). */
export const complianceDocs = pgTable('compliance_docs', {
  id: serial('id').primaryKey(),
  subjectType: text('subject_type').notNull(), // vehicle | driver
  subject: text('subject').notNull(), // vehicle no. or driver name
  docType: text('doc_type').notNull(),
  docNo: text('doc_no'),
  authority: text('authority'),
  issueDate: day('issue_date'),
  expiryDate: day('expiry_date'),
  description: text('description'),
  source: text('source').notNull().default('manual'), // manual | vahan
  verifiedAt: ts('verified_at'),
  supersededById: integer('superseded_by_id'),
  ...docAudit,
});

/* ------------------------------------------------------- safety and SOS */

export const incidents = pgTable('incidents', {
  id: serial('id').primaryKey(),
  incNo: text('inc_no').notNull().unique(),
  vehicleNo: text('vehicle_no').notNull(),
  driverName: text('driver_name'),
  occurredAt: ts('occurred_at').notNull(),
  type: text('type').notNull(), // accident | breakdown | theft | fire | cargo_damage | injury | other
  narrative: text('narrative').notNull(),
  location: text('location'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  severity: text('severity').notNull().default('minor'), // major | minor
  rsaProvider: text('rsa_provider'),
  rsaStatus: text('rsa_status').notNull().default('none'), // none | requested | dispatched | completed
  repairCost: money('repair_cost'),
  sosId: integer('sos_id'),
  status: text('status').notNull().default('open'), // open | investigating | closed
  closedAt: ts('closed_at'),
  ...docAudit,
});

export const insuranceClaims = pgTable('insurance_claims', {
  id: serial('id').primaryKey(),
  clmNo: text('clm_no').notNull().unique(),
  incidentId: integer('incident_id').references(() => incidents.id),
  vehicleNo: text('vehicle_no').notNull(),
  insurer: text('insurer').notNull(),
  policyNo: text('policy_no'),
  insurerClaimNo: text('insurer_claim_no'),
  surveyor: text('surveyor'),
  estimatedDamage: money('estimated_damage').notNull().default(0),
  approvedPayout: money('approved_payout'),
  settledAmount: money('settled_amount'),
  status: text('status').notNull().default('filed'), // filed | survey | approved | settled | rejected
  filedAt: ts('filed_at').notNull().defaultNow(),
  settledAt: ts('settled_at'),
  remarks: text('remarks'),
  ...docAudit,
});

/** Panic, crash and other emergency alarms, raised from Traccar alarm events or by hand. */
export const sosIncidents = pgTable('sos_incidents', {
  id: serial('id').primaryKey(),
  sosNo: text('sos_no').notNull().unique(),
  deviceId: integer('device_id'),
  vehicleNo: text('vehicle_no').notNull(),
  driverName: text('driver_name'),
  driverPhone: text('driver_phone'),
  trigger: text('trigger').notNull(), // sos | accident | fallDown | tampering | powerCut | jamming | manual
  severity: text('severity').notNull(), // critical | high | medium
  speedKmh: dec('speed_kmh'),
  ignition: text('ignition'), // on | off | null
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  address: text('address'),
  status: text('status').notNull().default('active'), // active | responding | resolved
  raisedAt: ts('raised_at').notNull().defaultNow(),
  respondedAt: ts('responded_at'),
  respondedBy: integer('responded_by'),
  responder: text('responder'),
  resolvedAt: ts('resolved_at'),
  resolution: text('resolution'),
  falseAlarm: integer('false_alarm').notNull().default(0),
  incidentId: integer('incident_id'),
  traccarEventId: integer('traccar_event_id').unique(),
  ...docAudit,
});

export const emergencyContacts = pgTable('emergency_contacts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  kind: text('kind').notNull().default('other'), // police | highway | ambulance | control_room | other
  sort: integer('sort').notNull().default(0),
  ...docAudit,
});

/* --------------------------------------------------------------- drivers */

/** Employment details for a driver; linked to the Traccar driver (RFID / iButton) when there is one. */
export const driverProfiles = pgTable('driver_profiles', {
  id: serial('id').primaryKey(),
  traccarDriverId: integer('traccar_driver_id').unique(),
  name: text('name').notNull(),
  phone: text('phone'),
  licenceNo: text('licence_no'),
  licenceExpiry: day('licence_expiry'),
  aadhar: text('aadhar'),
  monthlySalary: money('monthly_salary').notNull().default(0),
  dailyBata: money('daily_bata').notNull().default(0),
  tripAllowance: money('trip_allowance').notNull().default(0),
  status: text('status').notNull().default('active'), // active | inactive
  joinedOn: day('joined_on'),
  notes: text('notes'),
  ...docAudit,
});

/** Which driver drives which vehicle, with history (toAt null = current). */
export const driverAssignments = pgTable('driver_assignments', {
  id: serial('id').primaryKey(),
  driverId: integer('driver_id').notNull().references(() => driverProfiles.id),
  vehicleNo: text('vehicle_no').notNull(),
  fromAt: ts('from_at').notNull().defaultNow(),
  toAt: ts('to_at'),
  remarks: text('remarks'),
  createdBy: integer('created_by'),
});

/** Daily attendance: P present, H half day, L leave, A absent, WO weekly off. */
export const driverAttendance = pgTable(
  'driver_attendance',
  {
    driverId: integer('driver_id').notNull().references(() => driverProfiles.id),
    date: day('date').notNull(),
    code: text('code').notNull(),
    remarks: text('remarks'),
    updatedBy: integer('updated_by'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.driverId, t.date] })],
);

export interface PayrollLine {
  driverId: number;
  name: string;
  presentDays: number;
  paidDays: number;
  trips: number;
  basic: number;
  bata: number;
  tripPay: number;
  gross: number;
  chargeDeductions: { chargeId: number; dcNo: string; amount: number }[];
  deductions: number;
  net: number;
}

export const payrollRuns = pgTable('payroll_runs', {
  id: serial('id').primaryKey(),
  prNo: text('pr_no').notNull().unique(),
  month: text('month').notNull().unique(), // YYYY-MM
  lines: jsonb('lines').$type<PayrollLine[]>().notNull(),
  gross: money('gross').notNull(),
  deductions: money('deductions').notNull(),
  net: money('net').notNull(),
  status: text('status').notNull().default('draft'), // draft | pending_approval | approved | paid | rejected
  paidAt: ts('paid_at'),
  paymentRef: text('payment_ref'),
  ...docAudit,
});

/* ----------------------------------------------------------- field staff */

export const fieldStaff = pgTable('field_staff', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull(), // technician | collection | sales
  team: text('team'),
  city: text('city'),
  phone: text('phone'),
  traccarDeviceId: integer('traccar_device_id'),
  monthlyTarget: integer('monthly_target'),
  status: text('status').notNull().default('active'), // active | inactive
  ...docAudit,
});

export const fieldTasks = pgTable('field_tasks', {
  id: serial('id').primaryKey(),
  ftNo: text('ft_no').notNull().unique(),
  staffId: integer('staff_id').notNull().references(() => fieldStaff.id),
  partyId: integer('party_id'),
  kind: text('kind').notNull(), // installation | service | collection | sales_visit | other
  title: text('title').notNull(),
  address: text('address'),
  city: text('city'),
  dueAt: ts('due_at').notNull(),
  status: text('status').notNull().default('assigned'), // assigned | in_progress | done | cancelled
  startedAt: ts('started_at'),
  completedAt: ts('completed_at'),
  amountCollected: money('amount_collected'),
  rating: integer('rating'),
  outcome: text('outcome'),
  ...docAudit,
});

export const staffAttendance = pgTable(
  'staff_attendance',
  {
    staffId: integer('staff_id').notNull().references(() => fieldStaff.id),
    date: day('date').notNull(),
    checkIn: ts('check_in'),
    checkOut: ts('check_out'),
    km: dec('km'),
    checkInLat: doublePrecision('check_in_lat'),
    checkInLon: doublePrecision('check_in_lon'),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.date] })],
);

export const expenseClaims = pgTable('expense_claims', {
  id: serial('id').primaryKey(),
  expNo: text('exp_no').notNull().unique(),
  staffId: integer('staff_id').notNull().references(() => fieldStaff.id),
  date: day('date').notNull(),
  category: text('category').notNull(), // travel | fuel | food | lodging | tools | other
  description: text('description').notNull(),
  amount: money('amount').notNull(),
  status: text('status').notNull().default('pending_approval'), // pending_approval | approved | rejected | paid
  paidAt: ts('paid_at'),
  ...docAudit,
});
