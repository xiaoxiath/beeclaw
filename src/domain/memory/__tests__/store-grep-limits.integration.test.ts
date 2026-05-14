/**
 * Real-fs defence tests for MemoryStore.grep().
 *
 * The grep tool is called by the LLM and runs over the user's entire
 * memory directory. Without limits it is a denial-of-service surface:
 *   - a malicious memory file can be 100 MB
 *   - an attacker (or a buggy importer) can create 10 000 files
 *   - a symlinked directory can produce unbounded recursion
 *   - a single file can have 100 000 matching lines
 * Each of these wedges the event loop and exhausts memory before the
 * agent can return a response.
 *
 * These tests assert the defensive caps:
 *   - file count cap (early stop on traversal)
 *   - per-file matches cap
 *   - per-file size cap (skip oversized files)
 *   - directory depth cap
 *   - truncation indicator in the response
 *
 * Pairs with store-unit.test.ts (mocked fs) which covers the happy path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.unmock('fs');

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { MemoryStore } from '../store';

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function makeStore(base: string): MemoryStore {
  fs.mkdirSync(base, { recursive: true });
  return new MemoryStore({
    type: 'filesystem',
    path: base,
    tools: { enabled: ['memory_grep'], autoRecord: false },
    retention: { conversations: '90d', facts: 'forever', decisions: 'forever' },
  } as never);
}

describe('grep — defensive caps (real fs)', () => {
  let base: string;
  beforeEach(() => { base = mkTmpDir('beeclaw-mem-grep'); });
  afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

  it('caps the file-count results and includes a truncation hint', () => {
    // 200 files all containing the query keyword — far above the 50-file cap.
    for (let i = 0; i < 200; i++) {
      fs.writeFileSync(path.join(base, `note-${String(i).padStart(3, '0')}.md`), `# title\nfindme line ${i}\n`);
    }
    const store = makeStore(base);
    const res = store.grep('findme');
    expect(res.success).toBe(true);
    const data = String(res.data);
    // The result should mention files, but not all 200 of them.
    const fileMentions = (data.match(/note-\d{3}\.md/g) ?? []).length;
    expect(fileMentions).toBeGreaterThan(0);
    expect(fileMentions).toBeLessThanOrEqual(50);
    // Truncation marker tells the caller "refine your query".
    expect(data.toLowerCase()).toMatch(/truncated|more results|early stop/);
  });

  it('caps the match count within a single file', () => {
    // One file with 1000 matching lines.
    const lines = Array.from({ length: 1000 }, (_, i) => `findme on line ${i}`);
    fs.writeFileSync(path.join(base, 'big.md'), lines.join('\n'));
    const store = makeStore(base);
    const res = store.grep('findme');
    expect(res.success).toBe(true);
    const data = String(res.data);
    const lineMentions = (data.match(/^L\d+:/gm) ?? []).length;
    expect(lineMentions).toBeGreaterThan(0);
    expect(lineMentions).toBeLessThanOrEqual(20);
  });

  it('skips files larger than the size cap rather than reading them', () => {
    // 2 MB file — well above the per-file size cap. If the cap is honoured
    // the read is skipped and the query returns no match for this file.
    const big = 'a'.repeat(2_000_000) + '\nfindme inside the giant file\n';
    fs.writeFileSync(path.join(base, 'huge.md'), big);
    // Plus a small file with the keyword so we know grep itself works.
    fs.writeFileSync(path.join(base, 'small.md'), 'findme here\n');
    const store = makeStore(base);
    const res = store.grep('findme');
    expect(res.success).toBe(true);
    const data = String(res.data);
    expect(data).toContain('small.md');
    expect(data).not.toContain('huge.md');
  });

  it('honours a maximum recursion depth so deep trees do not stall', () => {
    // Build a 12-level deep tree with a match at the deepest level.
    let cur = base;
    for (let i = 0; i < 12; i++) {
      cur = path.join(cur, `lvl${i}`);
      fs.mkdirSync(cur, { recursive: true });
    }
    fs.writeFileSync(path.join(cur, 'deep.md'), 'findme way down here\n');
    // And a shallow match so the response isn't empty.
    fs.writeFileSync(path.join(base, 'shallow.md'), 'findme at root\n');

    const store = makeStore(base);
    const res = store.grep('findme');
    expect(res.success).toBe(true);
    const data = String(res.data);
    expect(data).toContain('shallow.md');
    // The deep file should NOT have been reached.
    expect(data).not.toContain('deep.md');
  });

  it('still returns happy-path results for a normal small workspace', () => {
    fs.writeFileSync(path.join(base, 'preferences.md'), '# Prefs\nfavourite color: blue\n');
    fs.writeFileSync(path.join(base, 'notes.md'), '# Notes\nblue sky thinking\n');
    const store = makeStore(base);
    const res = store.grep('blue');
    expect(res.success).toBe(true);
    const data = String(res.data);
    expect(data).toContain('preferences.md');
    expect(data).toContain('notes.md');
    expect(data).toMatch(/L\d+:.*blue/);
  });

  it('returns "(no matches found)" for an empty workspace', () => {
    const store = makeStore(base);
    const res = store.grep('anything');
    expect(res.success).toBe(true);
    expect(res.data).toBe('(no matches found)');
  });
});
