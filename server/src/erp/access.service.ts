import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth';
import { type Db, InjectDb } from '../db/db.module';
import { docPermissions, fieldMasks } from '../db/schema';
import { type Action, DEFAULT_PERMISSIONS, type DocType } from './doctypes';

export interface Masks {
  hidden: Set<string>;
  readonly: Set<string>;
}

const TTL_MS = 30_000;

/** Answers "may this user do X on document type Y" and "which fields are masked". */
@Injectable()
export class AccessService {
  private permCache = new Map<string, { at: number; value: Record<Action, boolean> | null }>();
  private maskCache = new Map<string, { at: number; value: Masks }>();

  constructor(@InjectDb() private readonly db: Db) {}

  /** Clears cached rules after an admin edits permissions or masks. */
  invalidate() {
    this.permCache.clear();
    this.maskCache.clear();
  }

  async permissions(role: string, docType: DocType): Promise<Record<Action, boolean>> {
    const all = { view: true, create: true, edit: true, delete: true, approve: true };
    if (role === 'admin') return all;
    const key = `${role}:${docType}`;
    const hit = this.permCache.get(key);
    let row = hit && Date.now() - hit.at < TTL_MS ? hit.value : undefined;
    if (row === undefined) {
      const [r] = await this.db
        .select()
        .from(docPermissions)
        .where(and(eq(docPermissions.role, role), eq(docPermissions.docType, docType)));
      row = r ? { view: r.canView, create: r.canCreate, edit: r.canEdit, delete: r.canDelete, approve: r.canApprove } : null;
      this.permCache.set(key, { at: Date.now(), value: row });
    }
    if (row) return row;
    const def = DEFAULT_PERMISSIONS[role as keyof typeof DEFAULT_PERMISSIONS]?.[docType] ?? {};
    return { view: !!def.view, create: !!def.create, edit: !!def.edit, delete: !!def.delete, approve: !!def.approve };
  }

  async can(user: AuthUser, docType: DocType, action: Action) {
    return (await this.permissions(user.role, docType))[action];
  }

  async require(user: AuthUser, docType: DocType, action: Action) {
    if (!(await this.can(user, docType, action))) {
      throw new ForbiddenException(`Your role (${user.role}) cannot ${action} ${docType.replace(/_/g, ' ')}`);
    }
  }

  async masks(role: string, docType: DocType): Promise<Masks> {
    if (role === 'admin') return { hidden: new Set(), readonly: new Set() };
    const key = `${role}:${docType}`;
    const hit = this.maskCache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const rows = await this.db
      .select()
      .from(fieldMasks)
      .where(and(eq(fieldMasks.role, role), eq(fieldMasks.docType, docType)));
    const value: Masks = {
      hidden: new Set(rows.filter((r) => r.mode === 'hidden').map((r) => r.field)),
      readonly: new Set(rows.filter((r) => r.mode === 'readonly').map((r) => r.field)),
    };
    this.maskCache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Removes hidden fields from a record before it leaves the API. */
  static redact<T extends Record<string, unknown>>(row: T, masks: Masks): T {
    if (!masks.hidden.size) return row;
    const out = { ...row };
    masks.hidden.forEach((f) => delete out[f]);
    return out;
  }

  /** Drops input for fields the user may not set (hidden always; read-only on update). */
  static stripInput(input: Record<string, unknown>, masks: Masks, isUpdate: boolean) {
    const out = { ...input };
    masks.hidden.forEach((f) => delete out[f]);
    if (isUpdate) masks.readonly.forEach((f) => delete out[f]);
    return out;
  }
}
