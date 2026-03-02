import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { MemoryStore, getMemoryStore, resetMemoryStore } from '../store';
import { executeMemoryTool } from '../tools';
import type { MemoryConfig } from '../types';

const TEST_MEMORY_PATH = './test-memory-data';

const testConfig: MemoryConfig = {
  type: 'filesystem',
  path: TEST_MEMORY_PATH,
  tools: {
    enabled: ['memory_ls', 'memory_grep', 'memory_read', 'memory_write', 'memory_record'],
    autoRecord: true,
  },
  retention: {
    conversations: '90d',
    facts: 'forever',
    decisions: 'forever',
  },
};

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_MEMORY_PATH)) {
      rmSync(TEST_MEMORY_PATH, { recursive: true });
    }
    resetMemoryStore();
    store = getMemoryStore(testConfig);
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_MEMORY_PATH)) {
      rmSync(TEST_MEMORY_PATH, { recursive: true });
    }
  });

  describe('init', () => {
    test('creates directory structure', () => {
      expect(existsSync(join(TEST_MEMORY_PATH, 'conversations'))).toBe(true);
      expect(existsSync(join(TEST_MEMORY_PATH, 'facts'))).toBe(true);
      expect(existsSync(join(TEST_MEMORY_PATH, 'decisions'))).toBe(true);
      expect(existsSync(join(TEST_MEMORY_PATH, 'skills'))).toBe(true);
    });

    test('creates default fact files', () => {
      expect(existsSync(join(TEST_MEMORY_PATH, 'facts', 'preferences.md'))).toBe(true);
      // Note: projects.md is no longer created by default - only preferences.md
    });

    test('creates core memory files (USER.md and SOUL.md)', () => {
      expect(existsSync(join(TEST_MEMORY_PATH, 'USER.md'))).toBe(true);
      expect(existsSync(join(TEST_MEMORY_PATH, 'SOUL.md'))).toBe(true);
    });

    test('creates index file', () => {
      expect(existsSync(join(TEST_MEMORY_PATH, 'index.json'))).toBe(true);
    });
  });

  describe('ls', () => {
    test('lists facts directory', () => {
      const result = store.ls('facts');
      expect(result.success).toBe(true);
      expect(result.data).toContain('preferences.md');
      // Note: projects.md is no longer created by default
    });

    test('lists memory root with USER.md and SOUL.md', () => {
      const result = store.ls('');
      expect(result.success).toBe(true);
      expect(result.data).toContain('USER.md');
      expect(result.data).toContain('SOUL.md');
    });

    test('returns error for non-existent path', () => {
      const result = store.ls('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('grep', () => {
    test('finds content in files', () => {
      // Write some content first
      store.write('facts/preferences.md', '\n- Test Preference\n- Dark Mode\n', 'append');

      const result = store.grep('Test');
      expect(result.success).toBe(true);
      expect(result.data).toContain('Test');
    });

    test('returns no matches message when nothing found', () => {
      const result = store.grep('xyznonexistent123');
      expect(result.success).toBe(true);
      expect(result.data).toContain('no matches');
    });
  });

  describe('read', () => {
    test('reads file content', () => {
      const result = store.read('USER.md');
      expect(result.success).toBe(true);
      expect(result.data).toContain('USER');
    });

    test('returns error for non-existent file', () => {
      const result = store.read('facts/nonexistent.md');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('write', () => {
    test('appends to file', () => {
      const result = store.write('facts/preferences.md', '\n- New fact', 'append');
      expect(result.success).toBe(true);

      const content = readFileSync(join(TEST_MEMORY_PATH, 'facts', 'preferences.md'), 'utf-8');
      expect(content).toContain('New fact');
    });

    test('overwrites file', () => {
      const result = store.write('facts/preferences.md', 'New content', 'overwrite');
      expect(result.success).toBe(true);

      const content = readFileSync(join(TEST_MEMORY_PATH, 'facts', 'preferences.md'), 'utf-8');
      expect(content).toBe('New content');
    });

    test('creates directory if not exists', () => {
      const result = store.write('facts/newdir/file.md', 'content', 'overwrite');
      expect(result.success).toBe(true);
      expect(existsSync(join(TEST_MEMORY_PATH, 'facts', 'newdir', 'file.md'))).toBe(true);
    });
  });

  describe('record', () => {
    test('records fact in preferences category', () => {
      const result = store.record('preferences', 'Likes Alice');
      expect(result.success).toBe(true);

      const content = readFileSync(join(TEST_MEMORY_PATH, 'facts', 'preferences.md'), 'utf-8');
      expect(content).toContain('Likes Alice');
    });

    test('records fact with timestamp', () => {
      store.record('preferences', 'Likes dark mode');

      const content = readFileSync(join(TEST_MEMORY_PATH, 'facts', 'preferences.md'), 'utf-8');
      expect(content).toContain('Likes dark mode');
      expect(content).toMatch(/\d{4}-\d{2}-\d{2}/); // Date pattern
    });
  });

  describe('recordConversation', () => {
    test('records conversation entry', () => {
      const entry = {
        timestamp: new Date().toISOString(),
        source: 'cli',
        user: 'Hello',
        assistant: 'Hi there!',
      };

      const result = store.recordConversation(entry);
      expect(result.success).toBe(true);

      const date = new Date();
      const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const day = String(date.getDate()).padStart(2, '0');
      const filePath = join(TEST_MEMORY_PATH, 'conversations', yearMonth, `${day}.md`);

      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('Hello');
      expect(content).toContain('Hi there!');
    });

    test('records conversation with metadata', () => {
      const entry = {
        timestamp: new Date().toISOString(),
        source: 'cli',
        user: 'Help me code',
        assistant: 'Sure!',
        metadata: {
          decision: 'Use TypeScript',
          relatedFiles: ['src/app.ts'],
        },
      };

      store.recordConversation(entry);

      const date = new Date();
      const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const day = String(date.getDate()).padStart(2, '0');
      const filePath = join(TEST_MEMORY_PATH, 'conversations', yearMonth, `${day}.md`);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('Use TypeScript');
      expect(content).toContain('src/app.ts');
    });
  });
});

describe('Memory Tools', () => {
  beforeEach(() => {
    if (existsSync(TEST_MEMORY_PATH)) {
      rmSync(TEST_MEMORY_PATH, { recursive: true });
    }
    resetMemoryStore();
    getMemoryStore(testConfig);
  });

  afterEach(() => {
    if (existsSync(TEST_MEMORY_PATH)) {
      rmSync(TEST_MEMORY_PATH, { recursive: true });
    }
  });

  test('memory_ls tool', () => {
    const result = executeMemoryTool('memory_ls', { path: 'facts' });
    expect(result.success).toBe(true);
  });

  test('memory_grep tool', () => {
    executeMemoryTool('memory_write', { file: 'facts/preferences.md', content: '\n- Test Preference\n' });
    const result = executeMemoryTool('memory_grep', { query: 'Test' });
    expect(result.success).toBe(true);
    expect(result.data).toContain('Test');
  });

  test('memory_read tool', () => {
    const result = executeMemoryTool('memory_read', { file: 'USER.md' });
    expect(result.success).toBe(true);
    expect(result.data).toContain('USER');
  });

  test('memory_write tool', () => {
    const result = executeMemoryTool('memory_write', {
      file: 'facts/preferences.md',
      content: '\n- New preference\n',
      mode: 'append',
    });
    expect(result.success).toBe(true);
  });

  test('memory_record tool', () => {
    const result = executeMemoryTool('memory_record', {
      category: 'preferences',
      fact: 'Likes dark mode',
    });
    expect(result.success).toBe(true);

    const readResult = executeMemoryTool('memory_read', { file: 'facts/preferences.md' });
    expect(readResult.data).toContain('Likes dark mode');
  });

  test('invalid tool returns error', () => {
    const result = executeMemoryTool('invalid_tool', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  test('invalid params returns error', () => {
    const result = executeMemoryTool('memory_ls', {}); // missing path
    expect(result.success).toBe(false);
  });
});
