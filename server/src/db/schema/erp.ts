import { sql } from 'drizzle-orm';
import {
  boolean,
  type AnyPgColumn,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const audit = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: integer('created_by'),
};
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: 'number' });

/* ------------------------------------------------------------ framework */

/** What each ERP role may do per document type. Missing rows fall back to built-in defaults. */
export const docPermissions = pgTable(
  'doc_permissions',
  {
    role: text('role').notNull(),
    docType: text('doc_type').notNull(),
    canView: boolean('can_view').notNull().default(false),
    canCreate: boolean('can_create').notNull().default(false),
    canEdit: boolean('can_edit').notNull().default(false),
    canDelete: boolean('can_delete').notNull().default(false),
    canApprove: boolean('can_approve').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.role, t.docType] })],
);

/** Per role and document type, fields that are hidden or read-only. */
export const fieldMasks = pgTable(
  'field_masks',
  {
    id: serial('id').primaryKey(),
    docType: text('doc_type').notNull(),
    role: text('role').notNull(),
    field: text('field').notNull(),
    mode: text('mode').notNull(), // 'hidden' | 'readonly'
  },
  (t) => [uniqueIndex('field_masks_unique').on(t.docType, t.role, t.field)],
);

/** Running counters for document numbers such as JC-2026-0001. */
export const numberSeries = pgTable(
  'number_series',
  {
    prefix: text('prefix').notNull(),
    year: integer('year').notNull(),
    last: integer('last').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.prefix, t.year] })],
);

/** When a document of this type needs approval, and who approves it. */
export const approvalRules = pgTable('approval_rules', {
  docType: text('doc_type').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  /** Approval is required when the document amount is at least this (0 = always). */
  minAmount: money('min_amount').notNull().default(0),
  approverRole: text('approver_role').notNull().default('admin'),
});

export const approvalRequests = pgTable('approval_requests', {
  id: serial('id').primaryKey(),
  docType: text('doc_type').notNull(),
  docId: integer('doc_id').notNull(),
  docNo: text('doc_no'),
  title: text('title').notNull(),
  summary: text('summary'),
  amount: money('amount'),
  priority: text('priority').notNull().default('normal'), // normal | high
  approverRole: text('approver_role').notNull(),
  status: text('status').notNull().default('pending'), // pending | approved | rejected
  requestedBy: integer('requested_by'),
  requestedByName: text('requested_by_name'),
  decidedBy: integer('decided_by'),
  decidedByName: text('decided_by_name'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  comment: text('comment'),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------- masters */

export const plants = pgTable('plants', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  gstin: text('gstin'),
  active: boolean('active').notNull().default(true),
  ...audit,
});

export const stores = pgTable('stores', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  plantId: integer('plant_id').references(() => plants.id),
  kind: text('kind').notNull().default('general'), // general | workshop | tyre | central | site
  active: boolean('active').notNull().default(true),
  ...audit,
});

/** Customers, vendors, garages, brokers, sister companies and scrap buyers in one directory. */
export const parties = pgTable('parties', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  kinds: text('kinds').array().notNull().default(sql`'{}'::text[]`),
  gstin: text('gstin'),
  pan: text('pan'),
  contactPerson: text('contact_person'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  creditDays: integer('credit_days'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  ...audit,
});

/** Up to four levels (main > sub > sub-sub > sub-sub-sub); settings flow down to items. */
export const itemCategories = pgTable('item_categories', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id').references((): AnyPgColumn => itemCategories.id),
  name: text('name').notNull(),
  level: integer('level').notNull().default(1),
  unit: text('unit'),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2, mode: 'number' }),
  hsn: text('hsn'),
  countingMode: text('counting_mode'), // standard | serial | volume
  ...audit,
});

export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  categoryId: integer('category_id').notNull().references(() => itemCategories.id),
  partNo: text('part_no'),
  countingMode: text('counting_mode'), // inherits from category when null
  unit: text('unit'),
  rate: money('rate'),
  gstRate: numeric('gst_rate', { precision: 5, scale: 2, mode: 'number' }),
  hsn: text('hsn'),
  reorderLevel: qty('reorder_level'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  active: boolean('active').notNull().default(true),
  ...audit,
});
