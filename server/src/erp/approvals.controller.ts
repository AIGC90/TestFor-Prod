import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser, ROLES, Roles } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { approvalRules } from '../db/schema';
import { ApprovalsService } from './approvals.service';
import { AuditService } from './audit.service';
import { validationError } from './crud';
import { DOC_TYPES, type DocType } from './doctypes';

const docTypeEnum = z.enum(Object.keys(DOC_TYPES) as [DocType, ...DocType[]]);
const ruleBody = z.object({
  docType: docTypeEnum,
  enabled: z.boolean(),
  minAmount: z.coerce.number().min(0),
  approverRole: z.enum(ROLES),
});

@Controller('approvals')
export class ApprovalsController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query('status') status = 'pending', @Query('docType') docType?: string) {
    if (status !== 'pending' && status !== 'history') throw new BadRequestException('status must be pending or history');
    const type = docType ? docTypeEnum.safeParse(docType) : null;
    if (type && !type.success) throw new BadRequestException('unknown docType');
    return this.approvals.inbox(user, { status, docType: type?.data });
  }

  @Post(':id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: { comment?: string }) {
    return this.approvals.decide(user, id, 'approved', body?.comment?.trim() || null);
  }

  @Post(':id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: { comment?: string }) {
    const comment = body?.comment?.trim();
    if (!comment) throw new BadRequestException('A reason is required to reject');
    return this.approvals.decide(user, id, 'rejected', comment);
  }

  /** Approves several requests; each is checked on its own and failures are reported per id. */
  @Post('approve-bulk')
  async approveBulk(@CurrentUser() user: AuthUser, @Body() body: { ids?: unknown }) {
    const parsed = z.array(z.number().int().positive()).min(1).max(200).safeParse(body?.ids);
    if (!parsed.success) throw validationError(parsed.error);
    const results = [];
    for (const id of parsed.data) {
      try {
        await this.approvals.decide(user, id, 'approved', null);
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: (e as Error).message });
      }
    }
    return results;
  }

  @Get('rules')
  rules() {
    return this.db.select().from(approvalRules).orderBy(asc(approvalRules.docType));
  }

  @Roles('admin')
  @Put('rules')
  async setRule(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const parsed = ruleBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const { docType, ...values } = parsed.data;
    const [row] = await this.db
      .insert(approvalRules)
      .values({ docType, ...values })
      .onConflictDoUpdate({ target: approvalRules.docType, set: values })
      .returning();
    await this.audit.log(user, 'update', 'approval_rule', docType, values);
    return row;
  }
}
