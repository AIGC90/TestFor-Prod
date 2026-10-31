import { z } from 'zod';

/** Optional free text: trims, and stores empty strings as null. */
export const text = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const requiredText = (max = 200) => z.string().trim().min(1, 'is required').max(max);

export const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;

/** Optional, upper-cased value that must match a pattern when given. */
export const pattern = (re: RegExp, label: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || re.test(v), `is not a valid ${label}`);

export const optionalNumber = z.coerce.number().nullish().transform((v) => (v === undefined ? null : v));
export const optionalId = z.coerce.number().int().positive().nullish().transform((v) => v ?? null);
