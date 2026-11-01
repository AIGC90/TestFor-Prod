import { BadRequestException, Body, ConflictException, Controller, Injectable, NotFoundException, OnModuleInit, Param, ParseIntPipe, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { goodsReceipts, groupLoans, openingBatches, stockRequests, stockSales } from '../db/schema';
import { AccessService } from '../erp/access.service';
import { ApprovalsService } from '../erp/approvals.service';
import { AuditService } from '../erp/audit.service';
import { validationError } from '../erp/crud';
import { NumberingService } from '../erp/numbering.service';
import { text } from '../erp/zod-helpers';
import { openingLine, requireItems } from './docs';
import { StockService } from './stock.service';

const openingBody = z.object({
  batchId: z.string().trim().max(60).regex(/^[A-Za-z0-9_-]*$/).optional(),
  storeId: z.coerce.number().int().positive(),
  lines: z.array(openingLine).min(1).max(1000),
});

/** State changes for inventory documents that touch stock or approvals. */
@Injectable()
export class InventoryDocsService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
    private readonly approvals: ApprovalsService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.approvals.onDecision('stock_request', async (req, decision) => {
      await this.db.update(stockRequests).set({ status: decision, updatedAt: new Date() }).where(eq(stockRequests.id, req.docId));
    });
    this.approvals.onDecision('stock_sale', async (req, decision) => {
      await this.db.update(stockSales).set({ status: decision, updatedAt: new Date() }).where(eq(stockSales.id, req.docId));
    });
  }

  private async request(id: number) {
    const [r] = await this.db.select().from(stockRequests).where(eq(stockRequests.id, id));
    if (!r) throw new NotFoundException();
    return r;
  }

  async submitRequest(user: AuthUser, id: number) {
    const r = await this.request(id);
    if (r.status !== 'open' && r.status !== 'rejected') throw new ConflictException(`Request is ${r.status}`);
    const lines = r.lines.length;
    const approval = await this.approvals.submit(user, {
      docType: 'stock_request',
      docId: r.id,
      docNo: r.reqNo,
      title: `${r.kind === 'buy' ? 'Buy' : 'Send stock'}: ${lines} line${lines === 1 ? '' : 's'}`,
      summary: r.notes,
      meta: { link: '/requests' },
    });
    const status = approval ? 'pending_approval' : 'approved';
    const [row] = await this.db.update(stockRequests).set({ status, updatedAt: new Date() }).where(eq(stockRequests.id, id)).returning();
    return row;
  }

  /** Transfer requests move stock now; buy requests become an expected goods receipt. */
  async fulfilRequest(user: AuthUser, id: number) {
    const r = await this.request(id);
    if (r.status !== 'approved') throw new ConflictException(`Only an approved request can be fulfilled (this one is ${r.status.replace('_', ' ')})`);
    if (r.kind === 'transfer') {
      await this.db.transaction(async (tx) => {
        for (const l of r.lines) {
          await this.stock.postInTx(
            tx,
            { kind: 'transfer', itemId: l.itemId, storeId: r.fromStoreId!, toStoreId: r.storeId, qty: l.qty, refType: 'stock_request', refId: r.id, refNo: r.reqNo },
            user,
          );
        }
        await tx.update(stockRequests).set({ status: 'fulfilled', updatedAt: new Date() }).where(eq(stockRequests.id, id));
      });
      await this.audit.log(user, 'fulfil', 'stock_request', id);
      return { status: 'fulfilled' };
    }
    const [receipt] = await this.db
      .insert(goodsReceipts)
      .values({
        recNo: await this.numbering.next('REC'),
        storeId: r.storeId,
        requestId: r.id,
        expectedAt: r.neededBy,
        lines: r.lines.map((l) => ({ itemId: l.itemId, expected: l.qty, received: 0, rate: null, serials: [] })),
        notes: `From ${r.reqNo}`,
        createdBy: user.id,
      })
      .returning();
    await this.db.update(stockRequests).set({ status: 'in_procurement', updatedAt: new Date() }).where(eq(stockRequests.id, id));
    await this.audit.log(user, 'fulfil', 'stock_request', id, { receiptId: receipt.id });
    return { status: 'in_procurement', receipt };
  }

  async cancelRequest(user: AuthUser, id: number) {
    const r = await this.request(id);
    if (!['open', 'approved', 'rejected'].includes(r.status)) throw new ConflictException(`A ${r.status.replace('_', ' ')} request cannot be cancelled`);
    await this.db.update(stockRequests).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(stockRequests.id, id));
    await this.audit.log(user, 'cancel', 'stock_request', id);
    return { status: 'cancelled' };
  }

  /** Puts the arrived units into the store; the supplier's bill can then be booked. */
  async landReceipt(user: AuthUser, id: number) {
    return this.db.transaction(async (tx) => {
      const [rec] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, id)).for('update');
      if (!rec) throw new NotFoundException();
      if (rec.status === 'landed') throw new ConflictException('Already landed');
      const arrived = rec.lines.filter((l) => l.received > 0);
      if (!arrived.length) throw new BadRequestException('Enter the units that arrived first');
      for (const l of arrived) {
        await this.stock.postInTx(
          tx,
          { kind: 'receipt', itemId: l.itemId, storeId: rec.storeId, qty: l.received, unitRate: l.rate, serials: l.serials, lrNo: rec.lrNo, refType: 'goods_receipt', refId: rec.id, refNo: rec.poNo ?? rec.recNo },
          user,
        );
      }
      const [landed] = await tx.update(goodsReceipts).set({ status: 'landed', landedAt: new Date(), updatedAt: new Date() }).where(eq(goodsReceipts.id, id)).returning();
      if (rec.requestId) await tx.update(stockRequests).set({ status: 'fulfilled', updatedAt: new Date() }).where(eq(stockRequests.id, rec.requestId));
      await this.audit.log(user, 'land', 'goods_receipt', id);
      return landed;
    });
  }

  /** Posts opening balances once per batch id; posting the same batch again returns the original. */
  async postOpening(user: AuthUser, raw: unknown) {
    const parsed = openingBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const batchId = parsed.data.batchId || (await this.numbering.next('BATCH'));
    const [existing] = await this.db.select().from(openingBatches).where(eq(openingBatches.batchId, batchId));
    if (existing) return { ...existing, alreadyPosted: true };
    await requireItems(this.db, parsed.data.lines.map((l) => l.itemId));
    const batch = await this.db.transaction(async (tx) => {
      for (const l of parsed.data.lines) {
        await this.stock.postInTx(tx, { kind: 'opening', itemId: l.itemId, storeId: parsed.data.storeId, qty: l.qty, unitRate: l.rate, serials: l.serials, refType: 'opening_batch', refNo: batchId }, user);
      }
      const [row] = await tx
        .insert(openingBatches)
        .values({
          batchId,
          storeId: parsed.data.storeId,
          lines: parsed.data.lines,
          totalQty: parsed.data.lines.reduce((s, l) => s + l.qty, 0),
          totalValue: Math.round(parsed.data.lines.reduce((s, l) => s + l.qty * l.rate, 0) * 100) / 100,
          createdBy: user.id,
        })
        .returning();
      return row;
    });
    await this.audit.log(user, 'post', 'opening_batch', batch.id, { batchId });
    return { ...batch, alreadyPosted: false };
  }

  private async sale(id: number) {
    const [s] = await this.db.select().from(stockSales).where(eq(stockSales.id, id));
    if (!s) throw new NotFoundException();
    return s;
  }

  async submitSale(user: AuthUser, id: number) {
    const s = await this.sale(id);
    if (s.status !== 'draft' && s.status !== 'rejected') throw new ConflictException(`Sale is ${s.status}`);
    const approval = await this.approvals.submit(user, {
      docType: 'stock_sale',
      docId: s.id,
      docNo: s.saleNo,
      title: `Stock sale ${s.saleNo}`,
      summary: s.remarks,
      amount: s.total,
      meta: { link: '/sales' },
    });
    const status = approval ? 'pending_approval' : 'approved';
    const [row] = await this.db.update(stockSales).set({ status, updatedAt: new Date() }).where(eq(stockSales.id, id)).returning();
    return row;
  }

  /** Invoicing takes the goods out of the store. */
  async invoiceSale(user: AuthUser, id: number) {
    return this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(stockSales).where(eq(stockSales.id, id)).for('update');
      if (!s) throw new NotFoundException();
      if (s.status !== 'approved') throw new ConflictException(`Only an approved sale can be invoiced (this one is ${s.status.replace('_', ' ')})`);
      for (const l of s.lines) {
        await this.stock.postInTx(tx, { kind: 'sale', itemId: l.itemId, storeId: s.storeId, qty: l.qty, serials: l.serials, refType: 'stock_sale', refId: s.id, refNo: s.saleNo }, user);
      }
      const [row] = await tx.update(stockSales).set({ status: 'invoiced', updatedAt: new Date() }).where(eq(stockSales.id, id)).returning();
      await this.audit.log(user, 'invoice', 'stock_sale', id);
      return row;
    });
  }

  async advanceSale(user: AuthUser, id: number, to: 'dispatched' | 'paid') {
    const s = await this.sale(id);
    const from = to === 'dispatched' ? 'invoiced' : 'dispatched';
    if (s.status !== from && !(to === 'paid' && s.status === 'invoiced')) throw new ConflictException(`Sale is ${s.status}`);
    const [row] = await this.db.update(stockSales).set({ status: to, updatedAt: new Date() }).where(eq(stockSales.id, id)).returning();
    await this.audit.log(user, to, 'stock_sale', id);
    return row;
  }

  async returnLoan(user: AuthUser, id: number, remarks?: string | null) {
    const [loan] = await this.db.select().from(groupLoans).where(eq(groupLoans.id, id));
    if (!loan) throw new NotFoundException();
    if (loan.status === 'returned') throw new ConflictException('Already returned');
    const [row] = await this.db
      .update(groupLoans)
      .set({ status: 'returned', returnedAt: new Date(), remarks: remarks ?? loan.remarks, updatedAt: new Date() })
      .where(eq(groupLoans.id, id))
      .returning();
    await this.audit.log(user, 'return', 'group_loan', id);
    return row;
  }
}

@Controller('inventory')
export class InventoryActionsController {
  constructor(
    private readonly docs: InventoryDocsService,
    private readonly access: AccessService,
  ) {}

  @Post('requests/:id/submit')
  async submitRequest(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'stock_request', 'create');
    return this.docs.submitRequest(u, id);
  }

  @Post('requests/:id/fulfil')
  async fulfil(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'stock_movement', 'create');
    return this.docs.fulfilRequest(u, id);
  }

  @Post('requests/:id/cancel')
  async cancel(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'stock_request', 'edit');
    return this.docs.cancelRequest(u, id);
  }

  @Post('receipts/:id/land')
  async land(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'goods_receipt', 'edit');
    await this.access.require(u, 'stock_movement', 'create');
    return this.docs.landReceipt(u, id);
  }

  @Post('opening/post')
  async opening(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    await this.access.require(u, 'stock_movement', 'create');
    return this.docs.postOpening(u, body);
  }

  @Post('sales/:id/submit')
  async submitSale(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'stock_sale', 'create');
    return this.docs.submitSale(u, id);
  }

  @Post('sales/:id/invoice')
  async invoice(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'stock_sale', 'edit');
    return this.docs.invoiceSale(u, id);
  }

  @Post('sales/:id/dispatch')
  async dispatch(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'stock_sale', 'edit');
    return this.docs.advanceSale(u, id, 'dispatched');
  }

  @Post('sales/:id/paid')
  async paid(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.access.require(u, 'stock_sale', 'edit');
    return this.docs.advanceSale(u, id, 'paid');
  }

  @Post('loans/:id/return')
  async loanReturn(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: { remarks?: string }) {
    await this.access.require(u, 'group_loan', 'edit');
    const remarks = text(1000).safeParse(body?.remarks);
    return this.docs.returnLoan(u, id, remarks.success ? remarks.data : null);
  }
}
