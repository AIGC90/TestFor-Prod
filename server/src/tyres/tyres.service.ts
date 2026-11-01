import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { type InterchangeLine, tyreEvents, tyreInterchanges, tyreLayouts, tyres } from '../db/schema';
import { AuditService } from '../erp/audit.service';
import { validationError } from '../erp/crud';
import { NumberingService } from '../erp/numbering.service';
import { text } from '../erp/zod-helpers';
import { OdometerService, vehicleKey } from '../traccar/odometer.service';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Tyre = typeof tyres.$inferSelect;

/** Wheel positions for the common Indian truck configurations. */
export const LAYOUTS: Record<string, { label: string; positions: string[] }> = {
  '4w': { label: '4 wheels (LCV)', positions: ['FL', 'FR', 'RL', 'RR', 'SPARE'] },
  '6w': { label: '6 wheels (2 axles, dual rear)', positions: ['FL', 'FR', 'RLO', 'RLI', 'RRI', 'RRO', 'SPARE'] },
  '10w': { label: '10 wheels (tandem drive)', positions: ['FL', 'FR', 'D1LO', 'D1LI', 'D1RI', 'D1RO', 'D2LO', 'D2LI', 'D2RI', 'D2RO', 'SPARE'] },
  '12w': { label: '12 wheels (twin steer, tandem drive)', positions: ['FL', 'FR', 'F2L', 'F2R', 'D1LO', 'D1LI', 'D1RI', 'D1RO', 'D2LO', 'D2LI', 'D2RI', 'D2RO', 'SPARE'] },
};
export const DEFAULT_LAYOUT = '6w';
export const LEGAL_NSD = 1.6;
export const WATCH_NSD = 3;

/** Km a tyre has run: earlier fitments plus the current one from the vehicle odometer. */
export function tyreKm(t: Pick<Tyre, 'status' | 'closedKm' | 'fittedKm'>, odometerKm: number | null | undefined) {
  const current = t.status === 'fitted' && t.fittedKm !== null && odometerKm !== null && odometerKm !== undefined ? Math.max(0, odometerKm - t.fittedKm) : 0;
  return Math.round((t.closedKm + current) * 10) / 10;
}

/** Cost per km of a tyre (purchase plus retreads/repairs); null until it has run. */
export function costPerKm(cost: number, km: number) {
  return km > 0 ? Math.round((cost / km) * 100) / 100 : null;
}

const fitBody = z.object({
  tyreId: z.coerce.number().int().positive(),
  vehicleNo: z.string().trim().toUpperCase().min(4).max(20),
  position: z.string().trim().toUpperCase().min(1).max(10),
  odometerKm: z.coerce.number().min(0).nullish(),
  technician: text(100),
  remarks: text(500),
});
const removeBody = z.object({
  to: z.enum(['store', 'retreader', 'scrap']),
  odometerKm: z.coerce.number().min(0).nullish(),
  nsd: z.coerce.number().min(0).max(30).nullish(),
  technician: text(100),
  remarks: text(500),
});
const inspectBody = z.object({
  nsd: z.coerce.number().min(0).max(30),
  pressure: z.coerce.number().min(0).max(200).nullish(),
  technician: text(100),
  remarks: text(500),
});
const costBody = z.object({ cost: z.coerce.number().min(0), nsd: z.coerce.number().min(0).max(30).nullish(), remarks: text(500), refNo: text(60) });
const interchangeBody = z.object({
  odometerKm: z.coerce.number().min(0).nullish(),
  remarks: text(500),
  lines: z
    .array(z.object({ tyreId: z.coerce.number().int().positive(), toVehicleNo: z.string().trim().toUpperCase().min(4).max(20), toPosition: z.string().trim().toUpperCase().min(1).max(10) }))
    .min(1)
    .max(30),
});

@Injectable()
export class TyresService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly odometers: OdometerService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  private async tyre(tx: Tx | Db, id: number) {
    const [t] = await tx.select().from(tyres).where(eq(tyres.id, id));
    if (!t) throw new NotFoundException('Tyre not found');
    return t;
  }

  private async event(tx: Tx | Db, user: AuthUser | null, e: Omit<typeof tyreEvents.$inferInsert, 'createdBy'>) {
    await tx.insert(tyreEvents).values({ ...e, createdBy: user?.id ?? null });
  }

  async layout(vehicleNo: string) {
    const [l] = await this.db.select().from(tyreLayouts).where(eq(tyreLayouts.vehicleNo, vehicleNo.toUpperCase()));
    if (l) return l;
    return { vehicleNo: vehicleNo.toUpperCase(), layout: DEFAULT_LAYOUT, positions: LAYOUTS[DEFAULT_LAYOUT].positions };
  }

  async setLayout(user: AuthUser, vehicleNo: string, layout: string) {
    const def = LAYOUTS[layout];
    if (!def) throw new BadRequestException(`layout must be one of ${Object.keys(LAYOUTS).join(', ')}`);
    const v = vehicleNo.trim().toUpperCase();
    const fitted = await this.db.select().from(tyres).where(and(eq(tyres.vehicleNo, v), eq(tyres.status, 'fitted')));
    const orphan = fitted.find((t) => !def.positions.includes(t.position!));
    if (orphan) throw new ConflictException(`Tyre ${orphan.serial} is fitted at ${orphan.position}, which the new layout does not have; remove it first`);
    const values = { vehicleNo: v, layout, positions: def.positions };
    await this.db.insert(tyreLayouts).values(values).onConflictDoUpdate({ target: tyreLayouts.vehicleNo, set: values });
    await this.audit.log(user, 'update', 'tyre_layout', v, { layout });
    return values;
  }

  private async odo(user: AuthUser, vehicleNo: string, given?: number | null) {
    if (given !== null && given !== undefined) return given;
    return (await this.odometers.readings(user.cookie)).get(vehicleKey(vehicleNo)) ?? null;
  }

  async fit(user: AuthUser, raw: unknown) {
    const parsed = fitBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const d = parsed.data;
    const layout = await this.layout(d.vehicleNo);
    if (!layout.positions.includes(d.position)) throw new BadRequestException(`${d.vehicleNo} has no position ${d.position} (layout ${layout.layout})`);
    const odometerKm = await this.odo(user, d.vehicleNo, d.odometerKm);
    return this.db.transaction(async (tx) => {
      const t = await this.tyre(tx, d.tyreId);
      if (t.status !== 'in_store') throw new ConflictException(`Tyre ${t.serial} is ${t.status.replace('_', ' ')}, not in store`);
      const [taken] = await tx.select().from(tyres).where(and(eq(tyres.vehicleNo, d.vehicleNo), eq(tyres.position, d.position), eq(tyres.status, 'fitted')));
      if (taken) throw new ConflictException(`${d.position} on ${d.vehicleNo} already has tyre ${taken.serial}`);
      const [row] = await tx
        .update(tyres)
        .set({ status: 'fitted', vehicleNo: d.vehicleNo, position: d.position, fittedAt: new Date(), fittedKm: odometerKm, updatedAt: new Date() })
        .where(eq(tyres.id, t.id))
        .returning();
      await this.event(tx, user, { tyreId: t.id, type: 'fit', vehicleNo: d.vehicleNo, position: d.position, odometerKm, nsd: t.lastNsd, technician: d.technician, remarks: d.remarks });
      return row;
    });
  }

  async remove(user: AuthUser, id: number, raw: unknown) {
    const parsed = removeBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const d = parsed.data;
    const t = await this.tyre(this.db, id);
    if (t.status !== 'fitted') throw new ConflictException(`Tyre ${t.serial} is not fitted`);
    const odometerKm = await this.odo(user, t.vehicleNo!, d.odometerKm);
    const ran = t.fittedKm !== null && odometerKm !== null ? Math.max(0, odometerKm - t.fittedKm) : 0;
    const status = d.to === 'store' ? 'in_store' : d.to === 'retreader' ? 'at_retreader' : 'scrapped';
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(tyres)
        .set({
          status,
          vehicleNo: null,
          position: null,
          fittedAt: null,
          fittedKm: null,
          closedKm: Math.round((t.closedKm + ran) * 10) / 10,
          ...(d.nsd !== null && d.nsd !== undefined ? { lastNsd: d.nsd, lastNsdAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(tyres.id, id))
        .returning();
      await this.event(tx, user, { tyreId: id, type: 'remove', vehicleNo: t.vehicleNo, position: t.position, odometerKm, nsd: d.nsd ?? t.lastNsd, technician: d.technician, remarks: d.remarks });
      if (d.to !== 'store') await this.event(tx, user, { tyreId: id, type: d.to === 'retreader' ? 'retread_out' : 'scrap', nsd: d.nsd ?? t.lastNsd, remarks: d.remarks });
      return row;
    });
  }

  async inspect(user: AuthUser, id: number, raw: unknown) {
    const parsed = inspectBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const t = await this.tyre(this.db, id);
    const odometerKm = t.vehicleNo ? await this.odo(user, t.vehicleNo) : null;
    const [row] = await this.db
      .update(tyres)
      .set({ lastNsd: parsed.data.nsd, lastNsdAt: new Date(), ...(parsed.data.pressure ? { lastPressure: parsed.data.pressure } : {}), updatedAt: new Date() })
      .where(eq(tyres.id, id))
      .returning();
    await this.event(this.db, user, { tyreId: id, type: 'inspect', vehicleNo: t.vehicleNo, position: t.position, odometerKm, nsd: parsed.data.nsd, pressure: parsed.data.pressure ?? null, technician: parsed.data.technician, remarks: parsed.data.remarks });
    return row;
  }

  /** A retreaded casing comes back to store with fresh tread. */
  async retreadIn(user: AuthUser, id: number, raw: unknown) {
    const parsed = costBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const t = await this.tyre(this.db, id);
    if (t.status !== 'at_retreader') throw new ConflictException(`Tyre ${t.serial} is not at the retreader`);
    const [row] = await this.db
      .update(tyres)
      .set({ status: 'in_store', retreadCount: t.retreadCount + 1, upkeepCost: t.upkeepCost + parsed.data.cost, lastNsd: parsed.data.nsd ?? t.lastNsd, lastNsdAt: new Date(), updatedAt: new Date() })
      .where(eq(tyres.id, id))
      .returning();
    await this.event(this.db, user, { tyreId: id, type: 'retread_in', cost: parsed.data.cost, nsd: parsed.data.nsd ?? null, refNo: parsed.data.refNo, remarks: parsed.data.remarks });
    return row;
  }

  async repair(user: AuthUser, id: number, raw: unknown) {
    const parsed = costBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const t = await this.tyre(this.db, id);
    if (['scrapped', 'sold'].includes(t.status)) throw new ConflictException(`Tyre ${t.serial} is ${t.status}`);
    const [row] = await this.db.update(tyres).set({ upkeepCost: t.upkeepCost + parsed.data.cost, updatedAt: new Date() }).where(eq(tyres.id, id)).returning();
    await this.event(this.db, user, { tyreId: id, type: 'repair', vehicleNo: t.vehicleNo, position: t.position, cost: parsed.data.cost, refNo: parsed.data.refNo, remarks: parsed.data.remarks });
    return row;
  }

  async dispose(user: AuthUser, id: number, how: 'scrap' | 'sale', raw: unknown) {
    const parsed = costBody.partial().safeParse(raw ?? {});
    if (!parsed.success) throw validationError(parsed.error);
    const t = await this.tyre(this.db, id);
    if (!['in_store', 'at_retreader'].includes(t.status)) throw new ConflictException(`Remove tyre ${t.serial} from the vehicle first`);
    const [row] = await this.db.update(tyres).set({ status: how === 'scrap' ? 'scrapped' : 'sold', updatedAt: new Date() }).where(eq(tyres.id, id)).returning();
    await this.event(this.db, user, { tyreId: id, type: how, cost: parsed.data.cost ?? null, refNo: parsed.data.refNo ?? null, remarks: parsed.data.remarks ?? null });
    return row;
  }

  /** Moves fitted tyres to new positions (same vehicle or another); swaps are allowed within one interchange. */
  async interchange(user: AuthUser, raw: unknown) {
    const parsed = interchangeBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const d = parsed.data;
    const list = await this.db.select().from(tyres).where(inArray(tyres.id, d.lines.map((l) => l.tyreId)));
    const byId = new Map(list.map((t) => [t.id, t]));
    for (const l of d.lines) {
      const t = byId.get(l.tyreId);
      if (!t) throw new BadRequestException(`Tyre ${l.tyreId} not found`);
      if (t.status !== 'fitted') throw new ConflictException(`Tyre ${t.serial} is not fitted`);
      const layout = await this.layout(l.toVehicleNo);
      if (!layout.positions.includes(l.toPosition)) throw new BadRequestException(`${l.toVehicleNo} has no position ${l.toPosition}`);
    }
    const targets = d.lines.map((l) => `${l.toVehicleNo}|${l.toPosition}`);
    if (new Set(targets).size !== targets.length) throw new BadRequestException('Two tyres cannot go to the same position');
    const vacated = new Set(d.lines.map((l) => `${byId.get(l.tyreId)!.vehicleNo}|${byId.get(l.tyreId)!.position}`));
    for (const l of d.lines) {
      const [occupant] = await this.db.select().from(tyres).where(and(eq(tyres.vehicleNo, l.toVehicleNo), eq(tyres.position, l.toPosition), eq(tyres.status, 'fitted')));
      if (occupant && !vacated.has(`${l.toVehicleNo}|${l.toPosition}`)) {
        throw new ConflictException(`${l.toPosition} on ${l.toVehicleNo} has tyre ${occupant.serial}; include it in the interchange`);
      }
    }
    const odo = await this.odometers.readings(user.cookie);
    const lines: InterchangeLine[] = [];
    const cross = d.lines.some((l) => l.toVehicleNo !== byId.get(l.tyreId)!.vehicleNo);
    return this.db.transaction(async (tx) => {
      for (const l of d.lines) {
        const t = byId.get(l.tyreId)!;
        const fromOdo = d.odometerKm ?? odo.get(vehicleKey(t.vehicleNo!)) ?? null;
        const toOdo = l.toVehicleNo === t.vehicleNo ? fromOdo : (odo.get(vehicleKey(l.toVehicleNo)) ?? null);
        const ran = t.fittedKm !== null && fromOdo !== null ? Math.max(0, fromOdo - t.fittedKm) : 0;
        await tx
          .update(tyres)
          .set({ vehicleNo: l.toVehicleNo, position: l.toPosition, closedKm: Math.round((t.closedKm + ran) * 10) / 10, fittedKm: toOdo, fittedAt: new Date(), updatedAt: new Date() })
          .where(eq(tyres.id, t.id));
        await this.event(tx, user, { tyreId: t.id, type: 'rotate', vehicleNo: t.vehicleNo, position: t.position, toVehicleNo: l.toVehicleNo, toPosition: l.toPosition, odometerKm: fromOdo, nsd: t.lastNsd, remarks: d.remarks });
        lines.push({ tyreId: t.id, serial: t.serial, fromVehicleNo: t.vehicleNo!, fromPosition: t.position!, toVehicleNo: l.toVehicleNo, toPosition: l.toPosition });
      }
      const [row] = await tx
        .insert(tyreInterchanges)
        .values({ tiNo: await this.numbering.next('TI'), kind: cross ? 'cross' : 'rotation', lines, remarks: d.remarks, createdBy: user.id })
        .returning();
      await this.audit.log(user, 'interchange', 'tyre', row.id, { lines: lines.length });
      return row;
    });
  }

  /** Tyres with their km and cost per km, from live odometers. */
  async withKm(user: AuthUser, where?: SQL) {
    const [list, odo] = await Promise.all([this.db.select().from(tyres).where(where), this.odometers.readings(user.cookie)]);
    return list.map((t) => {
      const kmRun = tyreKm(t, t.vehicleNo ? odo.get(vehicleKey(t.vehicleNo)) : null);
      return { ...t, kmRun, costPerKm: costPerKm(t.purchaseCost + t.upkeepCost, kmRun) };
    });
  }

  async vehicleMap(user: AuthUser, vehicleNo: string) {
    const v = vehicleNo.trim().toUpperCase();
    const layout = await this.layout(v);
    const fitted = await this.withKm(user, and(eq(tyres.vehicleNo, v), eq(tyres.status, 'fitted')));
    const history = await this.db.select().from(tyreEvents).where(eq(tyreEvents.vehicleNo, v)).orderBy(desc(tyreEvents.at)).limit(30);
    return { ...layout, layouts: LAYOUTS, tyres: fitted, history };
  }

  async nsdAlerts(user: AuthUser, threshold: number) {
    const list = await this.withKm(user, and(eq(tyres.status, 'fitted'), lte(tyres.lastNsd, threshold)));
    return list
      .map((t) => ({ ...t, severity: (t.lastNsd ?? 0) <= LEGAL_NSD ? 'critical' : 'warning' }))
      .sort((a, b) => (a.lastNsd ?? 0) - (b.lastNsd ?? 0));
  }

  async overview(user: AuthUser) {
    const all = await this.withKm(user);
    const fitted = all.filter((t) => t.status === 'fitted');
    const withNsd = fitted.filter((t) => t.lastNsd !== null);
    const band = (lo: number, hi: number) => withNsd.filter((t) => t.lastNsd! > lo && t.lastNsd! <= hi).length;
    const since = new Date();
    since.setMonth(since.getMonth() - 11, 1);
    since.setHours(0, 0, 0, 0);
    const events = await this.db.select().from(tyreEvents).where(gte(tyreEvents.at, since));
    const purchases = all.filter((t) => t.purchaseDate && t.purchaseDate >= since);
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(since);
      d.setMonth(since.getMonth() + i);
      return d.toISOString().slice(0, 7);
    });
    const spend = months.map((m) => ({
      month: m,
      newTyres: purchases.filter((t) => t.purchaseDate!.toISOString().startsWith(m)).reduce((s, t) => s + t.purchaseCost, 0),
      retreads: events.filter((e) => e.type === 'retread_in' && e.at.toISOString().startsWith(m)).reduce((s, e) => s + (e.cost ?? 0), 0),
      repairs: events.filter((e) => e.type === 'repair' && e.at.toISOString().startsWith(m)).reduce((s, e) => s + (e.cost ?? 0), 0),
    }));
    const totalCost = fitted.reduce((s, t) => s + t.purchaseCost + t.upkeepCost, 0);
    const totalKm = fitted.reduce((s, t) => s + t.kmRun, 0);
    const lowPressure = fitted.filter((t) => t.targetPressure && t.lastPressure && t.lastPressure < t.targetPressure * 0.9);
    const alerts = [
      ...withNsd.filter((t) => t.lastNsd! <= WATCH_NSD).map((t) => ({ severity: t.lastNsd! <= LEGAL_NSD ? 'critical' : 'high', tyreId: t.id, serial: t.serial, vehicleNo: t.vehicleNo, position: t.position, issue: `Tread ${t.lastNsd} mm` })),
      ...lowPressure.map((t) => ({ severity: 'medium', tyreId: t.id, serial: t.serial, vehicleNo: t.vehicleNo, position: t.position, issue: `Pressure ${t.lastPressure} psi (target ${t.targetPressure})` })),
      ...all.filter((t) => t.status === 'at_retreader').map((t) => ({ severity: 'low', tyreId: t.id, serial: t.serial, vehicleNo: null, position: null, issue: 'At the retreader' })),
    ];
    return {
      inService: fitted.length,
      vehicles: new Set(fitted.map((t) => t.vehicleNo)).size,
      inStore: all.filter((t) => t.status === 'in_store').length,
      atRetreader: all.filter((t) => t.status === 'at_retreader').length,
      avgNsd: withNsd.length ? Math.round((withNsd.reduce((s, t) => s + t.lastNsd!, 0) / withNsd.length) * 10) / 10 : null,
      health: { good: withNsd.filter((t) => t.lastNsd! > 6).length, watch: band(WATCH_NSD, 6), replace: withNsd.filter((t) => t.lastNsd! <= WATCH_NSD).length, unknown: fitted.length - withNsd.length },
      nsdBands: [[0, 3], [3, 6], [6, 9], [9, 12], [12, 99]].map(([lo, hi]) => ({ band: hi === 99 ? `${lo}+ mm` : `${lo}-${hi} mm`, count: lo === 0 ? withNsd.filter((t) => t.lastNsd! <= 3).length : band(lo, hi) })),
      costPerKm: costPerKm(totalCost, totalKm),
      lowPressure: lowPressure.length,
      spend,
      replacementForecast: withNsd
        .filter((t) => t.lastNsd! <= 4)
        .sort((a, b) => a.lastNsd! - b.lastNsd!)
        .map((t) => ({ tyreId: t.id, serial: t.serial, brand: t.brand, model: t.model, vehicleNo: t.vehicleNo, position: t.position, nsd: t.lastNsd, replaceBy: t.lastNsd! <= WATCH_NSD ? 'now' : 'within 30 days', estimatedCost: t.purchaseCost })),
      alerts,
    };
  }

  /** Tyre spend per km by vehicle for tyres currently fitted. */
  async costByVehicle(user: AuthUser) {
    const fitted = await this.withKm(user, eq(tyres.status, 'fitted'));
    const byVehicle = new Map<string, typeof fitted>();
    fitted.forEach((t) => byVehicle.set(t.vehicleNo!, [...(byVehicle.get(t.vehicleNo!) ?? []), t]));
    return [...byVehicle.entries()]
      .map(([vehicleNo, list]) => {
        const newSpend = list.reduce((s, t) => s + t.purchaseCost, 0);
        const upkeep = list.reduce((s, t) => s + t.upkeepCost, 0);
        const avgKm = list.reduce((s, t) => s + t.kmRun, 0) / list.length;
        const cpkm = costPerKm(newSpend + upkeep, avgKm);
        return { vehicleNo, tyres: list.length, avgKm: Math.round(avgKm), newSpend, upkeep, total: newSpend + upkeep, costPerKm: cpkm };
      })
      .sort((a, b) => (b.costPerKm ?? 0) - (a.costPerKm ?? 0));
  }

  /** Life and cost per km grouped by brand, model or size. */
  async performance(user: AuthUser, groupBy: 'brand' | 'model' | 'size') {
    const all = await this.withKm(user);
    const groups = new Map<string, typeof all>();
    all.forEach((t) => {
      const key = (groupBy === 'model' ? `${t.brand} ${t.model ?? ''}`.trim() : t[groupBy]) || 'Unknown';
      groups.set(key, [...(groups.get(key) ?? []), t]);
    });
    return [...groups.entries()]
      .map(([group, list]) => {
        const closed = list.filter((t) => t.status === 'scrapped' || t.status === 'sold');
        const lifeBase = closed.length ? closed : list;
        const km = list.reduce((s, t) => s + t.kmRun, 0);
        const cost = list.reduce((s, t) => s + t.purchaseCost + t.upkeepCost, 0);
        const removalNsd = closed.filter((t) => t.lastNsd !== null);
        return {
          group,
          tyres: list.length,
          closedLives: closed.length,
          avgLifeKm: Math.round(lifeBase.reduce((s, t) => s + t.kmRun, 0) / lifeBase.length),
          avgRemovalNsd: removalNsd.length ? Math.round((removalNsd.reduce((s, t) => s + t.lastNsd!, 0) / removalNsd.length) * 10) / 10 : null,
          avgCost: Math.round(list.reduce((s, t) => s + t.purchaseCost, 0) / list.length),
          costPerKm: costPerKm(cost, km),
        };
      })
      .sort((a, b) => (a.costPerKm ?? 1e9) - (b.costPerKm ?? 1e9));
  }
}
