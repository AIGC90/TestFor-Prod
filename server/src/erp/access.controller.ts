import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser, ROLES, Roles } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { docPermissions, fieldMasks } from '../db/schema';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { validationError } from './crud';
import { ACTIONS, DOC_TYPES, type DocType } from './doctypes';

const docTypeEnum = z.enum(Object.keys(DOC_TYPES) as [DocType, ...DocType[]]);
const editableRoles = ROLES.filter((r) => r !== 'admin') as [string, ...string[]];

const permissionBody = z.object({
  role: z.enum(editableRoles),
  docType: docTypeEnum,
  view: z.boolean(),
  create: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
  approve: z.boolean(),
});
const maskBody = z.object({
  role: z.enum(editableRoles),
  docType: docTypeEnum,
  field: z.string().trim().min(1).max(60).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  mode: z.enum(['hidden', 'readonly']),
});

@Controller('access')
export class AccessController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** The current user's permissions and masks for every document type (drives the UI). */
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const entries = await Promise.all(
      (Object.keys(DOC_TYPES) as DocType[]).map(async (d) => {
        const masks = await this.access.masks(user.role, d);
        return [d, { ...(await this.access.permissions(user.role, d)), hidden: [...masks.hidden], readonly: [...masks.readonly] }] as const;
      }),
    );
    return { role: user.role, docTypes: Object.fromEntries(entries) };
  }

  @Get('doc-types')
  docTypes() {
    return { roles: editableRoles, actions: ACTIONS, docTypes: DOC_TYPES };
  }

  @Roles('admin')
  @Get('permissions')
  async matrix(@Query('role') role: string) {
    if (!editableRoles.includes(role)) throw new BadRequestException(`role must be one of: ${editableRoles.join(', ')}`);
    const entries = await Promise.all((Object.keys(DOC_TYPES) as DocType[]).map(async (d) => [d, await this.access.permissions(role, d)] as const));
    return Object.fromEntries(entries);
  }

  @Roles('admin')
  @Put('permissions')
  async setPermission(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const parsed = permissionBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const p = parsed.data;
    const values = { canView: p.view || p.create || p.edit || p.delete || p.approve, canCreate: p.create, canEdit: p.edit, canDelete: p.delete, canApprove: p.approve };
    await this.db
      .insert(docPermissions)
      .values({ role: p.role, docType: p.docType, ...values })
      .onConflictDoUpdate({ target: [docPermissions.role, docPermissions.docType], set: values });
    this.access.invalidate();
    await this.audit.log(user, 'update', 'doc_permission', `${p.role}:${p.docType}`, p);
    return this.access.permissions(p.role, p.docType);
  }

  @Roles('admin')
  @Get('field-masks')
  async masks(@Query('docType') docType: string) {
    const parsed = docTypeEnum.safeParse(docType);
    if (!parsed.success) throw new BadRequestException('unknown docType');
    return this.db.select().from(fieldMasks).where(eq(fieldMasks.docType, parsed.data));
  }

  @Roles('admin')
  @Post('field-masks')
  async addMask(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    const parsed = maskBody.safeParse(raw);
    if (!parsed.success) throw validationError(parsed.error);
    const m = parsed.data;
    const [row] = await this.db
      .insert(fieldMasks)
      .values(m)
      .onConflictDoUpdate({ target: [fieldMasks.docType, fieldMasks.role, fieldMasks.field], set: { mode: m.mode } })
      .returning();
    this.access.invalidate();
    await this.audit.log(user, 'create', 'field_mask', row.id, m);
    return row;
  }

  @Roles('admin')
  @Delete('field-masks/:id')
  @HttpCode(204)
  async removeMask(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.db.delete(fieldMasks).where(and(eq(fieldMasks.id, id)));
    this.access.invalidate();
    await this.audit.log(user, 'delete', 'field_mask', id);
  }
}
