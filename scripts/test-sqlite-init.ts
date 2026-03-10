#!/usr/bin/env bun
/**
 * Test script to verify SQLite database initialization
 */

import { join } from 'path';
import { initDataConnection, getDataConnection, closeDataConnection } from '../src/db';

const memoryPath = './data/memory';
const dbPath = join(memoryPath, 'beeclaw.db');

console.log('🧪 Testing SQLite Database Initialization\n');

try {
  // Initialize database
  console.log('1. Initializing DataConnection...');
  initDataConnection({ path: dbPath, migrate: true });
  console.log('   ✅ DataConnection initialized\n');

  // Get connection
  console.log('2. Getting database connection...');
  const db = getDataConnection();
  console.log('   ✅ Database connection obtained\n');

  // Test query
  console.log('3. Testing database query...');
  const result = db.select()
    .from({} as any)
    .limit(1)
    .all();
  console.log('   ✅ Database query successful\n');

  // Close connection
  console.log('4. Closing database connection...');
  closeDataConnection();
  console.log('   ✅ Connection closed\n');

  console.log('✅ All tests passed! SQLite is working correctly.\n');
} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
}
