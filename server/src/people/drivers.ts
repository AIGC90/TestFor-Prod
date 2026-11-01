import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, OnModuleInit, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { driverAssignments, driverAttendance, driverCharges, driverProfiles, type PayrollLine, payrollRuns, trips } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { ApprovalsService } from '../erp/approvals.service';
import { AuditService } from '../erp/audit.service';
import { crudController, validationError } from '../erp/crud';
import { NumberingService } from '../erp/numbering.service';
import { pattern, requiredText, text } from '../erp/zod-helpers';
import { vehicleKey } from '../traccar/odometer.service';
import { TraccarService } from '../traccar/traccar.service';
import { WorkshopService } from '../workshop/workshop.service';

export const ATTENDANCE_CODES = { P: 'Present', H: 'Half day', L: 'Paid leave', A: 'Absent', WO: 'Weekly off' } as const;
type Code = keyof typeof ATTENDANCE_CODES;
/** Daily driving limit used for the working-hours compliance check. */
export const DRIVING_LIMIT_HOURS = 9;
const HARSH = ['hardBraking', 'hardAcceleration', 'hardCornering'];
const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').nullish()).transform((v) => v ?? null);
const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;

export const DriverProfilesController = crudController({
  path: 'drivers/profiles',
  docType: 'payroll',
  table: driverProfiles,
  searchColumns: [driverProfiles.name, driverProfiles.phone, driverProfiles.licenceNo],
  filters: { status: driverProfiles.status },
  orderBy: [asc(driverProfiles.name)],
  schema: z.object({
    traccarDriverId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
    name: requiredText(100),
    phone: text(30),
    licenceNo: text(30),
    licenceExpiry: day,
    aadhar: pattern(/^\d{12}$/, 'Aadhar number (12 digits)'),
    monthlySalary: z.coerce.number().min(0).default(0),
    dailyBata: z.coerce.number().min(0).default(0),
    tripAllowance: z.coerce.number().min(0).default(0),
    status: z.enum(['active', 'inactive']).default('active'),
    joinedOn: day,
    notes: text(1000),
  }),
  afterWrite: async (row, ctx, op) => {
    // an inactive driver gives up the truck
    if (op === 'update' && row.status === 'inactive') {
      await ctx.db.update(driverAssignments).set({ toAt: new Date() }).where(and(eq(driverAssignments.driverId, row.id as number), isNull(driverAssignments.toAt)));
    }
  },
  canDelete: async (row, ctx) => {
    const [a] = await ctx.db.select({ id: driverAssignments.id }).from(driverAssignments).where(eq(driverAssignments.driverId, row.id as number)).limit(1);
    return a ? 'This driver has assignment history; mark them inactive instead' : null;
  },
});

/* ---------------------------------------------------------- pure helpers */

export const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Paid days: present, weekly off and paid leave count fully, a half day counts half. */
export function attendanceTotals(codes: string[]) {
  const n = (c: Code) => codes.filter((x) => x === c).length;
  const present = n('P') + n('H') * 0.5;
  return { present, paid: present + n('L') + n('WO'), absent: n('A'), leave: n('L'), weeklyOff: n('WO'), marked: codes.length };
}

interface ProfilePay { id: number; name: string; monthlySalary: number; dailyBata: number; tripAllowance: number }
interface OpenCharge { id: number; dcNo: string; amount: number; recovered: number; instalments: number }

/** One driver's pay for the month: pro-rata basic, bata per day worked, trip allowance, and charge instalments (capped at gross). */
export function payrollLine(p: ProfilePay, codes: string[], tripCount: number, charges: OpenCharge[], monthDays: number): PayrollLine {
  const t = attendanceTotals(codes);
  const basic = r2((p.monthlySalary * Math.min(t.paid, monthDays)) / monthDays);
  const bata = r2(p.dailyBata * t.present);
  const tripPay = r2(p.tripAllowance * tripCount);
  const gross = r2(basic + bata + tripPay);
  let room = gross;
  const chargeDeductions: PayrollLine['chargeDeductions'] = [];
  for (const c of charges) {
    const left = r2(c.amount - c.recovered);
    const amount = r2(Math.min(left, Math.ceil(c.amount / Math.max(1, c.instalments)), room));
    if (amount <= 0) continue;
    chargeDeductions.push({ chargeId: c.id, dcNo: c.dcNo, amount });
    room = r2(room - amount);
  }
  const deductions = r2(chargeDeductions.reduce((s, c) => s + c.amount, 0));
  return { driverId: p.id, name: p.name, presentDays: t.present, paidDays: t.paid, trips: tripCount, basic, bata, tripPay, gross, chargeDeductions, deductions, net: r2(gross - deductions) };
}

interface Assignment { driverId: number; vehicleNo: string; fromAt: Date; toAt: Date | null }
/** Which driver had the vehicle at that moment. */
export function driverAt(assignments: Assignment[], vehicleNo: string, at: Date) {
  const key = vehicleKey(vehicleNo);
  return assignments.find((a) => vehicleKey(a.vehicleNo) === key && a.fromAt <= at && (!a.toAt || a.toAt > at))?.driverId ?? null;
}

interface TraccarTrip { deviceId: number; deviceName?: string; startTime: string; endTime: string; distance: number; duration: number }
interface TraccarEvent { deviceId: number; type: string; eventTime: string; attributes?: { alarm?: string } }

/** Driving hours and km per driver per day, from GPS trips. */
export function drivingByDriver(tripList: TraccarTrip[], names: Map<number, string>, assignments: Assignment[]) {
  const out = new Map<number, Map<string, { hours: number; km: number }>>();
  for (const t of tripList) {
    const start = new Date(t.startTime);
    const vehicle = names.get(t.deviceId) ?? t.deviceName ?? '';
    const driverId = driverAt(assignments, vehicle, start);
    if (!driverId) continue;
    const days = out.get(driverId) ?? new Map();
    const d = days.get(ymd(start)) ?? { hours: 0, km: 0 };
    d.hours += t.duration / 3_600_000;
    d.km += t.distance / 1000;
    days.set(ymd(start), d);
    out.set(driverId, days);
  }
  return out;
}

/** 100 minus penalties per 1,000 km: 2 per overspeed, 3 per harsh event, 10 per crash alarm. */
export function driverScore(overspeed: number, harsh: number, crashes: number, km: number) {
  const per1000 = (overspeed * 2 + harsh * 3 + crashes * 10) * (1000 / Math.max(km, 1000));
  return Math.max(0, Math.round(100 - per1000));
}

/* --------------------------------------------------------------- service */

const assignBody = z.object({ driverId: z.coerce.number().int().positive(), vehicleNo: z.string().trim().toUpperCase().min(4).max(20), remarks: text(300) });
const attendanceBody = z.object({
  entries: z
    .array(z.object({ driverId: z.coerce.number().int().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), code: z.enum(['P', 'H', 'L', 'A', 'WO', '']) }))
    .min(1)
    .max(5000),
});

@Injectable()
export class DriversService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly traccar: TraccarService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly approvals: ApprovalsService,
    private readonly workshop: WorkshopService,
  ) {}

  onModuleInit() {
    this.approvals.onDecision('payroll', async (req, d) => {
      await this.db.update(payrollRuns).set({ status: d, updatedAt: new Date() }).where(eq(payrollRuns.id, req.docId));
    });
  }

  /** Creates a profile for every Traccar driver that has none, copying licence, Aadhar and phone. */
  async syncFromTraccar(user: AuthUser) {
    const list = await this.traccar.get<{ id: number; name: string; attributes?: Record<string, unknown> }[]>(user.cookie, '/drivers');
    const existing = await this.db.select().from(driverProfiles);
    const linked = new Set(existing.map((p) => p.traccarDriverId));
    const byName = new Map(existing.filter((p) => !p.traccarDriverId).map((p) => [p.name.toLowerCase(), p]));
    let created = 0;
    let linkedByName = 0;
    for (const d of list) {
      if (linked.has(d.id)) continue;
      const same = byName.get(d.name.toLowerCase());
      if (same) {
        await this.db.update(driverProfiles).set({ traccarDriverId: d.id, updatedAt: new Date() }).where(eq(driverProfiles.id, same.id));
        linkedByName++;
        continue;
      }
      const a = d.attributes ?? {};
      const aadhar = String(a.aadhar ?? '').replace(/\D/g, '');
      const expiry = String(a.licenceExpiry ?? '').slice(0, 10);
      await this.db.insert(driverProfiles).values({
        traccarDriverId: d.id,
        name: d.name,
        phone: a.phone ? String(a.phone) : null,
        licenceNo: a.licenceNo ? String(a.licenceNo) : null,
        licenceExpiry: /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : null,
        aadhar: aadhar.length === 12 ? aadhar : null,
        createdBy: user.id,
      });
      created++;
    }
    await this.audit.log(user, 'sync', 'payroll', null, { created, linkedByName });
    return { created, linked: linkedByName, total: list.length };
  }

  async assign(user: AuthUser, raw: unknown) {
    const parsed = assignBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const d = parsed.data;
    const [p] = await this.db.select().from(driverProfiles).where(eq(driverProfiles.id, d.driverId));
    if (!p) throw new NotFoundException('Driver not found');
    if (p.status !== 'active') throw new ConflictException(`${p.name} is inactive`);
    return this.db.transaction(async (tx) => {
      const now = new Date();
      // the driver leaves their old truck, and the truck's old driver goes to standby
      await tx
        .update(driverAssignments)
        .set({ toAt: now })
        .where(and(isNull(driverAssignments.toAt), or(eq(driverAssignments.driverId, d.driverId), eq(driverAssignments.vehicleNo, d.vehicleNo))));
      const [row] = await tx.insert(driverAssignments).values({ driverId: d.driverId, vehicleNo: d.vehicleNo, remarks: d.remarks, fromAt: now, createdBy: user.id }).returning();
      await this.audit.log(user, 'assign', 'payroll', d.driverId, { vehicleNo: d.vehicleNo });
      return row;
    });
  }

  async unassign(user: AuthUser, driverId: number) {
    const rows = await this.db.update(driverAssignments).set({ toAt: new Date() }).where(and(eq(driverAssignments.driverId, driverId), isNull(driverAssignments.toAt))).returning();
    if (!rows.length) throw new ConflictException('The driver has no vehicle');
    await this.audit.log(user, 'unassign', 'payroll', driverId, { vehicleNo: rows[0].vehicleNo });
    return rows[0];
  }

  /** Drivers with their current vehicle, standby pool, and trucks without a driver. */
  async roster(user: AuthUser) {
    const [profiles, current, devices] = await Promise.all([
      this.db.select().from(driverProfiles).where(eq(driverProfiles.status, 'active')).orderBy(asc(driverProfiles.name)),
      this.db.select().from(driverAssignments).where(isNull(driverAssignments.toAt)),
      this.traccar.get<{ id: number; name: string; status?: string; lastUpdate?: string }[]>(user.cookie, '/devices'),
    ]);
    const byDriver = new Map(current.map((a) => [a.driverId, a]));
    const assignedVehicles = new Set(current.map((a) => vehicleKey(a.vehicleNo)));
    const today = ymd(new Date());
    const att = await this.db.select().from(driverAttendance).where(eq(driverAttendance.date, today));
    const attBy = new Map(att.map((a) => [a.driverId, a.code]));
    return {
      drivers: profiles.map((p) => ({ ...p, vehicleNo: byDriver.get(p.id)?.vehicleNo ?? null, since: byDriver.get(p.id)?.fromAt ?? null, today: attBy.get(p.id) ?? null })),
      standby: profiles.filter((p) => !byDriver.has(p.id)).map((p) => ({ id: p.id, name: p.name })),
      vehiclesWithoutDriver: devices.filter((d) => !assignedVehicles.has(vehicleKey(d.name))).map((d) => ({ deviceId: d.id, vehicleNo: d.name, status: d.status ?? null })),
    };
  }

  async history(driverId?: number, vehicleNo?: string) {
    return this.db
      .select({ a: driverAssignments, name: driverProfiles.name })
      .from(driverAssignments)
      .innerJoin(driverProfiles, eq(driverProfiles.id, driverAssignments.driverId))
      .where(and(driverId ? eq(driverAssignments.driverId, driverId) : undefined, vehicleNo ? eq(driverAssignments.vehicleNo, vehicleNo.toUpperCase()) : undefined))
      .orderBy(desc(driverAssignments.fromAt))
      .limit(500)
      .then((rows) => rows.map((r) => ({ ...r.a, driverName: r.name })));
  }

  /** Assigns standby drivers to trucks without one, longest-standing standby driver first. */
  async autoAssign(user: AuthUser) {
    const r = await this.roster(user);
    const pairs = r.standby.slice(0, r.vehiclesWithoutDriver.length).map((d, i) => ({ driverId: d.id, vehicleNo: r.vehiclesWithoutDriver[i].vehicleNo.toUpperCase() }));
    for (const p of pairs) await this.assign(user, { ...p, remarks: 'Auto-assigned' });
    return { assigned: pairs.length, pairs };
  }

  async attendance(month: string) {
    if (!monthRe.test(month)) throw new BadRequestException('month must be YYYY-MM');
    const days = daysInMonth(month);
    const [profiles, rows] = await Promise.all([
      this.db.select({ id: driverProfiles.id, name: driverProfiles.name, status: driverProfiles.status }).from(driverProfiles).orderBy(asc(driverProfiles.name)),
      this.db.select().from(driverAttendance).where(and(gte(driverAttendance.date, `${month}-01`), lte(driverAttendance.date, `${month}-${String(days).padStart(2, '0')}`))),
    ]);
    return {
      month,
      days,
      codes: ATTENDANCE_CODES,
      drivers: profiles
        .filter((p) => p.status === 'active' || rows.some((r) => r.driverId === p.id))
        .map((p) => {
          const mine = rows.filter((r) => r.driverId === p.id);
          return { driverId: p.id, name: p.name, codes: Object.fromEntries(mine.map((r) => [r.date, r.code])), totals: attendanceTotals(mine.map((r) => r.code)) };
        }),
    };
  }

  async setAttendance(user: AuthUser, raw: unknown) {
    const parsed = attendanceBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const today = ymd(new Date());
    for (const e of parsed.data.entries) {
      if (e.date > today) throw new BadRequestException(`${e.date} is in the future`);
      if (await this.paidMonth(e.date.slice(0, 7))) throw new ConflictException(`Payroll for ${e.date.slice(0, 7)} is approved; attendance is locked`);
    }
    await this.db.transaction(async (tx) => {
      for (const e of parsed.data.entries) {
        if (!e.code) {
          await tx.delete(driverAttendance).where(and(eq(driverAttendance.driverId, e.driverId), eq(driverAttendance.date, e.date)));
          continue;
        }
        await tx
          .insert(driverAttendance)
          .values({ driverId: e.driverId, date: e.date, code: e.code, updatedBy: user.id })
          .onConflictDoUpdate({ target: [driverAttendance.driverId, driverAttendance.date], set: { code: e.code, updatedBy: user.id, updatedAt: new Date() } });
      }
    });
    await this.audit.log(user, 'attendance', 'payroll', null, { entries: parsed.data.entries.length });
    return { saved: parsed.data.entries.length };
  }

  private async paidMonth(month: string) {
    const [run] = await this.db.select().from(payrollRuns).where(and(eq(payrollRuns.month, month), inArray(payrollRuns.status, ['approved', 'paid'])));
    return !!run;
  }

  private async gps(user: AuthUser, from: Date, to: Date) {
    const devices = await this.traccar.get<{ id: number; name: string }[]>(user.cookie, '/devices');
    if (!devices.length) return { names: new Map<number, string>(), trips: [] as TraccarTrip[], events: [] as TraccarEvent[] };
    const ids = devices.map((d) => `deviceId=${d.id}`).join('&');
    const range = `from=${from.toISOString()}&to=${to.toISOString()}`;
    const [tripList, events] = await Promise.all([
      this.traccar.get<TraccarTrip[]>(user.cookie, `/reports/trips?${ids}&${range}`),
      this.traccar.get<TraccarEvent[]>(user.cookie, `/reports/events?${ids}&${range}&type=deviceOverspeed&type=alarm`),
    ]);
    return { names: new Map(devices.map((d) => [d.id, d.name])), trips: tripList, events };
  }

  /** Driving hours per driver from GPS trips, with the 9-hour daily limit check. */
  async hours(user: AuthUser, days: number) {
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY);
    const [{ names, trips: tripList }, assignments, profiles] = await Promise.all([this.gps(user, from, to), this.db.select().from(driverAssignments), this.db.select().from(driverProfiles)]);
    const byDriver = drivingByDriver(tripList, names, assignments);
    const last7 = Array.from({ length: 7 }, (_, i) => ymd(new Date(to.getTime() - (6 - i) * DAY)));
    return profiles
      .filter((p) => p.status === 'active' || byDriver.has(p.id))
      .map((p) => {
        const daysMap = byDriver.get(p.id) ?? new Map<string, { hours: number; km: number }>();
        const list = [...daysMap.values()];
        const total = list.reduce((s, d) => s + d.hours, 0);
        const over = list.filter((d) => d.hours > DRIVING_LIMIT_HOURS).length;
        return {
          driverId: p.id,
          name: p.name,
          daysWorked: list.length,
          totalHours: r1(total),
          avgPerDay: list.length ? r1(total / list.length) : 0,
          maxDay: r1(Math.max(0, ...list.map((d) => d.hours))),
          daysOverLimit: over,
          km: Math.round(list.reduce((s, d) => s + d.km, 0)),
          last7: last7.map((d) => ({ date: d, hours: r1(daysMap.get(d)?.hours ?? 0) })),
          compliant: over === 0,
        };
      })
      .sort((a, b) => b.totalHours - a.totalHours);
  }

  /** Driver scores from overspeed and harsh-driving events over the last `days` days. */
  async scores(user: AuthUser, days = 30) {
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY);
    const [{ names, trips: tripList, events }, assignments, profiles] = await Promise.all([this.gps(user, from, to), this.db.select().from(driverAssignments), this.db.select().from(driverProfiles)]);
    const km = drivingByDriver(tripList, names, assignments);
    const counts = new Map<number, { overspeed: number; harsh: number; crashes: number }>();
    for (const e of events) {
      const driverId = driverAt(assignments, names.get(e.deviceId) ?? '', new Date(e.eventTime));
      if (!driverId) continue;
      const c = counts.get(driverId) ?? { overspeed: 0, harsh: 0, crashes: 0 };
      if (e.type === 'deviceOverspeed') c.overspeed++;
      else if (HARSH.includes(e.attributes?.alarm ?? '')) c.harsh++;
      else if (e.attributes?.alarm === 'accident') c.crashes++;
      counts.set(driverId, c);
    }
    return profiles
      .filter((p) => p.status === 'active')
      .map((p) => {
        const c = counts.get(p.id) ?? { overspeed: 0, harsh: 0, crashes: 0 };
        const k = [...(km.get(p.id)?.values() ?? [])].reduce((s, d) => s + d.km, 0);
        return { driverId: p.id, name: p.name, km: Math.round(k), ...c, score: driverScore(c.overspeed, c.harsh, c.crashes, k) };
      })
      .sort((a, b) => b.score - a.score || b.km - a.km);
  }

  /** Works out the month's pay without saving it. */
  async previewPayroll(month: string) {
    if (!monthRe.test(month)) throw new BadRequestException('month must be YYYY-MM');
    const days = daysInMonth(month);
    const start = new Date(`${month}-01T00:00:00Z`);
    const end = new Date(start.getTime() + days * DAY);
    const [profiles, att, done, charges] = await Promise.all([
      this.db.select().from(driverProfiles).where(eq(driverProfiles.status, 'active')).orderBy(asc(driverProfiles.name)),
      this.db.select().from(driverAttendance).where(and(gte(driverAttendance.date, `${month}-01`), lte(driverAttendance.date, `${month}-${days}`))),
      this.db
        .select({ name: sql<string>`lower(${trips.driverName})`, n: sql<number>`count(*)::int` })
        .from(trips)
        .where(and(eq(trips.status, 'completed'), gte(trips.completedAt, start), lte(trips.completedAt, end)))
        .groupBy(sql`lower(${trips.driverName})`),
      this.db.select().from(driverCharges).where(eq(driverCharges.status, 'approved')).orderBy(asc(driverCharges.incidentDate)),
    ]);
    const tripsBy = new Map(done.map((t) => [t.name, t.n]));
    const lines = profiles.map((p) =>
      payrollLine(
        p,
        att.filter((a) => a.driverId === p.id).map((a) => a.code),
        tripsBy.get(p.name.toLowerCase()) ?? 0,
        charges.filter((c) => c.driverName.toLowerCase() === p.name.toLowerCase()),
        days,
      ),
    );
    const unmarked = profiles.filter((p) => !att.some((a) => a.driverId === p.id)).map((p) => p.name);
    const sum = (k: 'gross' | 'deductions' | 'net') => r2(lines.reduce((s, l) => s + l[k], 0));
    return { month, days, lines, gross: sum('gross'), deductions: sum('deductions'), net: sum('net'), unmarked };
  }

  /** Saves the month's payroll and routes it for approval. A rejected or draft run is recalculated. */
  async runPayroll(user: AuthUser, month: string) {
    const p = await this.previewPayroll(month);
    if (!p.lines.length) throw new BadRequestException('No active drivers');
    const [existing] = await this.db.select().from(payrollRuns).where(eq(payrollRuns.month, month));
    if (existing && !['draft', 'rejected'].includes(existing.status)) throw new ConflictException(`Payroll for ${month} is ${existing.status.replace('_', ' ')}`);
    const values = { month, lines: p.lines, gross: p.gross, deductions: p.deductions, net: p.net, status: 'pending_approval', updatedAt: new Date() };
    const [row] = existing
      ? await this.db.update(payrollRuns).set(values).where(eq(payrollRuns.id, existing.id)).returning()
      : await this.db.insert(payrollRuns).values({ ...values, prNo: await this.numbering.next('PAY'), createdBy: user.id }).returning();
    const approval = await this.approvals.submit(user, {
      docType: 'payroll',
      docId: row.id,
      docNo: row.prNo,
      title: `Driver payroll ${month}`,
      summary: `${p.lines.length} drivers, gross SAR ${p.gross}, deductions SAR ${p.deductions}`,
      amount: p.net,
      meta: { link: '/driver-management?tab=payroll' },
    });
    if (!approval) {
      const [ok] = await this.db.update(payrollRuns).set({ status: 'approved' }).where(eq(payrollRuns.id, row.id)).returning();
      return ok;
    }
    return row;
  }

  /** Marks the run paid and recovers each driver-charge instalment it deducted. */
  async payPayroll(user: AuthUser, id: number, paymentRef: string | null) {
    const [run] = await this.db.select().from(payrollRuns).where(eq(payrollRuns.id, id));
    if (!run) throw new NotFoundException();
    if (run.status !== 'approved') throw new ConflictException(`Payroll is ${run.status.replace('_', ' ')}`);
    for (const l of run.lines) {
      for (const c of l.chargeDeductions) {
        const [charge] = await this.db.select().from(driverCharges).where(eq(driverCharges.id, c.chargeId));
        if (charge?.status !== 'approved') continue; // waived or recovered meanwhile
        await this.workshop.recoverCharge(user, c.chargeId, Math.min(c.amount, r2(charge.amount - charge.recovered)));
      }
    }
    const [row] = await this.db.update(payrollRuns).set({ status: 'paid', paidAt: new Date(), paymentRef, updatedAt: new Date() }).where(eq(payrollRuns.id, id)).returning();
    await this.audit.log(user, 'pay', 'payroll', id, { paymentRef, net: run.net });
    return row;
  }

  async overview(user: AuthUser) {
    const today = ymd(new Date());
    const month = today.slice(0, 7);
    const [r, scores, hours, att30, runs, profiles] = await Promise.all([
      this.roster(user),
      this.scores(user, 30),
      this.hours(user, 7),
      this.db.select().from(driverAttendance).where(gte(driverAttendance.date, ymd(new Date(Date.now() - 29 * DAY)))),
      this.db.select().from(payrollRuns).orderBy(desc(payrollRuns.month)).limit(6),
      this.db.select().from(driverProfiles).where(eq(driverProfiles.status, 'active')),
    ]);
    const todayCodes = r.drivers.map((d) => d.today);
    const in30 = ymd(new Date(Date.now() + 30 * DAY));
    const licence = profiles
      .filter((p) => !p.licenceNo || !p.licenceExpiry || p.licenceExpiry <= in30)
      .map((p) => ({ driverId: p.id, name: p.name, licenceNo: p.licenceNo, licenceExpiry: p.licenceExpiry, issue: !p.licenceNo ? 'No licence on file' : !p.licenceExpiry ? 'Licence expiry unknown' : p.licenceExpiry < today ? 'Licence expired' : 'Licence expires within 30 days' }));
    const daily = Array.from({ length: 30 }, (_, i) => ymd(new Date(Date.now() - (29 - i) * DAY))).map((d) => {
      const rows = att30.filter((a) => a.date === d);
      return { date: d, present: rows.filter((a) => a.code === 'P').length + rows.filter((a) => a.code === 'H').length * 0.5, absent: rows.filter((a) => a.code === 'A').length, leave: rows.filter((a) => a.code === 'L' || a.code === 'WO').length };
    });
    const withHours = hours.filter((h) => h.daysWorked);
    const bands = [[0, 60], [60, 70], [70, 80], [80, 90], [90, 101]].map(([lo, hi]) => ({ band: hi > 100 ? '90+' : `${lo}-${hi}`, drivers: scores.filter((s) => s.score >= lo && s.score < hi).length }));
    return {
      onRoll: r.drivers.length,
      onTrucks: r.drivers.filter((d) => d.vehicleNo).length,
      standby: r.standby.length,
      presentToday: todayCodes.filter((c) => c === 'P' || c === 'H').length,
      absentToday: todayCodes.filter((c) => c === 'A').length,
      leaveToday: todayCodes.filter((c) => c === 'L' || c === 'WO').length,
      notMarkedToday: todayCodes.filter((c) => !c).length,
      trucksWithoutDriver: r.vehiclesWithoutDriver.length,
      avgDrivingHours: withHours.length ? r1(withHours.reduce((s, h) => s + h.avgPerDay, 0) / withHours.length) : null,
      drivingLimit: DRIVING_LIMIT_HOURS,
      overLimitDrivers: hours.filter((h) => h.daysOverLimit).length,
      complianceAlerts: licence.length,
      avgScore: scores.length ? Math.round(scores.reduce((s, x) => s + x.score, 0) / scores.length) : null,
      payroll: runs.find((p) => p.month === month) ?? runs[0] ?? null,
      payrollTrend: runs.map((p) => ({ month: p.month, gross: p.gross, net: p.net, status: p.status })).reverse(),
      attendance30: daily,
      topDrivers: scores.slice(0, 5),
      scoreBands: bands,
      licence,
      roster: r.drivers.map((d) => ({ driverId: d.id, name: d.name, vehicleNo: d.vehicleNo, today: d.today, score: scores.find((s) => s.driverId === d.id)?.score ?? null, km: scores.find((s) => s.driverId === d.id)?.km ?? 0 })),
    };
  }
}

@Controller('drivers')
export class DriversController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly svc: DriversService,
    private readonly access: AccessService,
  ) {}

  private view = (u: AuthUser) => this.access.require(u, 'payroll', 'view');
  private edit = (u: AuthUser) => this.access.require(u, 'payroll', 'edit');

  @Get('overview')
  async overview(@CurrentUser() u: AuthUser) {
    await this.view(u);
    return this.svc.overview(u);
  }

  @Post('sync')
  async sync(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'payroll', 'create');
    return this.svc.syncFromTraccar(u);
  }

  @Get('roster')
  async roster(@CurrentUser() u: AuthUser) {
    await this.view(u);
    return this.svc.roster(u);
  }

  @Get('assignments')
  async assignments(@CurrentUser() u: AuthUser, @Query('driverId') driverId?: string, @Query('vehicleNo') vehicleNo?: string) {
    await this.view(u);
    return this.svc.history(driverId ? Number(driverId) : undefined, vehicleNo);
  }

  @Post('assign')
  async assign(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    await this.edit(u);
    return this.svc.assign(u, body);
  }

  @Post('auto-assign')
  async autoAssign(@CurrentUser() u: AuthUser) {
    await this.edit(u);
    return this.svc.autoAssign(u);
  }

  @Post(':id/unassign')
  async unassign(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.edit(u);
    return this.svc.unassign(u, id);
  }

  @Get('attendance')
  async attendance(@CurrentUser() u: AuthUser, @Query('month') month: string) {
    await this.view(u);
    return this.svc.attendance(month);
  }

  @Put('attendance')
  async setAttendance(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    await this.edit(u);
    return this.svc.setAttendance(u, body);
  }

  @Get('hours')
  async hours(@CurrentUser() u: AuthUser, @Query('days') days = '30') {
    await this.view(u);
    const n = Number(days);
    if (!(n >= 1 && n <= 92)) throw new BadRequestException('days must be 1 to 92');
    return this.svc.hours(u, n);
  }

  @Get('scores')
  async scores(@CurrentUser() u: AuthUser, @Query('days') days = '30') {
    await this.view(u);
    return this.svc.scores(u, Math.min(92, Math.max(1, Number(days) || 30)));
  }

  @Get('payroll/preview')
  async preview(@CurrentUser() u: AuthUser, @Query('month') month: string) {
    await this.view(u);
    return this.svc.previewPayroll(month);
  }

  @Get('payroll')
  async runs(@CurrentUser() u: AuthUser) {
    await this.view(u);
    return this.db.select().from(payrollRuns).orderBy(desc(payrollRuns.month));
  }

  @Post('payroll')
  async run(@CurrentUser() u: AuthUser, @Body() body: { month?: string }) {
    await this.access.require(u, 'payroll', 'create');
    return this.svc.runPayroll(u, String(body?.month ?? ''));
  }

  @Post('payroll/:id/pay')
  async pay(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: { paymentRef?: string }) {
    await this.edit(u);
    return this.svc.payPayroll(u, id, String(body?.paymentRef ?? '').trim() || null);
  }
}
