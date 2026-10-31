import { bigserial, boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** ERP role per Traccar user. Traccar administrators are always treated as `admin`. */
export const userRoles = pgTable('user_roles', {
  traccarUserId: integer('traccar_user_id').primaryKey(),
  role: text('role').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Every ERP write is recorded here (who, what, which record, before/after). */
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  userId: integer('user_id'),
  userName: text('user_name'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  data: jsonb('data'),
});

/** Raw events forwarded by Traccar (alarms, geofence, overspeed...), processed by ERP modules. */
export const traccarEvents = pgTable(
  'traccar_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    traccarEventId: integer('traccar_event_id'),
    type: text('type').notNull(),
    deviceId: integer('device_id'),
    deviceName: text('device_name'),
    eventTime: timestamp('event_time', { withTimezone: true }),
    payload: jsonb('payload').notNull(),
    processed: boolean('processed').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('traccar_events_event_id').on(t.traccarEventId)],
);

/** Which Traccar events each user has marked as read in the Notifications Center. */
export const notificationReads = pgTable(
  'notification_reads',
  {
    userId: integer('user_id').notNull(),
    eventId: integer('event_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('notification_reads_user_event').on(t.userId, t.eventId)],
);
