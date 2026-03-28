import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock memory store
const mockStore = {
  grep: vi.fn(),
  ls: vi.fn(),
  read: vi.fn(),
  stat: vi.fn(),
};

vi.mock('@/domain/memory', () => ({
  getMemoryStore: () => mockStore,
}));

import memoryRoutes from '../memory';

// Helper to make requests using Hono's test client approach
function createApp() {
  return memoryRoutes;
}

describe('Memory Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET / with search param ───
  describe('GET / (search)', () => {
    it('returns search results when search param is provided', async () => {
      const app = createApp();
      mockStore.grep.mockResolvedValue({
        success: true,
        data: '📄 notes/todo.md\nL5: buy milk\n\n---\n\n📄 notes/work.md\nL10: meeting notes',
      });

      const res = await app.request('/?search=milk');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entries).toHaveLength(2);
      expect(json.entries[0].path).toBe('notes/todo.md');
      expect(json.entries[0].matches).toHaveLength(1);
      expect(json.entries[0].matches[0]).toEqual({ line: 5, content: 'buy milk' });
      expect(json.entries[1].path).toBe('notes/work.md');
      expect(json.query).toEqual({ search: 'milk' });
      expect(json.total).toBe(2);
    });

    it('returns empty results for no matches', async () => {
      const app = createApp();
      mockStore.grep.mockResolvedValue({
        success: true,
        data: '(no matches found)',
      });

      const res = await app.request('/?search=nonexistent');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entries).toEqual([]);
      expect(json.total).toBe(0);
    });

    it('returns empty entries when grep data is empty', async () => {
      const app = createApp();
      mockStore.grep.mockResolvedValue({
        success: true,
        data: '',
      });

      const res = await app.request('/?search=foo');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entries).toEqual([]);
    });

    it('returns empty entries when grep success is false', async () => {
      const app = createApp();
      mockStore.grep.mockResolvedValue({
        success: false,
        data: null,
      });

      const res = await app.request('/?search=foo');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entries).toEqual([]);
    });

    it('handles grep results with non-matching line format', async () => {
      const app = createApp();
      mockStore.grep.mockResolvedValue({
        success: true,
        data: '📄 notes/file.md\nSome non-matching line\nL3: actual match',
      });

      const res = await app.request('/?search=test');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entries).toHaveLength(1);
      // Only L3 line matches the regex; the other line is filtered out as null
      expect(json.entries[0].matches).toHaveLength(1);
    });
  });

  // ─── GET / with path param ───
  describe('GET / (path)', () => {
    it('returns directory listing for path', async () => {
      const app = createApp();
      mockStore.ls.mockResolvedValue({
        success: true,
        data: 'd notes\nf readme.md',
      });

      const res = await app.request('/?path=/docs');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.path).toBe('/docs');
      expect(json.entries).toHaveLength(2);
      expect(json.entries[0].type).toBe('directory');
      expect(json.entries[0].path).toBe('/docs/notes');
      expect(json.entries[1].type).toBe('file');
      expect(json.total).toBe(2);
    });

    it('returns 404 when ls fails', async () => {
      const app = createApp();
      mockStore.ls.mockResolvedValue({
        success: false,
        error: 'Path not found',
      });

      const res = await app.request('/?path=/nonexistent');
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Failed to list path');
    });

    it('returns empty entries when ls data is empty', async () => {
      const app = createApp();
      mockStore.ls.mockResolvedValue({
        success: true,
        data: '',
      });

      const res = await app.request('/?path=/empty');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entries).toEqual([]);
    });

    it('handles root path correctly', async () => {
      const app = createApp();
      mockStore.ls.mockResolvedValue({
        success: true,
        data: 'd mydir',
      });

      const res = await app.request('/?path=/');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entries[0].path).toBe('/mydir');
    });
  });

  // ─── GET / (list all) ───
  describe('GET / (list all categories)', () => {
    it('returns all memory entries grouped by category', async () => {
      const app = createApp();
      mockStore.ls.mockResolvedValue({
        success: true,
        data: 'd notes\nd projects\nf readme.md',
      });

      const res = await app.request('/');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entries).toHaveLength(3);
      expect(json.total).toBe(3);
      expect(json.byCategory).toBeDefined();
      expect(json.byCategory.notes).toBeDefined();
    });

    it('returns 500 when ls / fails', async () => {
      const app = createApp();
      mockStore.ls.mockResolvedValue({
        success: false,
        error: 'Disk error',
      });

      const res = await app.request('/');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to list memory');
    });

    it('returns empty when ls data is falsy', async () => {
      const app = createApp();
      mockStore.ls.mockResolvedValue({
        success: true,
        data: null,
      });

      const res = await app.request('/');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entries).toEqual([]);
      expect(json.total).toBe(0);
    });

    it('returns 500 on thrown error', async () => {
      const app = createApp();
      mockStore.ls.mockRejectedValue(new Error('Unexpected crash'));

      const res = await app.request('/');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe(true);
      expect(json.message).toBe('Unexpected crash');
    });

    it('handles non-Error thrown objects', async () => {
      const app = createApp();
      mockStore.ls.mockRejectedValue('string error');

      const res = await app.request('/');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.message).toBe('Unknown error');
    });
  });

  // ─── GET /* (specific entry) ───
  describe('GET /* (specific entry)', () => {
    it('returns a file entry when read succeeds', async () => {
      const app = createApp();
      mockStore.read.mockResolvedValue({
        success: true,
        data: '# My Note\nSome content here',
      });
      mockStore.stat.mockReturnValue({
        success: true,
        mtime: new Date('2024-01-15T10:00:00Z'),
      });

      const res = await app.request('/api/memory/notes/todo.md');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entry.path).toBe('notes/todo.md');
      expect(json.entry.content).toBe('# My Note\nSome content here');
      expect(json.entry.type).toBe('file');
      expect(json.entry.updatedAt).toBe('2024-01-15T10:00:00.000Z');
    });

    it('uses current time when stat fails', async () => {
      const app = createApp();
      mockStore.read.mockResolvedValue({
        success: true,
        data: 'content',
      });
      mockStore.stat.mockReturnValue({
        success: false,
      });

      const res = await app.request('/api/memory/notes/test.md');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entry.updatedAt).toBeDefined();
    });

    it('returns directory listing for EISDIR error', async () => {
      const app = createApp();
      mockStore.read.mockResolvedValue({
        success: false,
        error: 'EISDIR: is a directory',
      });
      mockStore.ls.mockResolvedValue({
        success: true,
        data: 'f file1.md\nd subdir',
      });

      const res = await app.request('/api/memory/notes');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.type).toBe('directory');
      expect(json.entries).toHaveLength(2);
    });

    it('returns directory listing for "directory" error', async () => {
      const app = createApp();
      mockStore.read.mockResolvedValue({
        success: false,
        error: 'Path is a directory',
      });
      mockStore.ls.mockResolvedValue({
        success: true,
        data: 'f item.md',
      });

      const res = await app.request('/api/memory/mydir');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.type).toBe('directory');
    });

    it('returns 404 when directory listing fails', async () => {
      const app = createApp();
      mockStore.read.mockResolvedValue({
        success: false,
        error: 'EISDIR: is a directory',
      });
      mockStore.ls.mockResolvedValue({
        success: false,
        error: 'Cannot list',
      });

      const res = await app.request('/api/memory/baddir');
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Failed to list directory');
    });

    it('handles empty directory listing', async () => {
      const app = createApp();
      mockStore.read.mockResolvedValue({
        success: false,
        error: 'EISDIR: is a directory',
      });
      mockStore.ls.mockResolvedValue({
        success: true,
        data: '(empty)',
      });

      const res = await app.request('/api/memory/emptydir');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entries).toEqual([]);
    });

    it('filters out empty names from directory listing', async () => {
      const app = createApp();
      mockStore.read.mockResolvedValue({
        success: false,
        error: 'EISDIR: is a directory',
      });
      mockStore.ls.mockResolvedValue({
        success: true,
        data: 'f file1.md\nf \nf (empty)',
      });

      const res = await app.request('/api/memory/somedir');
      const json = await res.json();

      expect(res.status).toBe(200);
      // Only file1.md should survive the filter
      expect(json.entries).toHaveLength(1);
    });

    it('returns 404 when entry not found', async () => {
      const app = createApp();
      mockStore.read.mockResolvedValue({
        success: false,
        error: 'File not found',
      });

      const res = await app.request('/api/memory/nonexistent.md');
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Not found');
    });

    it('returns 404 with default message when no error info', async () => {
      const app = createApp();
      mockStore.read.mockResolvedValue({
        success: false,
      });

      const res = await app.request('/api/memory/noentry');
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.message).toBe('Memory entry not found');
    });

    it('returns 404 when read returns null', async () => {
      const app = createApp();
      mockStore.read.mockResolvedValue(null);

      const res = await app.request('/api/memory/nullentry');
      const json = await res.json();

      expect(res.status).toBe(404);
    });

    it('returns 500 on thrown error', async () => {
      const app = createApp();
      mockStore.read.mockRejectedValue(new Error('Read crash'));

      const res = await app.request('/api/memory/crash');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.message).toBe('Read crash');
    });

    it('handles non-Error thrown objects in wildcard route', async () => {
      const app = createApp();
      mockStore.read.mockRejectedValue('string thrown');

      const res = await app.request('/api/memory/crash2');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.message).toBe('Unknown error');
    });

    it('decodes URL-encoded paths', async () => {
      const app = createApp();
      mockStore.read.mockResolvedValue({
        success: true,
        data: 'content',
      });
      mockStore.stat.mockReturnValue({ success: false });

      const res = await app.request('/api/memory/notes%2Fdeep%2Ffile.md');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.entry.path).toBe('notes/deep/file.md');
    });
  });

  // ─── DELETE /* ───
  describe('DELETE /*', () => {
    it('returns 501 not supported', async () => {
      const app = createApp();

      const res = await app.request('/api/memory/notes/test.md', { method: 'DELETE' });
      const json = await res.json();

      expect(res.status).toBe(501);
      expect(json.error).toBe(true);
      expect(json.message).toContain('not yet supported');
    });
  });
});
