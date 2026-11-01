import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Roles } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { items, stockBalances, stockMovements, stockPieces, stores } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { AuditService } from '../erp/audit.service';
import { validationError } from '../erp/crud';
import { text } from '../erp/zod-helpers';
import { StockService } from './stock.service';

const movementBody = z.object({
  kind: z.enum(['receipt', 'issue', 'transfer', 'adjustment', 'write_off', 'return']),
  itemId: z.coerce.number().int().positive(),
  storeId: z.coerce.number().int().positive(),
  toStoreId: z.coerce.number().int().positive().nullish(),
  qty: z.coerce.number(),
  unitRate: z.coerce.number().min(0).nullish(),
  serials: z.array(z.string().trim().min(1).max(60)).max(500).default([]),
  vehicleNo: text(30),
  lrNo: text(40),
  refNo: text(60),
  remarks: text(500),
  status: z.enum(['completed', 'in_transit']).default('completed'),
});

@Controller('stock')
export class StockController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get('movements')
  async movements(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    await this.access.require(user, 'stock_movement', 'view');
    const where: SQL[] = [];
    if (q.kind) where.push(eq(stockMovements.kind, q.kind));
    if (q.status) where.push(eq(stockMovements.status, q.status));
    if (q.storeId) where.push(or(eq(stockMovements.storeId, Number(q.storeId)), eq(stockMovements.toStoreId, Number(q.storeId)))!);
    if (q.itemId) where.push(eq(stockMovements.itemId, Number(q.itemId)));
    if (q.lrNo) where.push(ilike(stockMovements.lrNo, `%${q.lrNo}%`));
    if (q.search) {
      const s = `%${q.search}%`;
      where.push(or(ilike(stockMovements.docNo, s), ilike(stockMovements.refNo, s), ilike(stockMovements.vehicleNo, s), ilike(items.name, s))!);
    }
    return this.db
      .select({ movement: stockMovements, itemName: items.name, itemCode: items.code, unit: items.unit })
      .from(stockMovements)
      .innerJoin(items, eq(items.id, stockMovements.itemId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(stockMovements.movedAt), desc(stockMovements.id))
      .limit(Math.min(Number(q.limit) || 500, 5000))
      .then((rows) => rows.map((r) => ({ ...r.movement, itemName: r.itemName, itemCode: r.itemCode, unit: r.unit })));
  }

  @Post('movements')
  async create(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    await this.access.require(user, 'stock_movement', 'create');
    const parsed = movementBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const m = await this.stock.post(parsed.data, user);
    await this.audit.log(user, 'create', 'stock_movement', m.id, m);
    return m;
  }

  @Post('movements/:id/receive')
  async receive(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(user, 'stock_movement', 'edit');
    const m = await this.stock.completeTransfer(id);
    await this.audit.log(user, 'receive', 'stock_movement', id);
    return m;
  }

  @Get('balances')
  async balances(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    await this.access.require(user, 'stock_movement', 'view');
    const where: SQL[] = [sql`${stockBalances.qty} <> 0`];
    if (q.storeId) where.push(eq(stockBalances.storeId, Number(q.storeId)));
    if (q.itemId) where.push(eq(stockBalances.itemId, Number(q.itemId)));
    const rows = await this.db
      .select({
        itemId: stockBalances.itemId,
        storeId: stockBalances.storeId,
        qty: stockBalances.qty,
        value: stockBalances.value,
        itemCode: items.code,
        itemName: items.name,
        categoryId: items.categoryId,
        unit: items.unit,
        reorderLevel: items.reorderLevel,
        storeName: stores.name,
      })
      .from(stockBalances)
      .innerJoin(items, eq(items.id, stockBalances.itemId))
      .innerJoin(stores, eq(stores.id, stockBalances.storeId))
      .where(and(...where))
      .orderBy(items.name);
    return rows.map((r) => ({ ...r, avgRate: r.qty ? Math.round((r.value / r.qty) * 100) / 100 : 0 }));
  }

  @Get('pieces')
  async pieces(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    await this.access.require(user, 'stock_movement', 'view');
    const where: SQL[] = [];
    if (q.itemId) where.push(eq(stockPieces.itemId, Number(q.itemId)));
    if (q.storeId) where.push(eq(stockPieces.storeId, Number(q.storeId)));
    if (q.state) where.push(inArray(stockPieces.state, q.state.split(',')));
    if (q.serial) where.push(ilike(stockPieces.serial, `%${q.serial}%`));
    return this.db
      .select({ piece: stockPieces, itemName: items.name, itemCode: items.code, storeName: stores.name })
      .from(stockPieces)
      .innerJoin(items, eq(items.id, stockPieces.itemId))
      .leftJoin(stores, eq(stores.id, stockPieces.storeId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(items.name, stockPieces.serial)
      .limit(5000)
      .then((rows) => rows.map((r) => ({ ...r.piece, itemName: r.itemName, itemCode: r.itemCode, storeName: r.storeName })));
  }

  @Post('pieces/:id/state')
  async pieceState(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: { state?: string }) {
    await this.access.require(user, 'stock_movement', 'edit');
    const parsed = z.enum(['damaged', 'in_stock']).safeParse(body?.state);
    if (!parsed.success) throw validationError(parsed.error);
    const piece = await this.stock.setPieceState(id, parsed.data);
    await this.audit.log(user, 'update', 'stock_piece', id, { state: parsed.data });
    return piece;
  }

  /** Per-store totals, piece counts by state and items below their reorder level. */
  @Get('summary')
  async summary(@CurrentUser() user: AuthUser) {
    await this.access.require(user, 'stock_movement', 'view');
    const perStore = await this.db
      .select({ storeId: stores.id, storeName: stores.name, kind: stores.kind, qty: sql<number>`coalesce(sum(${stockBalances.qty}), 0)::float`, value: sql<number>`coalesce(sum(${stockBalances.value}), 0)::float`, lines: sql<number>`count(${stockBalances.itemId}) filter (where ${stockBalances.qty} <> 0)::int` })
      .from(stores)
      .leftJoin(stockBalances, eq(stockBalances.storeId, stores.id))
      .where(eq(stores.active, true))
      .groupBy(stores.id)
      .orderBy(stores.name);
    const pieces = await this.db.select({ state: stockPieces.state, n: sql<number>`count(*)::int` }).from(stockPieces).groupBy(stockPieces.state);
    const belowReorder = await this.db
      .select({ itemId: items.id, itemName: items.name, reorderLevel: items.reorderLevel, qty: sql<number>`coalesce(sum(${stockBalances.qty}), 0)::float` })
      .from(items)
      .leftJoin(stockBalances, eq(stockBalances.itemId, items.id))
      .where(and(eq(items.active, true), sql`${items.reorderLevel} is not null`))
      .groupBy(items.id)
      .having(sql`coalesce(sum(${stockBalances.qty}), 0) < ${items.reorderLevel}`);
    const inTransit = await this.db.select({ n: sql<number>`count(*)::int` }).from(stockMovements).where(eq(stockMovements.status, 'in_transit'));
    return { perStore, pieces: Object.fromEntries(pieces.map((p) => [p.state, p.n])), belowReorder, inTransitTransfers: inTransit[0].n };
  }

  @Get('gl')
  async gl(@CurrentUser() user: AuthUser) {
    await this.access.require(user, 'stock_movement', 'view');
    const { count, value } = await this.stock.unposted();
    return { enabled: await this.stock.glEnabled(), unposted: count, unpostedValue: value };
  }

  @Roles('admin', 'accountant')
  @Put('gl')
  async setGl(@CurrentUser() user: AuthUser, @Body() body: { enabled?: unknown }) {
    const parsed = z.boolean().safeParse(body?.enabled);
    if (!parsed.success) throw validationError(parsed.error);
    await this.stock.setGl(parsed.data);
    await this.audit.log(user, 'update', 'gl_settings', 'gl', { enabled: parsed.data });
    return this.gl(user);
  }

  @Roles('admin', 'accountant')
  @Post('gl/backfill')
  async backfill(@CurrentUser() user: AuthUser, @Body() body: { from?: string; dryRun?: boolean }) {
    const from = body?.from ? new Date(body.from) : undefined;
    if (from && Number.isNaN(from.getTime())) throw validationError(new z.ZodError([{ code: 'custom', path: ['from'], message: 'not a date', input: body.from }]));
    const res = await this.stock.backfill(from, body?.dryRun !== false);
    if (!res.dryRun) await this.audit.log(user, 'backfill', 'gl_settings', 'gl', res);
    return res;
  }
}
