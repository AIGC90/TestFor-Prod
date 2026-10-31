import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  type Type,
} from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, ilike, or, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth';
import { DB, type Db } from '../db/db.module';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import type { DocType } from './doctypes';
import { NumberingService } from './numbering.service';

/** Turns a Zod error into a readable 400. */
export function validationError(error: z.ZodError) {
  const lines = error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
  return new BadRequestException(lines.join('; '));
}

/** Maps Postgres constraint errors to 409 with a useful message. */
export function dbError(e: unknown): never {
  // drizzle wraps the driver error; the pg error code sits on it or on its cause
  const err = e as { code?: string; detail?: string; cause?: { code?: string; detail?: string } };
  const code = err.code ?? err.cause?.code;
  const detail = err.detail ?? err.cause?.detail;
  if (code === '23505') throw new ConflictException(`Already exists${detail ? `: ${detail}` : ''}`);
  if (code === '23503') {
    throw new ConflictException(`This record is linked to other records and cannot be removed or changed${detail ? ` (${detail})` : ''}`);
  }
  throw e;
}

export interface CrudContext {
  db: Db;
  user: AuthUser;
  numbering: NumberingService;
}

export interface CrudOptions {
  path: string;
  docType: DocType;
  table: PgTable;
  /** Validates create input; updates use `.partial()` of the same schema. */
  schema: z.ZodObject<z.ZodRawShape>;
  /** Columns searched by `?search=`. */
  searchColumns?: PgColumn[];
  /** Query params that filter by equality, e.g. `{ plantId: stores.plantId }`. */
  filters?: Record<string, PgColumn>;
  orderBy?: SQL[];
  /** Custom filters built from the query string (e.g. array membership). */
  where?: (query: Record<string, string>) => SQL | undefined;
  /** Assigns a document number on create, e.g. `{ prefix: 'JC', column: 'docNo' }`. */
  numbering?: { prefix: string; column: string };
  beforeCreate?: (input: Record<string, unknown>, ctx: CrudContext) => Promise<Record<string, unknown>> | Record<string, unknown>;
  beforeUpdate?: (input: Record<string, unknown>, existing: Record<string, unknown>, ctx: CrudContext) => Promise<Record<string, unknown>> | Record<string, unknown>;
  afterWrite?: (row: Record<string, unknown>, ctx: CrudContext, op: 'create' | 'update') => Promise<void> | void;
  /** Reject deletes when this returns a reason (e.g. stock exists). */
  canDelete?: (row: Record<string, unknown>, ctx: CrudContext) => Promise<string | null> | string | null;
}

/** Field names per document type, for the Field Masks screen. */
export const FIELD_REGISTRY = new Map<DocType, string[]>();
const SYSTEM_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'createdBy']);

const listQuery = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

/**
 * Builds a Nest controller with list/get/create/update/delete for one table.
 * Every call checks the role's document permissions, applies field masks,
 * validates input with Zod, and writes the audit log.
 */
export function crudController(opts: CrudOptions): Type<unknown> {
  // Drizzle's generic table types do not narrow well here; the shape is fixed by `opts.table`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = opts.table as any;
  const columns = getTableColumns(opts.table);
  const idCol = columns.id as PgColumn;
  const hasUpdatedAt = 'updatedAt' in columns;
  const hasCreatedBy = 'createdBy' in columns;
  const updateSchema = opts.schema.partial();
  FIELD_REGISTRY.set(opts.docType, Object.keys(columns).filter((c) => !SYSTEM_FIELDS.has(c)));

  @Controller(opts.path)
  class CrudController {
    constructor(
      @Inject(DB) readonly db: Db,
      readonly access: AccessService,
      readonly audit: AuditService,
      readonly numbering: NumberingService,
    ) {}

    ctx(user: AuthUser): CrudContext {
      return { db: this.db, user, numbering: this.numbering };
    }

    async find(id: number) {
      const [row] = await this.db.select().from(table).where(eq(idCol, id));
      if (!row) throw new NotFoundException();
      return row as Record<string, unknown>;
    }

    @Get()
    async list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
      await this.access.require(user, opts.docType, 'view');
      const parsed = listQuery.safeParse(query);
      if (!parsed.success) throw validationError(parsed.error);
      const where: SQL[] = [];
      if (parsed.data.search && opts.searchColumns?.length) {
        where.push(or(...opts.searchColumns.map((c) => ilike(c, `%${parsed.data.search}%`)))!);
      }
      const custom = opts.where?.(query);
      if (custom) where.push(custom);
      for (const [param, col] of Object.entries(opts.filters ?? {})) {
        if (query[param] !== undefined && query[param] !== '') where.push(eq(col, query[param]));
      }
      const rows = await this.db
        .select()
        .from(table)
        .where(where.length ? and(...where) : undefined)
        .orderBy(...(opts.orderBy ?? [desc(idCol)]))
        .limit(parsed.data.limit);
      const masks = await this.access.masks(user.role, opts.docType);
      return (rows as Record<string, unknown>[]).map((r) => AccessService.redact(r, masks));
    }

    @Get(':id')
    async get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
      await this.access.require(user, opts.docType, 'view');
      return AccessService.redact(await this.find(id), await this.access.masks(user.role, opts.docType));
    }

    @Post()
    async create(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
      await this.access.require(user, opts.docType, 'create');
      const masks = await this.access.masks(user.role, opts.docType);
      const parsed = opts.schema.safeParse(AccessService.stripInput(body ?? {}, masks, false));
      if (!parsed.success) throw validationError(parsed.error);
      let values: Record<string, unknown> = { ...parsed.data };
      if (opts.beforeCreate) values = await opts.beforeCreate(values, this.ctx(user));
      if (opts.numbering && !values[opts.numbering.column]) {
        values[opts.numbering.column] = await this.numbering.next(opts.numbering.prefix);
      }
      if (hasCreatedBy) values.createdBy = user.id;
      let row: Record<string, unknown>;
      try {
        [row] = (await this.db.insert(table).values(values).returning()) as Record<string, unknown>[];
      } catch (e) {
        dbError(e);
      }
      await this.audit.log(user, 'create', opts.docType, row.id as number, row);
      await opts.afterWrite?.(row, this.ctx(user), 'create');
      return AccessService.redact(row, masks);
    }

    @Put(':id')
    async update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
      await this.access.require(user, opts.docType, 'edit');
      const existing = await this.find(id);
      const masks = await this.access.masks(user.role, opts.docType);
      const parsed = updateSchema.safeParse(AccessService.stripInput(body ?? {}, masks, true));
      if (!parsed.success) throw validationError(parsed.error);
      let values: Record<string, unknown> = { ...parsed.data };
      if (opts.beforeUpdate) values = await opts.beforeUpdate(values, existing, this.ctx(user));
      if (hasUpdatedAt) values.updatedAt = new Date();
      let row: Record<string, unknown>;
      try {
        [row] = (await this.db.update(table).set(values).where(eq(idCol, id)).returning()) as Record<string, unknown>[];
      } catch (e) {
        dbError(e);
      }
      await this.audit.log(user, 'update', opts.docType, id, values);
      await opts.afterWrite?.(row, this.ctx(user), 'update');
      return AccessService.redact(row, masks);
    }

    @Delete(':id')
    @HttpCode(204)
    async remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
      await this.access.require(user, opts.docType, 'delete');
      const existing = await this.find(id);
      const reason = await opts.canDelete?.(existing, this.ctx(user));
      if (reason) throw new ConflictException(reason);
      try {
        await this.db.delete(table).where(eq(idCol, id));
      } catch (e) {
        dbError(e);
      }
      await this.audit.log(user, 'delete', opts.docType, id, existing);
    }
  }

  Object.defineProperty(CrudController, 'name', { value: `${opts.docType}CrudController` });
  return CrudController;
}

export { asc, desc };
