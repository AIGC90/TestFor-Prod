import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** A copilot conversation. `messages` is the exact API history, only ever appended to. */
export const aiConversations = pgTable('ai_conversations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  title: text('title').notNull(),
  messages: jsonb('messages').$type<unknown[]>().notNull().default([]),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Something the copilot proposed. It runs only after a person approves it in the Pending Inbox. */
export const aiActions = pgTable('ai_actions', {
  id: serial('id').primaryKey(),
  actNo: text('act_no').notNull().unique(),
  conversationId: integer('conversation_id'),
  kind: text('kind').notNull(),
  params: jsonb('params').$type<Record<string, unknown>>().notNull(),
  summary: text('summary').notNull(),
  reason: text('reason'),
  status: text('status').notNull().default('pending_approval'), // pending_approval | executed | failed | rejected
  requestedBy: integer('requested_by').notNull(),
  result: jsonb('result'),
  error: text('error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  executedAt: ts('executed_at'),
});

/** Saved AI output: alert triage runs and daily briefings. */
export const aiReports = pgTable('ai_reports', {
  id: serial('id').primaryKey(),
  kind: text('kind').notNull(), // triage | briefing
  title: text('title').notNull(),
  content: jsonb('content').notNull(),
  createdBy: integer('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** One row per model call chain, for cost and audit. */
export const aiRuns = pgTable('ai_runs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  feature: text('feature').notNull(), // copilot | triage | briefing | extract
  model: text('model').notNull(),
  requests: integer('requests').notNull().default(1),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  ms: integer('ms').notNull().default(0),
  ok: boolean('ok').notNull().default(true),
  error: text('error'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
