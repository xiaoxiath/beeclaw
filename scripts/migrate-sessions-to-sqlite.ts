#!/usr/bin/env bun
/**
 * Migration script: Migrate sessions from JSON files to SQLite
 * RFC-03: SQLite migration tool
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { initDataConnection, getDataConnection, closeDataConnection } from '../src/db';
import { sessions as sessionsTable } from '../src/db/schema';
import { eq } from 'drizzle-orm';

const SESSIONS_PATH = process.env.SESSIONS_PATH || './data/memory/sessions';

interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface Session {
  id: string;
  userId: string;
  channel: string;
  messages: SessionMessage[];
  summary?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  pendingRecovery?: boolean;
  responseDelivered?: boolean;
  pendingDelivery?: boolean;
  recoveryAttempts?: number;
  lastRecoveryAt?: string;
  lastAiResponse?: string;
}

async function migrateSessions() {
  console.log('🔄 Starting session migration to SQLite...\n');

  // Check if sessions directory exists
  if (!existsSync(SESSIONS_PATH)) {
    console.log(`⚠️  Sessions directory not found: ${SESSIONS_PATH}`);
    console.log('No sessions to migrate.');
    return;
  }

  // Get all JSON session files
  const files = readdirSync(SESSIONS_PATH).filter(
    f => f.endsWith('.json') && !f.endsWith('.bak') && !f.endsWith('.tmp')
  );

  if (files.length === 0) {
    console.log('No session files found.');
    return;
  }

  console.log(`Found ${files.length} session files to migrate.\n`);

  // Initialize database connection
  const dbPath = join(SESSIONS_PATH, '..', 'beeclaw.db');
  initDataConnection({ path: dbPath, migrate: true });
  const db = getDataConnection();

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    try {
      // Read session file
      const filePath = join(SESSIONS_PATH, file);
      const content = readFileSync(filePath, 'utf-8');
      const session: Session = JSON.parse(content);

      // Check if session already exists in SQLite
      const existing = db.select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, session.id))
        .limit(1)
        .all();

      if (existing.length > 0) {
        console.log(`  ⏭️  Skipped ${session.id} (already exists)`);
        skipped++;
        continue;
      }

      // Insert session into SQLite
      await db.insert(sessionsTable).values({
        id: session.id,
        channel: session.channel,
        userId: session.userId,
        messages: session.messages,
        metadata: session.metadata || null,
        needsRecovery: session.pendingRecovery || false,
        recoveredAt: session.lastRecoveryAt ? new Date(session.lastRecoveryAt) : null,
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(session.updatedAt),
      }).run();

      console.log(`  ✅ Migrated ${session.id} (${session.messages.length} messages)`);
      migrated++;
    } catch (error) {
      console.error(`  ❌ Failed to migrate ${file}:`, error);
      errors++;
    }
  }

  // Print summary
  console.log('\n📊 Migration Summary:');
  console.log(`  ✅ Migrated: ${migrated} sessions`);
  console.log(`  ⏭️  Skipped: ${skipped} sessions`);
  console.log(`  ❌ Errors: ${errors} sessions`);
  console.log(`\n✨ Migration complete!\n`);

  // Close database connection
  closeDataConnection();
}

// Run migration
migrateSessions().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
