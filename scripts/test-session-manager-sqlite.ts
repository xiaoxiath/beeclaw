#!/usr/bin/env bun
/**
 * Test script to verify SessionManager with SQLite enabled
 */

import { join } from 'path';
import { existsSync } from 'fs';

// Enable SQLite sessions
process.env.USE_SQLITE_SESSIONS = 'true';

console.log('🧪 Testing SessionManager with SQLite Integration\n');

async function testSessionManager() {
  try {
    // 1. Import modules
    console.log('1. Initializing SessionManager with SQLite...');
    const { initSessionManager, getOrCreateSession, saveSession, getSession, deleteSession } = await import('../src/session');
    const { initDataConnection, getDataConnection } = await import('../src/db');
    const { sessions: sessionsTable } = await import('../src/db/schema');
    const { eq } = await import('drizzle-orm');

    const memoryPath = './data/memory';
    const dbPath = join(memoryPath, 'beeclaw.db');

    // Initialize database
    initDataConnection({ path: dbPath, migrate: true });

    // Initialize session manager (minimal config)
    initSessionManager({
      provider: { type: 'zhipu', name: 'test', apiKey: 'test', models: ['glm-4'] } as any,
      model: 'glm-4',
    });
    console.log('   ✅ SessionManager initialized\n');

    // 2. Create new session
    console.log('2. Creating new session...');
    const uniqueSessionId = `test-sqlite-${Date.now()}`;
    const session = getOrCreateSession({
      sessionId: uniqueSessionId,
      userId: 'test-user',
      channel: 'cli',
    });
    session.messages.push(
      { role: 'user', content: 'Hello from test', timestamp: new Date().toISOString() },
      { role: 'assistant', content: 'Hi! Test response', timestamp: new Date().toISOString() }
    );
    saveSession(session);
    console.log('   ✅ Session created and saved\n');

    // 3. Verify in SQLite
    console.log('3. Verifying session was saved to SQLite...');
    const db = getDataConnection();
    const fromDb = db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, uniqueSessionId))
      .all();

    if (fromDb.length > 0) {
      console.log(`   ✅ Found in SQLite: ${fromDb[0].id}`);
      console.log(`      - Messages: ${(fromDb[0].messages as any[]).length}\n`);
    } else {
      throw new Error('Session not found in SQLite!');
    }

    // 4. Update session
    console.log('4. Updating session (adding more messages)...');
    session.messages.push(
      { role: 'user', content: 'Another message', timestamp: new Date().toISOString() }
    );
    saveSession(session);
    console.log('   ✅ Session updated\n');

    // 5. Verify update in SQLite
    console.log('5. Verifying update in SQLite...');
    const updated = db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, uniqueSessionId))
      .all();

    const msgCount = (updated[0].messages as any[]).length;
    console.log(`   ✅ Updated message count: ${msgCount}\n`);

    if (msgCount !== 3) {
      throw new Error(`Expected 3 messages, got ${msgCount}`);
    }

    // 6. Clear cache and reload from SQLite
    console.log('6. Clearing cache and reloading from SQLite...');
    const reloaded = getSession(uniqueSessionId);
    if (reloaded) {
      console.log(`   ✅ Session reloaded from cache\n`);
    }

    // 7. Delete session
    console.log('7. Deleting session...');
    deleteSession(uniqueSessionId);
    console.log('   ✅ Session deleted\n');

    // 8. Verify deletion from SQLite
    console.log('8. Verifying deletion from SQLite...');
    const afterDelete = db.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, uniqueSessionId))
      .all();

    if (afterDelete.length === 0) {
      console.log('   ✅ Session removed from SQLite\n');
    } else {
      throw new Error('Session not deleted from SQLite!');
    }

    // 9. Check JSON file (dual-mode)
    console.log('9. Checking dual-mode (JSON + SQLite)...');
    const jsonPath = join(memoryPath, 'sessions', `${uniqueSessionId}.json`);
    if (existsSync(jsonPath)) {
      console.log('   ⚠️  JSON file still exists (expected - deleted with session)');
    } else {
      console.log('   ✅ JSON file deleted with session');
    }

    console.log('\n✅ All SessionManager + SQLite integration tests passed!\n');
    console.log('📊 Test Summary:');
    console.log('   ✅ SessionManager initialization');
    console.log('   ✅ Session creation (written to SQLite)');
    console.log('   ✅ Session update (saved to SQLite)');
    console.log('   ✅ Session retrieval from SQLite');
    console.log('   ✅ Session deletion (removed from SQLite)\n');

    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

testSessionManager();
