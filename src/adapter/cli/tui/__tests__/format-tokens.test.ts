/**
 * Token count → human-readable string.
 */

import { describe, test, expect } from 'vitest';
import { formatTokenCount } from '../format-tokens';

describe('formatTokenCount', () => {
  test('zero', () => {
    expect(formatTokenCount(0)).toBe('0');
  });

  test('small numbers pass through unchanged', () => {
    expect(formatTokenCount(1)).toBe('1');
    expect(formatTokenCount(42)).toBe('42');
    expect(formatTokenCount(999)).toBe('999');
  });

  test('floor instead of round for sub-1k (no surprise upward bumps)', () => {
    expect(formatTokenCount(99.9)).toBe('99');
  });

  test('thousands use the .XXk form below 10k', () => {
    expect(formatTokenCount(1000)).toBe('1.00k');
    expect(formatTokenCount(1234)).toBe('1.23k');
    expect(formatTokenCount(9999)).toBe('10.00k'); // upper-edge rounding
  });

  test('thousands switch to .Xk form at >= 10k', () => {
    expect(formatTokenCount(10_000)).toBe('10.0k');
    expect(formatTokenCount(12_345)).toBe('12.3k');
    expect(formatTokenCount(999_999)).toBe('1000.0k'); // upper edge
  });

  test('millions use .XXM form', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.00M');
    expect(formatTokenCount(1_234_567)).toBe('1.23M');
  });

  test('non-finite or negative input returns "0"', () => {
    expect(formatTokenCount(NaN)).toBe('0');
    expect(formatTokenCount(Infinity)).toBe('0');
    expect(formatTokenCount(-1)).toBe('0');
  });
});
