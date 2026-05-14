/**
 * Fallback messages are user-visible and historically Chinese-only.
 * This PR makes them overridable via AgentOptions.fallbackMessages
 * while keeping the Chinese defaults intact for backward compat.
 *
 * Verifies:
 *   - DEFAULT_FALLBACK_MESSAGES exported and unchanged in shape
 *   - AgentOptions accepts the new field shape
 *   - Defaults match the inlined fallbacks in orchestrator + stream-handler
 *     (i.e. no drift between the export and the actual emit sites)
 */

import { describe, test, expect } from 'vitest';
import { DEFAULT_FALLBACK_MESSAGES } from '../types';
import type { AgentOptions } from '../types';

describe('DEFAULT_FALLBACK_MESSAGES', () => {
  test('exports both fallback keys', () => {
    expect(DEFAULT_FALLBACK_MESSAGES).toHaveProperty('tokenBudgetExceeded');
    expect(DEFAULT_FALLBACK_MESSAGES).toHaveProperty('maxIterationsReached');
  });

  test('default values are non-empty strings (preserves backward compat)', () => {
    expect(typeof DEFAULT_FALLBACK_MESSAGES.tokenBudgetExceeded).toBe('string');
    expect(typeof DEFAULT_FALLBACK_MESSAGES.maxIterationsReached).toBe('string');
    expect(DEFAULT_FALLBACK_MESSAGES.tokenBudgetExceeded.length).toBeGreaterThan(0);
    expect(DEFAULT_FALLBACK_MESSAGES.maxIterationsReached.length).toBeGreaterThan(0);
  });

  test('default values still contain the historically pinned tokens', () => {
    // Several existing tests pin on these substrings — assert the same
    // here so the i18n PR doesn't accidentally drop them.
    expect(DEFAULT_FALLBACK_MESSAGES.tokenBudgetExceeded).toContain('Token');
    expect(DEFAULT_FALLBACK_MESSAGES.maxIterationsReached).toContain('工具调用次数限制');
  });

  test('default text is byte-identical to inline copies in orchestrator + stream-handler', async () => {
    // Drift guard: the production code intentionally inlines these strings
    // (so test mocks of './types' don't have to re-list constants). That
    // means DEFAULT_FALLBACK_MESSAGES is the *contract* for downstream
    // consumers (CLI, web). If someone changes one without the others,
    // the contract is silently broken.
    const fs = await import('fs');
    const path = await import('path');
    const here = path.dirname(new URL(import.meta.url).pathname);
    const orchSrc = fs.readFileSync(path.join(here, '..', 'orchestrator.ts'), 'utf-8');
    const streamSrc = fs.readFileSync(path.join(here, '..', 'stream-handler.ts'), 'utf-8');

    expect(orchSrc).toContain(DEFAULT_FALLBACK_MESSAGES.tokenBudgetExceeded);
    expect(orchSrc).toContain(DEFAULT_FALLBACK_MESSAGES.maxIterationsReached);
    expect(streamSrc).toContain(DEFAULT_FALLBACK_MESSAGES.tokenBudgetExceeded);
  });
});

describe('AgentOptions.fallbackMessages typing', () => {
  test('accepts a partial override', () => {
    const opts: AgentOptions = {
      provider: {} as any,
      model: 'm',
      fallbackMessages: {
        tokenBudgetExceeded: 'Token budget exceeded — please simplify your request.',
      },
    };
    expect(opts.fallbackMessages?.tokenBudgetExceeded).toContain('Token budget');
    expect(opts.fallbackMessages?.maxIterationsReached).toBeUndefined();
  });

  test('accepts both keys overridden', () => {
    const opts: AgentOptions = {
      provider: {} as any,
      model: 'm',
      fallbackMessages: {
        tokenBudgetExceeded: 'A',
        maxIterationsReached: 'B',
      },
    };
    expect(opts.fallbackMessages).toEqual({
      tokenBudgetExceeded: 'A',
      maxIterationsReached: 'B',
    });
  });
});
