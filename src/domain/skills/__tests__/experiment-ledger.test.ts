import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExperimentLedger, type LedgerRow } from '../experiment-ledger';

// ---------------------------------------------------------------------------
// ExperimentLedger
// ---------------------------------------------------------------------------

describe('ExperimentLedger', () => {
  let tempDir: string;
  let ledger: ExperimentLedger;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'beeclaw-ledger-'));
    ledger = new ExperimentLedger(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── log() ────────────────────────────────────────────────────────────────

  describe('log()', () => {
    test('appends a TSV row to results.tsv', () => {
      ledger.log('greeting', 0.85, 0.9, 12.5, 'v001', 'keep', 'Initial version');

      const content = readFileSync(join(tempDir, 'results.tsv'), 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      // First line is the header
      expect(lines[0]).toContain('timestamp');
      expect(lines[0]).toContain('skill');
      expect(lines[0]).toContain('composite_score');

      // Second line is the data row
      expect(lines).toHaveLength(2);
      const parts = lines[1].split('\t');
      expect(parts[1]).toBe('greeting');
      expect(parts[2]).toBe('v001');
      expect(parts[3]).toBe('0.8500');
      expect(parts[4]).toBe('0.9000');
      expect(parts[5]).toBe('12.5000');
      expect(parts[6]).toBe('keep');
      expect(parts[7]).toBe('Initial version');
    });

    test('appends multiple rows without repeating the header', () => {
      ledger.log('skill-a', 0.7, 0.8, 10, 'v001', 'keep', 'first');
      ledger.log('skill-b', 0.6, 0.5, 20, 'v001', 'discard', 'second');

      const content = readFileSync(join(tempDir, 'results.tsv'), 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      // 1 header + 2 data rows
      expect(lines).toHaveLength(3);
      // Only the first line should be the header
      expect(lines[0]).toMatch(/^timestamp\t/);
      expect(lines[1]).not.toMatch(/^timestamp\t/);
    });

    test('replaces tab characters in description field with spaces', () => {
      ledger.log('skill-a', 0.5, 0.5, 10, 'v001', 'keep', 'has\ttab\there');

      const content = readFileSync(join(tempDir, 'results.tsv'), 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const dataLine = lines[1];

      // The description field (last column) should have no tabs
      // Split by tab to get columns; the description is column index 7
      const parts = dataLine.split('\t');
      expect(parts[7]).toBe('has tab here');
      // Ensure no raw tabs leaked into the description
      expect(parts[7]).not.toContain('\t');
    });
  });

  // ── getHistory() ─────────────────────────────────────────────────────────

  describe('getHistory()', () => {
    test('parses TSV rows correctly', () => {
      ledger.log('greeting', 0.85, 0.9, 12.5, 'v001', 'keep', 'desc one');
      ledger.log('greeting', 0.75, 0.8, 14.0, 'v002', 'discard', 'desc two');

      const rows: LedgerRow[] = ledger.getHistory();
      expect(rows).toHaveLength(2);

      expect(rows[0].skill).toBe('greeting');
      expect(rows[0].version).toBe('v001');
      expect(rows[0].compositeScore).toBeCloseTo(0.85, 3);
      expect(rows[0].successRate).toBeCloseTo(0.9, 3);
      expect(rows[0].complexity).toBeCloseTo(12.5, 3);
      expect(rows[0].status).toBe('keep');
      expect(rows[0].description).toBe('desc one');

      expect(rows[1].skill).toBe('greeting');
      expect(rows[1].version).toBe('v002');
      expect(rows[1].status).toBe('discard');
    });

    test('filters by skill name', () => {
      ledger.log('alpha', 0.8, 0.9, 10, 'v001', 'keep', 'a');
      ledger.log('beta', 0.6, 0.5, 20, 'v001', 'keep', 'b');
      ledger.log('alpha', 0.9, 0.95, 8, 'v002', 'keep', 'c');

      const alphaRows = ledger.getHistory('alpha');
      expect(alphaRows).toHaveLength(2);
      expect(alphaRows.every((r) => r.skill === 'alpha')).toBe(true);

      const betaRows = ledger.getHistory('beta');
      expect(betaRows).toHaveLength(1);
      expect(betaRows[0].skill).toBe('beta');
    });

    test('returns empty array when no ledger file exists', () => {
      const freshLedger = new ExperimentLedger(join(tempDir, 'empty-subdir'));
      const rows = freshLedger.getHistory();
      expect(rows).toEqual([]);
    });
  });

  // ── getTrend() ───────────────────────────────────────────────────────────

  describe('getTrend()', () => {
    test('returns correct trend analysis (composite scores oldest to newest)', () => {
      ledger.log('skill-x', 0.5, 0.6, 10, 'v001', 'keep', 'a');
      ledger.log('skill-x', 0.6, 0.7, 10, 'v002', 'keep', 'b');
      ledger.log('skill-x', 0.8, 0.9, 10, 'v003', 'keep', 'c');

      const trend = ledger.getTrend('skill-x');
      expect(trend).toHaveLength(3);
      expect(trend[0]).toBeCloseTo(0.5, 3);
      expect(trend[1]).toBeCloseTo(0.6, 3);
      expect(trend[2]).toBeCloseTo(0.8, 3);
    });

    test('respects lastN parameter', () => {
      ledger.log('skill-x', 0.1, 0.2, 10, 'v001', 'keep', 'a');
      ledger.log('skill-x', 0.2, 0.3, 10, 'v002', 'keep', 'b');
      ledger.log('skill-x', 0.3, 0.4, 10, 'v003', 'keep', 'c');
      ledger.log('skill-x', 0.4, 0.5, 10, 'v004', 'keep', 'd');

      const trend = ledger.getTrend('skill-x', 2);
      expect(trend).toHaveLength(2);
      // Should be the last 2 entries
      expect(trend[0]).toBeCloseTo(0.3, 3);
      expect(trend[1]).toBeCloseTo(0.4, 3);
    });

    test('returns empty array for unknown skill', () => {
      const trend = ledger.getTrend('nonexistent');
      expect(trend).toEqual([]);
    });
  });
});
