import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { MemoryStore } from '../store';

const TEST_MEMORY_PATH = './test-p0-patch';

describe('P0 Patch Validation', () => {
  let store: MemoryStore;

  beforeEach(() => {
    if (existsSync(TEST_MEMORY_PATH)) {
      rmSync(TEST_MEMORY_PATH, { recursive: true });
    }
    store = new MemoryStore({
      type: 'filesystem',
      path: TEST_MEMORY_PATH,
      tools: { enabled: [] },
      retention: { conversations: 'forever' },
    });
    store.init();
  });

  afterEach(() => {
    if (existsSync(TEST_MEMORY_PATH)) {
      rmSync(TEST_MEMORY_PATH, { recursive: true });
    }
  });

  describe('P0-#10: Path Traversal Prevention', () => {
    test('blocks simple path traversal', () => {
      const result = store.read('../../../etc/passwd');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Path traversal detected');
    });

    test('absolute paths are treated as relative (stripped)', () => {
      // Absolute paths like /etc/passwd get stripped to etc/passwd
      // and resolved under basePath, so they're safe
      const result = store.read('/etc/passwd');
      // Should fail because file doesn't exist, not because of traversal
      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    test('allows valid relative paths', () => {
      // This should work - normal path within memory
      const result = store.read('facts/preferences.md');
      expect(result.success).toBe(true);
    });
  });

  describe('P0-#9: Concurrency Safety', () => {
    test('write() is now async', async () => {
      const result = await store.write('facts/test.md', 'Test content', 'overwrite');
      expect(result.success).toBe(true);
      expect(existsSync(join(TEST_MEMORY_PATH, 'facts', 'test.md'))).toBe(true);
    });

    test('record() is now async', async () => {
      const result = await store.record('preferences', 'Test preference');
      expect(result.success).toBe(true);
    });

    test('recordConversation() is now async', async () => {
      const result = await store.recordConversation({
        timestamp: new Date().toISOString(),
        source: 'test',
        user: 'test user message',
        assistant: 'test assistant message',
      });
      expect(result.success).toBe(true);
    });

    test('concurrent writes do not corrupt data', async () => {
      // Write to the same file concurrently
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(store.write('facts/concurrent.md', `Line ${i}\n`, 'append'));
      }

      const results = await Promise.all(promises);
      const allSuccess = results.every(r => r.success);
      expect(allSuccess).toBe(true);

      // Verify file exists and has content
      const readResult = store.read('facts/concurrent.md');
      expect(readResult.success).toBe(true);
      expect(readResult.data).toContain('Line');
    });
  });

  describe('Backward Compatibility', () => {
    test('writeSync() still works for sync callers', () => {
      const result = store.writeSync('facts/sync-test.md', 'Sync content', 'overwrite');
      expect(result.success).toBe(true);
      expect(existsSync(join(TEST_MEMORY_PATH, 'facts', 'sync-test.md'))).toBe(true);
    });

    test('ls(), grep(), read() remain synchronous', () => {
      // These methods should remain sync
      const lsResult = store.ls('facts');
      expect(lsResult.success).toBe(true);

      const writeResult = store.writeSync('facts/test.md', 'Test', 'overwrite');
      expect(writeResult.success).toBe(true);

      const grepResult = store.grep('Test');
      expect(grepResult.success).toBe(true);

      const readResult = store.read('facts/test.md');
      expect(readResult.success).toBe(true);
    });
  });
});
