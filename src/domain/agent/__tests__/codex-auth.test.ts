/**
 * Codex OAuth token handling — read/write/refresh + JWT account-id.
 *
 * Real fs (via vi.unmock) for the file IO paths; mock fetch for the
 * refresh endpoint. JWT parsing is tested with synthesized payloads
 * since the claim path is the only thing we care about.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.unmock('fs');

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import {
  loadCodexAuthFile,
  loadCodexTokens,
  writeCodexAuthFile,
  extractChatgptAccountId,
  refreshCodexTokens,
  refreshAndPersistCodexTokens,
  buildCodexCloudflareHeaders,
  CodexAuthError,
  defaultCodexAuthPath,
} from '../codex-auth';

let tmp: string;
let authPath: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beeclaw-codex-auth-'));
  authPath = path.join(tmp, 'auth.json');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Helper to fake a JWT with a payload (signature is ignored).
function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

// ─── defaultCodexAuthPath ──────────────────────────────────────────────────

describe('defaultCodexAuthPath', () => {
  test('points at ~/.codex/auth.json under HOME', () => {
    const p = defaultCodexAuthPath();
    expect(p.endsWith('/.codex/auth.json')).toBe(true);
    expect(p.startsWith(os.homedir())).toBe(true);
  });
});

// ─── loadCodexAuthFile ────────────────────────────────────────────────────

describe('loadCodexAuthFile', () => {
  test('reads a well-formed file', () => {
    fs.writeFileSync(authPath, JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        id_token: 'id-1',
        account_id: 'acct-1',
      },
      last_refresh: '2026-05-15T08:00:00Z',
    }));
    const file = loadCodexAuthFile(authPath);
    expect(file.tokens.access_token).toBe('access-1');
    expect(file.tokens.refresh_token).toBe('refresh-1');
    expect(file.auth_mode).toBe('chatgpt');
  });

  test('throws reloginRequired when file missing', () => {
    expect(() => loadCodexAuthFile(authPath)).toThrowError(CodexAuthError);
    try {
      loadCodexAuthFile(authPath);
    } catch (e) {
      expect((e as CodexAuthError).opts.code).toBe('codex_auth_file_missing');
      expect((e as CodexAuthError).opts.reloginRequired).toBe(true);
    }
  });

  test('throws on invalid JSON', () => {
    fs.writeFileSync(authPath, '{not valid');
    try {
      loadCodexAuthFile(authPath);
    } catch (e) {
      expect((e as CodexAuthError).opts.code).toBe('codex_auth_file_invalid_json');
      expect((e as CodexAuthError).opts.reloginRequired).toBe(true);
    }
  });

  test('throws on missing tokens block', () => {
    fs.writeFileSync(authPath, JSON.stringify({ auth_mode: 'chatgpt' }));
    try {
      loadCodexAuthFile(authPath);
    } catch (e) {
      expect((e as CodexAuthError).opts.code).toBe('codex_auth_tokens_missing');
    }
  });

  test('throws when access_token missing in tokens', () => {
    fs.writeFileSync(authPath, JSON.stringify({
      tokens: { refresh_token: 'r' },
    }));
    try {
      loadCodexAuthFile(authPath);
    } catch (e) {
      expect((e as CodexAuthError).opts.code).toBe('codex_auth_tokens_missing');
    }
  });

  test('throws when refresh_token missing', () => {
    fs.writeFileSync(authPath, JSON.stringify({
      tokens: { access_token: 'a' },
    }));
    try {
      loadCodexAuthFile(authPath);
    } catch (e) {
      expect((e as CodexAuthError).opts.code).toBe('codex_auth_tokens_missing');
    }
  });
});

describe('loadCodexTokens', () => {
  test('returns just the tokens object', () => {
    fs.writeFileSync(authPath, JSON.stringify({
      tokens: { access_token: 'a', refresh_token: 'r' },
    }));
    expect(loadCodexTokens(authPath)).toEqual({ access_token: 'a', refresh_token: 'r' });
  });
});

// ─── writeCodexAuthFile ───────────────────────────────────────────────────

describe('writeCodexAuthFile', () => {
  test('writes a fresh file when one does not exist', () => {
    writeCodexAuthFile({ access_token: 'a1', refresh_token: 'r1' }, authPath);
    const written = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    expect(written.tokens.access_token).toBe('a1');
    expect(written.tokens.refresh_token).toBe('r1');
    expect(written.last_refresh).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('preserves unknown top-level fields on overwrite (forward-compat)', () => {
    fs.writeFileSync(authPath, JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: 'fallback',
      future_field: { nested: true },
      tokens: { access_token: 'old', refresh_token: 'old-r', id_token: 'id', account_id: 'acct' },
    }));
    writeCodexAuthFile({ access_token: 'new', refresh_token: 'new-r' }, authPath);
    const written = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    expect(written.auth_mode).toBe('chatgpt');
    expect(written.OPENAI_API_KEY).toBe('fallback');
    expect(written.future_field).toEqual({ nested: true });
    // Tokens replaced, but id_token/account_id preserved.
    expect(written.tokens.access_token).toBe('new');
    expect(written.tokens.refresh_token).toBe('new-r');
    expect(written.tokens.id_token).toBe('id');
    expect(written.tokens.account_id).toBe('acct');
  });

  test('uses provided last_refresh when given', () => {
    writeCodexAuthFile(
      { access_token: 'a', refresh_token: 'r', last_refresh: '2026-01-01T00:00:00Z' },
      authPath,
    );
    const written = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    expect(written.last_refresh).toBe('2026-01-01T00:00:00Z');
  });
});

// ─── extractChatgptAccountId ──────────────────────────────────────────────

describe('extractChatgptAccountId', () => {
  test('returns the account id from the namespaced claim', () => {
    const jwt = fakeJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-abc-123' },
    });
    expect(extractChatgptAccountId(jwt)).toBe('acct-abc-123');
  });

  test('returns undefined when claim is absent', () => {
    const jwt = fakeJwt({ sub: 'user-1', exp: 0 });
    expect(extractChatgptAccountId(jwt)).toBeUndefined();
  });

  test('returns undefined when namespaced claim is wrong type', () => {
    const jwt = fakeJwt({ 'https://api.openai.com/auth': 'string-not-object' });
    expect(extractChatgptAccountId(jwt)).toBeUndefined();
  });

  test('returns undefined when chatgpt_account_id is empty', () => {
    const jwt = fakeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: '' } });
    expect(extractChatgptAccountId(jwt)).toBeUndefined();
  });

  test('returns undefined for non-string input', () => {
    expect(extractChatgptAccountId(undefined as any)).toBeUndefined();
    expect(extractChatgptAccountId(null as any)).toBeUndefined();
    expect(extractChatgptAccountId('' as any)).toBeUndefined();
  });

  test('returns undefined for malformed JWT (no dots)', () => {
    expect(extractChatgptAccountId('not-a-jwt')).toBeUndefined();
  });

  test('returns undefined when payload is not valid JSON (does not throw)', () => {
    const broken = `${Buffer.from('{}').toString('base64url')}.${Buffer.from('not json').toString('base64url')}.sig`;
    expect(extractChatgptAccountId(broken)).toBeUndefined();
  });
});

// ─── buildCodexCloudflareHeaders ──────────────────────────────────────────

describe('buildCodexCloudflareHeaders', () => {
  test('always emits originator + User-Agent', () => {
    const headers = buildCodexCloudflareHeaders('not-a-jwt');
    expect(headers['originator']).toBe('codex_cli_rs');
    expect(headers['User-Agent']).toMatch(/codex_cli_rs/);
  });

  test('adds ChatGPT-Account-ID when JWT has the claim', () => {
    const jwt = fakeJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-9' },
    });
    const headers = buildCodexCloudflareHeaders(jwt);
    expect(headers['ChatGPT-Account-ID']).toBe('acct-9');
  });

  test('omits Account-ID header when claim is absent', () => {
    const jwt = fakeJwt({ sub: 'u' });
    const headers = buildCodexCloudflareHeaders(jwt);
    expect(headers['ChatGPT-Account-ID']).toBeUndefined();
  });
});

// ─── refreshCodexTokens (mock fetch) ──────────────────────────────────────

describe('refreshCodexTokens', () => {
  test('returns new access_token + rotated refresh_token on 200', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'new-a', refresh_token: 'new-r' }),
    } as any);

    const out = await refreshCodexTokens('old-r', { fetchImpl: mockFetch });
    expect(out).toEqual({ access_token: 'new-a', refresh_token: 'new-r' });

    // Verify request shape — endpoint, method, body fields.
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://auth.openai.com/oauth/token');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = init.body as string;
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=old-r');
    expect(body).toContain('client_id=app_EMoamEEZ73f0CkXaXp7hrann');
  });

  test('keeps original refresh_token when server omits rotation', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'new-a' }),
    } as any);
    const out = await refreshCodexTokens('keep-me', { fetchImpl: mockFetch });
    expect(out.refresh_token).toBe('keep-me');
  });

  test('throws reloginRequired on invalid_grant', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'expired' }),
    } as any);
    try {
      await refreshCodexTokens('r', { fetchImpl: mockFetch });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as CodexAuthError).opts.code).toBe('invalid_grant');
      expect((e as CodexAuthError).opts.reloginRequired).toBe(true);
    }
  });

  test('throws reloginRequired with helpful message on refresh_token_reused', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'refresh_token_reused' }),
    } as any);
    try {
      await refreshCodexTokens('r', { fetchImpl: mockFetch });
      expect.unreachable();
    } catch (e) {
      expect((e as CodexAuthError).opts.code).toBe('refresh_token_reused');
      expect((e as CodexAuthError).opts.reloginRequired).toBe(true);
      expect((e as Error).message).toMatch(/already consumed/);
    }
  });

  test('handles OpenAI-shape error body { error: { code, message } }', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: 'unauthorized', message: 'token expired' },
      }),
    } as any);
    try {
      await refreshCodexTokens('r', { fetchImpl: mockFetch });
      expect.unreachable();
    } catch (e) {
      expect((e as CodexAuthError).opts.code).toBe('unauthorized');
      // 401 → reloginRequired even without explicit invalid_grant code
      expect((e as CodexAuthError).opts.reloginRequired).toBe(true);
      expect((e as Error).message).toContain('token expired');
    }
  });

  test('non-fatal status (500) → reloginRequired=false (operator should retry)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server_error' }),
    } as any);
    try {
      await refreshCodexTokens('r', { fetchImpl: mockFetch });
      expect.unreachable();
    } catch (e) {
      expect((e as CodexAuthError).opts.reloginRequired).toBe(false);
    }
  });

  test('throws when refresh_token missing', async () => {
    try {
      await refreshCodexTokens('');
      expect.unreachable();
    } catch (e) {
      expect((e as CodexAuthError).opts.code).toBe('codex_auth_missing_refresh_token');
      expect((e as CodexAuthError).opts.reloginRequired).toBe(true);
    }
  });

  test('throws when response is missing access_token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ refresh_token: 'r-only' }),
    } as any);
    try {
      await refreshCodexTokens('r', { fetchImpl: mockFetch });
      expect.unreachable();
    } catch (e) {
      expect((e as CodexAuthError).opts.code).toBe('codex_refresh_missing_access_token');
    }
  });

  test('wraps network errors with reloginRequired=false', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    try {
      await refreshCodexTokens('r', { fetchImpl: mockFetch });
      expect.unreachable();
    } catch (e) {
      expect((e as CodexAuthError).opts.code).toBe('codex_refresh_network');
      expect((e as CodexAuthError).opts.reloginRequired).toBe(false);
      expect((e as Error).message).toContain('ECONNRESET');
    }
  });
});

// ─── refreshAndPersistCodexTokens ─────────────────────────────────────────

describe('refreshAndPersistCodexTokens', () => {
  test('refreshes + writes the result back to disk', async () => {
    fs.writeFileSync(authPath, JSON.stringify({
      tokens: { access_token: 'old', refresh_token: 'old-r', id_token: 'id', account_id: 'acct' },
    }));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'new', refresh_token: 'new-r' }),
    } as any);

    const out = await refreshAndPersistCodexTokens({
      authFilePath: authPath,
      fetchImpl: mockFetch,
    });
    expect(out.access_token).toBe('new');
    expect(out.refresh_token).toBe('new-r');
    // id_token + account_id from the existing file flow through.
    expect(out.id_token).toBe('id');
    expect(out.account_id).toBe('acct');

    const onDisk = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    expect(onDisk.tokens.access_token).toBe('new');
    expect(onDisk.tokens.refresh_token).toBe('new-r');
    expect(onDisk.tokens.id_token).toBe('id'); // preserved
  });
});
