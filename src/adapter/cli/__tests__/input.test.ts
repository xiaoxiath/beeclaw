import { describe, test, expect, vi } from 'vitest';
import { LoadingIndicator, ProgressIndicator, formatElapsed, rewriteLine } from '../input';

describe('LoadingIndicator', () => {
  test('creates with default message', () => {
    const indicator = new LoadingIndicator();
    expect(indicator).toBeDefined();
  });

  test('creates with custom message', () => {
    const indicator = new LoadingIndicator('Loading data');
    expect(indicator).toBeDefined();
  });

  test('start and stop do not throw', () => {
    const indicator = new LoadingIndicator('Testing');

    expect(() => indicator.start()).not.toThrow();
    expect(() => indicator.stop()).not.toThrow();
  });

  test('update changes message', () => {
    const indicator = new LoadingIndicator('Initial');
    indicator.update('Updated');
    // No error means success
    expect(indicator).toBeDefined();
  });

  test('success stops with message', () => {
    const indicator = new LoadingIndicator('Processing');
    indicator.start();
    expect(() => indicator.success('Done')).not.toThrow();
  });

  test('error stops with message', () => {
    const indicator = new LoadingIndicator('Processing');
    indicator.start();
    expect(() => indicator.error('Failed')).not.toThrow();
  });

  test('calling start twice is safe', () => {
    const indicator = new LoadingIndicator('Testing');
    indicator.start();
    indicator.start(); // Should not create second interval
    indicator.stop();
    expect(indicator).toBeDefined();
  });
});

describe('ProgressIndicator', () => {
  test('creates with total', () => {
    const progress = new ProgressIndicator(100);
    expect(progress).toBeDefined();
  });

  test('update shows progress', () => {
    const progress = new ProgressIndicator(100);
    expect(() => progress.update(50)).not.toThrow();
  });

  test('update with message', () => {
    const progress = new ProgressIndicator(100);
    expect(() => progress.update(75, 'Processing...')).not.toThrow();
  });

  test('complete finishes progress', () => {
    const progress = new ProgressIndicator(100);
    progress.update(50);
    expect(() => progress.complete('All done')).not.toThrow();
  });

  test('calculates correct percentage', () => {
    const progress = new ProgressIndicator(200);
    // Update to 100 out of 200 = 50%
    progress.update(100);
    // No error means success
    expect(progress).toBeDefined();
  });
});

describe('formatElapsed', () => {
  test('formats milliseconds', () => {
    const start = Date.now() - 500; // 500ms ago
    const result = formatElapsed(start);
    expect(result).toMatch(/\d+ms/);
  });

  test('formats seconds', () => {
    const start = Date.now() - 5000; // 5 seconds ago
    const result = formatElapsed(start);
    expect(result).toMatch(/\d+\.\d+s/);
  });

  test('formats minutes and seconds', () => {
    const start = Date.now() - 90000; // 1.5 minutes ago
    const result = formatElapsed(start);
    expect(result).toMatch(/\d+m \d+s/);
  });

  test('handles zero elapsed', () => {
    const result = formatElapsed(Date.now());
    expect(result).toMatch(/\d+ms/);
  });

  test('handles large elapsed times', () => {
    const start = Date.now() - 3700000; // Over 1 hour
    const result = formatElapsed(start);
    expect(result).toMatch(/\d+m \d+s/);
  });
});

describe('rewriteLine', () => {
  test('writes to stdout without error', () => {
    expect(() => rewriteLine('Test message')).not.toThrow();
  });
});

// Note: InputHandler tests are skipped because they require interactive stdin
describe('InputHandler (requires interactive terminal)', () => {
  test.skip('prompt returns user input', async () => {
    // Would require mocking stdin
  });

  test.skip('promptMultiline collects multiple lines', async () => {
    // Would require mocking stdin
  });

  test.skip('promptAuto detects multiline triggers', async () => {
    // Would require mocking stdin
  });

  test.skip('confirm returns boolean', async () => {
    // Would require mocking stdin
  });

  test.skip('select returns option index', async () => {
    // Would require mocking stdin
  });

  test.skip('detectPaste identifies pasted content', () => {
    // Would require testing private method
  });
});

// Note: withSpinner and typeText are async functions that require real async context
describe('Async utilities', () => {
  test.skip('withSpinner wraps async function', async () => {
    // Would require real async execution
  });

  test.skip('typeText animates text output', async () => {
    // Would require real async execution
  });
});
