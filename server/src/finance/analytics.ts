import { BadRequestException, Controller, Get, Injectable, Query } from '@nestjs/common';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { driverAssignments, freightMemos, fuelIndents, invoiceReceipts, invoices, jobCards, parties, payrollRuns, repairBills, tollTxns, trips, tyreEvents, tyres } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { driverAt } from '../people/drivers';
import { vehicleKey } from '../traccar/odometer.service';
import { TraccarService } from '../traccar/traccar.service';
import { daysOverdue, outstanding } from './invoices';

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Expected life of a new casing, for amortising tyre cost over km run. */
export const TYRE_LIFE_KM = 100_000;
export const EXPENSE_CATEGORIES = ['fuel', 'tolls', 'driverPay', 'maintenance', 'tyres', 'marketHire'] as const;
type Category = (typeof EXPENSE_CATEGORIES)[number];
const LABEL: Record<Category, string> = { fuel: 'Fuel', tolls: 'Tolls', driverPay: 'Driver pay', maintenance: 'Maintenance', tyres: 'Tyres', marketHire: 'Market hire' };

interface Summary { deviceId: number; deviceName?: string; distance: number; engineHours: number; startTime?: string }
interface Trip { deviceId: number; duration: number; distance: number }

type Costs = Record<Category, number>;
const zero = (): Costs => ({ fuel: 0, tolls: 0, driverPay: 0, maintenance: 0, tyres: 0, marketHire: 0 });
const sum = (c: Costs) => r2(Object.values(c).reduce((s, v) => s + v, 0));

/** Spreads an amount over the days of the period it covers (used for payroll and amortisation). */
function spread(target: Map<string, number>, from: Date, to: Date, amount: number) {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
  for (let i = 0; i < days; i++) {
    const d = ymd(new Date(from.getTime() + i * DAY));
    target.set(d, (target.get(d) ?? 0) + amount / days);
  }
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly traccar: TraccarService,
  ) {}

  private async gps(user: AuthUser, from: Date, to: Date) {
    const devices = await this.traccar.get<{ id: number; name: string; model?: string | null; category?: string | null }[]>(user.cookie, '/devices');
    if (!devices.length) return { devices, summary: [] as Summary[], daily: [] as Summary[], trips: [] as Trip[] };
    const q = `${devices.map((d) => `deviceId=${d.id}`).join('&')}&from=${from.toISOString()}&to=${to.toISOString()}`;
    const [summary, daily, tripList] = await Promise.all([
      this.traccar.get<Summary[]>(user.cookie, `/reports/summary?${q}`),
      this.traccar.get<Summary[]>(user.cookie, `/reports/summary?${q}&daily=true`),
      this.traccar.get<Trip[]>(user.cookie, `/reports/trips?${q}`),
    ]);
    return { devices, summary, daily, trips: tripList };
  }

  async compute(user: AuthUser, from: Date, to: Date, vehicleFilter?: string) {
    if (!(from < to)) throw new BadRequestException('from must be before to');
    if (to.getTime() - from.getTime() > 400 * DAY) throw new BadRequestException('Choose a period of at most 400 days');
    const only = vehicleFilter ? vehicleKey(vehicleFilter) : null;
    const keep = (v: string | null | undefined) => !only || (!!v && vehicleKey(v) === only);
    const range = (col: AnyPgColumn) => and(gte(col, from), lt(col, to));

    const [g, tripRows, fuel, tolls, jobs, bills, payroll, assignments, fittedTyres, tyreRepairs, memos, customers, openInvoices, receipts90] = await Promise.all([
      this.gps(user, from, to),
      this.db.select().from(trips).where(and(eq(trips.status, 'completed'), range(trips.completedAt))),
      this.db.select().from(fuelIndents).where(and(eq(fuelIndents.status, 'approved'), range(fuelIndents.indentDate))),
      this.db.select().from(tollTxns).where(and(eq(tollTxns.kind, 'toll'), range(tollTxns.at))),
      this.db.select().from(jobCards).where(and(eq(jobCards.status, 'completed'), range(jobCards.closedAt))),
      this.db.select().from(repairBills).where(and(inArray(repairBills.status, ['approved', 'paid']), range(repairBills.billDate))),
      this.db.select().from(payrollRuns).where(and(inArray(payrollRuns.status, ['approved', 'paid']), gte(payrollRuns.month, ymd(from).slice(0, 7)), lt(payrollRuns.month, ymd(new Date(to.getTime() + 31 * DAY)).slice(0, 7)))),
      this.db.select().from(driverAssignments),
      this.db.select().from(tyres).where(eq(tyres.status, 'fitted')),
      this.db.select().from(tyreEvents).where(and(eq(tyreEvents.type, 'repair'), range(tyreEvents.at))),
      this.db.select().from(freightMemos).where(range(freightMemos.memoDate)),
      this.db.select({ id: parties.id, name: parties.name }).from(parties),
      this.db.select().from(invoices).where(inArray(invoices.status, ['open', 'partly_paid'])),
      this.db.select().from(invoiceReceipts).where(gte(invoiceReceipts.receivedOn, ymd(new Date(Date.now() - 90 * DAY)))),
    ]);
    const customerName = new Map(customers.map((c) => [c.id, c.name]));
    const deviceName = new Map(g.devices.map((d) => [d.id, d.name]));
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));

    // ---- per-vehicle accumulation (fleet vehicles are the Traccar devices)
    interface V { vehicleNo: string; model: string | null; trips: number; revenue: number; km: number; engineHours: number; drivingHours: number; activeDays: number; litres: number; costs: Costs }
    const vehicles = new Map<string, V>();
    const veh = (name: string): V => {
      const k = vehicleKey(name);
      let v = vehicles.get(k);
      if (!v) {
        const dev = g.devices.find((d) => vehicleKey(d.name) === k);
        v = { vehicleNo: dev?.name ?? name, model: dev?.model ?? null, trips: 0, revenue: 0, km: 0, engineHours: 0, drivingHours: 0, activeDays: 0, litres: 0, costs: zero() };
        vehicles.set(k, v);
      }
      return v;
    };
    g.devices.filter((d) => keep(d.name)).forEach((d) => veh(d.name));
    for (const s of g.summary) {
      const name = deviceName.get(s.deviceId) ?? s.deviceName;
      if (!name || !keep(name)) continue;
      const v = veh(name);
      v.km += s.distance / 1000;
      v.engineHours += s.engineHours / 3_600_000;
    }
    for (const s of g.daily) {
      const name = deviceName.get(s.deviceId) ?? s.deviceName;
      if (name && keep(name) && s.distance > 20_000) veh(name).activeDays++;
    }
    for (const t of g.trips) {
      const name = deviceName.get(t.deviceId);
      if (name && keep(name)) veh(name).drivingHours += t.duration / 3_600_000;
    }

    const daily = new Map<string, { revenue: number; expenses: number }>();
    const addDaily = (d: Date, k: 'revenue' | 'expenses', amount: number) => {
      const key = ymd(d);
      const row = daily.get(key) ?? { revenue: 0, expenses: 0 };
      row[k] += amount;
      daily.set(key, row);
    };
    const spreadCost = new Map<string, number>();
    const total = zero();
    const cost = (vehicleNo: string | null, cat: Category, amount: number, at: Date | null) => {
      if (!amount) return;
      if (vehicleNo && !keep(vehicleNo)) return;
      if (!vehicleNo && only) return;
      total[cat] += amount;
      if (vehicleNo) veh(vehicleNo).costs[cat] += amount;
      if (at) addDaily(at, 'expenses', amount);
    };

    const tripList = tripRows.filter((t) => keep(t.vehicleNo));
    for (const t of tripList) {
      const v = veh(t.vehicleNo);
      v.trips++;
      v.revenue += t.freight ?? 0;
      addDaily(t.completedAt!, 'revenue', t.freight ?? 0);
    }
    for (const f of fuel) {
      cost(f.vehicleNo, 'fuel', f.amount, f.indentDate);
      if (keep(f.vehicleNo)) veh(f.vehicleNo).litres += f.litres ?? (f.rate ? f.amount / f.rate : 0);
    }
    tolls.forEach((t) => cost(t.vehicleNo, 'tolls', t.amount, t.at));
    jobs.forEach((j) => cost(j.vehicleNo, 'maintenance', j.partsCost + j.labourCost, j.closedAt));
    bills.forEach((b) => cost(b.vehicleNo, 'maintenance', b.taxable, b.billDate));
    tyreRepairs.forEach((e) => cost(e.vehicleNo, 'tyres', e.cost ?? 0, e.at));
    if (!only) memos.forEach((m) => cost(null, 'marketHire', m.totalFreight, m.memoDate));
    // tyre amortisation: cost of fitted casings spread over expected life, by km run in the period
    for (const v of vehicles.values()) {
      const casings = fittedTyres.filter((t) => t.vehicleNo && vehicleKey(t.vehicleNo) === vehicleKey(v.vehicleNo)).reduce((s, t) => s + t.purchaseCost, 0);
      const amount = r2((casings * v.km) / TYRE_LIFE_KM);
      if (amount) {
        cost(v.vehicleNo, 'tyres', amount, null);
        spread(spreadCost, from, to, amount);
      }
    }
    // driver pay: each month's gross, pro-rated to the overlap, on the truck the driver had mid-month
    for (const run of payroll) {
      const mStart = new Date(`${run.month}-01T00:00:00Z`);
      const mEnd = new Date(Date.UTC(mStart.getUTCFullYear(), mStart.getUTCMonth() + 1, 1));
      const overlapFrom = new Date(Math.max(mStart.getTime(), from.getTime()));
      const overlapTo = new Date(Math.min(mEnd.getTime(), to.getTime()));
      if (overlapTo <= overlapFrom) continue;
      const share = (overlapTo.getTime() - overlapFrom.getTime()) / (mEnd.getTime() - mStart.getTime());
      const mid = new Date((mStart.getTime() + mEnd.getTime()) / 2);
      for (const l of run.lines) {
        const a = assignments.filter((x) => x.driverId === l.driverId);
        const vehicleNo = a.find((x) => driverAt([x], x.vehicleNo, mid))?.vehicleNo ?? null;
        const amount = r2(l.gross * share);
        cost(vehicleNo, 'driverPay', amount, null);
        if (vehicleNo ? keep(vehicleNo) : !only) spread(spreadCost, overlapFrom, overlapTo, amount);
      }
    }
    for (const [d, amount] of spreadCost) if (d >= ymd(from) && d < ymd(to)) addDaily(new Date(`${d}T00:00:00Z`), 'expenses', amount);

    // ---- roll-ups
    const revenue = r2(tripList.reduce((s, t) => s + (t.freight ?? 0), 0));
    const expenses = sum(total);
    const km = Math.round([...vehicles.values()].reduce((s, v) => s + v.km, 0));
    const vehicleRows = [...vehicles.values()].map((v) => {
      const exp = sum(v.costs);
      return {
        vehicleNo: v.vehicleNo,
        model: v.model,
        trips: v.trips,
        km: Math.round(v.km),
        revenue: r2(v.revenue),
        costs: Object.fromEntries(Object.entries(v.costs).map(([k, x]) => [k, r2(x)])) as Costs,
        expenses: exp,
        profit: r2(v.revenue - exp),
        margin: pct(v.revenue - exp, v.revenue),
        revenuePerKm: v.km ? r2(v.revenue / v.km) : null,
        costPerKm: v.km ? r2(exp / v.km) : null,
        utilisation: pct(v.activeDays, days),
        runningHours: Math.round(v.engineHours * 10) / 10,
        drivingHours: Math.round(v.drivingHours * 10) / 10,
        idleHours: Math.max(0, Math.round((v.engineHours - v.drivingHours) * 10) / 10),
        kmPerLitre: v.litres ? Math.round((v.km / v.litres) * 100) / 100 : null,
      };
    });
    const costPerKmOf = new Map(vehicleRows.map((v) => [vehicleKey(v.vehicleNo), v.costPerKm ?? 0]));

    const lanes = new Map<string, { lane: string; trips: number; km: number; revenue: number; cost: number }>();
    for (const t of tripList) {
      const lane = `${t.origin} → ${t.destination}`;
      const l = lanes.get(lane) ?? { lane, trips: 0, km: 0, revenue: 0, cost: 0 };
      l.trips++;
      l.km += t.plannedKm ?? 0;
      l.revenue += t.freight ?? 0;
      l.cost += (t.plannedKm ?? 0) * (costPerKmOf.get(vehicleKey(t.vehicleNo)) ?? 0);
      lanes.set(lane, l);
    }
    const laneRows = [...lanes.values()]
      .map((l) => ({ ...l, revenue: r2(l.revenue), cost: r2(l.cost), contribution: r2(l.revenue - l.cost), margin: pct(l.revenue - l.cost, l.revenue), revenuePerKm: l.km ? r2(l.revenue / l.km) : null }))
      .sort((a, b) => b.revenue - a.revenue);

    const custMap = new Map<number, { customerId: number; customer: string; trips: number; revenue: number }>();
    for (const t of tripList) {
      if (!t.customerId) continue;
      const c = custMap.get(t.customerId) ?? { customerId: t.customerId, customer: customerName.get(t.customerId) ?? `#${t.customerId}`, trips: 0, revenue: 0 };
      c.trips++;
      c.revenue = r2(c.revenue + (t.freight ?? 0));
      custMap.set(t.customerId, c);
    }
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => ({ day: d, revenue: r2(tripList.filter((t) => t.completedAt!.getUTCDay() === i).reduce((s, t) => s + (t.freight ?? 0), 0)) }));
    const series = Array.from({ length: days }, (_, i) => {
      const d = ymd(new Date(from.getTime() + i * DAY));
      const row = daily.get(d) ?? { revenue: 0, expenses: 0 };
      return { date: d, revenue: r2(row.revenue), expenses: r2(row.expenses), profit: r2(row.revenue - row.expenses) };
    });

    const outstandingTotal = r2(openInvoices.reduce((s, i) => s + outstanding(i), 0));
    const overdue = r2(openInvoices.filter((i) => daysOverdue(i) > 0).reduce((s, i) => s + outstanding(i), 0));
    const billed90 = await this.db.select().from(invoices).where(and(gte(invoices.invoiceDate, ymd(new Date(Date.now() - 90 * DAY))), inArray(invoices.status, ['open', 'partly_paid', 'paid'])));
    const billedPerDay = billed90.reduce((s, i) => s + i.total, 0) / 90;
    const collected30 = r2(receipts90.filter((r) => r.receivedOn >= ymd(new Date(Date.now() - 30 * DAY))).reduce((s, r) => s + r.amount + r.tds, 0));
    const litres = [...vehicles.values()].reduce((s, v) => s + v.litres, 0);
    const engine = [...vehicles.values()].reduce((s, v) => s + v.engineHours, 0);
    const driving = [...vehicles.values()].reduce((s, v) => s + v.drivingHours, 0);
    const vehicleDays = vehicles.size * days;
    const activeDays = [...vehicles.values()].reduce((s, v) => s + v.activeDays, 0);

    const kpis = {
      revenue,
      expenses,
      profit: r2(revenue - expenses),
      margin: pct(revenue - expenses, revenue),
      trips: tripList.length,
      km,
      revenuePerKm: km ? r2(revenue / km) : null,
      costPerKm: km ? r2(expenses / km) : null,
      utilisation: pct(activeDays, vehicleDays),
      outstanding: outstandingTotal,
      overdue,
      dso: billedPerDay ? Math.round(outstandingTotal / billedPerDay) : null,
      collected30,
      openInvoices: openInvoices.length,
      litres: Math.round(litres),
      kmPerLitre: litres ? Math.round((km / litres) * 100) / 100 : null,
      idleLossPct: engine ? pct(engine - driving, engine) : null,
    };
    const costPerKmBreakdown = EXPENSE_CATEGORIES.map((c) => ({ category: LABEL[c], key: c, amount: r2(total[c]), perKm: km ? r2(total[c] / km) : null }));

    // ---- plain-language insights
    const insights: string[] = [];
    if (kpis.margin !== null) insights.push(`Net margin is ${kpis.margin}% on ₹${revenue.toLocaleString('en-IN')} of revenue from ${tripList.length} trips.`);
    const topCost = [...costPerKmBreakdown].sort((a, b) => b.amount - a.amount)[0];
    if (topCost?.amount && expenses) insights.push(`${topCost.category} is the biggest cost at ${pct(topCost.amount, expenses)}% of expenses.`);
    const losers = vehicleRows.filter((v) => v.revenue > 0 && v.profit < 0).sort((a, b) => a.profit - b.profit);
    if (losers[0]) insights.push(`${losers[0].vehicleNo} lost ₹${Math.abs(losers[0].profit).toLocaleString('en-IN')} in this period.`);
    const idle = vehicleRows.filter((v) => v.utilisation !== null && v.utilisation < 30 && !v.trips);
    if (idle.length) insights.push(`${idle.length} vehicle${idle.length > 1 ? 's were' : ' was'} under 30% utilised with no completed trips.`);
    const bestLane = laneRows.filter((l) => l.margin !== null).sort((a, b) => b.margin! - a.margin!)[0];
    if (bestLane) insights.push(`Best lane by margin: ${bestLane.lane} (${bestLane.margin}%).`);
    if (overdue) insights.push(`₹${overdue.toLocaleString('en-IN')} of receivables is overdue${kpis.dso !== null ? `; DSO is ${kpis.dso} days` : ''}.`);

    return {
      period: { from: from.toISOString(), to: to.toISOString(), days, vehicleNo: vehicleFilter ?? null },
      kpis,
      daily: series,
      expenseMix: costPerKmBreakdown.filter((c) => c.amount > 0),
      costPerKmBreakdown,
      weekday,
      topCustomers: [...custMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
      lanes: laneRows,
      vehicles: vehicleRows.sort((a, b) => b.profit - a.profit),
      insights,
    };
  }
}

@Controller('finance')
export class AnalyticsController {
  constructor(
    private readonly svc: AnalyticsService,
    private readonly access: AccessService,
  ) {}

  @Get('analytics')
  async analytics(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string, @Query('vehicleNo') vehicleNo?: string) {
    await this.access.require(u, 'invoice', 'view');
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 30 * DAY);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new BadRequestException('from and to must be dates');
    return this.svc.compute(u, start, end, vehicleNo || undefined);
  }
}
