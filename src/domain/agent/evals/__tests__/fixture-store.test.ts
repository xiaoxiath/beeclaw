import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.unmock('fs');

import { FixtureStore, computePromptHash } from '../fixture-store';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'beeclaw-fixture-'));
}

describe('computePromptHash', () => {
  it('is deterministic for identical inputs', () => {
    const a = computePromptHash({ systemPrompt: 'sp', userMessage: 'um', model: 'm' });
    const b = computePromptHash({ systemPrompt: 'sp', userMessage: 'um', model: 'm' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when any input changes', () => {
    const base = computePromptHash({ systemPrompt: 'sp', userMessage: 'um', model: 'm' });
    expect(computePromptHash({ systemPrompt: 'sp.', userMessage: 'um', model: 'm' })).not.toBe(base);
    expect(computePromptHash({ systemPrompt: 'sp', userMessage: 'um.', model: 'm' })).not.toBe(base);
    expect(computePromptHash({ systemPrompt: 'sp', userMessage: 'um', model: 'm.' })).not.toBe(base);
  });
});

describe('FixtureStore — save / load round-trip', () => {
  let dir: string;
  beforeEach(() => { dir = mkTmp(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('save then load returns the fixture verbatim', () => {
    const store = new FixtureStore(dir);
    const f = FixtureStore.newFixture('case-a', 'gpt-test', 'abc123', 'hello world', [
      { name: 'memory_record', args: { key: 'k', value: 'v' } },
    ]);
    store.save(f);
    const loaded = store.load('case-a', 'abc123');
    expect(loaded).not.toBeNull();
    expect(loaded!.responseText).toBe('hello world');
    expect(loaded!.toolCalls).toEqual([{ name: 'memory_record', args: { key: 'k', value: 'v' } }]);
    expect(loaded!.model).toBe('gpt-test');
  });

  it('load returns null when no fixture exists', () => {
    const store = new FixtureStore(dir);
    expect(store.load('does-not-exist', 'any')).toBeNull();
  });

  it('load throws "stale" when the promptHash differs', () => {
    const store = new FixtureStore(dir);
    store.save(FixtureStore.newFixture('c', 'm', 'OLDHASH', 'r', []));
    expect(() => store.load('c', 'NEWHASH')).toThrow(/stale/);
  });

  it('load throws on malformed JSON', () => {
    const store = new FixtureStore(dir);
    fs.writeFileSync(path.join(dir, 'bad.fixture.json'), '{not json');
    expect(() => store.load('bad', 'h')).toThrow(/invalid JSON/);
  });

  it('load throws when required fields are missing', () => {
    const store = new FixtureStore(dir);
    fs.writeFileSync(path.join(dir, 'partial.fixture.json'), JSON.stringify({ caseId: 'partial' }));
    expect(() => store.load('partial', 'h')).toThrow(/malformed/);
  });

  it('load throws when caseId in file does not match requested id', () => {
    const store = new FixtureStore(dir);
    fs.writeFileSync(path.join(dir, 'a.fixture.json'), JSON.stringify({
      caseId: 'b', recordedAt: 't', model: 'm', promptHash: 'h', responseText: 'r', toolCalls: [],
    }));
    expect(() => store.load('a', 'h')).toThrow(/mismatch/);
  });

  it('save is atomic (no half-written file visible during write)', () => {
    const store = new FixtureStore(dir);
    const f = FixtureStore.newFixture('atomic', 'm', 'h', 'x'.repeat(100), []);
    store.save(f);
    // After save returns, exactly the final file is present, no .tmp leftover.
    const files = fs.readdirSync(dir);
    expect(files).toContain('atomic.fixture.json');
    expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0);
  });

  it('save overwrites an existing fixture', () => {
    const store = new FixtureStore(dir);
    store.save(FixtureStore.newFixture('c', 'm', 'h', 'old', []));
    store.save(FixtureStore.newFixture('c', 'm', 'h', 'new', []));
    expect(store.load('c', 'h')!.responseText).toBe('new');
  });

  it('save creates the base directory if missing', () => {
    const nested = path.join(dir, 'deeper', 'still');
    const store = new FixtureStore(nested);
    store.save(FixtureStore.newFixture('c', 'm', 'h', 'r', []));
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('rejects unsafe caseIds (path traversal / OS-incompatible chars)', () => {
    const store = new FixtureStore(dir);
    expect(() => store.load('../escape', 'h')).toThrow(/unsafe/);
    expect(() => store.load('with space', 'h')).toThrow(/unsafe/);
    expect(() => store.load('semi;colon', 'h')).toThrow(/unsafe/);
  });

  it('list returns sorted caseIds, ignoring non-fixture files', () => {
    const store = new FixtureStore(dir);
    store.save(FixtureStore.newFixture('zeta', 'm', 'h', 'r', []));
    store.save(FixtureStore.newFixture('alpha', 'm', 'h', 'r', []));
    fs.writeFileSync(path.join(dir, 'README.md'), 'docs');
    expect(store.list()).toEqual(['alpha', 'zeta']);
  });

  it('list returns [] when the base dir does not exist', () => {
    const store = new FixtureStore(path.join(dir, 'never-created'));
    expect(store.list()).toEqual([]);
  });
});
