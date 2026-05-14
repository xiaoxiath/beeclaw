/**
 * Defense-in-depth: even if a contributor accidentally logs a config
 * blob, response body, or auth header, the logger must mask common
 * secret shapes before stdout / log files / Feishu cards.
 *
 * Tests both branches:
 *   - pretty format → goes through safeStringify (key-name & string-value masking)
 *   - json format   → goes through redactValue (recursive object walk)
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  setupMockConsole,
  restoreConsole,
  getConsoleCallsFor,
} from '../../testing/mocks/console';
import { logger, redactString } from '../logger';

function lastInfoOutput(): string {
  const calls = getConsoleCallsFor('info');
  return String(calls[calls.length - 1].args[0]);
}

describe('redactString — string-pattern masking', () => {
  test('masks sk-XXXX style keys', () => {
    expect(redactString('using sk-abc1234567890XYZ now')).toBe('using sk-[REDACTED] now');
  });

  test('masks Bearer tokens', () => {
    const out = redactString('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig');
    expect(out).toBe('Authorization: Bearer [REDACTED]');
  });

  test('masks api_key= in query strings', () => {
    expect(redactString('https://x.com?api_key=secretvalue&other=ok'))
      .toBe('https://x.com?api_key=[REDACTED]&other=ok');
  });

  test('masks GitHub PAT', () => {
    expect(redactString('token=ghp_abcdefghijklmnopqrstuvwxyz0123456789'))
      .toContain('gh[REDACTED]');
  });

  test('does NOT mask short non-secret strings', () => {
    expect(redactString('error code: sk-12')).toBe('error code: sk-12');
  });

  test('does NOT mask normal user content', () => {
    expect(redactString('user said hello world')).toBe('user said hello world');
  });
});

describe('Logger — pretty format key-name masking', () => {
  beforeEach(() => {
    setupMockConsole(['debug', 'info', 'warn', 'error'], true);
    logger.configure({ level: 'info', format: 'pretty' });
  });
  afterEach(() => restoreConsole());

  test('masks apiKey field value in object args', () => {
    logger.info('config loaded', { apiKey: 'sk-realsecretvalue1234567890', model: 'gpt-4' });
    const out = lastInfoOutput();
    expect(out).not.toContain('realsecretvalue');
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('"model": "gpt-4"');
  });

  test('masks api_key (snake_case) and api-key (kebab-case) variants', () => {
    logger.info('a', { api_key: 'snakecase-secret' });
    expect(lastInfoOutput()).toContain('[REDACTED]');
    logger.info('b', { 'api-key': 'kebab-secret' });
    expect(lastInfoOutput()).toContain('[REDACTED]');
  });

  test('masks token / password / secret / authorization fields', () => {
    logger.info('multi', {
      token: 'abc',
      password: 'pw',
      secret: 'shh',
      Authorization: 'Bearer xyz',
    });
    const out = lastInfoOutput();
    expect(out).not.toContain('"token": "abc"');
    expect(out).not.toContain('"password": "pw"');
    expect(out).not.toContain('"secret": "shh"');
    // Authorization key value masked too
    expect(out.match(/\[REDACTED\]/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  test('passes through empty / null secret values (preserves debuggability)', () => {
    logger.info('empty', { apiKey: '', token: null, password: undefined });
    const out = lastInfoOutput();
    // Empty string and null/undefined should NOT show [REDACTED] — they're already safe
    // and seeing the absence helps debug "did you forget to set the env var?"
    expect(out).not.toContain('[REDACTED]');
  });

  test('masks sk-* in plain message string', () => {
    logger.info('connecting with sk-livesecret1234567890ABC to provider');
    const out = lastInfoOutput();
    expect(out).not.toContain('livesecret1234567890ABC');
    expect(out).toContain('sk-[REDACTED]');
  });

  test('masks sk-* nested deep inside object string values (non-secret keys)', () => {
    // Parent keys are NOT secret-named, so string-pattern masking applies.
    logger.info('cfg', { request: { headers: ['Authorization: Bearer eyJlongtokenstring1234'] } });
    const out = lastInfoOutput();
    expect(out).not.toContain('eyJlongtokenstring1234');
    expect(out).toContain('Bearer [REDACTED]');
  });

  test('safer-by-default: secret-named parent key masks ENTIRE subtree', () => {
    // Even if we don't know what's inside, masking is the right call.
    logger.info('cfg', { auth: { headerValue: 'Bearer eyJlongtokenstring1234', x: 1 } });
    const out = lastInfoOutput();
    expect(out).not.toContain('eyJlongtokenstring1234');
    expect(out).not.toContain('"x": 1');
    expect(out).toContain('[REDACTED]');
  });

  test('preserves non-secret fields untouched', () => {
    logger.info('mixed', { provider: 'openai', apiKey: 'sk-x123456789012345', maxTokens: 4096 });
    const out = lastInfoOutput();
    expect(out).toContain('"provider": "openai"');
    expect(out).toContain('"maxTokens": 4096');
    expect(out).not.toContain('x123456789012345');
  });

  test('still handles circular references safely', () => {
    const obj: any = { name: 'cycle' };
    obj.self = obj;
    logger.info('circular', obj);
    const out = lastInfoOutput();
    expect(out).toContain('[Circular]');
    expect(out).toContain('"name": "cycle"');
  });
});

describe('Logger — json format recursive redaction', () => {
  beforeEach(() => {
    setupMockConsole(['debug', 'info', 'warn', 'error'], true);
    logger.configure({ level: 'info', format: 'json' });
  });
  afterEach(() => {
    restoreConsole();
    logger.configure({ format: 'pretty' });
  });

  test('redacts nested apiKey via object walk', () => {
    logger.info('boot', { providers: [{ name: 'zhipu', apiKey: 'sk-zhipu-secretvalue1234567890' }] });
    const raw = lastInfoOutput();
    const parsed = JSON.parse(raw);
    expect(parsed.args[0].providers[0].name).toBe('zhipu');
    expect(parsed.args[0].providers[0].apiKey).toBe('[REDACTED]');
  });

  test('redacts sk-* in message string in json mode', () => {
    logger.info('using sk-abcdefghijklmnopqrstuv now');
    const parsed = JSON.parse(lastInfoOutput());
    expect(parsed.message).toBe('using sk-[REDACTED] now');
  });

  test('handles circular refs in json mode', () => {
    const a: any = { x: 1 };
    a.cycle = a;
    logger.info('msg', a);
    const parsed = JSON.parse(lastInfoOutput());
    expect(parsed.args[0].cycle).toBe('[Circular]');
  });
});

describe('Logger — Error redaction', () => {
  beforeEach(() => {
    setupMockConsole(['debug', 'info', 'warn', 'error'], true);
    logger.configure({ level: 'error', format: 'pretty' });
  });
  afterEach(() => restoreConsole());

  test('redacts secrets in Error.message', () => {
    const err = new Error('failed to call api with sk-realkey1234567890ABCDEF: 401');
    logger.error('api error', err);
    const out = String(getConsoleCallsFor('error').slice(-1)[0].args[0]);
    expect(out).not.toContain('realkey1234567890ABCDEF');
    expect(out).toContain('sk-[REDACTED]');
  });
});
