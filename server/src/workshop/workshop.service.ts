import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, OnModuleInit, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { driverCharges, gatePasses, jobCards, pmSchedules, repairBills } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { ApprovalsService } from '../erp/approvals.service';
import { AuditService } from '../erp/audit.service';
import { validationError } from '../erp/crud';
import { NumberingService } from '../erp/numbering.service';
import { text } from '../erp/zod-helpers';
import { StockService } from '../inventory/stock.service';
import { OdometerService, vehicleKey } from '../traccar/odometer.service';
import { DEFAULT_TOOLS, SERVICE_TYPES } from './docs';

type Pm = typeof pmSchedules.$inferSelect;
export type PmStatus = 'overdue' | 'due_soon' | 'ok' | 'unknown';
const DAY = 86_400_000;
export const DUE_SOON_KM = 1500;
export const DUE_SOON_DAYS = 7;

/** When a PM task is next due, by km and/or days, and how urgent it is. */
export function pmDue(s: Pick<Pm, 'intervalKm' | 'intervalDays' | 'lastDoneAt' | 'lastDoneKm'>, currentKm: number | null, now = new Date()) {
  const nextDueKm = s.intervalKm !== null && s.lastDoneKm !== null ? s.lastDoneKm + s.intervalKm : null;
  const nextDueDate = s.intervalDays !== null && s.lastDoneAt ? new Date(s.lastDoneAt.getTime() + s.intervalDays * DAY) : null;
  const kmLeft = nextDueKm !== null && currentKm !== null ? Math.round((nextDueKm - currentKm) * 10) / 10 : null;
  const daysLeft = nextDueDate ? Math.ceil((nextDueDate.getTime() - now.getTime()) / DAY) : null;
  let status: PmStatus = 'unknown';
  if (kmLeft !== null || daysLeft !== null) {
    if ((kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft <= 0)) status = 'overdue';
    else if ((kmLeft !== null && kmLeft <= DUE_SOON_KM) || (daysLeft !== null && daysLeft <= DUE_SOON_DAYS)) status = 'due_soon';
    else status = 'ok';
  }
  return { currentKm, nextDueKm, nextDueDate: nextDueDate?.toISOString() ?? null, kmLeft, daysLeft, status };
}

const partsBody = z.object({
  storeId: z.coerce.number().int().positive().optional(),
  lines: z.array(z.object({ itemId: z.coerce.number().int().positive(), qty: z.coerce.number().positive(), serials: z.array(z.string().trim().min(1)).default([]) })).min(1).max(50),
});
const completeBody = z.object({ workDone: z.string().trim().min(3, 'describe the work done').max(2000), labourCost: z.coerce.number().min(0).optional(), runningKm: z.coerce.number().min(0).nullish() });

@Injectable()
export class WorkshopService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly approvals: ApprovalsService,
    private readonly stock: StockService,
    private readonly odometers: OdometerService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.approvals.onDecision('job_card', async (req, d) => {
      await this.db.update(jobCards).set({ status: d === 'approved' ? 'open' : 'rejected', updatedAt: new Date() }).where(eq(jobCards.id, req.docId));
    });
    this.approvals.onDecision('gate_pass', async (req, d) => {
      await this.db.update(gatePasses).set({ status: d === 'approved' ? 'out' : 'rejected', updatedAt: new Date() }).where(eq(gatePasses.id, req.docId));
    });
    this.approvals.onDecision('repair_bill', async (req, d) => {
      await this.db.update(repairBills).set({ status: d, updatedAt: new Date() }).where(eq(repairBills.id, req.docId));
    });
    this.approvals.onDecision('driver_charge', async (req, d) => {
      await this.db.update(driverCharges).set({ status: d, updatedAt: new Date() }).where(eq(driverCharges.id, req.docId));
    });
  }

  private async job(id: number) {
    const [j] = await this.db.select().from(jobCards).where(eq(jobCards.id, id));
    if (!j) throw new NotFoundException();
    return j;
  }

  private async setJob(user: AuthUser, id: number, values: Partial<typeof jobCards.$inferInsert>, action: string) {
    const [row] = await this.db.update(jobCards).set({ ...values, updatedAt: new Date() }).where(eq(jobCards.id, id)).returning();
    await this.audit.log(user, action, 'job_card', id, values);
    return row;
  }

  async submitJob(user: AuthUser, id: number) {
    const j = await this.job(id);
    if (j.status !== 'draft' && j.status !== 'rejected') throw new ConflictException(`Job card is ${j.status.replace('_', ' ')}`);
    const approval = await this.approvals.submit(user, {
      docType: 'job_card',
      docId: j.id,
      docNo: j.jcNo,
      title: `${j.serviceType}: ${j.vehicleNo}`,
      summary: j.problem,
      amount: j.estimatedCost,
      priority: j.priority === 'high' ? 'high' : 'normal',
      meta: { vehicle: j.vehicleNo, link: '/job-cards' },
    });
    return this.setJob(user, id, { status: approval ? 'pending_approval' : 'open' }, 'submit');
  }

  async moveJob(user: AuthUser, id: number, to: 'in_progress' | 'awaiting_spares' | 'cancelled') {
    const j = await this.job(id);
    const allowed: Record<string, string[]> = {
      in_progress: ['open', 'awaiting_spares'],
      awaiting_spares: ['open', 'in_progress'],
      cancelled: ['draft', 'pending_approval', 'open', 'in_progress', 'awaiting_spares', 'rejected'],
    };
    if (!allowed[to].includes(j.status)) throw new ConflictException(`A ${j.status.replace('_', ' ')} job card cannot move to ${to.replace('_', ' ')}`);
    return this.setJob(user, id, { status: to }, to);
  }

  /** Issues spares from a store to the vehicle and adds them to the job card cost. */
  async issueParts(user: AuthUser, id: number, raw: unknown) {
    const parsed = partsBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const j = await this.job(id);
    if (!['open', 'in_progress', 'awaiting_spares'].includes(j.status)) throw new ConflictException(`Parts can only be issued to an open job card (this one is ${j.status.replace('_', ' ')})`);
    const storeId = parsed.data.storeId ?? j.storeId;
    if (!storeId) throw new BadRequestException('storeId: choose the store the parts come from');
    return this.db.transaction(async (tx) => {
      const added = [];
      for (const l of parsed.data.lines) {
        const m = await this.stock.postInTx(tx, { kind: 'issue', itemId: l.itemId, storeId, qty: l.qty, serials: l.serials, vehicleNo: j.vehicleNo, refType: 'job_card', refId: j.id, refNo: j.jcNo }, user);
        added.push({ itemId: l.itemId, qty: l.qty, serials: l.serials, value: m.value, movementId: m.id });
      }
      const parts = [...j.parts, ...added];
      const [row] = await tx
        .update(jobCards)
        .set({ parts, partsCost: Math.round(parts.reduce((s, p) => s + p.value, 0) * 100) / 100, status: j.status === 'awaiting_spares' ? 'in_progress' : j.status, updatedAt: new Date() })
        .where(eq(jobCards.id, id))
        .returning();
      await this.audit.log(user, 'issue_parts', 'job_card', id, { lines: added.length });
      return row;
    });
  }

  /** Completes the job; a linked PM schedule is reset from this service. */
  async completeJob(user: AuthUser, id: number, raw: unknown) {
    const parsed = completeBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const j = await this.job(id);
    if (!['open', 'in_progress', 'awaiting_spares'].includes(j.status)) throw new ConflictException(`Job card is ${j.status.replace('_', ' ')}`);
    const now = new Date();
    const runningKm = parsed.data.runningKm ?? j.runningKm;
    const row = await this.setJob(user, id, { status: 'completed', workDone: parsed.data.workDone, labourCost: parsed.data.labourCost ?? j.labourCost, runningKm, closedAt: now }, 'complete');
    if (j.pmScheduleId) {
      await this.db.update(pmSchedules).set({ lastDoneAt: now, lastDoneKm: runningKm ?? null, updatedAt: now }).where(eq(pmSchedules.id, j.pmScheduleId));
    }
    return row;
  }

  async pmDue(user: AuthUser, vehicleNo?: string) {
    const list = await this.db.select().from(pmSchedules).where(vehicleNo ? eq(pmSchedules.vehicleNo, vehicleNo.toUpperCase()) : undefined);
    const odo = await this.odometers.readings(user.cookie);
    const rank: Record<PmStatus, number> = { overdue: 0, due_soon: 1, unknown: 2, ok: 3 };
    return list
      .map((s) => ({ ...s, ...pmDue(s, odo.get(vehicleKey(s.vehicleNo)) ?? null) }))
      .sort((a, b) => rank[a.status] - rank[b.status] || (a.kmLeft ?? 1e9) - (b.kmLeft ?? 1e9));
  }

  /** Opens a job card for a PM task with the vehicle's current odometer. */
  async jobFromPm(user: AuthUser, pmId: number) {
    const [s] = await this.db.select().from(pmSchedules).where(eq(pmSchedules.id, pmId));
    if (!s) throw new NotFoundException();
    const odo = await this.odometers.readings(user.cookie);
    const [row] = await this.db
      .insert(jobCards)
      .values({
        jcNo: await this.numbering.next('JC'),
        vehicleNo: s.vehicleNo,
        serviceType: 'Preventive Maintenance',
        pmScheduleId: s.id,
        runningKm: odo.get(vehicleKey(s.vehicleNo)) ?? null,
        problem: s.task,
        status: 'draft',
        createdBy: user.id,
      })
      .returning();
    await this.audit.log(user, 'create', 'job_card', row.id, { fromPm: pmId });
    return row;
  }

  /** Creates the usual PM tasks for a vehicle that has none yet. */
  async seedPm(user: AuthUser, vehicleNo: string) {
    const v = vehicleNo.trim().toUpperCase();
    if (v.length < 4) throw new BadRequestException('vehicleNo is required');
    const existing = await this.db.select({ id: pmSchedules.id }).from(pmSchedules).where(eq(pmSchedules.vehicleNo, v));
    if (existing.length) throw new ConflictException(`${v} already has ${existing.length} PM schedules`);
    const odo = (await this.odometers.readings(user.cookie)).get(vehicleKey(v)) ?? null;
    const defaults: [string, string, number, number][] = [
      ['Engine oil, oil filter & fuel filters', 'Engine & fluids', 15000, 90],
      ['Air brake chambers, valves & drums inspection', 'Brakes & safety', 20000, 120],
      ['Transmission & differential oil', 'Drivetrain', 40000, 180],
      ['Front axle greasing & wheel bearings', 'Chassis & suspension', 10000, 60],
      ['Tyre rotation & wheel balancing', 'Tyres & wheels', 15000, 90],
      ['Battery, alternator & terminals', 'Electrical', 12000, 90],
      ['Air filter cleaning', 'Intake', 10000, 45],
      ['Coolant flush & top-up', 'Engine & fluids', 30000, 180],
    ];
    const rows = await this.db
      .insert(pmSchedules)
      .values(defaults.map(([task, category, intervalKm, intervalDays]) => ({ vehicleNo: v, task, category, intervalKm, intervalDays, lastDoneAt: new Date(), lastDoneKm: odo, createdBy: user.id })))
      .returning();
    await this.audit.log(user, 'seed', 'pm_schedule', v, { count: rows.length });
    return rows;
  }

  async returnGatePass(user: AuthUser, id: number) {
    const [g] = await this.db.select().from(gatePasses).where(eq(gatePasses.id, id));
    if (!g) throw new NotFoundException();
    if (g.status !== 'out') throw new ConflictException(`Gate pass is ${g.status.replace('_', ' ')}`);
    const status = g.kind === 'transfer' ? 'closed' : 'returned';
    const [row] = await this.db.update(gatePasses).set({ status, returnedAt: new Date(), updatedAt: new Date() }).where(eq(gatePasses.id, id)).returning();
    await this.audit.log(user, status, 'gate_pass', id);
    return row;
  }

  async payBill(user: AuthUser, id: number, paymentRef?: string | null) {
    const [b] = await this.db.select().from(repairBills).where(eq(repairBills.id, id));
    if (!b) throw new NotFoundException();
    if (b.status !== 'approved') throw new ConflictException(`Only an approved bill can be paid (this one is ${b.status.replace('_', ' ')})`);
    const [row] = await this.db.update(repairBills).set({ status: 'paid', paidAt: new Date(), paymentRef: paymentRef ?? null, updatedAt: new Date() }).where(eq(repairBills.id, id)).returning();
    await this.audit.log(user, 'pay', 'repair_bill', id, { paymentRef });
    return row;
  }

  async recoverCharge(user: AuthUser, id: number, amount: number) {
    const [c] = await this.db.select().from(driverCharges).where(eq(driverCharges.id, id));
    if (!c) throw new NotFoundException();
    if (c.status !== 'approved') throw new ConflictException(`Charge is ${c.status.replace('_', ' ')}`);
    if (!(amount > 0)) throw new BadRequestException('amount must be positive');
    const recovered = Math.round((c.recovered + amount) * 100) / 100;
    if (recovered > c.amount) throw new BadRequestException(`Only SAR ${c.amount - c.recovered} is left to recover`);
    const [row] = await this.db
      .update(driverCharges)
      .set({ recovered, status: recovered >= c.amount ? 'recovered' : 'approved', updatedAt: new Date() })
      .where(eq(driverCharges.id, id))
      .returning();
    await this.audit.log(user, 'recover', 'driver_charge', id, { amount });
    return row;
  }

  async waiveCharge(user: AuthUser, id: number, reason: string) {
    const [c] = await this.db.select().from(driverCharges).where(eq(driverCharges.id, id));
    if (!c) throw new NotFoundException();
    if (!['approved', 'pending_approval'].includes(c.status)) throw new ConflictException(`Charge is ${c.status}`);
    const [row] = await this.db.update(driverCharges).set({ status: 'waived', description: `${c.description}\nWaived: ${reason}`, updatedAt: new Date() }).where(eq(driverCharges.id, id)).returning();
    await this.audit.log(user, 'waive', 'driver_charge', id, { reason });
    return row;
  }

  /** Workshop hub numbers for the last `days` days. */
  async summary(user: AuthUser, days: number) {
    const since = new Date(Date.now() - days * DAY);
    const open = await this.db.select().from(jobCards).where(inArray(jobCards.status, ['draft', 'pending_approval', 'open', 'in_progress', 'awaiting_spares']));
    const closed = await this.db.select().from(jobCards).where(and(eq(jobCards.status, 'completed'), gte(jobCards.closedAt, since)));
    const pm = await this.pmDue(user);
    const passes = await this.db.select().from(gatePasses).where(eq(gatePasses.status, 'out'));
    const [owed] = await this.db
      .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${repairBills.netPayable}), 0)::float` })
      .from(repairBills)
      .where(inArray(repairBills.status, ['approved', 'pending_approval']));
    const spendOf = (j: typeof closed[number]) => j.partsCost + j.labourCost;
    const byType: Record<string, number> = {};
    const byVehicle: Record<string, { cards: number; spend: number }> = {};
    for (const j of closed) {
      byType[j.jobType] = (byType[j.jobType] ?? 0) + spendOf(j);
      byVehicle[j.vehicleNo] = { cards: (byVehicle[j.vehicleNo]?.cards ?? 0) + 1, spend: (byVehicle[j.vehicleNo]?.spend ?? 0) + spendOf(j) };
    }
    const turnaround = closed.filter((j) => j.closedAt).map((j) => (j.closedAt!.getTime() - j.openedAt.getTime()) / DAY);
    const now = Date.now();
    return {
      openJobs: open.length,
      inProgress: open.filter((j) => j.status === 'in_progress').length,
      awaitingSpares: open.filter((j) => j.status === 'awaiting_spares').length,
      agingOver7Days: open.filter((j) => now - j.openedAt.getTime() > 7 * DAY).length,
      pmOverdue: pm.filter((p) => p.status === 'overdue').length,
      pmDueSoon: pm.filter((p) => p.status === 'due_soon').length,
      gatePassesOut: passes.length,
      gatePassesOverdue: passes.filter((g) => g.expectedReturn && g.expectedReturn.getTime() < now).length,
      owedToGarages: owed.total,
      unpaidBills: owed.n,
      closed: closed.length,
      spend: Math.round(closed.reduce((s, j) => s + spendOf(j), 0)),
      partsSpend: Math.round(closed.reduce((s, j) => s + j.partsCost, 0)),
      labourSpend: Math.round(closed.reduce((s, j) => s + j.labourCost, 0)),
      avgTurnaroundDays: turnaround.length ? Math.round((turnaround.reduce((a, b) => a + b, 0) / turnaround.length) * 10) / 10 : null,
      openByService: Object.entries(open.reduce<Record<string, number>>((a, j) => ((a[j.serviceType] = (a[j.serviceType] ?? 0) + 1), a), {})).map(([name, value]) => ({ name, value })),
      spendByJobType: Object.entries(byType).map(([name, value]) => ({ name, value: Math.round(value) })),
      costliestVehicles: Object.entries(byVehicle).map(([vehicleNo, v]) => ({ vehicleNo, ...v, spend: Math.round(v.spend) })).sort((a, b) => b.spend - a.spend).slice(0, 5),
      pmNext: pm.filter((p) => p.status === 'overdue' || p.status === 'due_soon').slice(0, 6),
      openJobList: open.slice(0, 10),
    };
  }
}

@Controller('workshop')
export class WorkshopActionsController {
  constructor(
    private readonly ws: WorkshopService,
    private readonly access: AccessService,
  ) {}

  @Get('meta')
  meta() {
    return { serviceTypes: SERVICE_TYPES, tools: DEFAULT_TOOLS };
  }

  @Get('summary')
  async summary(@CurrentUser() u: AuthUser, @Query('days') days?: string) {
    await this.access.require(u, 'job_card', 'view');
    return this.ws.summary(u, Math.min(Math.max(Number(days) || 30, 1), 365));
  }

  @Post('job-cards/:id/submit')
  async submit(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'job_card', 'create');
    return this.ws.submitJob(u, id);
  }

  @Post('job-cards/:id/start')
  async start(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'job_card', 'edit');
    return this.ws.moveJob(u, id, 'in_progress');
  }

  @Post('job-cards/:id/await-spares')
  async awaitSpares(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'job_card', 'edit');
    return this.ws.moveJob(u, id, 'awaiting_spares');
  }

  @Post('job-cards/:id/cancel')
  async cancel(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'job_card', 'edit');
    return this.ws.moveJob(u, id, 'cancelled');
  }

  @Post('job-cards/:id/parts')
  async parts(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.access.require(u, 'job_card', 'edit');
    await this.access.require(u, 'stock_movement', 'create');
    return this.ws.issueParts(u, id, body);
  }

  @Post('job-cards/:id/complete')
  async complete(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.access.require(u, 'job_card', 'edit');
    return this.ws.completeJob(u, id, body);
  }

  @Get('pm-due')
  async pmDue(@CurrentUser() u: AuthUser, @Query('vehicleNo') vehicleNo?: string) {
    await this.access.require(u, 'pm_schedule', 'view');
    return this.ws.pmDue(u, vehicleNo);
  }

  @Post('pm-schedules/:id/job-card')
  async jobFromPm(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'job_card', 'create');
    return this.ws.jobFromPm(u, id);
  }

  @Post('pm-seed')
  async seedPm(@CurrentUser() u: AuthUser, @Body() body: { vehicleNo?: string }) {
    await this.access.require(u, 'pm_schedule', 'create');
    return this.ws.seedPm(u, String(body?.vehicleNo ?? ''));
  }

  @Post('gate-passes/:id/return')
  async gpReturn(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'gate_pass', 'edit');
    return this.ws.returnGatePass(u, id);
  }

  @Post('repair-bills/:id/pay')
  async pay(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: { paymentRef?: string }) {
    await this.access.require(u, 'repair_bill', 'edit');
    const ref = text(60).safeParse(body?.paymentRef);
    return this.ws.payBill(u, id, ref.success ? ref.data : null);
  }

  @Post('driver-charges/:id/recover')
  async recover(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: { amount?: unknown }) {
    await this.access.require(u, 'driver_charge', 'edit');
    return this.ws.recoverCharge(u, id, Number(body?.amount));
  }

  @Post('driver-charges/:id/waive')
  async waive(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: { reason?: string }) {
    await this.access.require(u, 'driver_charge', 'edit');
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 3) throw new BadRequestException('Give a reason for waiving');
    return this.ws.waiveCharge(u, id, reason);
  }
}
