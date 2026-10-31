import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { approvalRequests, approvalRules } from '../db/schema';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { DOC_TYPES, type DocType } from './doctypes';

export type Decision = 'approved' | 'rejected';
export type ApprovalRequest = typeof approvalRequests.$inferSelect;

export interface SubmitInput {
  docType: DocType;
  docId: number;
  docNo?: string | null;
  title: string;
  summary?: string | null;
  amount?: number | null;
  priority?: 'normal' | 'high';
  meta?: Record<string, unknown>;
}

/** Called by the owning module when its document is approved or rejected. */
export type DecisionHandler = (req: ApprovalRequest, decision: Decision, user: AuthUser) => Promise<void> | void;

@Injectable()
export class ApprovalsService {
  private handlers = new Map<DocType, DecisionHandler>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  onDecision(docType: DocType, handler: DecisionHandler) {
    this.handlers.set(docType, handler);
  }

  /**
   * Routes a document for approval when a rule requires it. Returns the request,
   * or null when no approval is needed (the caller then treats it as approved).
   */
  async submit(user: AuthUser, input: SubmitInput): Promise<ApprovalRequest | null> {
    const [rule] = await this.db.select().from(approvalRules).where(eq(approvalRules.docType, input.docType));
    if (!rule?.enabled || (input.amount ?? 0) < rule.minAmount) return null;
    const [open] = await this.db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.docType, input.docType), eq(approvalRequests.docId, input.docId), eq(approvalRequests.status, 'pending')));
    if (open) throw new ConflictException('This document is already waiting for approval');
    const [req] = await this.db
      .insert(approvalRequests)
      .values({
        ...input,
        priority: input.priority ?? 'normal',
        approverRole: rule.approverRole,
        requestedBy: user.id,
        requestedByName: user.name,
      })
      .returning();
    await this.audit.log(user, 'submit', input.docType, input.docId, { approvalRequestId: req.id });
    return req;
  }

  /** Document types this user may approve. */
  async approvableTypes(user: AuthUser): Promise<DocType[]> {
    const types = Object.keys(DOC_TYPES) as DocType[];
    const allowed = await Promise.all(types.map((t) => this.access.can(user, t, 'approve')));
    return types.filter((_, i) => allowed[i]);
  }

  async inbox(user: AuthUser, opts: { status: 'pending' | 'history'; docType?: DocType }) {
    const types = await this.approvableTypes(user);
    const visible = opts.docType ? types.filter((t) => t === opts.docType) : types;
    if (!visible.length) return [];
    return this.db
      .select()
      .from(approvalRequests)
      .where(
        and(
          inArray(approvalRequests.docType, visible),
          opts.status === 'pending' ? eq(approvalRequests.status, 'pending') : ne(approvalRequests.status, 'pending'),
        ),
      )
      // pending: high priority first, then oldest first; history: latest decisions first
      .orderBy(
        ...(opts.status === 'pending'
          ? [asc(sql`case when ${approvalRequests.priority} = 'high' then 0 else 1 end`), asc(approvalRequests.createdAt)]
          : [desc(approvalRequests.decidedAt)]),
      )
      .limit(opts.status === 'pending' ? 500 : 200);
  }

  /** Requests raised by this user (any status), e.g. to show "awaiting approval" on their documents. */
  async forDocument(docType: DocType, docId: number) {
    return this.db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.docType, docType), eq(approvalRequests.docId, docId)))
      .orderBy(desc(approvalRequests.createdAt));
  }

  async decide(user: AuthUser, id: number, decision: Decision, comment?: string | null) {
    const [req] = await this.db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
    if (!req) throw new NotFoundException();
    if (req.status !== 'pending') throw new ConflictException(`Already ${req.status}`);
    if (!(await this.access.can(user, req.docType as DocType, 'approve'))) {
      throw new ForbiddenException(`Your role (${user.role}) cannot approve ${req.docType.replace(/_/g, ' ')}`);
    }
    if (req.requestedBy === user.id && user.role !== 'admin') {
      throw new ForbiddenException('You cannot approve or reject your own request');
    }
    const [updated] = await this.db
      .update(approvalRequests)
      .set({ status: decision, decidedBy: user.id, decidedByName: user.name, decidedAt: new Date(), comment: comment ?? null })
      .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'pending')))
      .returning();
    if (!updated) throw new ConflictException('Someone else decided this request first');
    await this.handlers.get(req.docType as DocType)?.(updated, decision, user);
    await this.audit.log(user, decision === 'approved' ? 'approve' : 'reject', req.docType, req.docId, { approvalRequestId: id, comment });
    return updated;
  }
}
