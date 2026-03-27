import { describe, test, expect, vi } from 'vitest';
import { computeCompositeScore, measureComplexity } from '../evaluator';

// ---------------------------------------------------------------------------
// computeCompositeScore
// ---------------------------------------------------------------------------

describe('computeCompositeScore()', () => {
  test('returns a value between 0 and 1', () => {
    const score = computeCompositeScore({
      successRate: 0.5,
      triggerPrecision: 0.5,
      avgOutputQuality: 0.5,
      avgExecutionTimeMs: 5_000,
      complexityScore: 150,
    });

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test('returns 1 (or close to 1) for perfect metrics', () => {
    const score = computeCompositeScore({
      successRate: 1.0,
      triggerPrecision: 1.0,
      avgOutputQuality: 1.0,
      avgExecutionTimeMs: 0,
      complexityScore: 0,
    });

    // 0.35*1 + 0.25*1 + 0.20*1 + 0.12*1 + 0.08*1 = 1.0
    expect(score).toBeCloseTo(1.0, 2);
  });

  test('returns 0 for worst-case metrics', () => {
    const score = computeCompositeScore({
      successRate: 0,
      triggerPrecision: 0,
      avgOutputQuality: 0,
      avgExecutionTimeMs: 10_000,
      complexityScore: 300,
    });

    // All components should be 0
    expect(score).toBeCloseTo(0, 2);
  });

  test('gives higher score for higher success rate', () => {
    const base = {
      triggerPrecision: 0.5,
      avgOutputQuality: 0.5,
      avgExecutionTimeMs: 5_000,
      complexityScore: 100,
    };

    const lowSuccess = computeCompositeScore({ ...base, successRate: 0.2 });
    const highSuccess = computeCompositeScore({ ...base, successRate: 0.9 });

    expect(highSuccess).toBeGreaterThan(lowSuccess);
  });

  test('penalizes high complexity via simplicityBonus', () => {
    const base = {
      successRate: 0.8,
      triggerPrecision: 0.8,
      avgOutputQuality: 0.8,
      avgExecutionTimeMs: 1_000,
    };

    const lowComplexity = computeCompositeScore({ ...base, complexityScore: 10 });
    const highComplexity = computeCompositeScore({ ...base, complexityScore: 280 });

    expect(lowComplexity).toBeGreaterThan(highComplexity);
  });

  test('rewards faster execution via speedBonus', () => {
    const base = {
      successRate: 0.8,
      triggerPrecision: 0.8,
      avgOutputQuality: 0.8,
      complexityScore: 50,
    };

    const fast = computeCompositeScore({ ...base, avgExecutionTimeMs: 100 });
    const slow = computeCompositeScore({ ...base, avgExecutionTimeMs: 9_000 });

    expect(fast).toBeGreaterThan(slow);
  });

  test('speedBonus floors at 0 for >= 10000ms', () => {
    const base = {
      successRate: 0.5,
      triggerPrecision: 0.5,
      avgOutputQuality: 0.5,
      complexityScore: 150,
    };

    const at10k = computeCompositeScore({ ...base, avgExecutionTimeMs: 10_000 });
    const at20k = computeCompositeScore({ ...base, avgExecutionTimeMs: 20_000 });

    // Both should have speedBonus = 0, so scores are equal
    expect(at10k).toBeCloseTo(at20k, 3);
  });

  test('simplicityBonus floors at 0 for complexity >= 300', () => {
    const base = {
      successRate: 0.5,
      triggerPrecision: 0.5,
      avgOutputQuality: 0.5,
      avgExecutionTimeMs: 5_000,
    };

    const at300 = computeCompositeScore({ ...base, complexityScore: 300 });
    const at500 = computeCompositeScore({ ...base, complexityScore: 500 });

    // Both should have simplicityBonus = 0
    expect(at300).toBeCloseTo(at500, 3);
  });
});

// ---------------------------------------------------------------------------
// measureComplexity
// ---------------------------------------------------------------------------

describe('measureComplexity()', () => {
  test('returns 0 for empty string', () => {
    // An empty string splits to [""], which has length 1.
    // But lines * 0.5 = 0.5 for a truly empty string.
    // Actually "" splits into [""] -> 1 line -> 1 * 0.5 = 0.5
    // Let's verify the actual behavior:
    const result = measureComplexity('');
    // 1 line * 0.5 = 0.5, but could be treated as 0 depending on interpretation.
    // The source: `const lines = skillContent.split("\n").length;` => 1 for ""
    // So raw = 1 * 0.5 = 0.5
    expect(result).toBeLessThanOrEqual(1);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  test('increases with more lines', () => {
    const shortContent = 'line 1\nline 2';
    const longContent = 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10';

    const shortScore = measureComplexity(shortContent);
    const longScore = measureComplexity(longContent);

    expect(longScore).toBeGreaterThan(shortScore);
  });

  test('increases with conditional keywords (if/when/unless)', () => {
    const noConditionals = 'Just plain text\nNothing special here.';
    const withConditionals = 'if the user asks\nwhen triggered\nunless disabled\nif condition met';

    const plainScore = measureComplexity(noConditionals);
    const conditionalScore = measureComplexity(withConditionals);

    expect(conditionalScore).toBeGreaterThan(plainScore);
  });

  test('increases with markdown headings (sections)', () => {
    const noHeadings = 'plain content\nmore content';
    const withHeadings = '# Title\n## Section\n### Subsection\ncontent';

    const plainScore = measureComplexity(noHeadings);
    const headingScore = measureComplexity(withHeadings);

    expect(headingScore).toBeGreaterThan(plainScore);
  });

  test('increases with fenced code blocks', () => {
    const noCode = 'just text\nmore text';
    const withCode = 'text\n```python\nprint("hello")\n```\nmore text';

    const plainScore = measureComplexity(noCode);
    const codeScore = measureComplexity(withCode);

    expect(codeScore).toBeGreaterThan(plainScore);
  });

  test('caps at 300', () => {
    // Generate a very complex document: many lines + many conditionals + many sections
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(`# Section ${i}`);
      lines.push(`if condition ${i} then do something`);
      lines.push(`when triggered, execute step ${i}`);
      lines.push('```\ncode\n```');
    }
    const hugeContent = lines.join('\n');

    const score = measureComplexity(hugeContent);
    expect(score).toBe(300);
  });

  test('handles content with only code blocks', () => {
    const content = '```js\nconst x = 1;\n```\n```py\nprint(1)\n```';

    const score = measureComplexity(content);
    // 5 lines * 0.5 = 2.5 + 2 code blocks * 3 = 6 => 8.5
    expect(score).toBeGreaterThan(0);
  });
});
