/**
 * canRunTui gates the Ink renderer behind a TTY check. Ink's raw-mode
 * input handler throws on construction without a real TTY, so we want
 * a clean "fall back to legacy REPL" path for CI / pipe / docker.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { canRunTui } from '../index';

let originalStdinTty: boolean | undefined;
let originalStdoutTty: boolean | undefined;

beforeEach(() => {
  originalStdinTty = (process.stdin as any).isTTY;
  originalStdoutTty = (process.stdout as any).isTTY;
});

afterEach(() => {
  (process.stdin as any).isTTY = originalStdinTty;
  (process.stdout as any).isTTY = originalStdoutTty;
});

describe('canRunTui', () => {
  test('true when both stdin + stdout are TTYs', () => {
    (process.stdin as any).isTTY = true;
    (process.stdout as any).isTTY = true;
    expect(canRunTui()).toBe(true);
  });

  test('false when stdin is not a TTY (piped input)', () => {
    (process.stdin as any).isTTY = false;
    (process.stdout as any).isTTY = true;
    expect(canRunTui()).toBe(false);
  });

  test('false when stdout is not a TTY (output redirected)', () => {
    (process.stdin as any).isTTY = true;
    (process.stdout as any).isTTY = false;
    expect(canRunTui()).toBe(false);
  });

  test('false when neither is a TTY (CI environment)', () => {
    (process.stdin as any).isTTY = false;
    (process.stdout as any).isTTY = false;
    expect(canRunTui()).toBe(false);
  });
});
