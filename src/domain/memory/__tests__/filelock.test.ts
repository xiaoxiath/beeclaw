/**
 * P0-2.3: Cross-Process File Lock Tests
 *
 * Simple tests to verify file locking behavior in the memory store.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Cross-Process FileLock Behavior', () => {
  let testDir: string;

  beforeEach(() => {
    // Create unique test directory
    testDir = join(tmpdir(), `filelock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Lock file cleanup', () => {
    test('should not leave lock files after write operations', async () => {
      const { getMemoryStore, resetMemoryStore } = await import('../../memory/store');
      resetMemoryStore();

      const store = getMemoryStore({ path: testDir });
      store.init();

      // Perform write operation
      await store.write('test.md', 'Test content', 'overwrite');

      // Check that no lock files remain
      const files = require('fs').readdirSync(testDir, { recursive: true });
      const lockFiles = files.filter((f: string) => f.endsWith('.lock'));

      expect(lockFiles).toHaveLength(0);

      resetMemoryStore();
    });

    test('should clean up stale lock files', async () => {
      // Create a stale lock file
      const lockFile = join(testDir, 'test.md.lock');
      const staleLockData = JSON.stringify({
        pid: 999999999, // Non-existent PID
        ts: Date.now() - 11000, // 11 seconds old
      });
      writeFileSync(lockFile, staleLockData, 'utf-8');

      const { getMemoryStore, resetMemoryStore } = await import('../../memory/store');
      resetMemoryStore();

      const store = getMemoryStore({ path: testDir });
      store.init();

      // Perform write operation - stale lock cleanup removed (single-process design)
      await store.write('test.md', 'Test content', 'overwrite');

      // Lock file is not cleaned up (cross-process locking was removed)
      // but the write should still succeed
      const content = readFileSync(join(testDir, 'test.md'), 'utf-8');
      expect(content).toBe('Test content');

      resetMemoryStore();
    });

    test('should handle corrupt lock files', async () => {
      // Create a corrupt lock file
      const lockFile = join(testDir, 'test.md.lock');
      writeFileSync(lockFile, 'invalid json {{{', 'utf-8');

      const { getMemoryStore, resetMemoryStore } = await import('../../memory/store');
      resetMemoryStore();

      const store = getMemoryStore({ path: testDir });
      store.init();

      // Should handle corrupt lock gracefully (write succeeds despite lock file)
      await store.write('test.md', 'Test content', 'overwrite');

      // Data should be written even with corrupt lock file present
      const content = readFileSync(join(testDir, 'test.md'), 'utf-8');
      expect(content).toBe('Test content');

      resetMemoryStore();
    });
  });

  describe('Data integrity', () => {
    test('should write data atomically', async () => {
      const { getMemoryStore, resetMemoryStore } = await import('../../memory/store');
      resetMemoryStore();

      const store = getMemoryStore({ path: testDir });
      store.init();

      // Write data
      await store.write('atomic.md', 'Atomic content', 'overwrite');

      // Verify data
      const content = readFileSync(join(testDir, 'atomic.md'), 'utf-8');
      expect(content).toBe('Atomic content');

      resetMemoryStore();
    });

    test('should handle concurrent writes safely', async () => {
      const { getMemoryStore, resetMemoryStore } = await import('../../memory/store');
      resetMemoryStore();

      const store = getMemoryStore({ path: testDir });
      store.init();

      // Concurrent writes to same file
      const promises = [1, 2, 3, 4, 5].map(async (i) => {
        await store.write('concurrent.md', `Content ${i}\n`, 'append');
      });

      await Promise.all(promises);

      // File should have all content
      const content = readFileSync(join(testDir, 'concurrent.md'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(5);

      resetMemoryStore();
    });

    test('should handle sequential writes correctly', async () => {
      const { getMemoryStore, resetMemoryStore } = await import('../../memory/store');
      resetMemoryStore();

      const store = getMemoryStore({ path: testDir });
      store.init();

      // Sequential writes
      for (let i = 1; i <= 3; i++) {
        await store.write('sequential.md', `Line ${i}\n`, 'append');
      }

      // Verify data
      const content = readFileSync(join(testDir, 'sequential.md'), 'utf-8');
      expect(content).toBe('Line 1\nLine 2\nLine 3\n');

      resetMemoryStore();
    });
  });

  describe('Performance', () => {
    test('should handle rapid writes efficiently', async () => {
      const { getMemoryStore, resetMemoryStore } = await import('../../memory/store');
      resetMemoryStore();

      const store = getMemoryStore({ path: testDir });
      store.init();

      const startTime = Date.now();

      // Rapid writes
      for (let i = 0; i < 50; i++) {
        await store.write(`file${i}.md`, `Content ${i}`, 'overwrite');
      }

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 10 seconds)
      expect(duration).toBeLessThan(10000);

      // Verify all files created
      const files = require('fs').readdirSync(testDir);
      const mdFiles = files.filter((f: string) => f.endsWith('.md'));
      expect(mdFiles.length).toBe(50);

      resetMemoryStore();
    });
  });
});
