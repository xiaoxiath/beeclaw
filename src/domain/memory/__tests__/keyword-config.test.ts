import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.unmock('fs');

// Capture warn calls so we can assert the loader's graceful-degradation
// path produced an actionable log line for the operator.
const warnCalls: unknown[][] = [];
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn((...args: unknown[]) => { warnCalls.push(args); }),
    error: vi.fn(),
    debug: vi.fn(),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import {
  KeywordPatternConfigSchema,
  KEYWORD_CONFIG_FILENAME,
  getDefaultKeywordConfig,
  loadKeywordConfig,
  compilePatterns,
  type KeywordPattern,
} from '../keyword-config';
import { extractKeywords } from '../indexer';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'beeclaw-kw-'));
}

beforeEach(() => { warnCalls.length = 0; });

describe('KeywordPatternConfigSchema', () => {
  it('rejects an empty regex string', () => {
    const r = KeywordPatternConfigSchema.safeParse({
      patterns: [{ label: 'bad', regex: '' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects a missing label', () => {
    const r = KeywordPatternConfigSchema.safeParse({
      patterns: [{ regex: 'foo' }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts a minimal valid config and fills in defaults', () => {
    const r = KeywordPatternConfigSchema.safeParse({
      patterns: [{ label: 'l', regex: 'r' }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.locale).toBe('zh-CN');
      expect(r.data.stopWords).toEqual([]);
      expect(r.data.patterns[0].flags).toBe('g');
    }
  });
});

describe('getDefaultKeywordConfig', () => {
  it('returns a non-empty pattern list and stop-word list', () => {
    const cfg = getDefaultKeywordConfig();
    expect(cfg.patterns.length).toBeGreaterThan(0);
    expect(cfg.stopWords.length).toBeGreaterThan(0);
    expect(cfg.locale).toBe('zh-CN');
  });

  it('returns a fresh object on each call (no shared mutation hazard)', () => {
    const a = getDefaultKeywordConfig();
    const b = getDefaultKeywordConfig();
    a.stopWords.push('mutated');
    expect(b.stopWords).not.toContain('mutated');
  });
});

describe('loadKeywordConfig — file presence', () => {
  let dir: string;
  beforeEach(() => { dir = mkTmp(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns defaults silently when the override file is missing', () => {
    const cfg = loadKeywordConfig(dir);
    expect(cfg.locale).toBe('zh-CN');
    expect(cfg.patterns.length).toBeGreaterThan(0);
    expect(warnCalls).toHaveLength(0);
  });

  it('loads a valid override file', () => {
    const override = {
      locale: 'en-US',
      patterns: [
        { label: 'projects', regex: '\\b(beeclaw|claude)\\b', flags: 'gi' },
      ],
      stopWords: ['the', 'foo'],
    };
    fs.writeFileSync(
      path.join(dir, KEYWORD_CONFIG_FILENAME),
      JSON.stringify(override),
    );
    const cfg = loadKeywordConfig(dir);
    expect(cfg.locale).toBe('en-US');
    expect(cfg.patterns).toHaveLength(1);
    expect(cfg.patterns[0].label).toBe('projects');
    expect(cfg.stopWords).toEqual(['the', 'foo']);
  });

  it('falls back to defaults + warn on malformed JSON', () => {
    fs.writeFileSync(path.join(dir, KEYWORD_CONFIG_FILENAME), '{ not valid');
    const cfg = loadKeywordConfig(dir);
    expect(cfg.patterns).toEqual(getDefaultKeywordConfig().patterns);
    expect(warnCalls.length).toBe(1);
    expect(String(warnCalls[0][0])).toMatch(/could not be loaded/i);
  });

  it('falls back to defaults + warn on schema-invalid JSON', () => {
    fs.writeFileSync(
      path.join(dir, KEYWORD_CONFIG_FILENAME),
      JSON.stringify({ patterns: [{ label: 'no-regex' }] }),
    );
    const cfg = loadKeywordConfig(dir);
    expect(cfg.patterns).toEqual(getDefaultKeywordConfig().patterns);
    expect(warnCalls.length).toBe(1);
    expect(String(warnCalls[0][0])).toMatch(/schema validation/i);
  });
});

describe('compilePatterns', () => {
  it('compiles every valid pattern', () => {
    const patterns: KeywordPattern[] = [
      { label: 'a', regex: 'foo', flags: 'g' },
      { label: 'b', regex: '\\d+', flags: 'g' },
    ];
    const compiled = compilePatterns(patterns);
    expect(compiled).toHaveLength(2);
    expect(compiled[0].source).toBe('foo');
  });

  it('skips invalid regex with a warning rather than throwing', () => {
    const patterns: KeywordPattern[] = [
      { label: 'good', regex: 'ok', flags: 'g' },
      { label: 'bad', regex: '[invalid', flags: 'g' },
    ];
    const compiled = compilePatterns(patterns);
    expect(compiled).toHaveLength(1);
    expect(warnCalls.length).toBe(1);
    expect(String(warnCalls[0][0])).toMatch(/skipping invalid keyword pattern "bad"/);
  });
});

describe('extractKeywords — uses config when supplied', () => {
  it('default config still recognises built-in CN domain terms (back-compat)', () => {
    const out = extractKeywords('我在百度做前端，关心 React 和 期权');
    expect(out).toContain('百度');
    expect(out).toContain('前端');
    expect(out).toContain('React');
    expect(out).toContain('期权');
  });

  it('extracts only with custom patterns when an override config is supplied', () => {
    const cfg = {
      locale: 'en-US',
      patterns: [{ label: 'projects', regex: '\\b(alpha|bravo)\\b', flags: 'gi' }],
      stopWords: ['the', 'and'],
    };
    const out = extractKeywords('Project Alpha is bigger than the bravo team', cfg);
    expect(out).toContain('alpha');
    expect(out).toContain('bravo');
    expect(out).not.toContain('the');
    // Built-in CN patterns are NOT applied because config override doesn't include them.
    expect(out).not.toContain('百度');
  });

  it('honours custom stop words on the English path', () => {
    const cfg = {
      locale: 'en-US',
      patterns: [],
      stopWords: ['react', 'vue'],
    };
    const out = extractKeywords('react and vue and angular', cfg);
    expect(out).not.toContain('react');
    expect(out).not.toContain('vue');
    expect(out).toContain('angular');
  });
});
