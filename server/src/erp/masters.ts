import { BadRequestException } from '@nestjs/common';
import { and, arrayContains, asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { itemCategories, items, parties, plants, stores } from '../db/schema';
import { crudController } from './crud';
import { GSTIN, optionalId, optionalNumber, PAN, pattern, requiredText, text } from './zod-helpers';

export const PARTY_KINDS = ['customer', 'vendor', 'garage', 'broker', 'transporter', 'sister_company', 'buyer'] as const;
export const STORE_KINDS = ['central', 'workshop', 'tyre', 'site', 'general'] as const;
export const COUNTING_MODES = ['standard', 'serial', 'volume'] as const;
const code = z.string().trim().toUpperCase().min(1).max(40).regex(/^[A-Z0-9][A-Z0-9-_/]*$/, 'use letters, digits, - _ /');
/** Optional code: blank means "number it for me". */
const autoCode = z.preprocess((v) => (v === '' || v === null ? undefined : v), code.optional());

export const PlantsController = crudController({
  path: 'masters/plants',
  docType: 'plant',
  table: plants,
  searchColumns: [plants.name, plants.code, plants.city],
  orderBy: [asc(plants.name)],
  schema: z.object({
    code,
    name: requiredText(),
    address: text(500),
    city: text(),
    state: text(),
    gstin: pattern(GSTIN, 'GSTIN'),
    active: z.boolean().default(true),
  }),
});

export const StoresController = crudController({
  path: 'masters/stores',
  docType: 'store',
  table: stores,
  searchColumns: [stores.name, stores.code],
  filters: { plantId: stores.plantId, kind: stores.kind },
  orderBy: [asc(stores.name)],
  schema: z.object({
    code,
    name: requiredText(),
    plantId: optionalId,
    kind: z.enum(STORE_KINDS).default('general'),
    active: z.boolean().default(true),
  }),
});

export const PartiesController = crudController({
  path: 'masters/parties',
  docType: 'party',
  table: parties,
  searchColumns: [parties.name, parties.code, parties.gstin, parties.city, parties.phone],
  orderBy: [asc(parties.name)],
  numbering: { prefix: 'BP', column: 'code' },
  where: (q) => (q.kind ? arrayContains(parties.kinds, [q.kind]) : undefined),
  schema: z.object({
    code: autoCode,
    name: requiredText(),
    kinds: z.array(z.enum(PARTY_KINDS)).min(1, 'choose at least one type'),
    gstin: pattern(GSTIN, 'GSTIN'),
    pan: pattern(PAN, 'PAN'),
    contactPerson: text(),
    phone: text(30),
    email: z.email().nullish().or(z.literal('')).transform((v) => v || null),
    address: text(500),
    city: text(),
    state: text(),
    creditDays: z.coerce.number().int().min(0).max(365).nullish(),
    notes: text(1000),
    active: z.boolean().default(true),
  }),
});

export const ItemCategoriesController = crudController({
  path: 'masters/item-categories',
  docType: 'item_category',
  table: itemCategories,
  searchColumns: [itemCategories.name],
  filters: { parentId: itemCategories.parentId },
  orderBy: [asc(itemCategories.level), asc(itemCategories.name)],
  schema: z.object({
    name: requiredText(),
    parentId: optionalId,
    unit: text(20),
    gstRate: optionalNumber.refine((v) => v === null || (v >= 0 && v <= 28), 'GST must be 0–28%'),
    hsn: text(10),
    countingMode: z.enum(COUNTING_MODES).nullish(),
  }),
  // Level follows the parent; the tree is at most four levels deep.
  beforeCreate: async (input, { db }) => {
    if (!input.parentId) return { ...input, level: 1 };
    const [parent] = await db.select().from(itemCategories).where(eq(itemCategories.id, Number(input.parentId)));
    if (!parent) throw new BadRequestException('parentId: parent category not found');
    if (parent.level >= 4) throw new BadRequestException('Categories can be at most four levels deep');
    return { ...input, level: parent.level + 1 };
  },
  beforeUpdate: (input, existing) => {
    if ('parentId' in input && input.parentId !== existing.parentId) {
      throw new BadRequestException('Moving a category to another parent is not supported; create a new one instead');
    }
    return input;
  },
  canDelete: async (row, { db }) => {
    const [children] = await db.select({ n: count() }).from(itemCategories).where(eq(itemCategories.parentId, row.id as number));
    const [used] = await db.select({ n: count() }).from(items).where(eq(items.categoryId, row.id as number));
    if (children.n) return 'Delete or move its sub-categories first';
    if (used.n) return `${used.n} items use this category`;
    return null;
  },
});

export const ItemsController = crudController({
  path: 'masters/items',
  docType: 'item',
  table: items,
  searchColumns: [items.name, items.code, items.partNo, items.hsn],
  filters: { categoryId: items.categoryId },
  where: (q) => (q.tag ? and(arrayContains(items.tags, [q.tag])) : undefined),
  orderBy: [asc(items.name)],
  numbering: { prefix: 'ITM', column: 'code' },
  schema: z.object({
    code: autoCode,
    name: requiredText(),
    categoryId: z.coerce.number().int().positive(),
    partNo: text(60),
    countingMode: z.enum(COUNTING_MODES).nullish(),
    unit: text(20),
    rate: optionalNumber.refine((v) => v === null || v >= 0, 'rate cannot be negative'),
    gstRate: optionalNumber.refine((v) => v === null || (v >= 0 && v <= 28), 'GST must be 0–28%'),
    hsn: text(10),
    reorderLevel: optionalNumber,
    tags: z.array(z.string().trim().toLowerCase().max(30)).max(20).default([]),
    active: z.boolean().default(true),
  }),
});
