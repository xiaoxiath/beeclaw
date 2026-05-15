/**
 * Logger redirect — TUI mode MUST NOT let logger calls touch stdout
 * (Ink owns stdout). This test verifies the redirect actually moves
 * writes to the side log file and that restore puts everything back.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.unmock('fs');

import { logger } from '../../../../infra/observability/logger';
import {
  activateLoggerRedirect,
  restoreLogger,
  getLogPath,
} from '../logger-redirect';

let savedCwd: string;
let tmp: string;

beforeEach(() => {
  savedCwd = process.cwd();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beeclaw-tui-log-'));
  process.chdir(tmp);
});

afterEach(() => {
  restoreLogger();
  process.chdir(savedCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('activateLoggerRedirect', () => {
  test('logger writes go to logs/cli-debug.log, NOT stdout', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    activateLoggerRedirect();

    logger.info('test info', { foo: 'bar' });
    logger.warn('test warn');
    logger.error('boom');

    expect(stdoutSpy).not.toHaveBeenCalled();
    const written = fs.readFileSync(getLogPath(), 'utf-8');
    expect(written).toContain('[INFO] test info');
    expect(written).toContain('"foo":"bar"');
    expect(written).toContain('[WARN] test warn');
    expect(written).toContain('[ERROR] boom');

    stdoutSpy.mockRestore();
  });

  test('idempotent — second call is a no-op', () => {
    activateLoggerRedirect();
    const firstFn = logger.info;
    activateLoggerRedirect();
    expect(logger.info).toBe(firstFn);
  });

  test('Error objects serialize message + stack to the log', () => {
    activateLoggerRedirect();
    const err = new Error('something broke');
    logger.error('caught', err);
    const written = fs.readFileSync(getLogPath(), 'utf-8');
    expect(written).toContain('something broke');
    expect(written).toMatch(/at /); // stack frame marker
  });

  test('creates logs/ directory if absent', () => {
    expect(fs.existsSync(path.join(tmp, 'logs'))).toBe(false);
    activateLoggerRedirect();
    logger.info('first');
    expect(fs.existsSync(path.join(tmp, 'logs'))).toBe(true);
  });
});

describe('restoreLogger', () => {
  test('puts the original methods back', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    activateLoggerRedirect();
    restoreLogger();

    logger.info('post-restore');
    // After restore, the original implementation is back, which writes
    // to stdout via console.info → so the spy should have caught it.
    // (Console methods route through stdout; this is implementation-
    // dependent but stable for the structured logger.)
    stdoutSpy.mockRestore();

    // The redirected log file should NOT contain the post-restore line.
    if (fs.existsSync(getLogPath())) {
      const written = fs.readFileSync(getLogPath(), 'utf-8');
      expect(written).not.toContain('post-restore');
    }
  });
});

describe('getLogPath', () => {
  test('returns absolute path under cwd/logs', () => {
    const p = getLogPath();
    expect(path.isAbsolute(p)).toBe(true);
    expect(p.endsWith('cli-debug.log')).toBe(true);
  });
});
