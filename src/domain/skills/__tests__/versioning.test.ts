import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillVersionStore, type HistoryEntry } from '../versioning';

// ---------------------------------------------------------------------------
// SkillVersionStore
// ---------------------------------------------------------------------------

describe('SkillVersionStore', () => {
  let tempDir: string;
  let store: SkillVersionStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'beeclaw-versioning-'));
    store = new SkillVersionStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── snapshot() ───────────────────────────────────────────────────────────

  describe('snapshot()', () => {
    test('creates a v001.md file and appends to history.jsonl', () => {
      const snap = store.snapshot('greeting', '# Hello World\nSay hi.', 'initial version');

      expect(snap.versionId).toBe('v001');
      expect(snap.skillName).toBe('greeting');
      expect(snap.content).toBe('# Hello World\nSay hi.');
      expect(snap.author).toBe('agent');
      expect(snap.status).toBe('active');
      expect(snap.changeDescription).toBe('initial version');

      // File on disk
      const filePath = join(tempDir, 'greeting', 'v001.md');
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf-8')).toBe('# Hello World\nSay hi.');

      // History JSONL
      const historyPath = join(tempDir, 'greeting', 'history.jsonl');
      expect(existsSync(historyPath)).toBe(true);
      const lines = readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]) as HistoryEntry;
      expect(entry.versionId).toBe('v001');
      expect(entry.status).toBe('active');
    });

    test('increments version numbers v001 -> v002 -> v003', () => {
      const s1 = store.snapshot('summarize', 'v1 content', 'first');
      const s2 = store.snapshot('summarize', 'v2 content', 'second');
      const s3 = store.snapshot('summarize', 'v3 content', 'third');

      expect(s1.versionId).toBe('v001');
      expect(s2.versionId).toBe('v002');
      expect(s3.versionId).toBe('v003');

      // All files exist
      expect(existsSync(join(tempDir, 'summarize', 'v001.md'))).toBe(true);
      expect(existsSync(join(tempDir, 'summarize', 'v002.md'))).toBe(true);
      expect(existsSync(join(tempDir, 'summarize', 'v003.md'))).toBe(true);
    });
  });

  // ── rollback() ───────────────────────────────────────────────────────────

  describe('rollback()', () => {
    test('restores content from a previous version', () => {
      store.snapshot('translate', 'version 1 body', 'v1');
      store.snapshot('translate', 'version 2 body', 'v2');

      const restored = store.rollback('translate', 'v001');
      expect(restored).toBe('version 1 body');
    });

    test('throws when version does not exist', () => {
      store.snapshot('translate', 'content', 'init');

      expect(() => store.rollback('translate', 'v999')).toThrow(
        /Snapshot v999 not found/,
      );
    });
  });

  // ── history() ────────────────────────────────────────────────────────────

  describe('history()', () => {
    test('returns all snapshots in order (newest first)', () => {
      store.snapshot('search', 'a', 'first');
      store.snapshot('search', 'b', 'second');
      store.snapshot('search', 'c', 'third');

      const entries = store.history('search');
      expect(entries).toHaveLength(3);
      // Newest first
      expect(entries[0].versionId).toBe('v003');
      expect(entries[1].versionId).toBe('v002');
      expect(entries[2].versionId).toBe('v001');
    });

    test('respects the limit parameter', () => {
      store.snapshot('search', 'a', 'first');
      store.snapshot('search', 'b', 'second');
      store.snapshot('search', 'c', 'third');

      const entries = store.history('search', 2);
      expect(entries).toHaveLength(2);
      expect(entries[0].versionId).toBe('v003');
      expect(entries[1].versionId).toBe('v002');
    });

    test('returns empty array for non-existent skill', () => {
      const entries = store.history('nonexistent');
      expect(entries).toEqual([]);
    });
  });

  // ── getActiveVersion() ───────────────────────────────────────────────────

  describe('getActiveVersion()', () => {
    test('returns the latest non-discarded version', () => {
      store.snapshot('email', 'v1', 'first');
      store.snapshot('email', 'v2', 'second');
      store.snapshot('email', 'v3', 'third');

      const active = store.getActiveVersion('email');
      expect(active).toBeDefined();
      expect(active!.versionId).toBe('v003');
      expect(active!.content).toBe('v3');
    });

    test('skips discarded versions and returns next active', () => {
      store.snapshot('email', 'v1', 'first');
      store.snapshot('email', 'v2', 'second');
      store.snapshot('email', 'v3', 'third');

      // Discard v003
      store.markDiscarded('email', 'v003', 'poor quality');

      const active = store.getActiveVersion('email');
      expect(active).toBeDefined();
      expect(active!.versionId).toBe('v002');
      expect(active!.content).toBe('v2');
    });

    test('returns undefined when no qualifying snapshot exists', () => {
      const active = store.getActiveVersion('nonexistent');
      expect(active).toBeUndefined();
    });
  });

  // ── markDiscarded() ──────────────────────────────────────────────────────

  describe('markDiscarded()', () => {
    test('updates the status in history.jsonl', () => {
      store.snapshot('calc', 'body', 'init');
      store.markDiscarded('calc', 'v001', 'regression detected');

      const historyPath = join(tempDir, 'calc', 'history.jsonl');
      const lines = readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(2);

      const discardEntry = JSON.parse(lines[1]) as HistoryEntry;
      expect(discardEntry.versionId).toBe('v001');
      expect(discardEntry.status).toBe('discarded');
      expect(discardEntry.changeDescription).toContain('regression detected');
    });
  });

  // ── diff() ───────────────────────────────────────────────────────────────

  describe('diff()', () => {
    test('returns a meaningful diff between two versions', () => {
      store.snapshot('readme', 'line1\nline2\nline3', 'v1');
      store.snapshot('readme', 'line1\nline2-changed\nline3\nline4', 'v2');

      const result = store.diff('readme', 'v001', 'v002');

      // line2-changed and line4 are new in v2
      expect(result.added.length).toBeGreaterThan(0);
      // line2 was removed (replaced) from v1
      expect(result.removed.length).toBeGreaterThan(0);
      // line1 and line3 are unchanged
      expect(result.unchanged).toBeGreaterThanOrEqual(2);
    });

    test('returns empty diff for identical versions', () => {
      store.snapshot('readme', 'same content', 'v1');
      store.snapshot('readme', 'same content', 'v2');

      const result = store.diff('readme', 'v001', 'v002');

      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.unchanged).toBe(1); // single line
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    test('handles non-existent skill directory gracefully for history', () => {
      const entries = store.history('does-not-exist');
      expect(entries).toEqual([]);
    });

    test('handles non-existent skill directory gracefully for getActiveVersion', () => {
      const active = store.getActiveVersion('does-not-exist');
      expect(active).toBeUndefined();
    });
  });
});
