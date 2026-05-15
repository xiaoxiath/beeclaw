/**
 * Codex (ChatGPT-subscription) OAuth token handling.
 *
 * Codex is auth'd via the ChatGPT subscription, not by an sk-* API key.
 * The user runs `codex login` once (a separate CLI from beeclaw) which
 * does the browser OAuth dance and writes:
 *
 *   ~/.codex/auth.json
 *     {
 *       "auth_mode": "chatgpt",
 *       "OPENAI_API_KEY": "...",
 *       "tokens": {
 *         "id_token": "...",
 *         "access_token": "<JWT used as Bearer>",
 *         "refresh_token": "<used to mint new access_tokens>",
 *         "account_id": "..."
 *       },
 *       "last_refresh": "..."
 *     }
 *
 * This module wraps three jobs:
 *   1. read the file
 *   2. extract the `chatgpt_account_id` claim out of the access_token
 *      (the Codex backend's Cloudflare layer uses it as a routing
 *      header — without it, requests get 403'd)
 *   3. POST to https://auth.openai.com/oauth/token with grant_type=
 *      refresh_token to mint a new access_token when the current one
 *      401s, then write the result back to disk so subsequent runs
 *      pick up the rotation.
 *
 * What this file deliberately does NOT do: the OAuth login flow
 * itself (browser, PKCE, etc.). That's the Codex CLI's job; beeclaw
 * just consumes the credentials it produces.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../../infra/observability/logger';

// Public client id used by the canonical Codex CLI. Surfaced from the
// upstream hermes adapter — this is a constant baked into Codex CLI
// distributions, not a secret. Re-using it is what lets the same
// refresh_token issued to Codex CLI also work from here.
const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';

/** Path to the canonical Codex CLI auth file under the current user's home. */
export function defaultCodexAuthPath(): string {
  return join(homedir(), '.codex', 'auth.json');
}

/** Tokens portion of ~/.codex/auth.json that beeclaw actually uses. */
export interface CodexTokens {
  access_token: string;
  refresh_token: string;
  /** Optional — only used by some flows; we don't read it but preserve it on writeback. */
  id_token?: string;
  account_id?: string;
}

/** Full auth file shape. We preserve unknown fields on writeback. */
export interface CodexAuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: string;
  tokens: CodexTokens;
  last_refresh?: string;
  [extra: string]: unknown;
}

/**
 * Error subclass with relogin flag — callers can distinguish "transient
 * network blip, retry might help" from "user must re-run codex login".
 */
export class CodexAuthError extends Error {
  constructor(
    message: string,
    readonly opts: { code?: string; reloginRequired?: boolean } = {},
  ) {
    super(message);
    this.name = 'CodexAuthError';
  }
}

// ─── Load ──────────────────────────────────────────────────────────────────

/**
 * Read ~/.codex/auth.json. Throws CodexAuthError with reloginRequired
 * when the file is missing, malformed, or missing the tokens block.
 */
export function loadCodexAuthFile(path: string = defaultCodexAuthPath()): CodexAuthFile {
  if (!existsSync(path)) {
    throw new CodexAuthError(
      `Codex auth file not found at ${path}. Run \`codex\` (the Codex CLI) ` +
      `to log in once — it writes the OAuth tokens beeclaw reads from.`,
      { code: 'codex_auth_file_missing', reloginRequired: true },
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new CodexAuthError(
      `Codex auth file at ${path} is not valid JSON: ${(e as Error).message}`,
      { code: 'codex_auth_file_invalid_json', reloginRequired: true },
    );
  }
  if (!raw || typeof raw !== 'object') {
    throw new CodexAuthError(
      `Codex auth file at ${path} is not an object.`,
      { code: 'codex_auth_file_invalid_shape', reloginRequired: true },
    );
  }
  const tokens = (raw as Record<string, unknown>).tokens;
  if (
    !tokens
    || typeof tokens !== 'object'
    || typeof (tokens as Record<string, unknown>).access_token !== 'string'
    || typeof (tokens as Record<string, unknown>).refresh_token !== 'string'
  ) {
    throw new CodexAuthError(
      `Codex auth file at ${path} is missing required tokens.{access_token, refresh_token}. ` +
      `Re-run \`codex\` to refresh credentials.`,
      { code: 'codex_auth_tokens_missing', reloginRequired: true },
    );
  }
  return raw as CodexAuthFile;
}

/** Convenience — pull just the tokens. */
export function loadCodexTokens(path?: string): CodexTokens {
  return loadCodexAuthFile(path).tokens;
}

// ─── Write back ────────────────────────────────────────────────────────────

/**
 * Persist refreshed tokens, preserving any unknown top-level fields the
 * Codex CLI may add over time (forward-compat: don't clobber what we
 * don't understand).
 */
export function writeCodexAuthFile(
  updates: { access_token: string; refresh_token: string; last_refresh?: string },
  path: string = defaultCodexAuthPath(),
): void {
  let existing: CodexAuthFile;
  try {
    existing = loadCodexAuthFile(path);
  } catch {
    // File is gone or malformed — rebuild from scratch with what we have.
    existing = { tokens: { access_token: '', refresh_token: '' } };
  }
  const merged: CodexAuthFile = {
    ...existing,
    tokens: {
      ...existing.tokens,
      access_token: updates.access_token,
      refresh_token: updates.refresh_token,
    },
    last_refresh: updates.last_refresh ?? new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(merged, null, 2), 'utf-8');
}

// ─── JWT account-id extraction ─────────────────────────────────────────────

/**
 * Extract the chatgpt_account_id claim from an access_token JWT payload.
 *
 * Codex's Cloudflare layer expects this as an `ChatGPT-Account-ID`
 * header. Without it the request is 403'd before reaching the API.
 *
 * Tolerant: any parse failure returns undefined rather than throwing,
 * because a missing header surfaces as a clean 401/403 from the API
 * (which the caller handles), whereas a thrown error here would crash
 * the request mid-construction.
 */
export function extractChatgptAccountId(accessToken: string): string | undefined {
  if (typeof accessToken !== 'string' || accessToken.length === 0) return undefined;
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return undefined;
    // base64url → base64; pad to a multiple of 4
    const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
    const normal = padded.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(normal, 'base64').toString('utf-8');
    const claims = JSON.parse(json);
    if (!claims || typeof claims !== 'object') return undefined;
    // The claim is namespaced under a URI key (canonical OpenAI shape).
    const auth = (claims as Record<string, unknown>)['https://api.openai.com/auth'];
    if (!auth || typeof auth !== 'object') return undefined;
    const id = (auth as Record<string, unknown>).chatgpt_account_id;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

// ─── Refresh ───────────────────────────────────────────────────────────────

/**
 * Exchange a refresh_token for a fresh access_token.
 *
 * Returns the new pair (refresh_token may rotate — pass through whatever
 * the server returns; if it sends nothing we keep the old one). On any
 * non-200 response, surfaces a CodexAuthError. The reloginRequired flag
 * is set when the server's error code looks fatal (invalid_grant /
 * invalid_token / refresh_token_reused / 401 / 403) — those mean the
 * user has to re-run `codex login`, not that we should retry.
 */
export async function refreshCodexTokens(
  refreshToken: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ access_token: string; refresh_token: string }> {
  if (typeof refreshToken !== 'string' || !refreshToken.trim()) {
    throw new CodexAuthError(
      'Codex refresh failed: missing refresh_token. Run `codex` to re-authenticate.',
      { code: 'codex_auth_missing_refresh_token', reloginRequired: true },
    );
  }
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(CODEX_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CODEX_OAUTH_CLIENT_ID,
      }).toString(),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new CodexAuthError(
      `Codex refresh request failed: ${(e as Error).message}`,
      { code: 'codex_refresh_network', reloginRequired: false },
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    let code = 'codex_refresh_failed';
    let message = `Codex token refresh failed with status ${res.status}.`;
    let reloginRequired = res.status === 401 || res.status === 403;
    try {
      const errBody = await res.json() as Record<string, unknown> | null;
      if (errBody && typeof errBody === 'object') {
        const err = errBody.error;
        if (err && typeof err === 'object') {
          // OpenAI-style shape: { error: { code, type, message } }
          const nested = err as Record<string, unknown>;
          const c = (nested.code ?? nested.type) as unknown;
          if (typeof c === 'string' && c.trim()) code = c.trim();
          const m = nested.message as unknown;
          if (typeof m === 'string' && m.trim()) message = `Codex token refresh failed: ${m.trim()}`;
        } else if (typeof err === 'string' && err.trim()) {
          // OAuth-spec shape: { error: "code", error_description: "..." }
          code = err.trim();
          const desc = (errBody.error_description ?? errBody.message) as unknown;
          if (typeof desc === 'string' && desc.trim()) {
            message = `Codex token refresh failed: ${desc.trim()}`;
          }
        }
      }
    } catch { /* swallow body parse errors — original status is enough */ }

    if (['invalid_grant', 'invalid_token', 'invalid_request'].includes(code)) {
      reloginRequired = true;
    }
    if (code === 'refresh_token_reused') {
      reloginRequired = true;
      message =
        'Codex refresh_token was already consumed by another client (e.g. the Codex CLI ' +
        'or VS Code extension). Run `codex` in your terminal to mint fresh tokens.';
    }
    logger.warn('[CodexAuth] Refresh failed', { code, status: res.status, reloginRequired });
    throw new CodexAuthError(message, { code, reloginRequired });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await res.json() as Record<string, unknown>;
  } catch (e) {
    throw new CodexAuthError(
      `Codex refresh returned non-JSON body: ${(e as Error).message}`,
      { code: 'codex_refresh_invalid_json', reloginRequired: true },
    );
  }
  const access = payload.access_token;
  if (typeof access !== 'string' || !access.trim()) {
    throw new CodexAuthError(
      'Codex refresh response was missing access_token.',
      { code: 'codex_refresh_missing_access_token', reloginRequired: true },
    );
  }
  // refresh_token MAY rotate; if absent, keep the one we already had.
  const next = payload.refresh_token;
  return {
    access_token: access.trim(),
    refresh_token: typeof next === 'string' && next.trim() ? next.trim() : refreshToken,
  };
}

/**
 * One-shot helper: refresh tokens AND write them back to disk in a
 * single call. Used by the API client when it gets a 401.
 */
export async function refreshAndPersistCodexTokens(
  options: { authFilePath?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<CodexTokens> {
  const path = options.authFilePath ?? defaultCodexAuthPath();
  const current = loadCodexTokens(path);
  const refreshed = await refreshCodexTokens(current.refresh_token, {
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  writeCodexAuthFile(
    {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    },
    path,
  );
  return {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    id_token: current.id_token,
    account_id: current.account_id,
  };
}

// ─── Cloudflare headers ────────────────────────────────────────────────────

/**
 * Headers required for the chatgpt.com/backend-api/codex endpoint to
 * pass Cloudflare's bot check. The list of allowed `originator`s is
 * upstream-managed; `codex_cli_rs` is the canonical CLI value and is
 * known to be accepted. Pinning a Codex-shaped User-Agent reduces SDK
 * fingerprinting flags. The Account-ID header lets the backend route
 * to the right ChatGPT subscription.
 */
export function buildCodexCloudflareHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'codex_cli_rs/0.0.0 (Beeclaw)',
    'originator': 'codex_cli_rs',
  };
  const acctId = extractChatgptAccountId(accessToken);
  if (acctId) headers['ChatGPT-Account-ID'] = acctId;
  return headers;
}
