import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { glVouchers, integrations, itemCategories, items, stockBalances, stockMovements, stockPieces, stores } from '../db/schema';
import { NumberingService } from '../erp/numbering.service';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type MovementKind = 'receipt' | 'issue' | 'transfer' | 'adjustment' | 'write_off' | 'opening' | 'sale' | 'return';
export type Movement = typeof stockMovements.$inferSelect;

export interface MovementInput {
  kind: MovementKind;
  itemId: number;
  storeId: number;
  toStoreId?: number | null;
  /** Positive, except adjustments which are signed (+found / -lost). */
  qty: number;
  /** Cost per unit for stock coming in; outgoing stock always uses the moving average. */
  unitRate?: number | null;
  serials?: string[];
  vehicleNo?: string | null;
  lrNo?: string | null;
  refType?: string | null;
  refId?: number | null;
  refNo?: string | null;
  remarks?: string | null;
  /** Transfers may stay in transit until received at the destination. */
  status?: 'completed' | 'in_transit';
  movedAt?: Date;
}

const PREFIX: Record<MovementKind, string> = {
  receipt: 'RCT', issue: 'ISS', transfer: 'TRF', adjustment: 'ADJ', write_off: 'SCR', opening: 'OPN', sale: 'SAL', return: 'RET',
};
const INBOUND = new Set<MovementKind>(['receipt', 'opening', 'return']);
/** Piece state after an outbound movement of each kind. */
const OUT_STATE: Partial<Record<MovementKind, string>> = { issue: 'issued', write_off: 'written_off', sale: 'sold', adjustment: 'written_off', transfer: 'in_transit' };

/** Debit / credit accounts per movement, used when GL posting is on. */
export function glAccounts(kind: MovementKind, qty: number): { debit: string; credit: string } | null {
  switch (kind) {
    case 'receipt':
      return { debit: 'Inventory', credit: 'Goods Received Not Invoiced' };
    case 'opening':
      return { debit: 'Inventory', credit: 'Opening Balance Equity' };
    case 'return':
      return { debit: 'Inventory', credit: 'Vehicle Maintenance Expense' };
    case 'issue':
      return { debit: 'Vehicle Maintenance Expense', credit: 'Inventory' };
    case 'write_off':
      return { debit: 'Inventory Write-off', credit: 'Inventory' };
    case 'sale':
      return { debit: 'Cost of Scrap Sold', credit: 'Inventory' };
    case 'adjustment':
      return qty >= 0 ? { debit: 'Inventory', credit: 'Stock Adjustment' } : { debit: 'Stock Adjustment', credit: 'Inventory' };
    default:
      return null; // transfers stay inside the same entity
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class StockService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly numbering: NumberingService,
  ) {}

  /** Counting mode of an item: its own, else the nearest category's (default standard). */
  async countingMode(tx: Tx | Db, itemId: number): Promise<{ mode: string; name: string; rate: number | null }> {
    const [item] = await tx.select().from(items).where(eq(items.id, itemId));
    if (!item) throw new BadRequestException(`itemId: item ${itemId} not found`);
    let mode = item.countingMode;
    let catId: number | null = item.categoryId;
    while (!mode && catId) {
      const [cat] = await tx.select().from(itemCategories).where(eq(itemCategories.id, catId));
      mode = cat?.countingMode ?? null;
      catId = cat?.parentId ?? null;
    }
    return { mode: mode ?? 'standard', name: item.name, rate: item.rate };
  }

  /** Locks (creating if needed) the balance row of an item in a store. */
  private async lockBalance(tx: Tx, itemId: number, storeId: number) {
    await tx.insert(stockBalances).values({ itemId, storeId }).onConflictDoNothing();
    const [bal] = await tx
      .select()
      .from(stockBalances)
      .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.storeId, storeId)))
      .for('update');
    return bal;
  }

  private async addToBalance(tx: Tx, itemId: number, storeId: number, qty: number, value: number) {
    await tx
      .update(stockBalances)
      .set({ qty: sql`${stockBalances.qty} + ${qty}`, value: sql`${stockBalances.value} + ${value}`, updatedAt: new Date() })
      .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.storeId, storeId)));
  }

  async glEnabled(tx: Tx | Db = this.db) {
    const [row] = await tx.select().from(integrations).where(eq(integrations.key, 'gl'));
    return Boolean((row?.config as { enabled?: boolean } | undefined)?.enabled);
  }

  private async postVoucher(tx: Tx, m: Movement) {
    const acc = glAccounts(m.kind as MovementKind, m.qty);
    if (!acc || !m.value) return;
    const [v] = await tx
      .insert(glVouchers)
      .values({
        voucherNo: await this.numbering.next('JV', m.movedAt),
        date: m.movedAt,
        movementId: m.id,
        debitAccount: acc.debit,
        creditAccount: acc.credit,
        amount: Math.abs(m.value),
        narration: `${m.docNo} ${m.kind.replace('_', ' ')}${m.vehicleNo ? ` ${m.vehicleNo}` : ''}`,
      })
      .onConflictDoNothing()
      .returning();
    if (v) await tx.update(stockMovements).set({ glVoucherId: v.id }).where(eq(stockMovements.id, m.id));
  }

  /** Posts one movement inside an existing transaction (so documents can post several atomically). */
  async postInTx(tx: Tx, input: MovementInput, user: AuthUser | null): Promise<Movement> {
    const { kind } = input;
    const qty = Number(input.qty);
    if (!Number.isFinite(qty) || qty === 0) throw new BadRequestException('qty must be a non-zero number');
    if (kind !== 'adjustment' && qty < 0) throw new BadRequestException('qty must be positive');
    if (kind === 'transfer') {
      if (!input.toStoreId) throw new BadRequestException('toStoreId is required for a transfer');
      if (input.toStoreId === input.storeId) throw new BadRequestException('A transfer needs two different stores');
    }
    if (kind === 'issue' && !input.vehicleNo) throw new BadRequestException('vehicleNo is required when issuing to a vehicle');
    const storeIds = [input.storeId, ...(input.toStoreId ? [input.toStoreId] : [])];
    const found = await tx.select({ id: stores.id }).from(stores).where(inArray(stores.id, storeIds));
    if (found.length !== new Set(storeIds).size) throw new BadRequestException('storeId: store not found');

    const info = await this.countingMode(tx, input.itemId);
    const serial = info.mode === 'serial';
    const serials = (input.serials ?? []).map((s) => s.trim()).filter(Boolean);
    if (serial) {
      if (!Number.isInteger(qty)) throw new BadRequestException(`${info.name} is counted in whole pieces`);
      if (serials.length !== Math.abs(qty)) {
        throw new BadRequestException(`${info.name} is serial-tracked: give ${Math.abs(qty)} serial number(s), got ${serials.length}`);
      }
      if (new Set(serials).size !== serials.length) throw new BadRequestException('Serial numbers must be unique');
    } else if (serials.length) {
      throw new BadRequestException(`${info.name} is not serial-tracked; remove the serial numbers`);
    }

    const inbound = INBOUND.has(kind) || (kind === 'adjustment' && qty > 0);
    const absQty = Math.abs(qty);
    const bal = await this.lockBalance(tx, input.itemId, input.storeId);
    let unitRate: number;
    let value: number;

    if (inbound) {
      unitRate = input.unitRate ?? (bal.qty > 0 ? bal.value / bal.qty : (info.rate ?? 0));
      value = round2(absQty * unitRate);
      await this.addToBalance(tx, input.itemId, input.storeId, absQty, value);
    } else {
      if (bal.qty < absQty) {
        throw new ConflictException(`Only ${bal.qty} of ${info.name} in stock at this store; cannot take ${absQty}`);
      }
      unitRate = bal.qty > 0 ? bal.value / bal.qty : 0;
      value = absQty === bal.qty ? bal.value : round2(absQty * unitRate);
      await this.addToBalance(tx, input.itemId, input.storeId, -absQty, -value);
    }

    const status = kind === 'transfer' && input.status === 'in_transit' ? 'in_transit' : 'completed';
    const movedAt = input.movedAt ?? new Date();
    const [movement] = await tx
      .insert(stockMovements)
      .values({
        docNo: await this.numbering.next(PREFIX[kind], movedAt),
        kind,
        status,
        itemId: input.itemId,
        storeId: input.storeId,
        toStoreId: input.toStoreId ?? null,
        qty: kind === 'adjustment' ? qty : absQty,
        unitRate: round2(unitRate),
        value: kind === 'adjustment' && qty < 0 ? -value : value,
        serials,
        vehicleNo: input.vehicleNo ?? null,
        lrNo: input.lrNo ?? null,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        refNo: input.refNo ?? null,
        remarks: input.remarks ?? null,
        movedAt,
        completedAt: status === 'completed' ? movedAt : null,
        createdBy: user?.id ?? null,
      })
      .returning();

    if (serial) await this.movePieces(tx, movement, serials, inbound);
    if (kind === 'transfer' && status === 'completed') await this.arrive(tx, movement);
    if (await this.glEnabled(tx)) await this.postVoucher(tx, movement);
    return movement;
  }

  private async movePieces(tx: Tx, m: Movement, serials: string[], inbound: boolean) {
    const existing = await tx
      .select()
      .from(stockPieces)
      .where(and(eq(stockPieces.itemId, m.itemId), inArray(stockPieces.serial, serials)))
      .for('update');
    const bySerial = new Map(existing.map((p) => [p.serial, p]));
    for (const s of serials) {
      const piece = bySerial.get(s);
      if (inbound) {
        if (piece && ['in_stock', 'damaged', 'in_transit'].includes(piece.state)) {
          throw new ConflictException(`Serial ${s} is already in stock`);
        }
        if (piece && m.kind !== 'return' && m.kind !== 'adjustment') {
          throw new ConflictException(`Serial ${s} was ${piece.state.replace('_', ' ')} before; record it as a return`);
        }
        const values = { storeId: m.storeId, state: 'in_stock', vehicleNo: null, lastMovementId: m.id, updatedAt: new Date() };
        if (piece) await tx.update(stockPieces).set(values).where(eq(stockPieces.id, piece.id));
        else await tx.insert(stockPieces).values({ itemId: m.itemId, serial: s, ...values });
      } else {
        const allowed = m.kind === 'write_off' ? ['in_stock', 'damaged'] : ['in_stock'];
        if (!piece || piece.storeId !== m.storeId || !allowed.includes(piece.state)) {
          throw new ConflictException(`Serial ${s} is not available in this store`);
        }
        await tx
          .update(stockPieces)
          .set({
            state: OUT_STATE[m.kind as MovementKind] ?? 'issued',
            storeId: m.kind === 'transfer' ? m.storeId : null,
            vehicleNo: m.kind === 'issue' ? m.vehicleNo : null,
            lastMovementId: m.id,
            updatedAt: new Date(),
          })
          .where(eq(stockPieces.id, piece.id));
      }
    }
  }

  /** Adds a transfer's stock to the destination store. */
  private async arrive(tx: Tx, m: Movement) {
    await this.lockBalance(tx, m.itemId, m.toStoreId!);
    await this.addToBalance(tx, m.itemId, m.toStoreId!, m.qty, m.value);
    if (m.serials.length) {
      await tx
        .update(stockPieces)
        .set({ state: 'in_stock', storeId: m.toStoreId, lastMovementId: m.id, updatedAt: new Date() })
        .where(and(eq(stockPieces.itemId, m.itemId), inArray(stockPieces.serial, m.serials)));
    }
  }

  async post(input: MovementInput, user: AuthUser | null): Promise<Movement> {
    return this.db.transaction((tx) => this.postInTx(tx, input, user));
  }

  /** Receives an in-transit transfer at its destination. */
  async completeTransfer(id: number): Promise<Movement> {
    return this.db.transaction(async (tx) => {
      const [m] = await tx.select().from(stockMovements).where(eq(stockMovements.id, id)).for('update');
      if (!m) throw new NotFoundException();
      if (m.kind !== 'transfer' || m.status !== 'in_transit') throw new ConflictException('Only an in-transit transfer can be received');
      await this.arrive(tx, m);
      const [done] = await tx
        .update(stockMovements)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(stockMovements.id, id))
        .returning();
      return done;
    });
  }

  /** Marks a serial piece damaged or back in usable stock (no quantity change). */
  async setPieceState(id: number, state: 'damaged' | 'in_stock') {
    const [piece] = await this.db.select().from(stockPieces).where(eq(stockPieces.id, id));
    if (!piece) throw new NotFoundException();
    if (!['in_stock', 'damaged'].includes(piece.state)) throw new ConflictException(`Piece is ${piece.state.replace('_', ' ')}, not on a shelf`);
    const [row] = await this.db.update(stockPieces).set({ state, updatedAt: new Date() }).where(eq(stockPieces.id, id)).returning();
    return row;
  }

  /** Movements without a voucher (transfers excluded), optionally since a date. */
  async unposted(from?: Date) {
    const where = and(isNull(stockMovements.glVoucherId), ne(stockMovements.kind, 'transfer'), ne(stockMovements.value, 0), from ? gte(stockMovements.movedAt, from) : undefined);
    const [row] = await this.db.select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(abs(${stockMovements.value})), 0)::float` }).from(stockMovements).where(where);
    return { where, count: row.n, value: row.total };
  }

  /** Creates vouchers for older movements; a dry run only counts them. */
  async backfill(from: Date | undefined, dryRun: boolean) {
    const { where, count, value } = await this.unposted(from);
    if (dryRun) return { dryRun: true, count, value };
    const pending = await this.db.select().from(stockMovements).where(where);
    await this.db.transaction(async (tx) => {
      for (const m of pending) await this.postVoucher(tx, m);
    });
    return { dryRun: false, count: pending.length, value };
  }

  async setGl(enabled: boolean) {
    await this.db
      .insert(integrations)
      .values({ key: 'gl', config: { enabled } })
      .onConflictDoUpdate({ target: integrations.key, set: { config: { enabled }, updatedAt: new Date() } });
  }
}
