/**
 * SQLite database schema for Beeclaw
 * RFC-03: SQLite + Drizzle ORM foundation
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Sessions table stores conversation session metadata and message history
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  channel: text('channel').notNull(), // 'cli' | 'feishu' | future channels
  userId: text('user_id').notNull(),

  // Messages stored as JSON array for now (can normalize later if needed)
  messages: text('messages', { mode: 'json' }).notNull().$type<Array<any>>(),

  // Session metadata
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),

  // Recovery state
  needsRecovery: integer('needs_recovery', { mode: 'boolean' }).notNull().default(false),
  recoveredAt: integer('recovered_at', { mode: 'timestamp' }),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
  channelIdx: index('sessions_channel_idx').on(table.channel),
  userIdIdx: index('sessions_user_id_idx').on(table.userId),
  updatedAtIdx: index('sessions_updated_at_idx').on(table.updatedAt),
}));

/**
 * Tasks table stores scheduled and running tasks for TaskDispatcher
 */
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),

  // Task identification
  sessionId: text('session_id').notNull(),
  type: text('type').notNull(), // 'message' | 'cron' | 'reminder' | custom
  payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, any>>(),

  // Scheduling
  scheduledAt: integer('scheduled_at', { mode: 'timestamp' }).notNull(),
  cron: text('cron'), // cron expression for recurring tasks (null for one-time)

  // Execution state
  status: text('status', { mode: 'text' }).notNull().default('pending'), // 'pending' | 'running' | 'completed' | 'failed'
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  error: text('error'),

  // Locking (for per-session execution)
  lockedBy: text('locked_by'), // dispatcher instance ID
  lockedAt: integer('locked_at', { mode: 'timestamp' }),

  // Result
  result: text('result', { mode: 'json' }).$type<Record<string, any>>(),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
}, (table) => ({
  sessionIdIdx: index('tasks_session_id_idx').on(table.sessionId),
  statusIdx: index('tasks_status_idx').on(table.status),
  scheduledAtIdx: index('tasks_scheduled_at_idx').on(table.scheduledAt),
  typeIdx: index('tasks_type_idx').on(table.type),
}));

// Type exports
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
