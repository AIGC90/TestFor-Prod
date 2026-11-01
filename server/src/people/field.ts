import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, OnModuleInit, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { expenseClaims, fieldStaff, fieldTasks, staffAttendance } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { ApprovalsService } from '../erp/approvals.service';
import { AuditService } from '../erp/audit.service';
import { type CrudContext, crudController, validationError } from '../erp/crud';
import { requiredText, text } from '../erp/zod-helpers';

const DAY = 86_400_000;
const TZ = 'Asia/Kolkata';
/** Check-ins after this local time count as late. */
export const LATE_AFTER = '09:30';
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Calendar date in India for a timestamp. */
export const localDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
export const localTime = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const optCoord = z.coerce.number().min(-180).max(180).nullish().transform((v) => (v === undefined ? null : v));

export const FieldStaffController = crudController({
  path: 'field/staff',
  docType: 'field_staff',
  table: fieldStaff,
  searchColumns: [fieldStaff.name, fieldStaff.team, fieldStaff.city, fieldStaff.phone],
  filters: { role: fieldStaff.role, city: fieldStaff.city, status: fieldStaff.status, team: fieldStaff.team },
  orderBy: [asc(fieldStaff.name)],
  schema: z.object({
    name: requiredText(100),
    role: z.enum(['technician', 'collection', 'sales']),
    team: text(80),
    city: text(80),
    phone: text(30),
    traccarDeviceId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
    monthlyTarget: z.coerce.number().int().min(0).nullish().transform((v) => v ?? null),
    status: z.enum(['active', 'inactive']).default('active'),
  }),
  canDelete: async (row, ctx) => {
    const [t] = await ctx.db.select({ id: fieldTasks.id }).from(fieldTasks).where(eq(fieldTasks.staffId, row.id as number)).limit(1);
    return t ? 'This person has tasks; mark them inactive instead' : null;
  },
});

async function activeStaff(ctx: CrudContext, staffId: unknown) {
  const [s] = await ctx.db.select().from(fieldStaff).where(eq(fieldStaff.id, Number(staffId)));
  if (!s) throw new BadRequestException('staffId: not found');
  if (s.status !== 'active') throw new BadRequestException(`staffId: ${s.name} is inactive`);
  return s;
}

export const FieldTasksController = crudController({
  path: 'field/tasks',
  docType: 'field_staff',
  table: fieldTasks,
  searchColumns: [fieldTasks.ftNo, fieldTasks.title, fieldTasks.address, fieldTasks.city],
  filters: { status: fieldTasks.status, staffId: fieldTasks.staffId, kind: fieldTasks.kind, city: fieldTasks.city },
  orderBy: [desc(fieldTasks.dueAt), desc(fieldTasks.id)],
  numbering: { prefix: 'FT', column: 'ftNo' },
  schema: z.object({
    staffId: z.coerce.number().int().positive(),
    partyId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
    kind: z.enum(['installation', 'service', 'collection', 'sales_visit', 'other']),
    title: requiredText(200),
    address: text(300),
    city: text(80),
    dueAt: z.coerce.date(),
  }),
  beforeCreate: async (input, ctx) => {
    const s = await activeStaff(ctx, input.staffId);
    return { ...input, city: input.city ?? s.city };
  },
  beforeUpdate: async (input, existing, ctx) => {
    if (['done', 'cancelled'].includes(existing.status as string)) throw new BadRequestException(`A ${existing.status} task cannot be edited`);
    if (input.staffId) await activeStaff(ctx, input.staffId);
    return input;
  },
});

export const ExpenseClaimsController = crudController({
  path: 'field/claims',
  docType: 'expense_claim',
  table: expenseClaims,
  searchColumns: [expenseClaims.expNo, expenseClaims.description],
  filters: { status: expenseClaims.status, staffId: expenseClaims.staffId, category: expenseClaims.category },
  orderBy: [desc(expenseClaims.date), desc(expenseClaims.id)],
  numbering: { prefix: 'EXP', column: 'expNo' },
  schema: z.object({
    staffId: z.coerce.number().int().positive(),
    date: z.preprocess((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')),
    category: z.enum(['travel', 'fuel', 'food', 'lodging', 'tools', 'phone', 'other']),
    description: requiredText(500),
    amount: z.coerce.number().positive('enter the amount'),
  }),
  beforeCreate: async (input, ctx) => {
    await activeStaff(ctx, input.staffId);
    if (String(input.date) > localDate(new Date())) throw new BadRequestException('date: is in the future');
    return { ...input, status: 'pending_approval' };
  },
  beforeUpdate: (input, existing) => {
    if (!['pending_approval', 'rejected'].includes(existing.status as string)) throw new BadRequestException(`A ${existing.status} claim cannot be edited`);
    return input;
  },
  afterWrite: async (row, ctx, op) => {
    if (op !== 'create') return;
    const [s] = await ctx.db.select().from(fieldStaff).where(eq(fieldStaff.id, row.staffId as number));
    const approval = await ctx.get(ApprovalsService).submit(ctx.user, {
      docType: 'expense_claim',
      docId: row.id as number,
      docNo: row.expNo as string,
      title: `Expense claim: ${s?.name ?? ''}`,
      summary: `${row.category}: ${row.description}`,
      amount: row.amount as number,
      meta: { link: '/field-staff?tab=claims' },
    });
    if (!approval) {
      await ctx.db.update(expenseClaims).set({ status: 'approved' }).where(eq(expenseClaims.id, row.id as number));
      row.status = 'approved';
    }
  },
  canDelete: (row) => (row.status === 'paid' ? 'A paid claim cannot be deleted' : null),
});

/* ---------------------------------------------------------------- service */

const completeBody = z.object({
  outcome: requiredText(1000),
  amountCollected: z.coerce.number().min(0).nullish().transform((v) => (v === undefined ? null : v)),
  rating: z.coerce.number().int().min(1).max(5).nullish().transform((v) => v ?? null),
});
const checkBody = z.object({ staffId: z.coerce.number().int().positive(), latitude: optCoord, longitude: optCoord, km: z.coerce.number().min(0).max(2000).nullish() });

@Injectable()
export class FieldService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.approvals.onDecision('expense_claim', async (req, d) => {
      await this.db.update(expenseClaims).set({ status: d, updatedAt: new Date() }).where(eq(expenseClaims.id, req.docId));
    });
  }

  private async task(id: number) {
    const [t] = await this.db.select().from(fieldTasks).where(eq(fieldTasks.id, id));
    if (!t) throw new NotFoundException();
    return t;
  }

  async startTask(user: AuthUser, id: number) {
    const t = await this.task(id);
    if (t.status !== 'assigned') throw new ConflictException(`${t.ftNo} is ${t.status.replace('_', ' ')}`);
    const [row] = await this.db.update(fieldTasks).set({ status: 'in_progress', startedAt: new Date(), updatedAt: new Date() }).where(eq(fieldTasks.id, id)).returning();
    await this.audit.log(user, 'start', 'field_staff', id);
    return row;
  }

  async completeTask(user: AuthUser, id: number, raw: unknown) {
    const parsed = completeBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const t = await this.task(id);
    if (!['assigned', 'in_progress'].includes(t.status)) throw new ConflictException(`${t.ftNo} is ${t.status}`);
    if (t.kind === 'collection' && parsed.data.amountCollected === null) throw new BadRequestException('amountCollected: enter the amount collected (0 if nothing)');
    const now = new Date();
    const [row] = await this.db
      .update(fieldTasks)
      .set({ status: 'done', startedAt: t.startedAt ?? now, completedAt: now, ...parsed.data, updatedAt: now })
      .where(eq(fieldTasks.id, id))
      .returning();
    await this.audit.log(user, 'complete', 'field_staff', id, parsed.data);
    return row;
  }

  async cancelTask(user: AuthUser, id: number, reason: string) {
    const t = await this.task(id);
    if (['done', 'cancelled'].includes(t.status)) throw new ConflictException(`${t.ftNo} is ${t.status}`);
    if (!reason.trim()) throw new BadRequestException('reason is required');
    const [row] = await this.db.update(fieldTasks).set({ status: 'cancelled', outcome: reason.trim(), updatedAt: new Date() }).where(eq(fieldTasks.id, id)).returning();
    await this.audit.log(user, 'cancel', 'field_staff', id, { reason });
    return row;
  }

  async check(user: AuthUser, kind: 'in' | 'out', raw: unknown) {
    const parsed = checkBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const d = parsed.data;
    const now = new Date();
    const date = localDate(now);
    const [s] = await this.db.select().from(fieldStaff).where(eq(fieldStaff.id, d.staffId));
    if (!s || s.status !== 'active') throw new BadRequestException('staffId: not an active staff member');
    const [today] = await this.db.select().from(staffAttendance).where(and(eq(staffAttendance.staffId, d.staffId), eq(staffAttendance.date, date)));
    if (kind === 'in') {
      if (today?.checkIn) throw new ConflictException(`${s.name} already checked in at ${localTime(today.checkIn)}`);
      const [row] = await this.db.insert(staffAttendance).values({ staffId: d.staffId, date, checkIn: now, checkInLat: d.latitude, checkInLon: d.longitude }).returning();
      return row;
    }
    if (!today?.checkIn) throw new ConflictException(`${s.name} has not checked in today`);
    if (today.checkOut) throw new ConflictException(`${s.name} already checked out`);
    const [row] = await this.db
      .update(staffAttendance)
      .set({ checkOut: now, km: d.km ?? null })
      .where(and(eq(staffAttendance.staffId, d.staffId), eq(staffAttendance.date, date)))
      .returning();
    await this.audit.log(user, 'check_out', 'field_staff', d.staffId);
    return row;
  }

  async payClaim(user: AuthUser, id: number) {
    const [c] = await this.db.select().from(expenseClaims).where(eq(expenseClaims.id, id));
    if (!c) throw new NotFoundException();
    if (c.status !== 'approved') throw new ConflictException(`Claim is ${c.status.replace('_', ' ')}`);
    const [row] = await this.db.update(expenseClaims).set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() }).where(eq(expenseClaims.id, id)).returning();
    await this.audit.log(user, 'pay', 'expense_claim', id, { amount: c.amount });
    return row;
  }

  async attendance(days: number) {
    const from = localDate(new Date(Date.now() - (days - 1) * DAY));
    const [staff, rows] = await Promise.all([
      this.db.select().from(fieldStaff).where(eq(fieldStaff.status, 'active')).orderBy(asc(fieldStaff.name)),
      this.db.select().from(staffAttendance).where(gte(staffAttendance.date, from)),
    ]);
    const dates = Array.from({ length: days }, (_, i) => localDate(new Date(Date.now() - (days - 1 - i) * DAY)));
    return {
      dates,
      lateAfter: LATE_AFTER,
      staff: staff.map((s) => {
        const mine = rows.filter((r) => r.staffId === s.id);
        return {
          staffId: s.id,
          name: s.name,
          city: s.city,
          days: dates.map((d) => {
            const r = mine.find((x) => x.date === d);
            const hours = r?.checkIn && r.checkOut ? r1((r.checkOut.getTime() - r.checkIn.getTime()) / 3_600_000) : null;
            return { date: d, checkIn: r?.checkIn ? localTime(r.checkIn) : null, checkOut: r?.checkOut ? localTime(r.checkOut) : null, hours, km: r?.km ?? null, late: !!r?.checkIn && localTime(r.checkIn) > LATE_AFTER };
          }),
          present: mine.filter((r) => r.checkIn).length,
          km: Math.round(mine.reduce((t, r) => t + (r.km ?? 0), 0)),
        };
      }),
    };
  }

  /** Leaderboard over `days` days: visits done, completion, on-time rate, rating, km and a combined score. */
  async performance(days: number) {
    const since = new Date(Date.now() - days * DAY);
    const [staff, tasks, att] = await Promise.all([
      this.db.select().from(fieldStaff).where(eq(fieldStaff.status, 'active')),
      this.db.select().from(fieldTasks).where(gte(fieldTasks.dueAt, since)),
      this.db.select().from(staffAttendance).where(gte(staffAttendance.date, localDate(since))),
    ]);
    const now = new Date();
    return staff
      .map((s) => {
        const mine = tasks.filter((t) => t.staffId === s.id && t.status !== 'cancelled');
        const done = mine.filter((t) => t.status === 'done');
        const due = mine.filter((t) => t.status === 'done' || t.dueAt < now);
        const onTime = done.filter((t) => t.completedAt && t.completedAt <= t.dueAt);
        const rated = done.filter((t) => t.rating);
        const rating = rated.length ? r1(rated.reduce((x, t) => x + t.rating!, 0) / rated.length) : null;
        const completion = due.length ? Math.round((done.length / due.length) * 100) : null;
        const onTimePct = done.length ? Math.round((onTime.length / done.length) * 100) : null;
        const target = s.monthlyTarget ? Math.round((s.monthlyTarget * days) / 30) : null;
        const targetPct = target ? Math.min(100, Math.round((done.length / target) * 100)) : null;
        // weighted score: completion 40%, on time 30%, rating 20%, target 10%
        const parts: [number | null, number][] = [[completion, 0.4], [onTimePct, 0.3], [rating !== null ? rating * 20 : null, 0.2], [targetPct, 0.1]];
        const used = parts.filter(([v]) => v !== null);
        const score = used.length ? Math.round(used.reduce((x, [v, w]) => x + v! * w, 0) / used.reduce((x, [, w]) => x + w, 0)) : null;
        return {
          staffId: s.id,
          name: s.name,
          role: s.role,
          team: s.team,
          city: s.city,
          visits: done.length,
          open: mine.filter((t) => ['assigned', 'in_progress'].includes(t.status)).length,
          completion,
          onTime: onTimePct,
          rating,
          collected: done.reduce((x, t) => x + (t.amountCollected ?? 0), 0),
          km: Math.round(att.filter((a) => a.staffId === s.id).reduce((x, a) => x + (a.km ?? 0), 0)),
          target,
          score,
        };
      })
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }

  async overview() {
    const now = new Date();
    const today = localDate(now);
    const [staff, att, tasks, claims, recent] = await Promise.all([
      this.db.select().from(fieldStaff).where(eq(fieldStaff.status, 'active')),
      this.db.select().from(staffAttendance).where(eq(staffAttendance.date, today)),
      this.db.select().from(fieldTasks).where(gte(fieldTasks.dueAt, new Date(now.getTime() - 2 * DAY))),
      this.db.select().from(expenseClaims).where(eq(expenseClaims.status, 'pending_approval')),
      this.db.select().from(fieldTasks).where(eq(fieldTasks.status, 'done')).orderBy(desc(fieldTasks.completedAt)).limit(10),
    ]);
    const todays = tasks.filter((t) => localDate(t.dueAt) === today);
    const perf = await this.performance(30);
    const statusOf = (id: number) => {
      const a = att.find((x) => x.staffId === id);
      if (!a?.checkIn) return 'not_checked_in';
      if (a.checkOut) return 'checked_out';
      return tasks.some((t) => t.staffId === id && t.status === 'in_progress') ? 'on_task' : 'available';
    };
    const ratings = perf.filter((p) => p.rating !== null);
    const hours = Array.from({ length: 12 }, (_, i) => i + 8).map((h) => ({
      hour: `${String(h).padStart(2, '0')}:00`,
      due: todays.filter((t) => Number(localTime(t.dueAt).slice(0, 2)) === h).length,
      done: todays.filter((t) => t.completedAt && Number(localTime(t.completedAt).slice(0, 2)) === h).length,
    }));
    return {
      onDuty: att.filter((a) => a.checkIn && !a.checkOut).length,
      staff: staff.length,
      tasksToday: todays.length,
      doneToday: todays.filter((t) => t.status === 'done').length,
      collectedToday: todays.reduce((x, t) => x + (t.amountCollected ?? 0), 0),
      lateCheckIns: att.filter((a) => a.checkIn && localTime(a.checkIn) > LATE_AFTER).length,
      claimsPending: claims.length,
      claimsPendingAmount: claims.reduce((x, c) => x + c.amount, 0),
      avgRating: ratings.length ? r1(ratings.reduce((x, p) => x + p.rating!, 0) / ratings.length) : null,
      teamScore: perf.filter((p) => p.score !== null).length ? Math.round(perf.filter((p) => p.score !== null).reduce((x, p) => x + p.score!, 0) / perf.filter((p) => p.score !== null).length) : null,
      cities: [...new Set(staff.map((s) => s.city).filter(Boolean))],
      team: staff.map((s) => ({ staffId: s.id, name: s.name, role: s.role, city: s.city, phone: s.phone, traccarDeviceId: s.traccarDeviceId, status: statusOf(s.id), checkIn: att.find((a) => a.staffId === s.id)?.checkIn ?? null, tasksToday: todays.filter((t) => t.staffId === s.id).length })),
      todaysTasks: todays.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()),
      byHour: hours,
      recentlyCompleted: recent,
    };
  }
}

@Controller('field')
export class FieldController {
  constructor(
    private readonly svc: FieldService,
    private readonly access: AccessService,
  ) {}

  private view = (u: AuthUser) => this.access.require(u, 'field_staff', 'view');
  private edit = (u: AuthUser) => this.access.require(u, 'field_staff', 'edit');

  @Get('overview')
  async overview(@CurrentUser() u: AuthUser) {
    await this.view(u);
    return this.svc.overview();
  }

  @Get('attendance')
  async attendance(@CurrentUser() u: AuthUser, @Query('days') days = '14') {
    await this.view(u);
    return this.svc.attendance(Math.min(62, Math.max(1, Number(days) || 14)));
  }

  @Get('performance')
  async performance(@CurrentUser() u: AuthUser, @Query('days') days = '30') {
    await this.view(u);
    return this.svc.performance(Math.min(365, Math.max(1, Number(days) || 30)));
  }

  @Post('tasks/:id/start')
  async start(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.edit(u);
    return this.svc.startTask(u, id);
  }

  @Post('tasks/:id/complete')
  async complete(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.edit(u);
    return this.svc.completeTask(u, id, body);
  }

  @Post('tasks/:id/cancel')
  async cancel(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: { reason?: string }) {
    await this.edit(u);
    return this.svc.cancelTask(u, id, String(body?.reason ?? ''));
  }

  @Post('check-in')
  async checkIn(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    await this.edit(u);
    return this.svc.check(u, 'in', body);
  }

  @Post('check-out')
  async checkOut(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    await this.edit(u);
    return this.svc.check(u, 'out', body);
  }

  @Post('claims/:id/pay')
  async pay(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'expense_claim', 'edit');
    return this.svc.payClaim(u, id);
  }
}
