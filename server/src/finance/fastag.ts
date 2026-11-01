import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { config } from '../config';
import { type Db, InjectDb } from '../db/db.module';
import { fastagAccounts, tollTxns, trips } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { AuditService } from '../erp/audit.service';
import { crudController, validationError } from '../erp/crud';
import { requiredText, text } from '../erp/zod-helpers';
import { vehicleKey } from '../traccar/odometer.service';

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
export const VEHICLE_CLASSES = { VC4: 'Car / jeep / van', VC5: 'LCV', VC7: 'Bus / 2-axle truck', VC10: '3-axle truck', VC11: '4 to 6-axle truck', VC12: '7+ axle / oversized', VC15: 'Earth mover / HCM' } as const;

export const FastagAccountsController = crudController({
  path: 'fastag/accounts',
  docType: 'fastag',
  table: fastagAccounts,
  searchColumns: [fastagAccounts.vehicleNo, fastagAccounts.tagId, fastagAccounts.bank],
  filters: { status: fastagAccounts.status, vehicleNo: fastagAccounts.vehicleNo, bank: fastagAccounts.bank },
  orderBy: [asc(fastagAccounts.balance)],
  schema: z.object({
    vehicleNo: z.string().trim().toUpperCase().min(4).max(20),
    tagId: z.string().trim().toUpperCase().regex(/^[0-9A-Z-]{8,40}$/, 'is not a FASTag ID'),
    bank: requiredText(80),
    vehicleClass: z.enum(Object.keys(VEHICLE_CLASSES) as [string, ...string[]]).default('VC10'),
    balance: z.coerce.number().default(0),
    lowBalance: z.coerce.number().min(0).default(1000),
    status: z.enum(['active', 'low_balance', 'blacklisted', 'closed']).default('active'),
  }),
  // a balance typed in now is newer than any older statement row; with none, the first import sets it
  beforeCreate: (input) => ({ ...input, status: input.status === 'active' && (input.balance as number) < (input.lowBalance as number) ? 'low_balance' : input.status, balanceAt: input.balance ? new Date() : null }),
  canDelete: async (row, ctx) => {
    const [t] = await ctx.db.select({ id: tollTxns.id }).from(tollTxns).where(eq(tollTxns.tagId, row.tagId as string)).limit(1);
    return t ? 'This tag has transactions; close it instead' : null;
  },
});

/** One statement row from the issuer bank or aggregator. */
export const txnRow = z.object({
  txnRef: z.string().trim().min(3).max(80),
  npciRef: text(80),
  tagId: z.string().trim().toUpperCase().nullish(),
  vehicleNo: z.string().trim().toUpperCase().nullish(),
  kind: z.enum(['toll', 'recharge', 'refund']).default('toll'),
  plaza: text(150),
  highway: text(60),
  lane: text(20),
  at: z.coerce.date(),
  amount: z.coerce.number().positive(),
  balanceAfter: z.coerce.number().nullish().transform((v) => (v === undefined ? null : v)),
  status: z.enum(['debited', 'credited', 'disputed']).optional(),
});
type TxnRow = z.infer<typeof txnRow>;
type Account = typeof fastagAccounts.$inferSelect;

/** A tag goes to low balance below its threshold, and back to active once topped up. */
export const tagStatus = (a: Pick<Account, 'status' | 'lowBalance'>, balance: number) =>
  a.status === 'blacklisted' || a.status === 'closed' ? a.status : balance < a.lowBalance ? 'low_balance' : 'active';

@Injectable()
export class FastagService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Imports statement rows; duplicates (same txnRef) are skipped, balances follow the latest row. */
  async importTxns(user: AuthUser | null, rows: unknown, source: 'import' | 'api' | 'manual' = 'import') {
    if (!Array.isArray(rows) || !rows.length) throw new BadRequestException('rows must be a non-empty array');
    if (rows.length > 5000) throw new BadRequestException('Import at most 5000 rows at a time');
    const accounts = await this.db.select().from(fastagAccounts);
    const byTag = new Map(accounts.map((a) => [a.tagId, a]));
    const byVehicle = new Map(accounts.filter((a) => a.status !== 'closed').map((a) => [vehicleKey(a.vehicleNo), a]));
    const errors: { row: number; error: string }[] = [];
    const valid: (TxnRow & { account: Account })[] = [];
    rows.forEach((raw, i) => {
      const p = txnRow.safeParse(raw);
      if (!p.success) return errors.push({ row: i + 1, error: p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
      const account = (p.data.tagId && byTag.get(p.data.tagId)) || (p.data.vehicleNo && byVehicle.get(vehicleKey(p.data.vehicleNo))) || null;
      if (!account) return errors.push({ row: i + 1, error: `No FASTag account for ${p.data.tagId ?? p.data.vehicleNo ?? 'this row'}` });
      valid.push({ ...p.data, account });
    });
    const existing = valid.length ? new Set((await this.db.select({ ref: tollTxns.txnRef }).from(tollTxns).where(inArray(tollTxns.txnRef, valid.map((v) => v.txnRef)))).map((r) => r.ref)) : new Set<string>();
    let imported = 0;
    let duplicates = 0;
    await this.db.transaction(async (tx) => {
      for (const v of valid.sort((a, b) => a.at.getTime() - b.at.getTime())) {
        if (existing.has(v.txnRef)) {
          duplicates++;
          continue;
        }
        existing.add(v.txnRef);
        const [a] = await tx.select().from(fastagAccounts).where(eq(fastagAccounts.id, v.account.id));
        const sign = v.kind === 'toll' ? -1 : 1;
        const newer = !a.balanceAt || v.at >= a.balanceAt;
        const balance = v.balanceAfter ?? r2(a.balance + sign * v.amount);
        await tx.insert(tollTxns).values({
          txnRef: v.txnRef,
          npciRef: v.npciRef,
          tagId: a.tagId,
          vehicleNo: a.vehicleNo,
          kind: v.kind,
          plaza: v.plaza,
          highway: v.highway,
          lane: v.lane,
          at: v.at,
          amount: v.amount,
          balanceAfter: v.balanceAfter ?? (newer ? balance : null),
          status: v.status ?? (v.kind === 'toll' ? 'debited' : 'credited'),
          source,
          createdBy: user?.id ?? null,
        });
        if (newer) await tx.update(fastagAccounts).set({ balance, balanceAt: v.at, status: tagStatus(a, balance), updatedAt: new Date() }).where(eq(fastagAccounts.id, a.id));
        imported++;
      }
    });
    if (user) await this.audit.log(user, 'import', 'fastag', null, { imported, duplicates, errors: errors.length });
    return { imported, duplicates, errors };
  }

  async recharge(user: AuthUser, id: number, raw: unknown) {
    const p = z.object({ amount: z.coerce.number().positive().max(200000), reference: text(80) }).safeParse(raw);
    if (!p.success) throw validationError(p.error);
    const [a] = await this.db.select().from(fastagAccounts).where(eq(fastagAccounts.id, id));
    if (!a) throw new NotFoundException();
    if (a.status === 'closed' || a.status === 'blacklisted') throw new ConflictException(`Tag is ${a.status}`);
    const ref = p.data.reference ?? `RCH-${a.tagId.slice(-6)}-${Date.now()}`;
    const res = await this.importTxns(user, [{ txnRef: ref, tagId: a.tagId, kind: 'recharge', at: new Date(), amount: p.data.amount, balanceAfter: r2(a.balance + p.data.amount), plaza: 'Wallet recharge' }], 'manual');
    if (res.duplicates) throw new ConflictException(`Reference ${ref} was already recorded`);
    const [row] = await this.db.select().from(fastagAccounts).where(eq(fastagAccounts.id, id));
    return row;
  }

  /** Pulls recent transactions for every active tag from the configured aggregator. */
  async sync(user: AuthUser) {
    if (!config.fastagApiUrl) throw new BadRequestException('No FASTag aggregator is configured. Set FASTAG_API_URL and FASTAG_API_KEY on the API server, or import bank statements.');
    const accounts = await this.db.select().from(fastagAccounts).where(inArray(fastagAccounts.status, ['active', 'low_balance']));
    const rows: unknown[] = [];
    for (const a of accounts) {
      const since = (a.balanceAt ?? new Date(Date.now() - 30 * DAY)).toISOString();
      const res = await fetch(`${config.fastagApiUrl.replace(/\/$/, '')}/tags/${encodeURIComponent(a.tagId)}/transactions?since=${encodeURIComponent(since)}`, {
        headers: { Accept: 'application/json', ...(config.fastagApiKey ? { Authorization: `Bearer ${config.fastagApiKey}` } : {}) },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new BadRequestException(`FASTag aggregator returned HTTP ${res.status} for ${a.tagId}`);
      const list = (await res.json()) as Record<string, unknown>[];
      rows.push(...list.map((r) => ({ ...r, tagId: a.tagId })));
    }
    return rows.length ? this.importTxns(user, rows, 'api') : { imported: 0, duplicates: 0, errors: [] };
  }

  /** Toll transactions with the trip each crossing belongs to. */
  async txns(q: Record<string, string>) {
    const where: SQL[] = [];
    if (q.vehicleNo) where.push(eq(tollTxns.vehicleNo, q.vehicleNo.toUpperCase()));
    if (q.kind) where.push(eq(tollTxns.kind, q.kind));
    if (q.from) where.push(gte(tollTxns.at, new Date(q.from)));
    if (q.to) where.push(lte(tollTxns.at, new Date(q.to)));
    const list = await this.db.select().from(tollTxns).where(where.length ? and(...where) : undefined).orderBy(desc(tollTxns.at)).limit(2000);
    if (!list.length) return [];
    const tripRows = await this.db
      .select({ tripNo: trips.tripNo, vehicleNo: trips.vehicleNo, startedAt: trips.startedAt, completedAt: trips.completedAt })
      .from(trips)
      .where(inArray(trips.vehicleNo, [...new Set(list.map((t) => t.vehicleNo))]));
    return list.map((t) => ({
      ...t,
      tripNo: tripRows.find((r) => r.vehicleNo === t.vehicleNo && r.startedAt && r.startedAt <= t.at && (!r.completedAt || r.completedAt >= t.at))?.tripNo ?? null,
    }));
  }

  async summary() {
    const since = new Date(Date.now() - 30 * DAY);
    const [accounts, recent] = await Promise.all([this.db.select().from(fastagAccounts), this.db.select().from(tollTxns).where(and(eq(tollTxns.kind, 'toll'), gte(tollTxns.at, since)))]);
    const live = accounts.filter((a) => a.status !== 'closed');
    const plazas = new Map<string, { plaza: string; crossings: number; amount: number }>();
    recent.forEach((t) => {
      const p = plazas.get(t.plaza ?? '—') ?? { plaza: t.plaza ?? '—', crossings: 0, amount: 0 };
      p.crossings++;
      p.amount = r2(p.amount + t.amount);
      plazas.set(p.plaza, p);
    });
    const byVehicle = new Map<string, number>();
    recent.forEach((t) => byVehicle.set(t.vehicleNo, r2((byVehicle.get(t.vehicleNo) ?? 0) + t.amount)));
    return {
      totalBalance: r2(live.reduce((s, a) => s + a.balance, 0)),
      tags: live.length,
      lowBalance: live.filter((a) => a.status === 'low_balance').length,
      blacklisted: live.filter((a) => a.status === 'blacklisted').length,
      crossings30: recent.length,
      spend30: r2(recent.reduce((s, t) => s + t.amount, 0)),
      gateway: { configured: !!config.fastagApiUrl, mode: config.fastagApiUrl ? 'aggregator API' : 'statement import' },
      topPlazas: [...plazas.values()].sort((a, b) => b.amount - a.amount).slice(0, 10),
      byVehicle: [...byVehicle.entries()].map(([vehicleNo, amount]) => ({ vehicleNo, amount })).sort((a, b) => b.amount - a.amount),
      vehicleClasses: VEHICLE_CLASSES,
    };
  }
}

@Controller('fastag')
export class FastagController {
  constructor(
    private readonly svc: FastagService,
    private readonly access: AccessService,
  ) {}

  @Get('summary')
  async summary(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'fastag', 'view');
    return this.svc.summary();
  }

  @Get('txns')
  async txns(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    await this.access.require(u, 'fastag', 'view');
    return this.svc.txns(q);
  }

  @Post('txns/import')
  async import(@CurrentUser() u: AuthUser, @Body() body: { rows?: unknown }) {
    await this.access.require(u, 'fastag', 'create');
    return this.svc.importTxns(u, body?.rows);
  }

  @Post('sync')
  async sync(@CurrentUser() u: AuthUser) {
    await this.access.require(u, 'fastag', 'create');
    return this.svc.sync(u);
  }

  @Post('accounts/:id/recharge')
  async recharge(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    await this.access.require(u, 'fastag', 'edit');
    return this.svc.recharge(u, id, body);
  }
}
