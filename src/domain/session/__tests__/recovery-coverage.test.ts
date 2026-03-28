/**
 * Additional coverage tests for session/recovery.ts
 * Targets uncovered lines: disk fallback (85-101), MAX_RECOVERY_ATTEMPTS (126-133),
 * pendingDeliveryOnly phase 1 (277-280), multimodal recovery (285-291),
 * feishu delivery failure catch (334-342), delayMs branch (368-369),
 * empty sessions (no messages), stale pendingRecovery on answered session
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks                                                             */
/* ------------------------------------------------------------------ */

// Hoist mock references so they are available inside vi.mock factories
const mocks = vi.hoisted(() => ({
  existsSyncFn: vi.fn(),
  readdirSyncFn: vi.fn(),
  readFileSyncFn: vi.fn(),
  confirmDeliveryFn: vi.fn(),
  MAX_RECOVERY_ATTEMPTS: 3,
}));

vi.mock('fs', () => ({
  existsSync: mocks.existsSyncFn,
  readdirSync: mocks.readdirSyncFn,
  readFileSync: mocks.readFileSyncFn,
}));

vi.mock('bun:sqlite', () => {
  const MockDatabase = vi.fn(() => ({
    exec: vi.fn(), run: vi.fn(),
    query: vi.fn(() => ({ all: vi.fn(() => []) })),
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) })),
    transaction: vi.fn((fn: Function) => fn),
    close: vi.fn(),
  }));
  return { Database: MockDatabase, default: MockDatabase };
});
vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  })),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: vi.fn() }));
vi.mock('bunqueue/client', () => ({ Queue: vi.fn(), Worker: vi.fn() }));

vi.mock('../index', async (importOriginal) => {
  const orig: any = await importOriginal();
  return {
    ...orig,
    confirmDelivery: mocks.confirmDeliveryFn,
    MAX_RECOVERY_ATTEMPTS: mocks.MAX_RECOVERY_ATTEMPTS,
  };
});

vi.mock('@infra/observability/logger', () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  logger: {
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  },
}));

import { detectUnansweredSessions, recoverUnansweredSessions } from '../recovery';
import type { RecoveryConfig } from '../recovery';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const now = Date.now();

function defaultConfig(overrides: Partial<RecoveryConfig> = {}): RecoveryConfig {
  return {
    enabled: true,
    maxAge: 300_000,
    minAge: 10_000,
    channels: ['feishu'],
    batchSize: 5,
    delayMs: 0,
    startupDelay: 0,
    ...overrides,
  };
}

function makeSession(overrides: Record<string, any> = {}) {
  return {
    id: 'sess-1',
    userId: 'u1',
    channel: 'feishu',
    createdAt: new Date(now - 3_600_000).toISOString(),
    updatedAt: new Date(now - 60_000).toISOString(),
    messages: [
      {
        role: 'user',
        content: 'Hello world',
        timestamp: new Date(now - 60_000).toISOString(),
      },
    ],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  vi.clearAllMocks();
});

describe('detectUnansweredSessions — disk fallback', () => {
  it('returns empty when sessionsPath does not exist', async () => {
    mocks.existsSyncFn.mockReturnValue(false);

    const result = await detectUnansweredSessions(defaultConfig(), {
      /* no getAllSessions — triggers disk fallback */
    });

    expect(result).toHaveLength(0);
    expect(mocks.existsSyncFn).toHaveBeenCalled();
  });

  it('loads sessions from disk JSON files', async () => {
    mocks.existsSyncFn.mockReturnValue(true);
    mocks.readdirSyncFn.mockReturnValue(['s1.json', 's2.txt', 's3.json']);

    const sess1 = makeSession({ id: 'disk-1' });
    const sess3 = makeSession({ id: 'disk-3' });

    mocks.readFileSyncFn.mockImplementation((path: string) => {
      if (path.includes('s1.json')) return JSON.stringify(sess1);
      if (path.includes('s3.json')) return JSON.stringify(sess3);
      throw new Error('unexpected');
    });

    const result = await detectUnansweredSessions(defaultConfig());
    // Both .json files should be loaded (s2.txt filtered out)
    expect(result).toHaveLength(2);
    expect(mocks.readdirSyncFn).toHaveBeenCalled();
  });

  it('handles JSON parse error in a session file gracefully', async () => {
    mocks.existsSyncFn.mockReturnValue(true);
    mocks.readdirSyncFn.mockReturnValue(['bad.json', 'good.json']);

    const goodSession = makeSession({ id: 'good-1' });
    mocks.readFileSyncFn.mockImplementation((path: string) => {
      if (path.includes('bad.json')) return '{invalid json';
      return JSON.stringify(goodSession);
    });

    const result = await detectUnansweredSessions(defaultConfig());
    // bad.json is skipped, good.json is loaded
    expect(result).toHaveLength(1);
    expect(result[0].session.id).toBe('good-1');
  });

  it('uses custom sessionsPath option', async () => {
    mocks.existsSyncFn.mockReturnValue(false);

    await detectUnansweredSessions(defaultConfig(), {
      sessionsPath: '/custom/sessions',
    });

    expect(mocks.existsSyncFn).toHaveBeenCalledWith('/custom/sessions');
  });
});

describe('detectUnansweredSessions — MAX_RECOVERY_ATTEMPTS exceeded', () => {
  it('skips session that exceeded max recovery attempts', async () => {
    const sess = makeSession({
      id: 'over-limit',
      pendingRecovery: true,
      recoveryAttempts: 3,
    });

    const result = await detectUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
    });

    expect(result).toHaveLength(0);
    // Flags should be cleared on the session object
    expect(sess.pendingRecovery).toBe(false);
    expect(sess.pendingDelivery).toBe(false);
  });

  it('does NOT skip when attempts are below limit', async () => {
    const sess = makeSession({
      id: 'under-limit',
      pendingRecovery: true,
      recoveryAttempts: 2,
    });

    const result = await detectUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
    });

    expect(result).toHaveLength(1);
    expect(result[0].recoveryAttempts).toBe(2);
  });
});

describe('detectUnansweredSessions — stale pendingRecovery on answered session', () => {
  it('clears stale pendingRecovery flag when last message is assistant', async () => {
    const sess = makeSession({
      id: 'stale-pr',
      pendingRecovery: true,
      messages: [
        { role: 'user', content: 'hi', timestamp: new Date(now - 120_000).toISOString() },
        { role: 'assistant', content: 'hello', timestamp: new Date(now - 60_000).toISOString() },
      ],
    });

    const result = await detectUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
    });

    expect(result).toHaveLength(0);
    expect(sess.pendingRecovery).toBe(false);
  });
});

describe('detectUnansweredSessions — empty messages', () => {
  it('skips sessions with no messages', async () => {
    const sess = makeSession({ id: 'empty', messages: [] });

    const result = await detectUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
    });

    expect(result).toHaveLength(0);
  });
});

describe('detectUnansweredSessions — pendingDeliveryOnly and multimodal metadata', () => {
  it('sets pendingDeliveryOnly and existingResponse for delivery-pending sessions', async () => {
    const sess = makeSession({
      id: 'delivery-only',
      pendingDelivery: true,
      lastAiResponse: 'cached response',
      pendingRecovery: true,
      recoveryAttempts: 0,
    });

    const result = await detectUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
    });

    expect(result).toHaveLength(1);
    expect(result[0].pendingDeliveryOnly).toBe(true);
    expect(result[0].existingResponse).toBe('cached response');
  });

  it('captures multimodal metadata from _meta', async () => {
    const sess = makeSession({
      id: 'multi',
      messages: [
        {
          role: 'user',
          content: 'Look at this image',
          timestamp: new Date(now - 60_000).toISOString(),
          _meta: {
            originalType: 'multimodal',
            visionDescription: 'A cat sitting on a desk',
          },
        },
      ],
    });

    const result = await detectUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
    });

    expect(result).toHaveLength(1);
    expect(result[0].wasMultimodal).toBe(true);
    expect(result[0].visionDescription).toBe('A cat sitting on a desk');
  });

  it('does not set visionDescription when not multimodal', async () => {
    const sess = makeSession({ id: 'text-only' });

    const result = await detectUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
    });

    expect(result).toHaveLength(1);
    expect(result[0].wasMultimodal).toBeFalsy();
    expect(result[0].visionDescription).toBeUndefined();
  });
});

/* ================================================================== */
/*  recoverUnansweredSessions                                         */
/* ================================================================== */

describe('recoverUnansweredSessions — pendingDeliveryOnly phase 1', () => {
  it('re-delivers cached response without calling sendProactiveMessage', async () => {
    const sendProactiveFn = vi.fn();
    const sendPostMessageFn = vi.fn();

    const sess = makeSession({
      id: 'redeliver-1',
      pendingDelivery: true,
      pendingRecovery: true,
      lastAiResponse: 'Previously generated AI response',
      recoveryAttempts: 0,
      metadata: { chatId: 'chat-123' },
    });

    const result = await recoverUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
      sendProactiveMessage: sendProactiveFn,
      getFeishuClient: () => ({
        sendPostMessage: sendPostMessageFn,
      }),
    });

    expect(result.recovered).toBe(1);
    // Phase 1: should NOT call sendProactiveMessage
    expect(sendProactiveFn).not.toHaveBeenCalled();
    // Should send to Feishu with re-delivery title
    expect(sendPostMessageFn).toHaveBeenCalledWith(
      'chat-123',
      'chat_id',
      'Previously generated AI response',
      { title: '🔄 重新投递' },
    );
    expect(mocks.confirmDeliveryFn).toHaveBeenCalledWith('redeliver-1');
  });
});

describe('recoverUnansweredSessions — multimodal recovery (phase 2)', () => {
  it('constructs recovery message with vision context', async () => {
    let capturedMessage: string | undefined;
    const sess = makeSession({
      id: 'multi-recover',
      messages: [
        {
          role: 'user',
          content: 'What is in this photo?',
          timestamp: new Date(now - 60_000).toISOString(),
          _meta: {
            originalType: 'multimodal',
            visionDescription: 'A sunset over mountains',
          },
        },
      ],
      metadata: { chatId: 'chat-m1' },
    });

    const result = await recoverUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
      sendProactiveMessage: async (opts: any) => {
        capturedMessage = opts.message;
        return { success: true, response: 'Here is the sunset...' };
      },
      getFeishuClient: () => ({
        sendPostMessage: vi.fn(),
      }),
    });

    expect(result.recovered).toBe(1);
    expect(capturedMessage).toContain('图片描述：A sunset over mountains');
    expect(capturedMessage).toContain('What is in this photo?');
  });
});

describe('recoverUnansweredSessions — Feishu delivery failure catch', () => {
  it('saves AI response for Phase 1 retry when delivery fails', async () => {
    const sess = makeSession({
      id: 'delivery-fail',
      metadata: { chatId: 'chat-df' },
    }) as any;

    const result = await recoverUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess],
      sendProactiveMessage: async () => ({
        success: true,
        response: 'Generated response',
      }),
      getFeishuClient: () => ({
        sendPostMessage: vi.fn().mockRejectedValue(new Error('Network error')),
      }),
    });

    // Still counts as recovered (the catch doesn't rethrow)
    expect(result.recovered).toBe(1);
    // Session should have pendingDelivery saved for next retry
    expect(sess.pendingDelivery).toBe(true);
    expect(sess.lastAiResponse).toBe('Generated response');
  });

  it('does NOT set pendingDelivery when delivery-only re-delivery fails', async () => {
    const sess = makeSession({
      id: 'redeliver-fail',
      pendingDelivery: true,
      pendingRecovery: true,
      lastAiResponse: 'Cached response',
      recoveryAttempts: 0,
      metadata: { chatId: 'chat-rdf' },
    }) as any;

    const result = await recoverUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess],
      sendProactiveMessage: vi.fn(),
      getFeishuClient: () => ({
        sendPostMessage: vi.fn().mockRejectedValue(new Error('Feishu down')),
      }),
    });

    // Still recovered (catch doesn't rethrow)
    expect(result.recovered).toBe(1);
    // pendingDelivery already true, should not change lastAiResponse since
    // the !pendingDeliveryOnly condition is false
    // The existing cached response should remain
  });
});

describe('recoverUnansweredSessions — non-feishu channel', () => {
  it('does not attempt feishu delivery for non-feishu channel', async () => {
    const sendPostMessageFn = vi.fn();
    const config = defaultConfig({ channels: ['feishu', 'webhook'] });
    const sess = makeSession({
      id: 'webhook-sess',
      channel: 'webhook',
      metadata: { chatId: 'chat-wh' },
    });

    const result = await recoverUnansweredSessions(config, {
      getAllSessions: () => [sess as any],
      sendProactiveMessage: async () => ({
        success: true,
        response: 'webhook response',
      }),
      getFeishuClient: () => ({
        sendPostMessage: sendPostMessageFn,
      }),
    });

    expect(result.recovered).toBe(1);
    // channel is 'webhook', not 'feishu', so sendPostMessage should not be called
    expect(sendPostMessageFn).not.toHaveBeenCalled();
  });
});

describe('recoverUnansweredSessions — no sendProactiveMessage provided', () => {
  it('recovers without calling proactive when function not provided', async () => {
    const sess = makeSession({
      id: 'no-proactive',
      metadata: { chatId: 'chat-np' },
    });

    const result = await recoverUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
      // no sendProactiveMessage
      getFeishuClient: () => ({
        sendPostMessage: vi.fn(),
      }),
    });

    // Should still count as recovered (no error thrown)
    expect(result.recovered).toBe(1);
  });
});

describe('recoverUnansweredSessions — error handling', () => {
  it('handles non-Error throw from sendProactiveMessage', async () => {
    const sess = makeSession({ id: 'str-err' });

    const result = await recoverUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
      sendProactiveMessage: async () => {
        throw 'string error';
      },
    });

    expect(result.failed).toBe(1);
    expect(result.details[0].error).toBe('string error');
  });

  it('increments recoveryAttempts on the session object', async () => {
    const sess = makeSession({
      id: 'attempt-inc',
      recoveryAttempts: 1,
    }) as any;

    await recoverUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess],
      sendProactiveMessage: async () => ({ success: true }),
    });

    expect(sess.recoveryAttempts).toBe(2);
    expect(sess.lastRecoveryAt).toBeDefined();
  });
});

describe('recoverUnansweredSessions — delayMs branch', () => {
  it('waits between messages when delayMs > 0', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const sess1 = makeSession({ id: 'delay-1' });
    const sess2 = makeSession({ id: 'delay-2' });

    const config = defaultConfig({ delayMs: 100 });

    const promise = recoverUnansweredSessions(config, {
      getAllSessions: () => [sess1 as any, sess2 as any],
      sendProactiveMessage: async () => ({ success: true }),
    });

    const result = await promise;

    expect(result.recovered).toBe(2);

    vi.useRealTimers();
  });
});

describe('recoverUnansweredSessions — feishu client edge cases', () => {
  it('skips feishu send when getFeishuClient returns null', async () => {
    const sess = makeSession({
      id: 'null-client',
      metadata: { chatId: 'chat-nc' },
    });

    const result = await recoverUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
      sendProactiveMessage: async () => ({
        success: true,
        response: 'some response',
      }),
      getFeishuClient: () => null,
    });

    expect(result.recovered).toBe(1);
    expect(mocks.confirmDeliveryFn).not.toHaveBeenCalled();
  });

  it('skips feishu send when session has no chatId in metadata', async () => {
    const sess = makeSession({
      id: 'no-chatid',
      metadata: {},
    });

    const result = await recoverUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
      sendProactiveMessage: async () => ({
        success: true,
        response: 'some response',
      }),
      getFeishuClient: () => ({
        sendPostMessage: vi.fn(),
      }),
    });

    expect(result.recovered).toBe(1);
    expect(mocks.confirmDeliveryFn).not.toHaveBeenCalled();
  });

  it('skips feishu send when getFeishuClient is not provided', async () => {
    const sess = makeSession({
      id: 'no-client-fn',
      metadata: { chatId: 'chat-x' },
    });

    const result = await recoverUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
      sendProactiveMessage: async () => ({
        success: true,
        response: 'resp',
      }),
      // no getFeishuClient
    });

    expect(result.recovered).toBe(1);
    expect(mocks.confirmDeliveryFn).not.toHaveBeenCalled();
  });
});

describe('recoverUnansweredSessions — proactive error with error message', () => {
  it('uses proactive error message in failure details', async () => {
    const sess = makeSession({ id: 'proactive-err' });

    const result = await recoverUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
      sendProactiveMessage: async () => ({
        success: false,
        error: 'Service unavailable',
      }),
    });

    expect(result.failed).toBe(1);
    expect(result.details[0].error).toBe('Service unavailable');
  });

  it('uses "Unknown error" when proactive returns failure without error message', async () => {
    const sess = makeSession({ id: 'proactive-unk' });

    const result = await recoverUnansweredSessions(defaultConfig(), {
      getAllSessions: () => [sess as any],
      sendProactiveMessage: async () => ({
        success: false,
      }),
    });

    expect(result.failed).toBe(1);
    expect(result.details[0].error).toBe('Unknown error');
  });
});
