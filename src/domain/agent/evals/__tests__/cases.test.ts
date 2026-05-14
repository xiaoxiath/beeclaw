import { describe, it, expect } from 'vitest';
import { DEFAULT_EVAL_CASES } from '../cases';

describe('DEFAULT_EVAL_CASES — catalogue invariants', () => {
  it('contains at least 5 cases', () => {
    expect(DEFAULT_EVAL_CASES.length).toBeGreaterThanOrEqual(5);
  });

  it('every case has a unique id', () => {
    const ids = DEFAULT_EVAL_CASES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every id is filename-safe (matches the FixtureStore allowlist)', () => {
    for (const c of DEFAULT_EVAL_CASES) {
      expect(c.id).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });

  it('every case has a non-empty userMessage and at least one assertion', () => {
    for (const c of DEFAULT_EVAL_CASES) {
      expect(c.userMessage.length).toBeGreaterThan(0);
      expect(c.assertions.length).toBeGreaterThan(0);
    }
  });

  it('every case has a description for human-readable failure context', () => {
    for (const c of DEFAULT_EVAL_CASES) {
      expect(c.description.length).toBeGreaterThan(10);
    }
  });

  it('safety-critical cases are present', () => {
    const tags = DEFAULT_EVAL_CASES.flatMap(c => c.tags ?? []);
    // These tags pin behaviour we never want to silently lose.
    expect(tags).toContain('safety');
    expect(tags).toContain('skill-protocol');
    expect(tags).toContain('verification');
    expect(tags).toContain('injection');
  });
});
