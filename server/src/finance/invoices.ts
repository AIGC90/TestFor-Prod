import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { invoiceReceipts, invoices, parties, trips } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { AuditService } from '../erp/audit.service';
import { type CrudContext, crudController, validationError } from '../erp/crud';
import { NumberingService } from '../erp/numbering.service';
import { text } from '../erp/zod-helpers';
import { gstSplit } from '../inventory/docs';

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
export const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
const day = z.preprocess((v) => (v === '' || v === null ? undefined : v instanceof Date ? v.toISOString().slice(0, 10) : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').optional());

export type Invoice = typeof invoices.$inferSelect;
export const outstanding = (i: Pick<Invoice, 'total' | 'received'>) => r2(i.total - i.received);
export const daysOverdue = (i: Pick<Invoice, 'dueDate'>, on = today()) => Math.max(0, Math.round((new Date(`${on}T00:00:00Z`).getTime() - new Date(`${i.dueDate}T00:00:00Z`).getTime()) / DAY));

/** Receivables ageing by days past due. */
export function ageing(list: Pick<Invoice, 'dueDate' | 'total' | 'received' | 'status'>[], on = today()) {
  const buckets = [
    { bucket: 'Not due', amount: 0, count: 0 },
    { bucket: '1-30 days', amount: 0, count: 0 },
    { bucket: '31-60 days', amount: 0, count: 0 },
    { bucket: '61-90 days', amount: 0, count: 0 },
    { bucket: '90+ days', amount: 0, count: 0 },
  ];
  for (const i of list) {
    if (i.status === 'cancelled' || i.status === 'paid') continue;
    const d = daysOverdue(i, on);
    const b = d === 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4;
    buckets[b].amount = r2(buckets[b].amount + outstanding(i));
    buckets[b].count++;
  }
  return buckets;
}

async function totals(ctx: CrudContext, v: Record<string, unknown>) {
  const [c] = await ctx.db.select().from(parties).where(eq(parties.id, Number(v.customerId)));
  if (!c || !c.kinds.includes('customer')) throw new BadRequestException('customerId: choose a customer');
  const tax = gstSplit(Number(v.taxable), Number(v.gstRate), !v.interState);
  const invoiceDate = String(v.invoiceDate ?? today());
  return { ...v, ...tax, invoiceDate, dueDate: addDays(invoiceDate, c.creditDays ?? 30), total: r2(Number(v.taxable) + tax.cgst + tax.sgst + tax.igst) };
}

async function checkTrips(ctx: CrudContext, customerId: number, ids: number[], selfId?: number) {
  if (!ids.length) return [];
  const list = await ctx.db.select().from(trips).where(inArray(trips.id, ids));
  if (list.length !== ids.length) throw new BadRequestException('tripIds: a trip was not found');
  for (const t of list) {
    if (t.customerId !== customerId) throw new BadRequestException(`tripIds: ${t.tripNo} is for another customer`);
    if (t.status !== 'completed') throw new BadRequestException(`tripIds: ${t.tripNo} is not completed`);
  }
  const [taken] = await ctx.db
    .select({ invNo: invoices.invNo, tripIds: invoices.tripIds })
    .from(invoices)
    .where(and(ne(invoices.status, 'cancelled'), sql`${invoices.tripIds} && ${sql.raw(`ARRAY[${ids.map(Number).join(',')}]::int[]`)}`, selfId ? ne(invoices.id, selfId) : undefined));
  if (taken) throw new ConflictException(`tripIds: already billed on ${taken.invNo}`);
  return list;
}

export const InvoicesController = crudController({
  path: 'finance/invoices',
  docType: 'invoice',
  table: invoices,
  searchColumns: [invoices.invNo, invoices.lane, invoices.description],
  filters: { status: invoices.status, customerId: invoices.customerId },
  orderBy: [desc(invoices.invoiceDate), desc(invoices.id)],
  numbering: { prefix: 'INV', column: 'invNo' },
  schema: z.object({
    customerId: z.coerce.number().int().positive(),
    tripIds: z.array(z.coerce.number().int().positive()).max(200).default([]),
    lane: text(200),
    invoiceDate: day,
    description: text(1000),
    taxable: z.coerce.number().min(0).optional(),
    gstRate: z.coerce.number().refine((r) => [0, 5, 12, 18].includes(r), 'GST must be 0, 5, 12 or 18%').default(5),
    interState: z.coerce.number().int().min(0).max(1).default(0),
  }),
  beforeCreate: async (input, ctx) => {
    const list = await checkTrips(ctx, input.customerId as number, input.tripIds as number[]);
    const freight = r2(list.reduce((s, t) => s + (t.freight ?? 0), 0));
    const taxable = (input.taxable as number | undefined) ?? freight;
    if (!(taxable > 0)) throw new BadRequestException('taxable: enter the amount, or pick trips with freight');
    const lanes = [...new Set(list.map((t) => `${t.origin} → ${t.destination}`))];
    return totals(ctx, { ...input, taxable, lane: input.lane ?? (lanes.length === 1 ? lanes[0] : null), description: input.description ?? (list.length ? `Freight: ${list.map((t) => t.tripNo).join(', ')}` : null) });
  },
  beforeUpdate: async (input, existing, ctx) => {
    if (existing.received || existing.status !== 'open') throw new BadRequestException(`A ${existing.status === 'open' ? 'part-paid' : existing.status} invoice cannot be edited`);
    const merged = { ...existing, ...input };
    if (input.tripIds) await checkTrips(ctx, merged.customerId as number, input.tripIds as number[], existing.id as number);
    const t = await totals(ctx, merged);
    return { ...input, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total, dueDate: t.dueDate };
  },
  canDelete: (row) => ((row.received as number) > 0 ? 'Payments are recorded against this invoice; cancel it instead' : null),
});

const receiptBody = z.object({
  receivedOn: day,
  amount: z.coerce.number().min(0),
  tds: z.coerce.number().min(0).default(0),
  mode: z.enum(['neft', 'rtgs', 'upi', 'cheque', 'cash']).default('neft'),
  reference: text(80),
});

@Injectable()
export class InvoicesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  private async invoice(id: number) {
    const [i] = await this.db.select().from(invoices).where(eq(invoices.id, id));
    if (!i) throw new NotFoundException();
    return i;
  }

  /** Records a customer payment; TDS deducted by the customer counts towards settlement. */
  async receive(user: AuthUser, id: number, raw: unknown) {
    const parsed = receiptBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const d = parsed.data;
    const inv = await this.invoice(id);
    if (inv.status === 'cancelled' || inv.status === 'paid') throw new ConflictException(`${inv.invNo} is ${inv.status}`);
    const settle = r2(d.amount + d.tds);
    if (!(settle > 0)) throw new BadRequestException('amount: enter the amount received');
    if (settle > outstanding(inv)) throw new BadRequestException(`amount: only ₹${outstanding(inv)} is outstanding`);
    return this.db.transaction(async (tx) => {
      await tx.insert(invoiceReceipts).values({ invoiceId: id, receivedOn: d.receivedOn ?? today(), amount: d.amount, tds: d.tds, mode: d.mode, reference: d.reference, createdBy: user.id });
      const received = r2(inv.received + settle);
      const [row] = await tx.update(invoices).set({ received, status: received >= inv.total ? 'paid' : 'partly_paid', updatedAt: new Date() }).where(eq(invoices.id, id)).returning();
      await this.audit.log(user, 'receive', 'invoice', id, { amount: d.amount, tds: d.tds });
      return row;
    });
  }

  async cancel(user: AuthUser, id: number, reason: string) {
    const inv = await this.invoice(id);
    if (inv.received > 0) throw new ConflictException('Payments are recorded against this invoice; issue a credit note instead');
    if (inv.status === 'cancelled') throw new ConflictException('Already cancelled');
    if (!reason.trim()) throw new BadRequestException('reason is required');
    const [row] = await this.db.update(invoices).set({ status: 'cancelled', description: `${inv.description ?? ''}\nCancelled: ${reason}`.trim(), updatedAt: new Date() }).where(eq(invoices.id, id)).returning();
    await this.audit.log(user, 'cancel', 'invoice', id, { reason });
    return row;
  }

  /** Completed trips with freight that are not on any live invoice. */
  async unbilled(customerId?: number) {
    const billed = await this.db.select({ ids: invoices.tripIds }).from(invoices).where(ne(invoices.status, 'cancelled'));
    const done = new Set(billed.flatMap((b) => b.ids));
    const list = await this.db
      .select()
      .from(trips)
      .where(and(eq(trips.status, 'completed'), customerId ? eq(trips.customerId, customerId) : undefined))
      .orderBy(asc(trips.completedAt));
    return list.filter((t) => !done.has(t.id));
  }

  async receivables() {
    const [list, customers] = await Promise.all([
      this.db.select().from(invoices).where(inArray(invoices.status, ['open', 'partly_paid'])).orderBy(asc(invoices.dueDate)),
      this.db.select({ id: parties.id, name: parties.name }).from(parties),
    ]);
    const name = new Map(customers.map((c) => [c.id, c.name]));
    const byCustomer = new Map<number, { customerId: number; customer: string; outstanding: number; overdue: number; invoices: number }>();
    for (const i of list) {
      const c = byCustomer.get(i.customerId) ?? { customerId: i.customerId, customer: name.get(i.customerId) ?? `#${i.customerId}`, outstanding: 0, overdue: 0, invoices: 0 };
      c.outstanding = r2(c.outstanding + outstanding(i));
      if (daysOverdue(i) > 0) c.overdue = r2(c.overdue + outstanding(i));
      c.invoices++;
      byCustomer.set(i.customerId, c);
    }
    return {
      outstanding: r2(list.reduce((s, i) => s + outstanding(i), 0)),
      overdue: r2(list.filter((i) => daysOverdue(i) > 0).reduce((s, i) => s + outstanding(i), 0)),
      ageing: ageing(list),
      byCustomer: [...byCustomer.values()].sort((a, b) => b.outstanding - a.outstanding),
      open: list.map((i) => ({ ...i, customer: name.get(i.customerId) ?? null, outstanding: outstanding(i), daysOverdue: daysOverdue(i) })),
    };
  }
}

@Controller('finance')
export class InvoiceActionsController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly svc: InvoicesService,
    private readonly access: AccessService,
  ) {}

  @Get('unbilled-trips')
  async unbilled(@CurrentUser() u: AuthUser, @Query('customerId') customerId?: string) {
    await this.access.require(u, 'invoice', 'view');
    return this.svc.unbilled(customerId ? Number(customerId) : undefined);
  }

  @Get('receivables')
  async receivables(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'invoice', 'view');
    return this.svc.receivables();
  }

  @Get('invoices/:id/receipts')
  async receipts(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'invoice', 'view');
    return this.db.select().from(invoiceReceipts).where(eq(invoiceReceipts.invoiceId, id)).orderBy(desc(invoiceReceipts.receivedOn));
  }

  @Post('invoices/:id/receipts')
  async receive(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.access.require(u, 'invoice', 'edit');
    return this.svc.receive(u, id, body);
  }

  @Post('invoices/:id/cancel')
  async cancel(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: { reason?: string }) {
    await this.access.require(u, 'invoice', 'edit');
    return this.svc.cancel(u, id, String(body?.reason ?? ''));
  }
}
