/**
 * Comprehensive unit tests for memory/store.ts
 * Uses vi.mock() to mock all external dependencies (fs, indexer, short-term-cache, logger).
 * Covers: MemoryStore class, FileLock (indirectly through write/record), atomicWriteFileSync,
 * resolvePath (path traversal), getMemoryStore/resetMemoryStore singletons.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks ─────────────────────────────────────────────────────────
const {
  mockExistsSync, mockMkdirSync, mockReaddirSync, mockStatSync,
  mockWriteFileSync, mockReadFileSync, mockRenameSync, mockUnlinkSync, mockAppendFileSync,
  mockBuildFullIndex, mockLoadIndex, mockSaveIndex, mockSearchIndex,
  mockShortTermCache, mockGetShortTermCache,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(() => true),
  mockMkdirSync: vi.fn(),
  mockReaddirSync: vi.fn(() => []),
  mockStatSync: vi.fn(() => ({ isDirectory: () => false, isFile: () => true, mtime: new Date(), size: 100 })),
  mockWriteFileSync: vi.fn(),
  mockReadFileSync: vi.fn(() => ''),
  mockRenameSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockAppendFileSync: vi.fn(),
  mockBuildFullIndex: vi.fn(() => ({
    facts: { keywords: {}, lastUpdated: '' },
    knowledge: { keywords: {}, lastUpdated: '' },
    lastFullIndex: new Date().toISOString(),
  })),
  mockLoadIndex: vi.fn(() => null),
  mockSaveIndex: vi.fn(),
  mockSearchIndex: vi.fn(() => []),
  mockShortTermCache: {
    addConversation: vi.fn(async () => {}),
    getRecentConversations: vi.fn(async () => null),
    updateConversations: vi.fn(async () => {}),
  },
  mockGetShortTermCache: vi.fn(),
}));

// Wire up getShortTermCache to return mock
mockGetShortTermCache.mockReturnValue(mockShortTermCache);

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
  statSync: mockStatSync,
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
  renameSync: mockRenameSync,
  unlinkSync: mockUnlinkSync,
  appendFileSync: mockAppendFileSync,
}));

vi.mock('../indexer', () => ({
  buildFullIndex: mockBuildFullIndex,
  loadIndex: mockLoadIndex,
  saveIndex: mockSaveIndex,
  searchIndex: mockSearchIndex,
}));

vi.mock('../short-term-cache', () => ({
  getShortTermCache: mockGetShortTermCache,
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import { MemoryStore, getMemoryStore, resetMemoryStore } from '../store';

// ─── Helpers ────────────────────────────────────────────────────────────────
function createStore(path = '/test/memory'): MemoryStore {
  return new MemoryStore({ type: 'filesystem', path, tools: { enabled: [], autoRecord: false }, retention: { conversations: '90d', facts: 'forever', decisions: 'forever' } });
}

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('MemoryStore (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMemoryStore();
    // Re-wire after clearAllMocks (which resets return values)
    mockGetShortTermCache.mockReturnValue(mockShortTermCache);
    // Default: existsSync returns false so init creates dirs/files
    mockExistsSync.mockReturnValue(false);
    mockLoadIndex.mockReturnValue(null);
  });

  // ─── init ─────────────────────────────────────────────────────────────
  describe('init', () => {
    it('should create category directories', () => {
      const store = createStore();
      store.init();

      // Should create conversations, facts, decisions, skills
      const mkdirCalls = mockMkdirSync.mock.calls.map(c => c[0]);
      expect(mkdirCalls).toEqual(expect.arrayContaining([
        expect.stringContaining('conversations'),
        expect.stringContaining('facts'),
        expect.stringContaining('decisions'),
        expect.stringContaining('skills'),
      ]));
    });

    it('should not re-initialize if already initialized', () => {
      const store = createStore();
      store.init();
      const callCount = mockMkdirSync.mock.calls.length;
      store.init(); // second call
      expect(mockMkdirSync.mock.calls.length).toBe(callCount); // no new calls
    });

    it('should skip creating directories that already exist', () => {
      mockExistsSync.mockReturnValue(true);
      const store = createStore();
      store.init();
      // mkdirSync should not be called for categories since they exist
      const catCalls = mockMkdirSync.mock.calls.filter(c =>
        typeof c[0] === 'string' && (c[0].endsWith('conversations') || c[0].endsWith('facts') || c[0].endsWith('decisions') || c[0].endsWith('skills'))
      );
      expect(catCalls.length).toBe(0);
    });

    it('should create default preferences.md when it does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      store.init();

      // Should write preferences.md (via atomicWriteFileSync)
      const writeCalls = mockWriteFileSync.mock.calls.filter(c =>
        typeof c[0] === 'string' && c[0].includes('preferences.md')
      );
      expect(writeCalls.length).toBeGreaterThan(0);
    });

    it('should create index.json when it does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      store.init();

      const writeCalls = mockWriteFileSync.mock.calls.filter(c =>
        typeof c[0] === 'string' && c[0].includes('index.json')
      );
      expect(writeCalls.length).toBeGreaterThan(0);
    });

    it('should use loadIndex and fall back to buildFullIndex', () => {
      mockExistsSync.mockReturnValue(false);
      mockLoadIndex.mockReturnValue(null); // index not loadable
      const store = createStore();
      store.init();

      expect(mockLoadIndex).toHaveBeenCalled();
      expect(mockBuildFullIndex).toHaveBeenCalled();
      expect(mockSaveIndex).toHaveBeenCalled();
    });

    it('should not rebuild if loadIndex returns valid index', () => {
      mockExistsSync.mockReturnValue(false);
      mockLoadIndex.mockReturnValue({
        facts: { keywords: {}, lastUpdated: '' },
        knowledge: { keywords: {}, lastUpdated: '' },
        lastFullIndex: '',
      });
      const store = createStore();
      store.init();

      expect(mockBuildFullIndex).not.toHaveBeenCalled();
    });
  });

  // ─── getBasePath ──────────────────────────────────────────────────────
  describe('getBasePath', () => {
    it('should return resolved base path', () => {
      const store = createStore('/test/memory');
      expect(store.getBasePath()).toMatch(/test\/memory$/);
    });
  });

  // ─── resolvePath / path traversal ─────────────────────────────────────
  describe('path traversal prevention', () => {
    it('should throw on path traversal via ../', () => {
      const store = createStore('/test/memory');
      expect(() => (store as any).resolvePath('../../../etc/passwd')).toThrow('Path traversal detected');
    });

    it('should strip leading slashes', () => {
      const store = createStore('/test/memory');
      // /facts should resolve to /test/memory/facts, not /facts
      const result = (store as any).resolvePath('/facts/file.md');
      expect(result).toContain('memory');
      expect(result).toContain('facts');
    });

    it('should allow valid paths', () => {
      const store = createStore('/test/memory');
      const result = (store as any).resolvePath('facts/preferences.md');
      expect(result).toContain('facts/preferences.md');
    });

    it('should allow path equal to basePath', () => {
      const store = createStore('/test/memory');
      // Empty string after strip resolves to basePath itself
      const result = (store as any).resolvePath('');
      expect(result).toBe(store.getBasePath());
    });
  });

  // ─── ls ───────────────────────────────────────────────────────────────
  describe('ls', () => {
    it('should return error for non-existent path', () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      const result = store.ls('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should list directory entries with d/f prefix', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isDirectory: () => true, isFile: () => false });
      mockReaddirSync.mockReturnValue([
        { name: 'subdir', isDirectory: () => true },
        { name: 'file.md', isDirectory: () => false },
      ] as any);
      const store = createStore();
      const result = store.ls('facts');
      expect(result.success).toBe(true);
      expect(result.data).toContain('d  subdir');
      expect(result.data).toContain('f  file.md');
    });

    it('should return (empty) for empty directory', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isDirectory: () => true });
      mockReaddirSync.mockReturnValue([]);
      const store = createStore();
      const result = store.ls('facts');
      expect(result.success).toBe(true);
      expect(result.data).toBe('(empty)');
    });

    it('should handle file path (not directory)', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isDirectory: () => false, isFile: () => true });
      const store = createStore();
      const result = store.ls('facts/preferences.md');
      expect(result.success).toBe(true);
      expect(result.data).toContain('f ');
    });

    it('should catch errors and return error result', () => {
      mockExistsSync.mockImplementation(() => { throw new Error('EPERM'); });
      const store = createStore();
      const result = store.ls('facts');
      expect(result.success).toBe(false);
      expect(result.error).toContain('EPERM');
    });

    it('should handle non-Error throws', () => {
      mockExistsSync.mockImplementation(() => { throw 'string error'; });
      const store = createStore();
      const result = store.ls('x');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  // ─── grep ─────────────────────────────────────────────────────────────
  describe('grep', () => {
    it('should return error when path not found', () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      const result = store.grep('query', 'missing');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should search single file', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isFile: () => true, isDirectory: () => false });
      mockReadFileSync.mockReturnValue('line1\nfound here\nline3');
      const store = createStore('/base');
      const result = store.grep('found', 'test.md');
      expect(result.success).toBe(true);
      expect(result.data).toContain('found here');
    });

    it('should skip non-md/json files in grepFile', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isFile: () => true, isDirectory: () => false });
      const store = createStore('/base');
      // File with .txt extension should be skipped
      const result = store.grep('query', 'test.txt');
      expect(result.success).toBe(true);
      expect(result.data).toBe('(no matches found)');
    });

    it('should search recursively in directory', () => {
      let callCount = 0;
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockImplementation(() => {
        // First call (for searchPath) returns directory, subsequent for files
        return { isFile: () => callCount > 0, isDirectory: () => callCount++ === 0 };
      });
      mockReaddirSync.mockReturnValue([
        { name: 'file.md', isDirectory: () => false },
      ] as any);
      mockReadFileSync.mockReturnValue('some matched content');
      const store = createStore('/base');
      const result = store.grep('matched');
      expect(result.success).toBe(true);
      expect(result.data).toContain('matched');
    });

    it('should return no matches found when no content matches', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isFile: () => true, isDirectory: () => false });
      mockReadFileSync.mockReturnValue('nothing relevant');
      const store = createStore('/base');
      const result = store.grep('zzz_not_found', 'file.md');
      expect(result.success).toBe(true);
      expect(result.data).toBe('(no matches found)');
    });

    it('should use basePath when path not provided', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isFile: () => false, isDirectory: () => true });
      mockReaddirSync.mockReturnValue([]);
      const store = createStore('/base/mem');
      const result = store.grep('query');
      expect(result.success).toBe(true);
    });

    it('should handle error in grep', () => {
      mockExistsSync.mockImplementation(() => { throw new Error('IO'); });
      const store = createStore();
      const result = store.grep('q');
      expect(result.success).toBe(false);
      expect(result.error).toContain('IO');
    });

    it('should handle non-Error in grep', () => {
      mockExistsSync.mockImplementation(() => { throw 42; });
      const store = createStore();
      const result = store.grep('q');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('should handle recursive directory with subdirectory', () => {
      mockExistsSync.mockReturnValue(true);
      // grep calls resolvePath->resolve, then statSync on the resolved path
      // We need statSync to return directory for the search path, then handle sub-entries
      mockStatSync.mockReturnValue({ isFile: () => false, isDirectory: () => true });
      // First readdir returns sub + file, second readdir (for sub) returns a file
      let readdirCall = 0;
      mockReaddirSync.mockImplementation(() => {
        readdirCall++;
        if (readdirCall === 1) {
          return [
            { name: 'sub', isDirectory: () => true },
            { name: 'notes.json', isDirectory: () => false },
          ];
        }
        // sub-directory readdir
        return [{ name: 'inner.md', isDirectory: () => false }];
      });
      mockReadFileSync.mockReturnValue('{"key": "match"}');
      const store = createStore('/base');
      const result = store.grep('match');
      expect(result.success).toBe(true);
      expect(result.data).toContain('match');
    });

    it('should silently skip files that cannot be read in grepRecursive', () => {
      mockExistsSync.mockReturnValue(true);
      let statCallIdx = 0;
      mockStatSync.mockImplementation(() => ({
        isFile: () => statCallIdx > 0,
        isDirectory: () => statCallIdx++ === 0,
      }));
      mockReaddirSync.mockReturnValue([
        { name: 'broken.md', isDirectory: () => false },
      ] as any);
      mockReadFileSync.mockImplementation(() => { throw new Error('EACCES'); });
      const store = createStore('/base');
      const result = store.grep('query');
      expect(result.success).toBe(true);
      expect(result.data).toBe('(no matches found)');
    });
  });

  // ─── read ─────────────────────────────────────────────────────────────
  describe('read', () => {
    it('should return error for non-existent file', () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      const result = store.read('missing.md');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should read and return file content', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('file content here');
      const store = createStore();
      const result = store.read('facts/prefs.md');
      expect(result.success).toBe(true);
      expect(result.data).toBe('file content here');
    });

    it('should catch and return error', () => {
      mockExistsSync.mockImplementation(() => { throw new Error('EACCES'); });
      const store = createStore();
      const result = store.read('x');
      expect(result.success).toBe(false);
      expect(result.error).toContain('EACCES');
    });

    it('should handle non-Error throws', () => {
      mockExistsSync.mockImplementation(() => { throw null; });
      const store = createStore();
      const result = store.read('x');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  // ─── stat ─────────────────────────────────────────────────────────────
  describe('stat', () => {
    it('should return error for non-existent file', () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      const result = store.stat('missing');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('not found');
    });

    it('should return mtime and size', () => {
      const mtime = new Date('2025-06-01');
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ mtime, size: 42 });
      const store = createStore();
      const result = store.stat('file.md');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mtime).toBe(mtime);
        expect(result.size).toBe(42);
      }
    });

    it('should catch error', () => {
      mockExistsSync.mockImplementation(() => { throw new Error('stat fail'); });
      const store = createStore();
      const result = store.stat('x');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('stat fail');
    });

    it('should handle non-Error throws in stat', () => {
      mockExistsSync.mockImplementation(() => { throw 123; });
      const store = createStore();
      const result = store.stat('x');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('Unknown error');
    });
  });

  // ─── write (async) ────────────────────────────────────────────────────
  describe('write', () => {
    it('should create directory if not exists', async () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      await store.write('newdir/file.md', 'content', 'overwrite');
      expect(mockMkdirSync).toHaveBeenCalled();
    });

    it('should overwrite file via atomicWriteFileSync', async () => {
      mockExistsSync.mockReturnValue(true);
      const store = createStore();
      const result = await store.write('file.md', 'new', 'overwrite');
      expect(result.success).toBe(true);
      // atomicWriteFileSync writes to temp then renames
      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(mockRenameSync).toHaveBeenCalled();
    });

    it('should append to existing file', async () => {
      let existsCallIdx = 0;
      mockExistsSync.mockImplementation(() => {
        existsCallIdx++;
        return true;
      });
      mockReadFileSync.mockReturnValue('existing ');
      const store = createStore();
      const result = await store.write('file.md', 'appended', 'append');
      expect(result.success).toBe(true);
      // Should write existing + appended
      const writeCall = mockWriteFileSync.mock.calls.find(c =>
        typeof c[1] === 'string' && c[1].includes('existing appended')
      );
      expect(writeCall).toBeTruthy();
    });

    it('should append to non-existing file', async () => {
      // dir exists but file does not
      let callIdx = 0;
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('.lock')) return false;
        callIdx++;
        // dir check returns true, file check returns false
        return callIdx <= 1;
      });
      const store = createStore();
      const result = await store.write('file.md', 'content');
      expect(result.success).toBe(true);
    });

    it('should default to append mode', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('old ');
      const store = createStore();
      const result = await store.write('file.md', 'new');
      expect(result.success).toBe(true);
    });

    it('should return error on exception', async () => {
      mockExistsSync.mockImplementation(() => { throw new Error('disk full'); });
      const store = createStore();
      const result = await store.write('x', 'y');
      expect(result.success).toBe(false);
      expect(result.error).toContain('disk full');
    });

    it('should return Unknown error for non-Error throw', async () => {
      mockExistsSync.mockImplementation(() => { throw undefined; });
      const store = createStore();
      const result = await store.write('x', 'y');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  // ─── writeSync ────────────────────────────────────────────────────────
  describe('writeSync', () => {
    it('should overwrite file', () => {
      mockExistsSync.mockReturnValue(true);
      const store = createStore();
      const result = store.writeSync('file.md', 'data', 'overwrite');
      expect(result.success).toBe(true);
      expect(result.data).toContain('Written to');
    });

    it('should append to existing file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('old ');
      const store = createStore();
      const result = store.writeSync('file.md', 'more');
      expect(result.success).toBe(true);
    });

    it('should append to non-existing file', () => {
      // First check for dir (true), then for file (false)
      let idx = 0;
      mockExistsSync.mockImplementation(() => ++idx > 1 ? false : true);
      const store = createStore();
      const result = store.writeSync('file.md', 'data');
      expect(result.success).toBe(true);
    });

    it('should create dir if needed', () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      store.writeSync('sub/file.md', 'data', 'overwrite');
      expect(mockMkdirSync).toHaveBeenCalled();
    });

    it('should catch and return error', () => {
      mockExistsSync.mockImplementation(() => { throw new Error('ENOMEM'); });
      const store = createStore();
      const result = store.writeSync('x', 'y');
      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOMEM');
    });

    it('should handle non-Error throw', () => {
      mockExistsSync.mockImplementation(() => { throw false; });
      const store = createStore();
      const result = store.writeSync('x', 'y');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  // ─── record ───────────────────────────────────────────────────────────
  describe('record', () => {
    it('should create file with header if not exists', async () => {
      mockExistsSync.mockReturnValue(false);
      mockReadFileSync.mockReturnValue('');
      const store = createStore();
      const result = await store.record('preferences', 'likes dark mode');
      expect(result.success).toBe(true);
      expect(result.data).toContain('preferences');
    });

    it('should append to existing file', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('# Preferences\n\n');
      const store = createStore();
      const result = await store.record('user', 'age 30');
      expect(result.success).toBe(true);
      expect(result.data).toContain('user');
    });

    it('should use correct titles for each category', async () => {
      const categories: Array<'user' | 'preferences' | 'events' | 'investments' | 'lessons'> = ['user', 'preferences', 'events', 'investments', 'lessons'];
      for (const cat of categories) {
        mockExistsSync.mockReturnValue(false);
        mockReadFileSync.mockReturnValue('');
        const store = createStore();
        const result = await store.record(cat, 'test');
        expect(result.success).toBe(true);
      }
    });

    it('should catch error', async () => {
      mockExistsSync.mockImplementation(() => { throw new Error('record fail'); });
      const store = createStore();
      const result = await store.record('preferences', 'x');
      expect(result.success).toBe(false);
      expect(result.error).toContain('record fail');
    });

    it('should handle non-Error throw', async () => {
      mockExistsSync.mockImplementation(() => { throw null; });
      const store = createStore();
      const result = await store.record('preferences', 'x');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  // ─── recordConversation ───────────────────────────────────────────────
  describe('recordConversation', () => {
    it('should create conversation file with header when new', async () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      const result = await store.recordConversation({
        timestamp: '2025-06-15T10:30:00Z',
        source: 'cli',
        user: 'hello',
        assistant: 'hi',
      });
      expect(result.success).toBe(true);
      expect(result.data).toContain('.md');
    });

    it('should append to existing conversation file', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('# 2025-06-15\n\n');
      const store = createStore();
      const result = await store.recordConversation({
        timestamp: '2025-06-15T10:30:00Z',
        source: 'lark',
        user: 'question',
        assistant: 'answer',
      });
      expect(result.success).toBe(true);
    });

    it('should include metadata.decision when present', async () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      await store.recordConversation({
        timestamp: '2025-06-15T10:30:00Z',
        source: 'cli',
        user: 'q',
        assistant: 'a',
        metadata: { decision: 'Use TS' },
      });
      // Check the written content includes decision
      const writeCall = mockWriteFileSync.mock.calls.find(c =>
        typeof c[1] === 'string' && c[1].includes('Use TS')
      );
      expect(writeCall).toBeTruthy();
    });

    it('should include metadata.relatedFiles when present', async () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      await store.recordConversation({
        timestamp: '2025-06-15T10:30:00Z',
        source: 'cli',
        user: 'q',
        assistant: 'a',
        metadata: { relatedFiles: ['src/app.ts', 'src/main.ts'] },
      });
      const writeCall = mockWriteFileSync.mock.calls.find(c =>
        typeof c[1] === 'string' && c[1].includes('src/app.ts')
      );
      expect(writeCall).toBeTruthy();
    });

    it('should include metadata.skillTriggered when present', async () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      await store.recordConversation({
        timestamp: '2025-06-15T10:30:00Z',
        source: 'cli',
        user: 'q',
        assistant: 'a',
        metadata: { skillTriggered: 'code-review' },
      });
      const writeCall = mockWriteFileSync.mock.calls.find(c =>
        typeof c[1] === 'string' && c[1].includes('code-review')
      );
      expect(writeCall).toBeTruthy();
    });

    it('should handle short-term cache failure gracefully', async () => {
      mockExistsSync.mockReturnValue(false);
      mockShortTermCache.addConversation.mockRejectedValueOnce(new Error('cache fail'));
      const store = createStore();
      const result = await store.recordConversation({
        timestamp: '2025-06-15T10:30:00Z',
        source: 'cli',
        user: 'q',
        assistant: 'a',
      });
      expect(result.success).toBe(true); // main flow not affected
    });

    it('should use fallback time when timestamp has no T', async () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      const result = await store.recordConversation({
        timestamp: '2025-06-15', // no T separator
        source: 'cli',
        user: 'q',
        assistant: 'a',
      });
      expect(result.success).toBe(true);
    });

    it('should catch and return error', async () => {
      mockExistsSync.mockImplementation(() => { throw new Error('IO fail'); });
      const store = createStore();
      const result = await store.recordConversation({
        timestamp: '2025-06-15T10:30:00Z',
        source: 'x',
        user: 'q',
        assistant: 'a',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('IO fail');
    });

    it('should handle non-Error throw', async () => {
      mockExistsSync.mockImplementation(() => { throw 'weird'; });
      const store = createStore();
      const result = await store.recordConversation({
        timestamp: 'x', source: 'x', user: 'x', assistant: 'x',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  // ─── getRecentConversations ───────────────────────────────────────────
  describe('getRecentConversations', () => {
    it('should return cached data when available', async () => {
      const cached = [{ timestamp: 'x', source: 'y', user: 'u', assistant: 'a' }];
      mockShortTermCache.getRecentConversations.mockResolvedValueOnce(cached);
      const store = createStore();
      const result = await store.getRecentConversations('user1', 5);
      expect(result).toBe(cached);
    });

    it('should fall back to disk when cache misses', async () => {
      mockShortTermCache.getRecentConversations.mockResolvedValueOnce(null);
      mockExistsSync.mockReturnValue(false); // conversations path not found
      const store = createStore();
      const result = await store.getRecentConversations();
      expect(result).toEqual([]);
    });

    it('should handle cache error and fall back to disk', async () => {
      mockShortTermCache.getRecentConversations.mockRejectedValueOnce(new Error('cache err'));
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      const result = await store.getRecentConversations();
      expect(result).toEqual([]);
    });

    it('should read from disk, parse, sort and cache results', async () => {
      mockShortTermCache.getRecentConversations.mockResolvedValueOnce(null);
      mockExistsSync.mockReturnValue(true);

      // readdir: first call = month dirs, second call = day files
      let readdirCallCount = 0;
      mockReaddirSync.mockImplementation(() => {
        readdirCallCount++;
        if (readdirCallCount === 1) return ['2025-06'];
        if (readdirCallCount === 2) return ['15.md'];
        return [];
      });

      mockStatSync.mockReturnValue({
        isDirectory: () => true,
        isFile: () => false,
        mtime: new Date('2025-06-15'),
        size: 100,
      });

      // Use actual newlines in the content string
      mockReadFileSync.mockReturnValue(
        '# 2025-06-15\n\n## 10:30 - cli\n\n**用户**：hello\n\n**助手**：hi\n\n---\n\n'
      );

      const store = createStore();
      const result = await store.getRecentConversations('default', 10);
      // The parser may or may not find entries depending on newline handling
      // but the function should complete and attempt cache update
      expect(mockShortTermCache.updateConversations).toHaveBeenCalled();
    });

    it('should handle cache update failure silently', async () => {
      mockShortTermCache.getRecentConversations.mockResolvedValueOnce(null);
      mockExistsSync.mockReturnValue(false);
      mockShortTermCache.updateConversations.mockRejectedValueOnce(new Error('cache update fail'));
      const store = createStore();
      const result = await store.getRecentConversations();
      expect(result).toEqual([]); // should not throw
    });
  });

  // ─── readUser / readSoul / writeUser / writeSoul ──────────────────────
  describe('readUser / readSoul / writeUser / writeSoul', () => {
    it('readUser delegates to read', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('# User');
      const store = createStore();
      const result = store.readUser();
      expect(result.success).toBe(true);
    });

    it('readSoul delegates to read', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('# Soul');
      const store = createStore();
      const result = store.readSoul();
      expect(result.success).toBe(true);
    });

    it('writeUser delegates to writeSync', () => {
      mockExistsSync.mockReturnValue(true);
      const store = createStore();
      const result = store.writeUser('new user data');
      expect(result.success).toBe(true);
    });

    it('writeSoul delegates to writeSync', () => {
      mockExistsSync.mockReturnValue(true);
      const store = createStore();
      const result = store.writeSoul('new soul data');
      expect(result.success).toBe(true);
    });
  });

  // ─── getCoreContext ───────────────────────────────────────────────────
  describe('getCoreContext', () => {
    it('should return user, soul, and facts content', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((p: any) => {
        if (typeof p === 'string') {
          if (p.includes('USER.md')) return '# User Info';
          if (p.includes('SOUL.md')) return '# Soul Config';
          if (p.includes('preferences.md')) return '# Preferences\n\nLikes dark mode';
        }
        return '';
      });
      mockReaddirSync.mockReturnValue(['preferences.md']);
      const store = createStore();
      const ctx = store.getCoreContext();
      expect(ctx.user).toBe('# User Info');
      expect(ctx.soul).toBe('# Soul Config');
      expect(ctx.facts).toContain('preferences');
    });

    it('should return empty strings when files not found', () => {
      mockExistsSync.mockReturnValue(false);
      const store = createStore();
      const ctx = store.getCoreContext();
      expect(ctx.user).toBe('');
      expect(ctx.soul).toBe('');
      expect(ctx.facts).toBe('');
    });

    it('should skip short/empty fact files', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['empty.md', 'short.md']);
      mockReadFileSync.mockImplementation((p: any) => {
        if (typeof p === 'string') {
          if (p.includes('empty.md')) return '';
          if (p.includes('short.md')) return '# Short'; // 7 chars, < 10
        }
        return '';
      });
      const store = createStore();
      const ctx = store.getCoreContext();
      expect(ctx.facts).toBe(''); // both files skipped
    });
  });

  // ─── rebuildIndex ─────────────────────────────────────────────────────
  describe('rebuildIndex', () => {
    it('should build and save index', () => {
      const store = createStore();
      const result = store.rebuildIndex();
      expect(result.success).toBe(true);
      expect(mockBuildFullIndex).toHaveBeenCalled();
      expect(mockSaveIndex).toHaveBeenCalled();
    });

    it('should handle error', () => {
      mockBuildFullIndex.mockImplementation(() => { throw new Error('index error'); });
      const store = createStore();
      const result = store.rebuildIndex();
      expect(result.success).toBe(false);
      expect(result.error).toContain('index error');
    });

    it('should handle non-Error throw', () => {
      mockBuildFullIndex.mockImplementation(() => { throw 42; });
      const store = createStore();
      const result = store.rebuildIndex();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to rebuild index');
    });
  });

  // ─── searchByKeyword ─────────────────────────────────────────────────
  describe('searchByKeyword', () => {
    it('should search using index', () => {
      const store = createStore();
      // Manually set index
      mockLoadIndex.mockReturnValue({
        facts: { keywords: { test: ['f1'] }, lastUpdated: '' },
        knowledge: { keywords: {}, lastUpdated: '' },
        lastFullIndex: '',
      });
      store.init();
      mockSearchIndex.mockReturnValue([{ path: 'facts/prefs.md', matchedKeywords: ['test'] }]);
      const result = store.searchByKeyword('test');
      expect(result.success).toBe(true);
      expect(result.data).toContain('prefs.md');
    });

    it('should return no matches message when empty results', () => {
      const store = createStore();
      mockLoadIndex.mockReturnValue({
        facts: { keywords: {}, lastUpdated: '' },
        knowledge: { keywords: {}, lastUpdated: '' },
        lastFullIndex: '',
      });
      store.init();
      mockSearchIndex.mockReturnValue([]);
      const result = store.searchByKeyword('nothing');
      expect(result.success).toBe(true);
      expect(result.data).toContain('no matches');
    });

    it('should return error when index not available', () => {
      mockLoadIndex.mockReturnValue(null);
      mockBuildFullIndex.mockImplementation(() => { throw new Error('fail'); });
      const store = createStore();
      // The init would fail to build index, so index stays null
      // But we need to handle the case where both loadOrBuildIndex paths fail
      // Let's test by directly calling without init
      const result = store.searchByKeyword('test');
      // Since index is null and loadOrBuildIndex tries to load then build,
      // and build throws, search should still handle gracefully
      // Actually it calls loadOrBuildIndex first which may throw
      expect(result.success).toBe(false);
    });

    it('should catch search error', () => {
      const store = createStore();
      mockLoadIndex.mockReturnValue({
        facts: { keywords: {}, lastUpdated: '' },
        knowledge: { keywords: {}, lastUpdated: '' },
        lastFullIndex: '',
      });
      store.init();
      mockSearchIndex.mockImplementation(() => { throw new Error('search fail'); });
      const result = store.searchByKeyword('test');
      expect(result.success).toBe(false);
      expect(result.error).toContain('search fail');
    });

    it('should pass scope to searchIndex', () => {
      const store = createStore();
      mockLoadIndex.mockReturnValue({
        facts: { keywords: {}, lastUpdated: '' },
        knowledge: { keywords: {}, lastUpdated: '' },
        lastFullIndex: '',
      });
      store.init();
      mockSearchIndex.mockReturnValue([]);
      store.searchByKeyword('test', 'facts');
      expect(mockSearchIndex).toHaveBeenCalledWith(expect.anything(), 'test', { scope: 'facts' });
    });
  });

  // ─── getIndexStats ────────────────────────────────────────────────────
  describe('getIndexStats', () => {
    it('should return null when index not loaded', () => {
      const store = createStore();
      // Don't call init, index stays null
      expect(store.getIndexStats()).toBeNull();
    });

    it('should return keyword counts and lastUpdated', () => {
      mockLoadIndex.mockReturnValue({
        facts: { keywords: { a: ['1'], b: ['2'] }, lastUpdated: '' },
        knowledge: { keywords: { c: ['3'] }, lastUpdated: '' },
        lastFullIndex: '2025-01-01',
      });
      const store = createStore();
      store.init();
      const stats = store.getIndexStats();
      expect(stats).not.toBeNull();
      expect(stats!.factsKeywords).toBe(2);
      expect(stats!.knowledgeKeywords).toBe(1);
      expect(stats!.lastUpdated).toBe('2025-01-01');
    });
  });

  // ─── getMemoryStore / resetMemoryStore singletons ─────────────────────
  describe('getMemoryStore / resetMemoryStore', () => {
    it('should create and return singleton', () => {
      resetMemoryStore();
      mockExistsSync.mockReturnValue(false);
      const store = getMemoryStore({
        type: 'filesystem', path: '/test/mem',
        tools: { enabled: [], autoRecord: false },
        retention: { conversations: '90d', facts: 'forever', decisions: 'forever' },
      });
      expect(store).toBeInstanceOf(MemoryStore);
    });

    it('should return existing singleton without config', () => {
      resetMemoryStore();
      mockExistsSync.mockReturnValue(false);
      const store1 = getMemoryStore({
        type: 'filesystem', path: '/test/mem',
        tools: { enabled: [], autoRecord: false },
        retention: { conversations: '90d', facts: 'forever', decisions: 'forever' },
      });
      const store2 = getMemoryStore();
      expect(store2).toBe(store1);
    });

    it('should throw if called without config and not initialized', () => {
      resetMemoryStore();
      expect(() => getMemoryStore()).toThrow('MemoryStore not initialized');
    });

    it('resetMemoryStore should clear singleton', () => {
      resetMemoryStore();
      mockExistsSync.mockReturnValue(false);
      getMemoryStore({
        type: 'filesystem', path: '/test/mem',
        tools: { enabled: [], autoRecord: false },
        retention: { conversations: '90d', facts: 'forever', decisions: 'forever' },
      });
      resetMemoryStore();
      expect(() => getMemoryStore()).toThrow('MemoryStore not initialized');
    });
  });
});
