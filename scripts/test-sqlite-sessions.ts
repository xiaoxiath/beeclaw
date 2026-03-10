#!/usr/bin/env bun
/**
 * Test script to verify SQLite session storage
 */

import { join } from 'path';
import { initDataConnection, getDataConnection, closeDataConnection } from '../src/db';
import { sessions as sessionsTable } from '../src/db/schema';
import { eq } from 'drizzle-orm';

const memoryPath = './data/memory';
const dbPath = join(memoryPath, 'beeclaw.db');

console.log('🧪 Testing SQLite Session Storage\n');

try {
  // Initialize database
  console.log('1. Initializing DataConnection...');
  initDataConnection({ path: dbPath, migrate: true });
  const db = getDataConnection();
  console.log('   ✅ Ready\n');

  // Create test session
  const testSession = {
    id: 'test-session-001',
    channel: 'cli',
    userId: 'test-user',
    messages: [
      { role: 'user' as const, content: 'Hello', timestamp: new Date().toISOString() },
      { role: 'assistant' as const, content: 'Hi there!', timestamp: new Date().toISOString() },
    ],
    metadata: { test: true },
    needsRecovery: false,
    recoveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Insert session
  console.log('2. Inserting test session...');
  await db.insert(sessionsTable).values(testSession).run();
  console.log('   ✅ Session inserted\n');

  // Query session
  console.log('3. Querying test session...');
  const result = db.select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, 'test-session-001'))
    .all();

  console.log('   ✅ Session retrieved:');
  console.log(`      - ID: ${result[0].id}`);
  console.log(`      - Channel: ${result[0].channel}`);
  console.log(`      - Messages: ${(result[0].messages as any[]).length}`);
  console.log(`      - Created: ${result[0].createdAt}\n`);

  // Update session
  console.log('4. Updating test session...');
  await db.update(sessionsTable)
    .set({
      messages: [...(result[0].messages as any[]), { role: 'user', content: 'How are you?', timestamp: new Date().toISOString() }],
      updatedAt: new Date(),
    })
    .where(eq(sessionsTable.id, 'test-session-001'))
    .run();
  console.log('   ✅ Session updated\n');

  // Verify update
  console.log('5. Verifying update...');
  const updated = db.select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, 'test-session-001'))
    .all();
  console.log(`   ✅ Messages after update: ${(updated[0].messages as any[]).length}\n`);

  // Delete test session
  console.log('6. Cleaning up test session...');
  await db.delete(sessionsTable)
    .where(eq(sessionsTable.id, 'test-session-001'))
    .run();
  console.log('   ✅ Test session deleted\n');

  // Close connection
  closeDataConnection();

  console.log('✅ All tests passed! SQLite session storage is working correctly.\n');
} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
}
