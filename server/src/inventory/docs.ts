import { BadRequestException } from '@nestjs/common';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Db } from '../db/db.module';
import { goodsReceipts, groupLoans, items, openingBatches, parties, plants, stockRequests, stockSales, stores } from '../db/schema';
import { crudController } from '../erp/crud';
import { text } from '../erp/zod-helpers';

/** Splits GST: within the same state CGST + SGST (half each), otherwise IGST. */
export function gstSplit(taxable: number, rate: number, intraState: boolean) {
  const tax = Math.round(taxable * rate) / 100;
  if (intraState) {
    const half = Math.round(tax * 50) / 100;
    return { cgst: half, sgst: Math.round((tax - half) * 100) / 100, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: tax };
}

const id = z.coerce.number().int().positive();
const qty = z.coerce.number().positive('must be more than 0');
const date = z.coerce.date().nullish().transform((v) => v ?? null);
const serials = z.array(z.string().trim().min(1).max(60)).max(500).default([]);

export async function requireItems(db: Db, ids: number[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new BadRequestException('Add at least one line');
  const found = await db.select({ id: items.id }).from(items).where(inArray(items.id, unique));
  if (found.length !== unique.length) throw new BadRequestException('lines: unknown item');
}

/* -------------------------------------------------------------- requests */

export const requestLine = z.object({ itemId: id, qty, note: text(200) });

export const StockRequestsController = crudController({
  path: 'inventory/requests',
  docType: 'stock_request',
  table: stockRequests,
  searchColumns: [stockRequests.reqNo, stockRequests.notes],
  filters: { kind: stockRequests.kind, status: stockRequests.status, storeId: stockRequests.storeId },
  orderBy: [desc(stockRequests.id)],
  numbering: { prefix: 'REQ', column: 'reqNo' },
  schema: z.object({
    kind: z.enum(['buy', 'transfer']),
    storeId: id,
    fromStoreId: id.nullish(),
    neededBy: date,
    lines: z.array(requestLine).min(1).max(100),
    notes: text(1000),
  }),
  beforeCreate: async (input, { db, user }) => {
    if (input.kind === 'transfer' && (!input.fromStoreId || input.fromStoreId === input.storeId)) {
      throw new BadRequestException('fromStoreId: a transfer request needs a different source store');
    }
    await requireItems(db, (input.lines as { itemId: number }[]).map((l) => l.itemId));
    return { ...input, requestedByName: user.name, status: 'open' };
  },
  beforeUpdate: (input, existing) => {
    if (existing.status !== 'open') throw new BadRequestException(`A ${existing.status} request cannot be edited`);
    const { status: _ignored, ...rest } = input;
    return rest;
  },
  canDelete: (row) => (row.status === 'open' || row.status === 'cancelled' ? null : `A ${row.status} request cannot be deleted`),
});

/* -------------------------------------------------------------- receipts */

export const receiptLine = z.object({
  itemId: id,
  expected: qty,
  received: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0).nullish().transform((v) => v ?? null),
  serials,
});

export const GoodsReceiptsController = crudController({
  path: 'inventory/receipts',
  docType: 'goods_receipt',
  table: goodsReceipts,
  searchColumns: [goodsReceipts.recNo, goodsReceipts.poNo, goodsReceipts.lrNo],
  filters: { status: goodsReceipts.status, storeId: goodsReceipts.storeId, supplierId: goodsReceipts.supplierId },
  orderBy: [desc(goodsReceipts.id)],
  numbering: { prefix: 'REC', column: 'recNo' },
  schema: z.object({
    poNo: text(60),
    supplierId: id.nullish(),
    storeId: id,
    lrNo: text(40),
    expectedAt: date,
    lines: z.array(receiptLine).min(1).max(200),
    notes: text(1000),
  }),
  beforeCreate: async (input, { db }) => {
    await requireItems(db, (input.lines as { itemId: number }[]).map((l) => l.itemId));
    return { ...input, status: 'expected' };
  },
  beforeUpdate: (input, existing) => {
    if (existing.status === 'landed') throw new BadRequestException('A landed receipt cannot be changed');
    const lines = input.lines as { expected: number; received: number }[] | undefined;
    const status = lines ? (lines.every((l) => l.received >= l.expected) ? 'ready' : 'expected') : existing.status;
    return { ...input, status };
  },
  canDelete: (row) => (row.status === 'landed' ? 'A landed receipt cannot be deleted' : null),
});

/* --------------------------------------------------------------- opening */

export const openingLine = z.object({ itemId: id, qty, rate: z.coerce.number().min(0), serials });

export const OpeningBatchesController = crudController({
  path: 'inventory/opening',
  docType: 'stock_movement',
  table: openingBatches,
  searchColumns: [openingBatches.batchId],
  orderBy: [desc(openingBatches.id)],
  // creation goes through POST /inventory/opening/post so it can be idempotent and post stock
  schema: z.object({}),
  beforeCreate: () => {
    throw new BadRequestException('Use POST /erp/inventory/opening/post');
  },
  beforeUpdate: () => {
    throw new BadRequestException('Posted opening stock cannot be changed; record an adjustment instead');
  },
  canDelete: () => 'Posted opening stock cannot be deleted; record an adjustment instead',
});

/* ----------------------------------------------------------------- sales */

export const saleLine = z.object({ itemId: id, qty, rate: z.coerce.number().min(0), gstRate: z.coerce.number().min(0).max(28), serials });

/** Works out taxable, GST split and total for a sale (intra-state when buyer and store's plant share a state). */
export async function priceSale(db: Db, input: { buyerId: number; storeId: number; lines: z.infer<typeof saleLine>[] }) {
  const [buyer] = await db.select().from(parties).where(eq(parties.id, input.buyerId));
  if (!buyer) throw new BadRequestException('buyerId: buyer not found');
  const [store] = await db.select({ state: plants.state }).from(stores).leftJoin(plants, eq(plants.id, stores.plantId)).where(eq(stores.id, input.storeId));
  if (!store) throw new BadRequestException('storeId: store not found');
  const intra = Boolean(buyer.state && store.state && buyer.state.trim().toLowerCase() === store.state.trim().toLowerCase());
  let taxable = 0;
  const tax = { cgst: 0, sgst: 0, igst: 0 };
  for (const l of input.lines) {
    const amount = Math.round(l.qty * l.rate * 100) / 100;
    taxable += amount;
    const t = gstSplit(amount, l.gstRate, intra);
    tax.cgst += t.cgst;
    tax.sgst += t.sgst;
    tax.igst += t.igst;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { taxable: r(taxable), cgst: r(tax.cgst), sgst: r(tax.sgst), igst: r(tax.igst), total: r(taxable + tax.cgst + tax.sgst + tax.igst) };
}

export const StockSalesController = crudController({
  path: 'inventory/sales',
  docType: 'stock_sale',
  table: stockSales,
  searchColumns: [stockSales.saleNo, stockSales.remarks],
  filters: { status: stockSales.status, buyerId: stockSales.buyerId, storeId: stockSales.storeId },
  orderBy: [desc(stockSales.id)],
  numbering: { prefix: 'SALE', column: 'saleNo' },
  schema: z.object({
    // blank means today (coercing null would give 1 Jan 1970)
    saleDate: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.coerce.date().optional()),
    buyerId: id,
    storeId: id,
    lines: z.array(saleLine).min(1).max(200),
    remarks: text(1000),
  }),
  beforeCreate: async (input, { db }) => {
    await requireItems(db, (input.lines as { itemId: number }[]).map((l) => l.itemId));
    return { ...input, ...(await priceSale(db, input as never)), status: 'draft' };
  },
  beforeUpdate: async (input, existing, { db }) => {
    if (existing.status !== 'draft' && existing.status !== 'rejected') throw new BadRequestException(`A ${existing.status} sale cannot be edited`);
    const merged = { ...existing, ...input } as never;
    return { ...input, ...(await priceSale(db, merged)), status: 'draft' };
  },
  canDelete: (row) => (['draft', 'rejected'].includes(row.status as string) ? null : `A ${row.status} sale cannot be deleted`),
});

/* ----------------------------------------------------------------- loans */

export const GroupLoansController = crudController({
  path: 'inventory/loans',
  docType: 'group_loan',
  table: groupLoans,
  searchColumns: [groupLoans.loanNo, groupLoans.tyreSerial, groupLoans.tyreSpec, groupLoans.location, groupLoans.challanNo],
  filters: { direction: groupLoans.direction, status: groupLoans.status, sisterId: groupLoans.sisterId },
  orderBy: [asc(groupLoans.status), desc(groupLoans.loanDate)],
  numbering: { prefix: 'LN', column: 'loanNo' },
  schema: z.object({
    direction: z.enum(['lent', 'borrowed']),
    sisterId: id,
    tyreSerial: z.string().trim().min(1).max(60),
    tyreSpec: z.string().trim().min(1).max(120),
    loanDate: z.coerce.date(),
    expectedReturn: date,
    location: text(200),
    challanNo: text(60),
    remarks: text(1000),
  }),
  beforeCreate: async (input, { db }) => {
    const [sister] = await db.select().from(parties).where(eq(parties.id, Number(input.sisterId)));
    if (!sister?.kinds.includes('sister_company')) throw new BadRequestException('sisterId: choose a sister company');
    return input;
  },
});
