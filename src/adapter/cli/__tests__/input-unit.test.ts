/**
 * Comprehensive unit tests for src/adapter/cli/input.ts
 * Targets maximum statement and branch coverage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  return {
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    mockStdoutWrite: vi.fn(),
    mockRlQuestion: vi.fn(),
    mockRlClose: vi.fn(),
    mockRlInterface: vi.fn(),
  };
});

vi.mock('../../../infra/observability/logger', () => ({
  logger: mocks.mockLogger,
}));

vi.mock('readline', () => ({
  createInterface: (...args: any[]) => {
    mocks.mockRlInterface(...args);
    return {
      question: (...a: any[]) => mocks.mockRlQuestion(...a),
      close: (...a: any[]) => mocks.mockRlClose(...a),
    };
  },
}));

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
import {
  LoadingIndicator,
  ProgressIndicator,
  InputHandler,
  formatElapsed,
  withSpinner,
  typeText,
  rewriteLine,
  showTemporaryMessage,
} from '../input';

// ---------------------------------------------------------------------------
// Helper: reset mock implementations
// ---------------------------------------------------------------------------
function resetMockImplementations() {
  mocks.mockStdoutWrite.mockReturnValue(true);
  mocks.mockRlQuestion.mockImplementation((_q: string, cb: (answer: string) => void) => {
    // Default: immediately answer with empty string
    cb('');
  });
  mocks.mockRlClose.mockReturnValue(undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoadingIndicator', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetMockImplementations();
    vi.useFakeTimers();
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    writeSpy.mockRestore();
  });

  it('should construct with default message and prefix', () => {
    const li = new LoadingIndicator();
    expect(li).toBeDefined();
  });

  it('should construct with custom message and prefix', () => {
    const li = new LoadingIndicator('Loading', '>> ');
    expect(li).toBeDefined();
  });

  it('should start the spinner animation', () => {
    const li = new LoadingIndicator('Working');
    li.start();

    // Should hide cursor
    expect(writeSpy).toHaveBeenCalledWith('\x1B[?25l');

    // Advance timer to trigger at least one spinner frame
    vi.advanceTimersByTime(100);

    // Should have written a spinner frame
    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const frameCall = calls.find(c => c.includes('Working...'));
    expect(frameCall).toBeDefined();

    li.stop();
  });

  it('should not start twice if already running', () => {
    const li = new LoadingIndicator('Test');
    li.start();
    const callsBefore = writeSpy.mock.calls.length;
    li.start(); // Second call should be no-op
    // No additional hide-cursor call
    const callsAfter = writeSpy.mock.calls.length;
    expect(callsAfter).toBe(callsBefore);

    li.stop();
  });

  it('should cycle through spinner frames', () => {
    const li = new LoadingIndicator('Spin');
    li.start();

    // Advance through multiple frames
    vi.advanceTimersByTime(80 * 5); // 5 frames

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const frameChars = calls
      .filter(c => c.includes('Spin...'))
      .map(c => {
        // Extract spinner char: "\r\nX Spin..." -> X
        const match = c.match(/([⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])/);
        return match ? match[1] : null;
      })
      .filter(Boolean);

    expect(frameChars.length).toBeGreaterThanOrEqual(5);

    li.stop();
  });

  it('should update the message', () => {
    const li = new LoadingIndicator('First');
    li.start();
    li.update('Second');

    vi.advanceTimersByTime(100);

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const hasSecond = calls.some(c => c.includes('Second...'));
    expect(hasSecond).toBe(true);

    li.stop();
  });

  it('should stop and clear line by default', () => {
    const li = new LoadingIndicator('Clearing');
    li.start();
    vi.advanceTimersByTime(100);

    li.stop();

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    // Should show cursor
    expect(calls).toContain('\x1B[?25h');
    // Should clear line
    expect(calls).toContain('\r\x1B[2K');
  });

  it('should stop without clearing line when clearLine=false', () => {
    const li = new LoadingIndicator('NoClear');
    li.start();
    vi.advanceTimersByTime(100);

    writeSpy.mockClear();
    li.stop(false);

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    expect(calls).toContain('\x1B[?25h');
    expect(calls).not.toContain('\r\x1B[2K');
  });

  it('should handle stop when not started', () => {
    const li = new LoadingIndicator('NotStarted');
    // Should not throw
    li.stop();
    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    expect(calls).toContain('\x1B[?25h');
  });

  it('should show success message', () => {
    const li = new LoadingIndicator('Working');
    li.start();
    vi.advanceTimersByTime(100);

    li.success('All done!');

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const successCall = calls.find(c => c.includes('✅') && c.includes('All done!'));
    expect(successCall).toBeDefined();
  });

  it('should show error message', () => {
    const li = new LoadingIndicator('Working');
    li.start();
    vi.advanceTimersByTime(100);

    li.error('Something failed');

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const errorCall = calls.find(c => c.includes('❌') && c.includes('Something failed'));
    expect(errorCall).toBeDefined();
  });
});

describe('ProgressIndicator', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetMockImplementations();
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('should create with total', () => {
    const pi = new ProgressIndicator(100);
    expect(pi).toBeDefined();
  });

  it('should update progress bar', () => {
    const pi = new ProgressIndicator(100);
    pi.update(50);

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const progressCall = calls.find(c => c.includes('50%'));
    expect(progressCall).toBeDefined();
    expect(progressCall).toContain('█');
    expect(progressCall).toContain('░');
  });

  it('should update with message', () => {
    const pi = new ProgressIndicator(100);
    pi.update(75, 'Almost there');

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const call = calls.find(c => c.includes('75%') && c.includes('Almost there'));
    expect(call).toBeDefined();
  });

  it('should show 0% at start', () => {
    const pi = new ProgressIndicator(100);
    pi.update(0);

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const call = calls.find(c => c.includes('0%'));
    expect(call).toBeDefined();
  });

  it('should show 100% on complete', () => {
    const pi = new ProgressIndicator(100);
    pi.complete('Finished');

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const call = calls.find(c => c.includes('100%'));
    expect(call).toBeDefined();
  });

  it('should use "Done" as default complete message', () => {
    const pi = new ProgressIndicator(50);
    pi.complete();

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const call = calls.find(c => c.includes('Done'));
    expect(call).toBeDefined();
  });

  it('should write newline on complete', () => {
    const pi = new ProgressIndicator(10);
    pi.complete();

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    expect(calls[calls.length - 1]).toBe('\n');
  });
});

describe('InputHandler', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let stdinOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetMockImplementations();
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stdinOnSpy = vi.spyOn(process.stdout, 'on').mockReturnValue(process.stdout);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    stdinOnSpy.mockRestore();
  });

  it('should create an InputHandler', () => {
    const handler = new InputHandler();
    expect(handler).toBeDefined();
    expect(mocks.mockRlInterface).toHaveBeenCalled();
    handler.close();
  });

  it('should close the readline interface', () => {
    const handler = new InputHandler();
    handler.close();
    expect(mocks.mockRlClose).toHaveBeenCalled();
  });

  it('should return the readline interface', () => {
    const handler = new InputHandler();
    const rl = handler.getReadline();
    expect(rl).toBeDefined();
    expect(rl.question).toBeDefined();
    handler.close();
  });

  describe('prompt()', () => {
    it('should resolve with user input', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb('hello world');
      });

      const handler = new InputHandler();
      const result = await handler.prompt('> ');
      expect(result).toBe('hello world');
      handler.close();
    });

    it('should use default prompt if none provided', async () => {
      mocks.mockRlQuestion.mockImplementation((q: string, cb: Function) => {
        expect(q).toBe('> ');
        cb('test');
      });

      const handler = new InputHandler();
      await handler.prompt();
      handler.close();
    });

    it('should emit input event', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb('typed text');
      });

      const handler = new InputHandler();
      const inputSpy = vi.fn();
      handler.on('input', inputSpy);

      await handler.prompt();
      expect(inputSpy).toHaveBeenCalledWith('typed text');
      handler.close();
    });

    it('should detect paste for large input (>500 chars)', async () => {
      const largeInput = 'x'.repeat(501);
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb(largeInput);
      });

      const handler = new InputHandler();
      const pasteSpy = vi.fn();
      handler.on('paste', pasteSpy);

      await handler.prompt();
      expect(pasteSpy).toHaveBeenCalledWith(largeInput);
      handler.close();
    });

    it('should detect paste for multi-line input', async () => {
      const multiLine = 'line1\nline2\nline3';
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb(multiLine);
      });

      const handler = new InputHandler();
      const pasteSpy = vi.fn();
      handler.on('paste', pasteSpy);

      await handler.prompt();
      expect(pasteSpy).toHaveBeenCalledWith(multiLine);
      handler.close();
    });

    it('should show input indicator for large inputs (>100 chars)', async () => {
      const input = 'x'.repeat(101) + '\n' + 'y'.repeat(50);
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb(input);
      });

      const handler = new InputHandler();
      await handler.prompt();

      const calls = writeSpy.mock.calls.map(c => c[0] as string);
      const indicatorCall = calls.find(c => c.includes('lines') && c.includes('chars'));
      expect(indicatorCall).toBeDefined();
      handler.close();
    });

    it('should not show input indicator for small inputs', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb('short');
      });

      const handler = new InputHandler();
      writeSpy.mockClear();
      await handler.prompt();

      const calls = writeSpy.mock.calls.map(c => c[0] as string);
      const indicatorCall = calls.find(c => c.includes('lines') && c.includes('chars'));
      expect(indicatorCall).toBeUndefined();
      handler.close();
    });
  });

  describe('promptMultiline()', () => {
    it('should collect lines until delimiter', async () => {
      let callCount = 0;
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        callCount++;
        if (callCount === 1) cb('first line');
        else if (callCount === 2) cb('second line');
        else cb('END');
      });

      const handler = new InputHandler();
      const result = await handler.promptMultiline('>>> ', 'END');

      expect(result).toBe('first line\nsecond line');
      handler.close();
    });

    it('should use default delimiter END', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb('END');
      });

      const handler = new InputHandler();
      const result = await handler.promptMultiline();
      expect(result).toBe('');
      handler.close();
    });

    it('should emit multiline event', async () => {
      let callCount = 0;
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        callCount++;
        if (callCount === 1) cb('line1');
        else cb('END');
      });

      const handler = new InputHandler();
      const multilineSpy = vi.fn();
      handler.on('multiline', multilineSpy);

      await handler.promptMultiline();
      expect(multilineSpy).toHaveBeenCalledWith('line1');
      handler.close();
    });

    it('should handle trimmed delimiter', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb('  END  '); // With whitespace
      });

      const handler = new InputHandler();
      const result = await handler.promptMultiline();
      expect(result).toBe('');
      handler.close();
    });
  });

  describe('promptAuto()', () => {
    it('should return single line if no trigger detected', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb('regular input');
      });

      const handler = new InputHandler();
      const result = await handler.promptAuto();
      expect(result).toBe('regular input');
      handler.close();
    });

    it('should enter multiline mode when trigger found at start', async () => {
      let callCount = 0;
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        callCount++;
        if (callCount === 1) cb('```code block');
        else if (callCount === 2) cb('  some code');
        else cb('closing ```');
      });

      const handler = new InputHandler();
      const result = await handler.promptAuto();

      expect(result).toContain('```code block');
      expect(result).toContain('some code');
      expect(result).toContain('closing ```');
      handler.close();
    });

    it('should not enter multiline mode if trigger is self-closing', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        // Start AND end with trigger on same line
        cb('```inline code```');
      });

      const handler = new InputHandler();
      const result = await handler.promptAuto();
      expect(result).toBe('```inline code```');
      handler.close();
    });

    it('should use custom multiline triggers', async () => {
      let callCount = 0;
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        callCount++;
        if (callCount === 1) cb('"""multiline string');
        else if (callCount === 2) cb('line2');
        else cb('end """');
      });

      const handler = new InputHandler();
      const result = await handler.promptAuto('> ', ['"""']);

      expect(result).toContain('"""multiline string');
      expect(result).toContain('end """');
      handler.close();
    });
  });

  describe('confirm()', () => {
    it('should return true for "y" answer', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb('y');
      });

      const handler = new InputHandler();
      const result = await handler.confirm('Continue?');
      expect(result).toBe(true);
      handler.close();
    });

    it('should return true for "yes" answer', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb('yes');
      });

      const handler = new InputHandler();
      const result = await handler.confirm('Continue?');
      expect(result).toBe(true);
      handler.close();
    });

    it('should return false for "n" answer', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb('n');
      });

      const handler = new InputHandler();
      const result = await handler.confirm('Continue?');
      expect(result).toBe(false);
      handler.close();
    });

    it('should use default value when empty answer', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb('');
      });

      const handler = new InputHandler();
      expect(await handler.confirm('Q?', true)).toBe(true);
      expect(await handler.confirm('Q?', false)).toBe(false);
      handler.close();
    });

    it('should show [Y/n] hint when default is true', async () => {
      mocks.mockRlQuestion.mockImplementation((q: string, cb: Function) => {
        expect(q).toContain('[Y/n]');
        cb('');
      });

      const handler = new InputHandler();
      await handler.confirm('Delete?', true);
      handler.close();
    });

    it('should show [y/N] hint when default is false', async () => {
      mocks.mockRlQuestion.mockImplementation((q: string, cb: Function) => {
        expect(q).toContain('[y/N]');
        cb('');
      });

      const handler = new InputHandler();
      await handler.confirm('Delete?', false);
      handler.close();
    });
  });

  describe('select()', () => {
    it('should return selected index for valid input', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb('2');
      });

      const handler = new InputHandler();
      const result = await handler.select('Choose:', ['Option A', 'Option B', 'Option C']);

      expect(result).toBe(1); // 0-indexed: input "2" => index 1
      handler.close();
    });

    it('should retry on invalid input', async () => {
      let callCount = 0;
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        callCount++;
        if (callCount === 1) cb('invalid');
        else if (callCount === 2) cb('0'); // out of range
        else if (callCount === 3) cb('5'); // out of range
        else cb('1'); // valid
      });

      const handler = new InputHandler();
      const result = await handler.select('Pick:', ['A', 'B']);

      expect(result).toBe(0); // input "1" => index 0
      expect(mocks.mockLogger.debug).toHaveBeenCalledWith('Invalid selection. Please try again.');
      handler.close();
    });

    it('should display options with numbering', async () => {
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        cb('1');
      });

      const handler = new InputHandler();
      await handler.select('Choose:', ['Alpha', 'Beta']);

      expect(mocks.mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Choose:'));
      expect(mocks.mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('1. Alpha'));
      expect(mocks.mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('2. Beta'));
      handler.close();
    });
  });

  describe('detectPaste (private, via prompt)', () => {
    it('should detect fast input as paste', async () => {
      vi.useFakeTimers();

      // First call sets lastInputTime
      let callCount = 0;
      mocks.mockRlQuestion.mockImplementation((_q: string, cb: Function) => {
        callCount++;
        if (callCount === 1) {
          cb('first input sets the timer');
        } else {
          // Fast input (>50 chars within pasteThreshold 50ms)
          vi.advanceTimersByTime(10); // only 10ms later
          cb('a'.repeat(51));
        }
      });

      const handler = new InputHandler();
      const pasteSpy = vi.fn();
      handler.on('paste', pasteSpy);

      await handler.prompt(); // first call
      await handler.prompt(); // second call (fast, >50 chars)

      expect(pasteSpy).toHaveBeenCalled();
      handler.close();
      vi.useRealTimers();
    });
  });
});

describe('formatElapsed()', () => {
  it('should format milliseconds (<1s)', () => {
    const start = Date.now() - 500;
    const result = formatElapsed(start);
    expect(result).toMatch(/^\d+ms$/);
  });

  it('should format seconds (1s-60s)', () => {
    const start = Date.now() - 5000;
    const result = formatElapsed(start);
    expect(result).toMatch(/^\d+\.\d+s$/);
  });

  it('should format minutes (>60s)', () => {
    const start = Date.now() - 90000;
    const result = formatElapsed(start);
    expect(result).toMatch(/^\d+m \d+s$/);
  });

  it('should handle exact boundary at 1000ms', () => {
    const start = Date.now() - 1000;
    const result = formatElapsed(start);
    expect(result).toMatch(/^\d+\.\d+s$/);
  });

  it('should handle exact boundary at 60000ms', () => {
    const start = Date.now() - 60000;
    const result = formatElapsed(start);
    expect(result).toMatch(/^\d+m \d+s$/);
  });

  it('should handle 0ms elapsed', () => {
    const result = formatElapsed(Date.now());
    expect(result).toMatch(/^\d+ms$/);
  });
});

describe('withSpinner()', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    writeSpy.mockRestore();
  });

  it('should execute function and show success', async () => {
    const fn = vi.fn().mockResolvedValue('result');

    const resultPromise = withSpinner('Loading', fn);
    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result).toBe('result');
    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const successCall = calls.find(c => c.includes('✅'));
    expect(successCall).toBeDefined();
  });

  it('should show custom success message', async () => {
    const fn = vi.fn().mockResolvedValue(42);

    const resultPromise = withSpinner('Calc', fn, 'Calculation done');
    await vi.advanceTimersByTimeAsync(100);
    await resultPromise;

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const successCall = calls.find(c => c.includes('Calculation done'));
    expect(successCall).toBeDefined();
  });

  it('should show default success message when none provided', async () => {
    const fn = vi.fn().mockResolvedValue(42);

    const resultPromise = withSpinner('Loading', fn);
    await vi.advanceTimersByTimeAsync(100);
    await resultPromise;

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const successCall = calls.find(c => c.includes('Loading complete'));
    expect(successCall).toBeDefined();
  });

  it('should show error and re-throw on failure', async () => {
    // fn throws synchronously to avoid unhandled rejection with fake timers
    const err = new Error('boom');
    const fn = vi.fn().mockImplementation(() => { throw err; });

    let caught: Error | undefined;
    try {
      await withSpinner('Processing', fn);
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBe(err);

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    const errorCall = calls.find(c => c.includes('❌') && c.includes('Processing failed'));
    expect(errorCall).toBeDefined();
  });
});

describe('typeText()', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    writeSpy.mockRestore();
  });

  it('should write each character with delay', async () => {
    const promise = typeText('Hi', 10);

    // Advance time for each character
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);
    await promise;

    expect(writeSpy).toHaveBeenCalledWith('H');
    expect(writeSpy).toHaveBeenCalledWith('i');
  });

  it('should use default delay of 10ms', async () => {
    const promise = typeText('AB');

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);
    await promise;

    expect(writeSpy).toHaveBeenCalledWith('A');
    expect(writeSpy).toHaveBeenCalledWith('B');
  });

  it('should handle empty string', async () => {
    writeSpy.mockClear();
    await typeText('');
    expect(writeSpy).not.toHaveBeenCalled();
  });
});

describe('rewriteLine()', () => {
  it('should clear line and write text', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    rewriteLine('New text');

    expect(writeSpy).toHaveBeenCalledWith('\r\x1B[2K' + 'New text');
    writeSpy.mockRestore();
  });
});

describe('showTemporaryMessage()', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    writeSpy.mockRestore();
  });

  it('should show message and clear after duration', async () => {
    const promise = showTemporaryMessage('Saving...', 1000);

    // Message should be written
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Saving...'));

    // Advance past duration
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    // Should clear the line
    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    expect(calls).toContain('\r\x1B[2K');
  });

  it('should use default 2000ms duration', async () => {
    const promise = showTemporaryMessage('Hello');

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Hello'));

    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    const calls = writeSpy.mock.calls.map(c => c[0] as string);
    expect(calls).toContain('\r\x1B[2K');
  });
});
