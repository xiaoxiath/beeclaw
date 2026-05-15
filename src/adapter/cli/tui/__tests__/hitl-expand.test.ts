/**
 * Pure helper that expands "1" → "Option 1: <text>" when a HITL prompt
 * has options. Anything that's not a valid digit answer passes through.
 */

import { describe, test, expect } from 'vitest';
import { expandHitlAnswer } from '../hitl-expand';

const opts = ['Apple', 'Banana', 'Cherry'];

describe('expandHitlAnswer', () => {
  test('expands a valid digit to Option N: text', () => {
    expect(expandHitlAnswer('1', opts)).toBe('Option 1: Apple');
    expect(expandHitlAnswer('3', opts)).toBe('Option 3: Cherry');
  });

  test('trims whitespace around the digit', () => {
    expect(expandHitlAnswer('  2  ', opts)).toBe('Option 2: Banana');
  });

  test('passes through digits outside the valid range verbatim', () => {
    expect(expandHitlAnswer('0', opts)).toBe('0');
    expect(expandHitlAnswer('4', opts)).toBe('4'); // beyond options.length
  });

  test('passes through free-text verbatim (anything non-digit)', () => {
    expect(expandHitlAnswer('Apple', opts)).toBe('Apple');
    expect(expandHitlAnswer('1.5', opts)).toBe('1.5');
    expect(expandHitlAnswer('option 1', opts)).toBe('option 1');
  });

  test('no options → input passes through verbatim', () => {
    expect(expandHitlAnswer('1', undefined)).toBe('1');
    expect(expandHitlAnswer('1', [])).toBe('1');
  });

  test('empty answer passes through', () => {
    expect(expandHitlAnswer('', opts)).toBe('');
  });
});
