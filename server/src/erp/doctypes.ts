import type { Role } from '../auth/auth';

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve'] as const;
export type Action = (typeof ACTIONS)[number];

/** Every ERP document type, grouped by module. Keys are stable identifiers used in permissions. */
export const DOC_TYPES = {
  // masters
  plant: { label: 'Plants', module: 'masters' },
  store: { label: 'Stores', module: 'masters' },
  party: { label: 'Business partners', module: 'masters' },
  item_category: { label: 'Item categories', module: 'masters' },
  item: { label: 'Items', module: 'masters' },
  // operations
  order: { label: 'Customer orders', module: 'operations' },
  trip: { label: 'Trips', module: 'operations' },
  lr: { label: 'Lorry receipts / loading sheet', module: 'operations' },
  freight_memo: { label: 'Freight memos', module: 'operations' },
  fuel_indent: { label: 'Fuel indents', module: 'operations' },
  incoming_vehicle: { label: 'Incoming vehicles', module: 'operations' },
  material_return: { label: 'Material received', module: 'operations' },
  invoice: { label: 'Invoices & receipts', module: 'finance' },
  fastag: { label: 'FASTag accounts & tolls', module: 'finance' },
  subscription: { label: 'Device licences & subscriptions', module: 'finance' },
  // inventory
  stock_movement: { label: 'Stock movements', module: 'inventory' },
  stock_request: { label: 'Stock requests', module: 'inventory' },
  goods_receipt: { label: 'Goods receipts', module: 'inventory' },
  stock_sale: { label: 'Stock sales', module: 'inventory' },
  group_loan: { label: 'Group loans', module: 'inventory' },
  // tyres
  tyre: { label: 'Tyre register', module: 'tyres' },
  // workshop
  job_card: { label: 'Job cards', module: 'workshop' },
  pm_schedule: { label: 'PM schedules', module: 'workshop' },
  gate_pass: { label: 'Gate passes', module: 'workshop' },
  repair_bill: { label: 'Repair bills', module: 'workshop' },
  tool_checklist: { label: 'Tool checklists', module: 'workshop' },
  driver_charge: { label: 'Driver charges', module: 'workshop' },
  // compliance & people
  compliance_doc: { label: 'Compliance documents', module: 'compliance' },
  incident: { label: 'Incidents & claims', module: 'compliance' },
  sos: { label: 'SOS incidents', module: 'compliance' },
  field_staff: { label: 'Field staff & tasks', module: 'people' },
  expense_claim: { label: 'Field expense claims', module: 'people' },
  // AI
  ai_ops: { label: 'AI Ops: alert triage & briefings', module: 'ai' },
  ai_action: { label: 'AI-proposed actions', module: 'ai' },
  payroll: { label: 'Driver payroll & attendance', module: 'people' },
} as const;
export type DocType = keyof typeof DOC_TYPES;

type Grant = Partial<Record<Action, boolean>>;
const VIEW: Grant = { view: true };
const WRITE: Grant = { view: true, create: true, edit: true };
const FULL: Grant = { view: true, create: true, edit: true, delete: true };

const allDocs = Object.keys(DOC_TYPES) as DocType[];
const grant = (docs: DocType[], g: Grant) => Object.fromEntries(docs.map((d) => [d, g])) as Partial<Record<DocType, Grant>>;
const viewAll = grant(allDocs, VIEW);

/**
 * Built-in permissions per role, used until an admin customises a role in
 * Document Permissions. `admin` always has every permission and is not listed.
 */
export const DEFAULT_PERMISSIONS: Record<Exclude<Role, 'admin'>, Partial<Record<DocType, Grant>>> = {
  fleet_supervisor: {
    ...viewAll,
    ...grant(['order', 'trip', 'lr', 'freight_memo', 'incoming_vehicle', 'material_return', 'compliance_doc', 'incident', 'sos', 'payroll', 'field_staff', 'fastag'], FULL),
    expense_claim: { ...FULL, approve: true },
    fuel_indent: { ...FULL, approve: true },
    ai_ops: FULL,
    ai_action: { ...WRITE, approve: true },
  },
  workshop_manager: {
    ...viewAll,
    ...grant(['pm_schedule', 'tool_checklist', 'driver_charge', 'tyre'], FULL),
    ai_action: { ...WRITE, approve: true },
    job_card: { ...FULL, approve: true },
    gate_pass: { ...FULL, approve: true },
    repair_bill: WRITE,
  },
  technician: {
    ...grant(['job_card', 'tyre', 'tool_checklist', 'pm_schedule', 'item', 'item_category', 'store', 'gate_pass'], VIEW),
    ...grant(['job_card', 'tyre', 'tool_checklist'], WRITE),
  },
  storekeeper: {
    ...grant(['plant', 'party', 'job_card', 'trip', 'lr'], VIEW),
    ...grant(['store', 'item', 'item_category', 'stock_movement', 'goods_receipt', 'group_loan', 'material_return', 'gate_pass'], FULL),
    stock_request: { ...FULL, approve: true },
    stock_sale: WRITE,
  },
  accountant: {
    ...viewAll,
    ...grant(['party', 'invoice', 'fastag', 'subscription'], FULL),
    repair_bill: { ...FULL, approve: true },
    stock_sale: { ...FULL, approve: true },
    payroll: { ...WRITE, approve: true },
    expense_claim: { ...WRITE, approve: true },
  },
  driver: {
    ...grant(['trip', 'fuel_indent', 'tool_checklist'], VIEW),
    fuel_indent: WRITE,
  },
  viewer: viewAll,
};
