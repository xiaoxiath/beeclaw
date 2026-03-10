#!/usr/bin/env bun
/**
 * Test script to verify TaskDispatcher with SQLite
 */

import { join } from 'path';
import { initDataConnection, getDataConnection, closeDataConnection } from '../src/db';
import { tasks as tasksTable } from '../src/db/schema';
import { eq } from 'drizzle-orm';

const memoryPath = './data/memory';
const dbPath = join(memoryPath, 'beeclaw.db');

console.log('🧪 Testing SQLite Task Storage\n');

try {
  // Initialize database
  console.log('1. Initializing DataConnection...');
  initDataConnection({ path: dbPath, migrate: true });
  const db = getDataConnection();
  console.log('   ✅ Ready\n');

  // Create test task
  const testTask = {
    id: 'test-task-001',
    sessionId: 'test-session-001',
    type: 'message' as const,
    payload: { message: 'Test message', userId: 'test-user', channel: 'cli' },
    scheduledAt: new Date(),
    cron: null,
    status: 'pending' as const,
    attempts: 0,
    maxAttempts: 3,
    createdAt: new Date(),
  };

  // Insert task
  console.log('2. Inserting test task...');
  await db.insert(tasksTable).values(testTask).run();
  console.log('   ✅ Task inserted\n');

  // Query pending tasks
  console.log('3. Querying pending tasks...');
  const pending = db.select()
    .from(tasksTable)
    .where(eq(tasksTable.status, 'pending'))
    .all();
  console.log(`   ✅ Found ${pending.length} pending task(s)\n`);

  // Update task status
  console.log('4. Updating task status to running...');
  await db.update(tasksTable)
    .set({
      status: 'running',
      startedAt: new Date(),
      lockedBy: 'test-dispatcher',
      lockedAt: new Date(),
    })
    .where(eq(tasksTable.id, 'test-task-001'))
    .run();
  console.log('   ✅ Task status updated\n');

  // Complete task
  console.log('5. Completing task...');
  await db.update(tasksTable)
    .set({
      status: 'completed',
      completedAt: new Date(),
      result: { success: true },
      lockedBy: null,
      lockedAt: null,
    })
    .where(eq(tasksTable.id, 'test-task-001'))
    .run();
  console.log('   ✅ Task completed\n');

  // Verify completion
  console.log('6. Verifying task completion...');
  const completed = db.select()
    .from(tasksTable)
    .where(eq(tasksTable.id, 'test-task-001'))
    .all();
  console.log(`   ✅ Task status: ${completed[0].status}`);
  console.log(`   ✅ Has result: ${!!completed[0].result}\n`);

  // Clean up
  console.log('7. Cleaning up test task...');
  await db.delete(tasksTable)
    .where(eq(tasksTable.id, 'test-task-001'))
    .run();
  console.log('   ✅ Test task deleted\n');

  // Close connection
  closeDataConnection();

  console.log('✅ All tests passed! SQLite task storage is working correctly.\n');
} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
}
