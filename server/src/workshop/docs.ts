import { BadRequestException } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { driverCharges, gatePasses, jobCards, parties, pmSchedules, repairBills, toolChecklists } from '../db/schema';
import { ApprovalsService } from '../erp/approvals.service';
import { type CrudContext, crudController } from '../erp/crud';
import type { DocType } from '../erp/doctypes';
import { requiredText, text } from '../erp/zod-helpers';
import { gstSplit } from '../inventory/docs';

const id = z.coerce.number().int().positive();
const optId = id.nullish().transform((v) => v ?? null);
const optNum = z.coerce.number().min(0).nullish().transform((v) => (v === undefined ? null : v));
const optDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullish()).transform((v) => v ?? null);
const dateOrNow = z.preprocess((v) => (v === null || v === '' ? undefined : v), z.coerce.date().optional());
const vehicle = z.string().trim().toUpperCase().min(4, 'enter the vehicle number').max(20);
const r2 = (n: number) => Math.round(n * 100) / 100;

export const SERVICE_TYPES = [
  'Breakdown Repair', 'Preventive Maintenance', 'Tyre Fitment', 'Brake Inspection & Overhaul',
  'Electrical Work & Wiring', 'Oil & Filter Service', 'Suspension / Leaf Spring Repair', 'Body & Cabin', 'Accident Repair',
];
export const DEFAULT_TOOLS = [
  '20-ton hydraulic jack', 'Wheel nut spanner', 'Tommy bar / jack handle', 'Reflective warning triangle',
  'Lockable tool box', 'Fire extinguisher (2 kg ABC)', 'First aid kit', 'LED emergency torch',
];

async function requireParty(ctx: CrudContext, partyId: unknown, kinds: string[], field: string) {
  const [p] = await ctx.db.select().from(parties).where(eq(parties.id, Number(partyId)));
  if (!p || !kinds.some((k) => p.kinds.includes(k))) throw new BadRequestException(`${field}: choose a ${kinds.join(' or ').replace('_', ' ')}`);
}

/** Routes a new document to approval; when no rule applies it goes straight to `autoStatus`. */
function submitOnCreate(docType: DocType, table: typeof gatePasses | typeof repairBills | typeof driverCharges, autoStatus: string, describe: (row: Record<string, unknown>) => { docNo: string; title: string; summary?: string; amount?: number | null; vehicle?: string | null; link: string; priority?: 'high' | 'normal' }) {
  return async (row: Record<string, unknown>, ctx: CrudContext, op: 'create' | 'update') => {
    if (op !== 'create') return;
    const d = describe(row);
    const approval = await ctx.get(ApprovalsService).submit(ctx.user, {
      docType,
      docId: row.id as number,
      docNo: d.docNo,
      title: d.title,
      summary: d.summary ?? null,
      amount: d.amount ?? null,
      priority: d.priority,
      meta: { link: d.link, ...(d.vehicle ? { vehicle: d.vehicle } : {}) },
    });
    if (!approval) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ctx.db.update(table as any).set({ status: autoStatus }).where(eq((table as typeof gatePasses).id, row.id as number));
      row.status = autoStatus;
    }
  };
}

/* -------------------------------------------------------------- job cards */

export const JobCardsController = crudController({
  path: 'workshop/job-cards',
  docType: 'job_card',
  table: jobCards,
  searchColumns: [jobCards.jcNo, jobCards.vehicleNo, jobCards.driverName, jobCards.serviceType, jobCards.problem],
  filters: { status: jobCards.status, vehicleNo: jobCards.vehicleNo, jobType: jobCards.jobType },
  orderBy: [desc(jobCards.openedAt), desc(jobCards.id)],
  numbering: { prefix: 'JC', column: 'jcNo' },
  schema: z.object({
    vehicleNo: vehicle,
    driverName: text(100),
    jobType: z.enum(['own_workshop', 'market_garage', 'amc']).default('own_workshop'),
    serviceType: requiredText(100),
    storeId: optId,
    partyId: optId,
    inspectedBy: text(100),
    runningKm: optNum,
    pmScheduleId: optId,
    problem: requiredText(2000),
    priority: z.enum(['normal', 'high']).default('normal'),
    estimatedCost: optNum,
    labourCost: z.coerce.number().min(0).default(0),
    workDone: text(2000),
  }),
  beforeCreate: async (input, ctx) => {
    if (input.jobType !== 'own_workshop' && !input.partyId) throw new BadRequestException('partyId: choose the garage or AMC provider');
    if (input.partyId) await requireParty(ctx, input.partyId, ['garage', 'vendor'], 'partyId');
    return { ...input, status: 'draft' };
  },
  beforeUpdate: (input, existing) => {
    if (['completed', 'cancelled'].includes(existing.status as string)) throw new BadRequestException(`A ${existing.status} job card cannot be edited`);
    return input;
  },
  canDelete: (row) => (row.status === 'draft' || row.status === 'cancelled' ? null : `A ${row.status} job card cannot be deleted; cancel it instead`),
});

/* ------------------------------------------------------------ PM schedules */

export const PmSchedulesController = crudController({
  path: 'workshop/pm-schedules',
  docType: 'pm_schedule',
  table: pmSchedules,
  searchColumns: [pmSchedules.vehicleNo, pmSchedules.task, pmSchedules.category],
  filters: { vehicleNo: pmSchedules.vehicleNo },
  orderBy: [asc(pmSchedules.vehicleNo), asc(pmSchedules.task)],
  schema: z.object({
    vehicleNo: vehicle,
    task: requiredText(200),
    category: text(100),
    intervalKm: optNum,
    intervalDays: z.coerce.number().int().min(1).max(3650).nullish(),
    lastDoneAt: optDate,
    lastDoneKm: optNum,
  }),
  beforeCreate: (input) => {
    if (!input.intervalKm && !input.intervalDays) throw new BadRequestException('Set an interval in km, in days, or both');
    return input;
  },
});

/* ------------------------------------------------------------ gate passes */

const gpLine = z.object({
  itemId: optId,
  description: requiredText(200),
  qty: z.coerce.number().positive(),
  serials: z.array(z.string().trim().min(1).max(60)).default([]),
  reason: text(200),
});

export const GatePassesController = crudController({
  path: 'workshop/gate-passes',
  docType: 'gate_pass',
  table: gatePasses,
  searchColumns: [gatePasses.gpNo, gatePasses.vehicleNo, gatePasses.remark],
  filters: { status: gatePasses.status, kind: gatePasses.kind, fromStoreId: gatePasses.fromStoreId },
  orderBy: [desc(gatePasses.id)],
  numbering: { prefix: 'GP', column: 'gpNo' },
  schema: z.object({
    kind: z.enum(['returnable', 'transfer', 'claim']),
    fromStoreId: id,
    partyId: id,
    vehicleNo: z.preprocess((v) => (v === '' ? null : v), vehicle.nullish()).transform((v) => v ?? null),
    jobCardId: optId,
    expectedReturn: optDate,
    remark: text(1000),
    lines: z.array(gpLine).min(1).max(100),
    estimatedValue: optNum,
  }),
  beforeCreate: async (input, ctx) => {
    await requireParty(ctx, input.partyId, ['garage', 'vendor', 'sister_company'], 'partyId');
    if (input.kind !== 'transfer' && !input.expectedReturn) throw new BadRequestException('expectedReturn: when should it come back?');
    return { ...input, status: 'pending_approval' };
  },
  beforeUpdate: (input, existing) => {
    if (existing.status !== 'pending_approval' && existing.status !== 'rejected') throw new BadRequestException(`A gate pass that is ${existing.status} cannot be edited`);
    return input;
  },
  afterWrite: submitOnCreate('gate_pass', gatePasses, 'out', (r) => ({
    docNo: r.gpNo as string,
    title: `${String(r.kind).replace(/^./, (c) => c.toUpperCase())} gate pass: ${(r.lines as { description: string }[]).map((l) => l.description).join(', ')}`,
    summary: (r.remark as string) ?? undefined,
    amount: r.estimatedValue as number | null,
    vehicle: r.vehicleNo as string | null,
    link: '/gate-passes',
  })),
  canDelete: (row) => (['pending_approval', 'rejected'].includes(row.status as string) ? null : 'Only a pass that has not gone out can be deleted'),
});

/* ----------------------------------------------------------- repair bills */

/** GST on the taxable amount, TDS u/s 194C on the taxable amount (not on GST). */
export function billTotals(b: { taxable?: unknown; gstRate?: unknown; interState?: unknown; tdsRate?: unknown }) {
  const taxable = r2(Number(b.taxable ?? 0));
  const gst = gstSplit(taxable, Number(b.gstRate ?? 18), !Number(b.interState));
  const tds = r2((taxable * Number(b.tdsRate ?? 0)) / 100);
  return { ...gst, tds, netPayable: r2(taxable + gst.cgst + gst.sgst + gst.igst - tds) };
}

export const RepairBillsController = crudController({
  path: 'workshop/repair-bills',
  docType: 'repair_bill',
  table: repairBills,
  searchColumns: [repairBills.rbNo, repairBills.vendorBillNo, repairBills.vehicleNo, repairBills.description],
  filters: { status: repairBills.status, partyId: repairBills.partyId, vehicleNo: repairBills.vehicleNo },
  orderBy: [desc(repairBills.billDate), desc(repairBills.id)],
  numbering: { prefix: 'RB', column: 'rbNo' },
  schema: z.object({
    vendorBillNo: text(60),
    partyId: id,
    vehicleNo: vehicle,
    jobCardId: optId,
    billDate: dateOrNow,
    taxable: z.coerce.number().positive('enter the taxable amount'),
    gstRate: z.coerce.number().refine((v) => [0, 5, 12, 18, 28].includes(v), 'GST must be 0, 5, 12, 18 or 28%').default(18),
    interState: z.preprocess((v) => (typeof v === 'boolean' ? Number(v) : v), z.coerce.number().int().min(0).max(1)).default(0),
    tdsRate: z.coerce.number().refine((v) => [0, 1, 2].includes(v), 'TDS u/s 194C is 1% (individual/HUF) or 2% (others), or 0').default(2),
    description: text(2000),
  }),
  beforeCreate: async (input, ctx) => {
    await requireParty(ctx, input.partyId, ['garage', 'vendor'], 'partyId');
    return { ...input, billDate: input.billDate ?? new Date(), ...billTotals(input), status: 'pending_approval' };
  },
  beforeUpdate: (input, existing) => {
    if (existing.status !== 'pending_approval' && existing.status !== 'rejected') throw new BadRequestException(`A ${existing.status} bill cannot be edited`);
    return { ...input, ...billTotals({ ...existing, ...input }) };
  },
  afterWrite: submitOnCreate('repair_bill', repairBills, 'approved', (r) => ({
    docNo: r.rbNo as string,
    title: `Repair bill ${r.vendorBillNo ?? r.rbNo} for ${r.vehicleNo}`,
    summary: (r.description as string) ?? undefined,
    amount: r.netPayable as number,
    vehicle: r.vehicleNo as string,
    link: '/repair-bills',
  })),
  canDelete: (row) => (row.status === 'paid' || row.status === 'approved' ? `An ${row.status} bill cannot be deleted` : null),
});

/* --------------------------------------------------------- tool checklists */

export const ToolChecklistsController = crudController({
  path: 'workshop/tool-checklists',
  docType: 'tool_checklist',
  table: toolChecklists,
  searchColumns: [toolChecklists.tcNo, toolChecklists.vehicleNo, toolChecklists.driverName, toolChecklists.inspector],
  filters: { auditType: toolChecklists.auditType, vehicleNo: toolChecklists.vehicleNo, driverName: toolChecklists.driverName },
  orderBy: [desc(toolChecklists.auditDate), desc(toolChecklists.id)],
  numbering: { prefix: 'TC', column: 'tcNo' },
  schema: z.object({
    auditType: z.enum(['handover', 'return']),
    vehicleNo: vehicle,
    driverName: requiredText(100),
    inspector: text(100),
    auditDate: dateOrNow,
    tools: z.array(z.object({ tool: requiredText(100), present: z.boolean() })).min(1).max(50),
    remarks: text(1000),
  }),
  beforeCreate: (input) => ({ ...input, missingCount: (input.tools as { present: boolean }[]).filter((t) => !t.present).length }),
  beforeUpdate: (input, existing) => {
    const tools = (input.tools ?? existing.tools) as { present: boolean }[];
    return { ...input, missingCount: tools.filter((t) => !t.present).length };
  },
});

/* ---------------------------------------------------------- driver charges */

export const DriverChargesController = crudController({
  path: 'workshop/driver-charges',
  docType: 'driver_charge',
  table: driverCharges,
  searchColumns: [driverCharges.dcNo, driverCharges.driverName, driverCharges.vehicleNo, driverCharges.refNo, driverCharges.description],
  filters: { status: driverCharges.status, driverName: driverCharges.driverName, category: driverCharges.category },
  orderBy: [desc(driverCharges.incidentDate), desc(driverCharges.id)],
  numbering: { prefix: 'DC', column: 'dcNo' },
  schema: z.object({
    driverName: requiredText(100),
    incidentDate: dateOrNow,
    category: z.enum(['missing_tool', 'vehicle_damage', 'fuel_shortage', 'other']),
    vehicleNo: z.preprocess((v) => (v === '' ? null : v), vehicle.nullish()).transform((v) => v ?? null),
    amount: z.coerce.number().positive('enter the amount'),
    refNo: text(60),
    description: requiredText(1000),
    recoveryPlan: z.enum(['one_time', 'instalments']).default('one_time'),
    instalments: z.coerce.number().int().min(1).max(24).default(1),
  }),
  beforeCreate: (input) => ({ ...input, incidentDate: input.incidentDate ?? new Date(), instalments: input.recoveryPlan === 'one_time' ? 1 : input.instalments, status: 'pending_approval' }),
  beforeUpdate: (input, existing) => {
    if (existing.status !== 'pending_approval' && existing.status !== 'rejected') throw new BadRequestException(`A ${existing.status} charge cannot be edited`);
    return input;
  },
  afterWrite: submitOnCreate('driver_charge', driverCharges, 'approved', (r) => ({
    docNo: r.dcNo as string,
    title: `Driver charge: ${r.driverName}`,
    summary: r.description as string,
    amount: r.amount as number,
    vehicle: r.vehicleNo as string | null,
    link: '/driver-charges',
  })),
  canDelete: (row) => (row.recovered ? 'Part of this charge has been recovered; waive it instead' : null),
});
