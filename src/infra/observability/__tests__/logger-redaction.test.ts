/**
 * Defense-in-depth: even if a contributor accidentally logs a config
 * blob, response body, or auth header, the logger must mask common
 * secret shapes before stdout / log files / Feishu cards.
 *
 * Three layers tested separately:
 *   1. redactString  — pure string-pattern masking (sk-*, Bearer *, etc.)
 *   2. redactValue   — recursive object walk masking by key + nested strings
 *   3. logger.info() — end-to-end: log goes through pino, JSON line is captured
 *      via setLoggerDestination(), parsed, and asserted against.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  logger,
  redactString,
  redactValue,
  setLoggerDestination,
} from '../logger';

describe('redactString — string-pattern masking', () => {
  test('masks sk-XXXX style keys', () => {
    expect(redactString('using sk-abc1234567890XYZ now')).toBe('using sk-[REDACTED] now');
  });

  test('masks Bearer tokens', () => {
    expect(redactString('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'))
      .toBe('Authorization: Bearer [REDACTED]');
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

describe('redactValue — recursive object walk', () => {
  test('masks apiKey, api_key, api-key variants', () => {
    expect((redactValue({ apiKey: 'sk-secret1234567890abc' }) as any).apiKey).toBe('[REDACTED]');
    expect((redactValue({ api_key: 'snakey' }) as any).api_key).toBe('[REDACTED]');
    expect((redactValue({ 'api-key': 'kebabby' }) as any)['api-key']).toBe('[REDACTED]');
  });

  test('masks token / password / secret / authorization fields', () => {
    const out = redactValue({
      token: 'abc', password: 'pw', secret: 'shh', Authorization: 'Bearer xyz',
    }) as any;
    expect(out.token).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.secret).toBe('[REDACTED]');
    expect(out.Authorization).toBe('[REDACTED]');
  });

  test('passes through empty / null / undefined secret values', () => {
    const out = redactValue({ apiKey: '', token: null, password: undefined }) as any;
    expect(out.apiKey).toBe('');
    expect(out.token).toBeNull();
    expect(out.password).toBeUndefined();
  });

  test('safer-by-default: secret-named parent key masks ENTIRE subtree', () => {
    const out = redactValue({ auth: { headerValue: 'Bearer eyJlong', x: 1 } }) as any;
    expect(out.auth).toBe('[REDACTED]');
  });

  test('masks secret-shaped strings inside non-secret keys', () => {
    const out = redactValue({ request: { headers: ['Authorization: Bearer eyJlongtoken1234567890'] } }) as any;
    expect(out.request.headers[0]).toBe('Authorization: Bearer [REDACTED]');
  });

  test('preserves non-secret fields untouched', () => {
    const out = redactValue({ provider: 'openai', apiKey: 'sk-x123456789012345', maxTokens: 4096 }) as any;
    expect(out.provider).toBe('openai');
    expect(out.maxTokens).toBe(4096);
    expect(out.apiKey).toBe('[REDACTED]');
  });

  test('handles circular references safely', () => {
    const obj: any = { name: 'cycle' };
    obj.self = obj;
    const out = redactValue(obj) as any;
    expect(out.name).toBe('cycle');
    expect(out.self).toBe('[Circular]');
  });

  test('redacts Error.message and stack', () => {
    const err = new Error('failed sk-realkey1234567890ABCDEF');
    const out = redactValue(err) as any;
    expect(out.message).toBe('failed sk-[REDACTED]');
    expect(typeof out.stack).toBe('string');
  });
});

/**
 * Memory destination — captures every line pino emits as a JSON string.
 * Pino calls .write(chunk) where chunk is the formatted line (\n-suffixed).
 */
function createMemoryDestination() {
  const lines: string[] = [];
  return {
    write(chunk: string): void {
      lines.push(chunk.trimEnd());
    },
    lines,
    parsed(): any[] {
      return lines.map(l => {
        try { return JSON.parse(l); } catch { return { raw: l }; }
      });
    },
  };
}

describe('logger.info() end-to-end → pino destination', () => {
  let mem: ReturnType<typeof createMemoryDestination>;

  beforeEach(() => {
    mem = createMemoryDestination();
    // Force json (raw) format so we don't drag pino-pretty into the test.
    logger.configure({ level: 'info', format: 'json' });
    setLoggerDestination(mem as any);
  });

  afterEach(() => {
    setLoggerDestination(undefined);
    logger.configure({ format: 'pretty' });
  });

  test('redacts apiKey in single-object arg (lifted to top level)', () => {
    logger.info('config loaded', { apiKey: 'sk-realsecret1234567890', model: 'gpt-4' });
    const [line] = mem.parsed();
    expect(line.apiKey).toBe('[REDACTED]');
    expect(line.model).toBe('gpt-4');
    expect(line.msg).toBe('config loaded');
  });

  test('redacts sk-* in plain message string', () => {
    logger.info('connecting with sk-livesecret1234567890ABC to provider');
    const [line] = mem.parsed();
    expect(line.msg).toBe('connecting with sk-[REDACTED] to provider');
  });

  test('redacts nested apiKey via object walk', () => {
    logger.info('boot', { providers: [{ name: 'zhipu', apiKey: 'sk-zhipu-secret1234567890' }] });
    const [line] = mem.parsed();
    expect(line.providers[0].name).toBe('zhipu');
    expect(line.providers[0].apiKey).toBe('[REDACTED]');
  });

  test('redacts secrets in Error.message', () => {
    const err = new Error('failed to call api with sk-realkey1234567890ABCDEF: 401');
    logger.error('api error', err);
    const [line] = mem.parsed();
    // Errors land under args[0] (we deliberately don't lift them — pino
    // has its own special `err` handling we'd collide with).
    expect(line.args[0].message).toBe('failed to call api with sk-[REDACTED]: 401');
    expect(line.msg).toBe('api error');
  });
});
