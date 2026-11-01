import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, OnModuleInit, Param, ParseIntPipe, Post } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { fuelIndents, incomingVehicles, lorryReceipts, materialReturns, orders, stockPieces, trips } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { ApprovalsService } from '../erp/approvals.service';
import { AuditService } from '../erp/audit.service';
import { validationError } from '../erp/crud';
import { NumberingService } from '../erp/numbering.service';
import { text } from '../erp/zod-helpers';
import { requireItems } from '../inventory/docs';
import { StockService } from '../inventory/stock.service';
import { TraccarService } from '../traccar/traccar.service';
import { lrSchema } from './docs';

type Trip = typeof trips.$inferSelect;
interface Position {
  deviceId: number;
  speed: number; // knots
  fixTime: string;
  attributes: { totalDistance?: number };
}

const KNOTS_TO_KMH = 1.852;
/** Speed assumed for ETA when the truck is stopped or the speed is unreliable. */
const FALLBACK_KMH = 45;

/** Live progress of a trip from its start odometer and the vehicle's current position. */
export function tripProgress(trip: Pick<Trip, 'status' | 'plannedKm' | 'startOdometerM' | 'plannedArrival'>, pos: Position | undefined, now = new Date()) {
  if (trip.status !== 'in_transit' || !pos || trip.startOdometerM === null || !trip.plannedKm) {
    return { travelledKm: null, progressPct: trip.status === 'arrived' || trip.status === 'completed' ? 100 : null, eta: null, delayed: false };
  }
  const travelledKm = Math.max(0, ((pos.attributes.totalDistance ?? trip.startOdometerM) - trip.startOdometerM) / 1000);
  const remainingKm = Math.max(0, trip.plannedKm - travelledKm);
  const speedKmh = pos.speed * KNOTS_TO_KMH;
  const etaHours = remainingKm / (speedKmh > 10 ? speedKmh : FALLBACK_KMH);
  const eta = new Date(now.getTime() + etaHours * 3_600_000);
  return {
    travelledKm: Math.round(travelledKm * 10) / 10,
    progressPct: Math.min(99, Math.round((travelledKm / trip.plannedKm) * 100)),
    eta: eta.toISOString(),
    delayed: Boolean(trip.plannedArrival && eta > trip.plannedArrival),
  };
}

const podBody = z.object({ receivedBy: z.string().trim().min(2, 'who received the goods?').max(100), remarks: text(1000) });
const returnBody = z.object({
  storeId: z.coerce.number().int().positive(),
  returnDate: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.coerce.date().optional()),
  vehicleNo: z.string().trim().toUpperCase().min(4).max(20),
  lrNo: text(40),
  indentNo: text(40),
  condition: z.enum(['good', 'damaged']).default('good'),
  lines: z
    .array(z.object({ itemId: z.coerce.number().int().positive(), qty: z.coerce.number().positive(), serials: z.array(z.string().trim().min(1)).default([]) }))
    .min(1, 'list what came back')
    .max(100),
  notes: text(1000),
});

@Injectable()
export class OperationsService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly traccar: TraccarService,
    private readonly approvals: ApprovalsService,
    private readonly stock: StockService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.approvals.onDecision('fuel_indent', async (req, decision) => {
      await this.db.update(fuelIndents).set({ status: decision, updatedAt: new Date() }).where(eq(fuelIndents.id, req.docId));
    });
  }

  private async trip(id: number) {
    const [t] = await this.db.select().from(trips).where(eq(trips.id, id));
    if (!t) throw new NotFoundException();
    return t;
  }

  private async positions(user: AuthUser): Promise<Map<number, Position>> {
    try {
      const list = await this.traccar.get<Position[]>(user.cookie, '/positions');
      return new Map(list.map((p) => [p.deviceId, p]));
    } catch {
      return new Map();
    }
  }

  /** Open trips with live progress, ETA and delay flags. */
  async live(user: AuthUser) {
    const list = await this.db.select().from(trips).where(inArray(trips.status, ['scheduled', 'in_transit', 'arrived']));
    const pos = await this.positions(user);
    return list.map((t) => ({ ...t, ...tripProgress(t, t.deviceId ? pos.get(t.deviceId) : undefined) }));
  }

  async start(user: AuthUser, id: number) {
    const t = await this.trip(id);
    if (t.status !== 'scheduled') throw new ConflictException(`Trip is ${t.status.replace('_', ' ')}`);
    const pos = t.deviceId ? (await this.positions(user)).get(t.deviceId) : undefined;
    const [row] = await this.db
      .update(trips)
      .set({ status: 'in_transit', startedAt: new Date(), startOdometerM: pos?.attributes.totalDistance ?? null, updatedAt: new Date() })
      .where(eq(trips.id, id))
      .returning();
    if (t.orderId) await this.db.update(orders).set({ status: 'in_transit', updatedAt: new Date() }).where(eq(orders.id, t.orderId));
    await this.audit.log(user, 'start', 'trip', id);
    return row;
  }

  async arrive(user: AuthUser | null, id: number) {
    const t = await this.trip(id);
    if (t.status !== 'in_transit') throw new ConflictException(`Trip is ${t.status.replace('_', ' ')}`);
    const [row] = await this.db.update(trips).set({ status: 'arrived', arrivedAt: new Date(), updatedAt: new Date() }).where(eq(trips.id, id)).returning();
    await this.audit.log(user, 'arrive', 'trip', id);
    return row;
  }

  /** Proof of delivery closes the trip and marks the order delivered. */
  async pod(user: AuthUser, id: number, raw: unknown) {
    const parsed = podBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const t = await this.trip(id);
    if (t.status !== 'arrived' && t.status !== 'in_transit') throw new ConflictException(`Trip is ${t.status.replace('_', ' ')}`);
    const now = new Date();
    const [row] = await this.db
      .update(trips)
      .set({ status: 'completed', completedAt: now, arrivedAt: t.arrivedAt ?? now, podStatus: 'verified', podReceivedBy: parsed.data.receivedBy, podRemarks: parsed.data.remarks, podAt: now, updatedAt: now })
      .where(eq(trips.id, id))
      .returning();
    if (t.orderId) await this.db.update(orders).set({ status: 'delivered', updatedAt: now }).where(eq(orders.id, t.orderId));
    await this.audit.log(user, 'pod', 'trip', id, parsed.data);
    return row;
  }

  async cancel(user: AuthUser, id: number) {
    const t = await this.trip(id);
    if (t.status === 'completed' || t.status === 'cancelled') throw new ConflictException(`Trip is ${t.status}`);
    const [row] = await this.db.update(trips).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(trips.id, id)).returning();
    if (t.orderId) await this.db.update(orders).set({ status: 'booked', tripId: null, updatedAt: new Date() }).where(eq(orders.id, t.orderId));
    await this.audit.log(user, 'cancel', 'trip', id);
    return row;
  }

  /** Traccar event hook: entering the destination geofence marks an in-transit trip as arrived. */
  async onTraccarEvent(event: { type?: string; deviceId?: number; geofenceId?: number }) {
    if (event.type !== 'geofenceEnter' || !event.deviceId || !event.geofenceId) return;
    const open = await this.db
      .select()
      .from(trips)
      .where(and(eq(trips.deviceId, event.deviceId), eq(trips.destGeofenceId, event.geofenceId), eq(trips.status, 'in_transit')));
    for (const t of open) await this.arrive(null, t.id);
  }

  /** Bulk LR entry (loading-sheet upload): valid rows are created, the rest reported. */
  async bulkLrs(user: AuthUser, rows: unknown) {
    if (!Array.isArray(rows) || !rows.length) throw new BadRequestException('rows must be a non-empty array');
    if (rows.length > 2000) throw new BadRequestException('Upload at most 2000 rows at a time');
    const created: string[] = [];
    const errors: { row: number; error: string }[] = [];
    for (const [i, raw] of rows.entries()) {
      const parsed = lrSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push({ row: i + 1, error: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
        continue;
      }
      const lrNo = parsed.data.lrNo ?? (await this.numbering.next('LR'));
      const [dup] = await this.db.select({ id: lorryReceipts.id }).from(lorryReceipts).where(eq(lorryReceipts.lrNo, lrNo));
      if (dup) {
        errors.push({ row: i + 1, error: `LR ${lrNo} already exists` });
        continue;
      }
      await this.db.insert(lorryReceipts).values({ ...parsed.data, lrNo, createdBy: user.id });
      created.push(lrNo);
    }
    await this.audit.log(user, 'import', 'lr', null, { created: created.length, failed: errors.length });
    return { created: created.length, errors };
  }

  async receiveIncoming(user: AuthUser, id: number) {
    const [v] = await this.db.select().from(incomingVehicles).where(eq(incomingVehicles.id, id));
    if (!v) throw new NotFoundException();
    if (v.status === 'received') throw new ConflictException('Already received');
    const [row] = await this.db.update(incomingVehicles).set({ status: 'received', receivedAt: new Date(), updatedAt: new Date() }).where(eq(incomingVehicles.id, id)).returning();
    await this.audit.log(user, 'receive', 'incoming_vehicle', id);
    return row;
  }

  /** Material coming back from a vehicle goes into stock in one transaction; damaged pieces are marked. */
  async receiveReturn(user: AuthUser, raw: unknown) {
    const parsed = returnBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const d = parsed.data;
    await requireItems(this.db, d.lines.map((l) => l.itemId));
    const returnNo = await this.numbering.next('MR');
    const row = await this.db.transaction(async (tx) => {
      for (const l of d.lines) {
        await this.stock.postInTx(tx, { kind: 'return', itemId: l.itemId, storeId: d.storeId, qty: l.qty, serials: l.serials, vehicleNo: d.vehicleNo, lrNo: d.lrNo, refType: 'material_return', refNo: returnNo, remarks: d.notes }, user);
        if (d.condition === 'damaged' && l.serials.length) {
          await tx.update(stockPieces).set({ state: 'damaged', updatedAt: new Date() }).where(and(eq(stockPieces.itemId, l.itemId), inArray(stockPieces.serial, l.serials)));
        }
      }
      const [r] = await tx.insert(materialReturns).values({ ...d, returnNo, returnDate: d.returnDate ?? new Date(), createdBy: user.id }).returning();
      return r;
    });
    await this.audit.log(user, 'receive', 'material_return', row.id, { returnNo });
    return row;
  }
}

@Controller('ops')
export class OperationsActionsController {
  constructor(
    private readonly ops: OperationsService,
    private readonly access: AccessService,
  ) {}

  @Get('trips-live')
  async live(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'trip', 'view');
    return this.ops.live(u);
  }

  @Post('trips/:id/start')
  async start(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'trip', 'edit');
    return this.ops.start(u, id);
  }

  @Post('trips/:id/arrive')
  async arrive(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'trip', 'edit');
    return this.ops.arrive(u, id);
  }

  @Post('trips/:id/pod')
  async pod(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.access.require(u, 'trip', 'edit');
    return this.ops.pod(u, id, body);
  }

  @Post('trips/:id/cancel')
  async cancel(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'trip', 'edit');
    return this.ops.cancel(u, id);
  }

  @Post('lrs/bulk')
  async bulk(@CurrentUser() u: AuthUser, @Body() body: { rows?: unknown }) {
    await this.access.require(u, 'lr', 'create');
    return this.ops.bulkLrs(u, body?.rows);
  }

  @Post('incoming/:id/receive')
  async receive(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'incoming_vehicle', 'edit');
    return this.ops.receiveIncoming(u, id);
  }

  @Post('returns/receive')
  async returns(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    await this.access.require(u, 'material_return', 'create');
    await this.access.require(u, 'stock_movement', 'create');
    return this.ops.receiveReturn(u, body);
  }
}
