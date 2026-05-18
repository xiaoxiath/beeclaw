import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use vi.hoisted for variables referenced in vi.mock factories
const { mockHandleHITLResponse, mockHookRunner, mockAgent, mockExtractionManager } = vi.hoisted(() => ({
  mockHandleHITLResponse: vi.fn(async () => null),
  mockHookRunner: {
    runSessionStart: vi.fn(),
    runSessionEnd: vi.fn(),
  },
  mockAgent: {
    chat: vi.fn(async () => 'mock response'),
    addMessage: vi.fn(() => {}),
    getLastToolCalls: vi.fn(() => []),
  },
  mockExtractionManager: {
    shouldTrigger: vi.fn(() => ({ reason: '' })),
    extract: vi.fn(async () => ({ triggered: false, notifications: [] })),
  },
}));

// Heavy mocking for the session index module
vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(() => {}), error: vi.fn(() => {}), warn: vi.fn(() => {}), debug: vi.fn(() => {}) },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));
vi.mock('../../../infra/utils/atomic-fs', () => ({
  writeFileAtomic: vi.fn(() => {}), readFileWithRecovery: vi.fn(() => null), cleanupTempFiles: vi.fn(() => {}),
}));
vi.mock('../../../infra/db', () => ({ getDataConnection: vi.fn(() => ({})) }));
vi.mock('../../../infra/db/schema', () => ({ sessions: { id: 'id' } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => ({})) }));

vi.mock('../../ports', () => ({
  getPluginRegistryPort: vi.fn(() => null),
  getHookRunnerPort: vi.fn(() => mockHookRunner),
  getChannelClientPort: vi.fn(() => null),
  getMessageControllerFactory: vi.fn(() => null),
}));

vi.mock('../../agent', () => ({
  createAgent: vi.fn(() => mockAgent),
  SYSTEM_PROMPTS: { default: 'You are helpful.' },
  getAllToolsForAI: vi.fn(() => []),
  buildSystemPrompt: vi.fn((s: string) => s),
  formatSkillsForPrompt: vi.fn(() => ''),
}));
vi.mock('../../../infra/bee-adapter', () => ({
  getBeeAIClient: () => ({
    callAI: vi.fn(async () => ({ choices: [{ message: { content: 'summary' } }] })),
  }),
  toProviderConfig: (p: any) => p,
}));
vi.mock('../../agent/fast-llm-judge', () => ({ getFastModelFromConfig: vi.fn(() => null) }));
vi.mock('../../memory', () => ({ getMemoryStore: vi.fn(() => ({ getCoreContext: () => ({}) })) }));
vi.mock('../../skills/store', () => ({ getSkillStore: vi.fn(() => ({ list: () => [] })) }));
vi.mock('../../tools/deep-analysis', () => ({
  setDeepAnalysisContext: vi.fn(() => {}), clearDeepAnalysisContext: vi.fn(() => {}),
}));

vi.mock('../../extraction', () => ({
  initExtractionManager: vi.fn(() => {}),
  getExtractionManager: vi.fn(() => mockExtractionManager),
  resetExtractionManager: vi.fn(() => {}),
}));
vi.mock('../../../infra/config/schema', () => ({}));
vi.mock('../../../infra/resilience/session-lock', () => ({
  SessionMessageQueue: {
    getInstance: vi.fn(() => ({ enqueue: vi.fn(async (_id: string, fn: Function) => fn()) })),
    resetInstance: vi.fn(() => {}),
  },
}));
vi.mock('../../../app', () => ({ getConfig_: vi.fn(() => ({})) }));

// Fix: Use a class-based mock for SmartTimeout
vi.mock('../../../infra/resilience/smart-timeout', () => {
  class MockSmartTimeout {
    start() {}
    stop() {}
    recordActivity() {}
    getRuntimeMs() { return 1000; }
    getMonitor() {
      return {
        getStats: () => ({ totalEvents: 0, lastActivity: new Date() }),
        formatReport: () => '',
      };
    }
  }
  return { SmartTimeout: MockSmartTimeout };
});

vi.mock('../hitl-manager', () => ({ handleHITLResponse: mockHandleHITLResponse }));
vi.mock('../../../infra/config/resilience-config', () => ({
  resolveConfig: vi.fn(() => ({ timeout: { turnTimeoutMs: 120000 } })),
}));

// Import the mocked modules at top level (instead of using require() in test body)
import { initExtractionManager, getExtractionManager, resetExtractionManager } from '../../extraction';

import {
  generateSessionId,
  calculateRecoveryBackoff,
  getOrCreateSession,
  getSession,
  listSessions,
  deleteSession,
  clearRecoveryFlag,
  confirmDelivery,
  MAX_RECOVERY_ATTEMPTS,
  configureSessionManager,
  initSessionManager,
  markResponseDelivered,
  registerChannelHandler,
  getSessionSummary,
  getSessionStats,
  sendProactiveMessage,
  continueConversation,
  getExtraction,
  resetExtraction,
  saveSession,
  saveAllSessions,
  loadAllSessions,
  clearOldSessions,
  isMessageProcessed,
  getMessageState,
  markMessageProcessing,
  markMessageProcessed,
  markMessageCompleted,
  markMessageFailed,
  getCachedAgentResponse,
  injectProactiveResult,
  getRecentSessionHistory,
  getArchivedSessionSegments,
  readArchivedSessionSegment,
  searchArchivedSessionSegments,
  pruneProcessedMessages,
  isValidSession,
  MESSAGE_DEDUP_TTL_MS,
  MESSAGE_DEDUP_MAX_SIZE,
  MAX_MESSAGE_RETRY_COUNT,
  PROCESSING_STALE_TIMEOUT_MS,
  type Session,
} from '../index';

describe('session/index', () => {
  beforeEach(() => {
    mockAgent.chat.mockResolvedValue('mock response');
    mockHandleHITLResponse.mockResolvedValue(null);
  });

  // ─── Re-exports ────────────────────────────────────────────────────────
  describe('re-exports from dedup', () => {
    it('exports MESSAGE_DEDUP_TTL_MS', () => {
      expect(typeof MESSAGE_DEDUP_TTL_MS).toBe('number');
      expect(MESSAGE_DEDUP_TTL_MS).toBeGreaterThan(0);
    });
    it('exports MESSAGE_DEDUP_MAX_SIZE', () => {
      expect(typeof MESSAGE_DEDUP_MAX_SIZE).toBe('number');
    });
    it('exports MAX_MESSAGE_RETRY_COUNT', () => {
      expect(typeof MAX_MESSAGE_RETRY_COUNT).toBe('number');
    });
    it('exports PROCESSING_STALE_TIMEOUT_MS', () => {
      expect(typeof PROCESSING_STALE_TIMEOUT_MS).toBe('number');
    });
  });

  describe('re-exports from storage', () => {
    it('exports isValidSession', () => {
      expect(typeof isValidSession).toBe('function');
      expect(isValidSession({ id: 's1', messages: [] })).toBe(true);
      expect(isValidSession(null)).toBe(false);
    });
  });

  // ─── generateSessionId ─────────────────────────────────────────────────
  describe('generateSessionId', () => {
    it('should combine channel and identifiers', () => {
      expect(generateSessionId('feishu', 'user1', 'chat1')).toBe('feishu-user1-chat1');
    });

    it('should work with single identifier', () => {
      expect(generateSessionId('cli', 'user1')).toBe('cli-user1');
    });

    it('should work with no identifiers', () => {
      expect(generateSessionId('api')).toBe('api-');
    });
  });

  // ─── MAX_RECOVERY_ATTEMPTS ─────────────────────────────────────────────
  describe('MAX_RECOVERY_ATTEMPTS', () => {
    it('should be 3', () => {
      expect(MAX_RECOVERY_ATTEMPTS).toBe(3);
    });
  });

  // ─── configureSessionManager ───────────────────────────────────────────
  describe('configureSessionManager', () => {
    it('should accept partial config without error', () => {
      expect(() => configureSessionManager({ maxMessages: 50 })).not.toThrow();
    });

    it('should accept storagePath config', () => {
      expect(() => configureSessionManager({ storagePath: '/tmp/test-sessions' })).not.toThrow();
    });
  });

  // ─── initSessionManager ────────────────────────────────────────────────
  describe('initSessionManager', () => {
    it('should initialize with minimal config', () => {
      expect(() => initSessionManager({
        provider: 'openai',
        model: 'gpt-4',
      })).not.toThrow();
    });

    it('should initialize with full config', () => {
      expect(() => initSessionManager({
        provider: 'openai',
        model: 'gpt-4',
        systemPrompt: 'test prompt',
        useTools: true,
        tokenStatsConfig: {},
        extractionConfig: { enabled: true },
        memoryDir: '/tmp/mem',
        visionConfig: {
          visionModel: 'gpt-4-vision',
          textModel: 'gpt-4',
          fallbackOnError: 'placeholder',
          maxRetries: 2,
        },
        params: {
          temperature: 0.7,
          max_tokens: 4096,
        },
        resilienceConfig: { timeout: { turnTimeoutMs: 60000 } } as any,
      })).not.toThrow();
    });

    it('should handle extraction init failure gracefully', () => {
      vi.mocked(initExtractionManager).mockImplementationOnce(() => { throw new Error('fail'); });
      expect(() => initSessionManager({
        provider: 'openai',
        model: 'gpt-4',
        extractionConfig: { enabled: true },
      })).not.toThrow();
    });

    it('should skip extraction when disabled', () => {
      vi.mocked(initExtractionManager).mockClear();
      initSessionManager({
        provider: 'openai',
        model: 'gpt-4',
        extractionConfig: { enabled: false },
      });
      expect(initExtractionManager).not.toHaveBeenCalled();
    });
  });

  // ─── getOrCreateSession ────────────────────────────────────────────────
  describe('getOrCreateSession', () => {
    it('should create a new session with expected fields', () => {
      const session = getOrCreateSession({
        sessionId: 'test-new-' + Date.now(),
        userId: 'user-1',
        channel: 'cli',
      });
      expect(session).toBeDefined();
      expect(session.id).toContain('test-new-');
      expect(session.userId).toBe('user-1');
      expect(session.channel).toBe('cli');
      expect(session.messages).toEqual([]);
      expect(session.createdAt).toBeDefined();
    });

    it('should return same session on second call', () => {
      const id = 'test-reuse-' + Date.now();
      const s1 = getOrCreateSession({ sessionId: id, channel: 'cli' });
      const s2 = getOrCreateSession({ sessionId: id, channel: 'cli' });
      expect(s1).toBe(s2);
    });

    it('should default userId to "default-user"', () => {
      const id = 'test-default-user-' + Date.now();
      const s = getOrCreateSession({ sessionId: id, channel: 'cli' });
      expect(s.userId).toBe('default-user');
    });

    it('should store metadata', () => {
      const id = 'test-meta-' + Date.now();
      const s = getOrCreateSession({
        sessionId: id,
        channel: 'feishu',
        metadata: { chatId: 'chat123' },
      });
      expect(s.metadata).toEqual({ chatId: 'chat123' });
    });

    it('should update updatedAt on second call', () => {
      const id = 'test-update-' + Date.now();
      const s1 = getOrCreateSession({ sessionId: id, channel: 'cli' });
      const s2 = getOrCreateSession({ sessionId: id, channel: 'cli' });
      expect(s2.updatedAt).toBeDefined();
    });

    it('should fire session_start hook for new session', async () => {
      const id = 'test-hook-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'cli', userId: 'hookuser' });
      await new Promise(r => setTimeout(r, 10));
      expect(mockHookRunner.runSessionStart).toHaveBeenCalled();
    });
  });

  // ─── getSession ────────────────────────────────────────────────────────
  describe('getSession', () => {
    it('should return undefined for unknown session', () => {
      expect(getSession('nonexistent-' + Date.now())).toBeUndefined();
    });

    it('should return session after creation', () => {
      const id = 'test-get-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'cli' });
      const s = getSession(id);
      expect(s).toBeDefined();
      expect(s!.id).toBe(id);
    });
  });

  // ─── listSessions ─────────────────────────────────────────────────────
  describe('listSessions', () => {
    it('should return array of sessions', () => {
      const list = listSessions();
      expect(Array.isArray(list)).toBe(true);
    });

    it('should filter by channel', () => {
      const id = 'test-filter-ch-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'feishu', userId: 'u1' });
      const filtered = listSessions({ channel: 'webhook' });
      const found = filtered.find(s => s.id === id);
      expect(found).toBeUndefined();
    });

    it('should filter by userId', () => {
      const id = 'test-filter-uid-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'cli', userId: 'special-user-xyz' });
      const filtered = listSessions({ userId: 'special-user-xyz' });
      const found = filtered.find(s => s.id === id);
      expect(found).toBeDefined();
    });

    it('should filter by both channel and userId', () => {
      const id = 'test-filter-both-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'api', userId: 'both-user' });
      const yes = listSessions({ channel: 'api', userId: 'both-user' });
      expect(yes.find(s => s.id === id)).toBeDefined();
      const no = listSessions({ channel: 'cli', userId: 'both-user' });
      expect(no.find(s => s.id === id)).toBeUndefined();
    });

    it('should return all sessions with no filter', () => {
      const id1 = 'test-all1-' + Date.now();
      const id2 = 'test-all2-' + Date.now();
      getOrCreateSession({ sessionId: id1, channel: 'cli' });
      getOrCreateSession({ sessionId: id2, channel: 'feishu' });
      const all = listSessions();
      expect(all.find(s => s.id === id1)).toBeDefined();
      expect(all.find(s => s.id === id2)).toBeDefined();
    });
  });

  // ─── deleteSession ─────────────────────────────────────────────────────
  describe('deleteSession', () => {
    it('should delete an existing session', () => {
      const id = 'test-del-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'cli' });
      const result = deleteSession(id);
      expect(result).toBe(true);
      expect(getSession(id)).toBeUndefined();
    });

    it('should return false for unknown session', () => {
      expect(deleteSession('not-here-' + Date.now())).toBe(false);
    });

    it('should fire session_end hook', async () => {
      const id = 'test-del-hook-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'cli', userId: 'deluser' });
      mockHookRunner.runSessionEnd.mockClear();
      deleteSession(id);
      await new Promise(r => setTimeout(r, 10));
      expect(mockHookRunner.runSessionEnd).toHaveBeenCalled();
    });
  });

  // ─── clearRecoveryFlag ─────────────────────────────────────────────────
  describe('clearRecoveryFlag', () => {
    it('should clear recovery flag on existing session', () => {
      const id = 'test-recovery-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.pendingRecovery = true;
      clearRecoveryFlag(id);
      expect(session.pendingRecovery).toBe(false);
      expect(session.responseDelivered).toBe(true);
    });

    it('should do nothing for non-existent session', () => {
      expect(() => clearRecoveryFlag('nonexistent-' + Date.now())).not.toThrow();
    });
  });

  // ─── confirmDelivery ───────────────────────────────────────────────────
  describe('confirmDelivery', () => {
    it('should reset delivery tracking fields', () => {
      const id = 'test-confirm-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.pendingRecovery = true;
      session.pendingDelivery = true;
      session.lastAiResponse = 'cached';
      session.recoveryAttempts = 3;
      session.consecutiveRecoveryFailures = 2;

      confirmDelivery(id);

      expect(session.pendingRecovery).toBe(false);
      expect(session.pendingDelivery).toBe(false);
      expect(session.lastAiResponse).toBeUndefined();
      expect(session.recoveryAttempts).toBe(0);
      expect(session.consecutiveRecoveryFailures).toBe(0);
      expect(session.responseDelivered).toBe(true);
    });

    it('should do nothing for non-existent session', () => {
      expect(() => confirmDelivery('nonexistent-' + Date.now())).not.toThrow();
    });
  });

  // ─── calculateRecoveryBackoff ──────────────────────────────────────────
  describe('calculateRecoveryBackoff', () => {
    it('should return -1 for unknown session', () => {
      expect(calculateRecoveryBackoff('unknown-' + Date.now())).toBe(-1);
    });

    it('should return increasing backoff delays', () => {
      const id = 'test-backoff-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.consecutiveRecoveryFailures = 0;

      const d1 = calculateRecoveryBackoff(id);
      expect(d1).toBe(1000);
      const d2 = calculateRecoveryBackoff(id);
      expect(d2).toBe(4000);
      const d3 = calculateRecoveryBackoff(id);
      expect(d3).toBe(16000);
      const d4 = calculateRecoveryBackoff(id);
      expect(d4).toBe(64000);
      const d5 = calculateRecoveryBackoff(id);
      expect(d5).toBe(256000);
    });

    it('should return -1 after max failures (5)', () => {
      const id = 'test-maxfail-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.consecutiveRecoveryFailures = 5;
      expect(calculateRecoveryBackoff(id)).toBe(-1);
    });

    it('should update session fields on backoff', () => {
      const id = 'test-backoff-fields-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.consecutiveRecoveryFailures = 0;
      calculateRecoveryBackoff(id);
      expect(session.consecutiveRecoveryFailures).toBe(1);
      expect(session.lastRecoveryAt).toBeDefined();
    });
  });

  // ─── markResponseDelivered ─────────────────────────────────────────────
  describe('markResponseDelivered', () => {
    it('should mark response as delivered', () => {
      const id = 'test-delivered-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.responseDelivered = false;
      markResponseDelivered(id);
      expect(session.responseDelivered).toBe(true);
    });

    it('should do nothing for non-existent session', () => {
      expect(() => markResponseDelivered('nonexistent-' + Date.now())).not.toThrow();
    });
  });

  // ─── registerChannelHandler ────────────────────────────────────────────
  describe('registerChannelHandler', () => {
    it('should register a handler without error', () => {
      const handler = vi.fn(async () => {});
      expect(() => registerChannelHandler('test-channel', handler)).not.toThrow();
    });
  });

  // ─── getSessionSummary ─────────────────────────────────────────────────
  describe('getSessionSummary', () => {
    it('should return empty string for non-existent session', () => {
      expect(getSessionSummary('nonexistent-' + Date.now())).toBe('');
    });

    it('should return empty string for session with no messages', () => {
      const id = 'test-summary-empty-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'cli' });
      expect(getSessionSummary(id)).toBe('');
    });

    it('should return formatted summary of recent messages', () => {
      const id = 'test-summary-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli', userId: 'u1' });
      session.messages.push(
        { role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'Hi there!', timestamp: new Date().toISOString() },
      );
      const summary = getSessionSummary(id);
      expect(summary).toContain('[user] Hello');
      expect(summary).toContain('[assistant] Hi there!');
    });

    it('should respect maxMessages parameter', () => {
      const id = 'test-summary-max-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      for (let i = 0; i < 10; i++) {
        session.messages.push({ role: 'user', content: `msg${i}`, timestamp: new Date().toISOString() });
      }
      const summary = getSessionSummary(id, 3);
      expect(summary).toContain('msg7');
      expect(summary).toContain('msg8');
      expect(summary).toContain('msg9');
      expect(summary).not.toContain('msg0');
    });

    it('should truncate long messages to 200 chars', () => {
      const id = 'test-summary-trunc-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.messages.push({
        role: 'user', content: 'A'.repeat(300), timestamp: new Date().toISOString(),
      });
      const summary = getSessionSummary(id);
      expect(summary).toContain('...');
    });

    it('should deny access when requesterId does not match session owner', () => {
      const id = 'test-summary-acl-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli', userId: 'owner-user' });
      session.messages.push({ role: 'user', content: 'secret', timestamp: new Date().toISOString() });
      const summary = getSessionSummary(id, 5, 'other-user');
      expect(summary).toBe('');
    });

    it('should allow access when requesterId matches session owner', () => {
      const id = 'test-summary-acl-ok-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli', userId: 'owner-user' });
      session.messages.push({ role: 'user', content: 'hello', timestamp: new Date().toISOString() });
      const summary = getSessionSummary(id, 5, 'owner-user');
      expect(summary).toContain('hello');
    });

    it('should allow access when no requesterId is provided', () => {
      const id = 'test-summary-no-req-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli', userId: 'owner' });
      session.messages.push({ role: 'user', content: 'hello', timestamp: new Date().toISOString() });
      const summary = getSessionSummary(id);
      expect(summary).toContain('hello');
    });
  });

  // ─── getSessionStats ───────────────────────────────────────────────────
  describe('getSessionStats', () => {
    it('should return stats object with expected fields', () => {
      const stats = getSessionStats();
      expect(typeof stats.total).toBe('number');
      expect(typeof stats.byChannel).toBe('object');
    });

    it('should count sessions by channel', () => {
      const id1 = 'test-stats-cli-' + Date.now();
      const id2 = 'test-stats-feishu-' + Date.now();
      getOrCreateSession({ sessionId: id1, channel: 'cli' });
      getOrCreateSession({ sessionId: id2, channel: 'feishu' });
      const stats = getSessionStats();
      expect(stats.byChannel['cli']).toBeGreaterThanOrEqual(1);
      expect(stats.byChannel['feishu']).toBeGreaterThanOrEqual(1);
    });

    it('should report oldest and newest session', () => {
      const stats = getSessionStats();
      if (stats.total > 0) {
        expect(stats.oldestSession).toBeDefined();
        expect(stats.newestSession).toBeDefined();
      }
    });
  });

  // ─── sendProactiveMessage ──────────────────────────────────────────────
  describe('sendProactiveMessage', () => {
    beforeEach(() => {
      initSessionManager({ provider: 'openai', model: 'gpt-4', useTools: false });
      mockAgent.chat.mockResolvedValue('mock response');
    });

    it('should handle text messages', async () => {
      const result = await sendProactiveMessage({
        message: 'Hello', channel: 'cli',
        sessionId: 'proactive-text-' + Date.now(),
      });
      expect(result.success).toBe(true);
      expect(result.response).toBe('mock response');
    });

    it('should handle recovery mode (isRecovery=true)', async () => {
      const id = 'proactive-recovery-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.messages.push({ role: 'user', content: 'original msg', timestamp: new Date().toISOString() });
      const result = await sendProactiveMessage({
        message: 'original msg', channel: 'cli', sessionId: id,
        context: { isRecovery: true },
      });
      expect(result.success).toBe(true);
    });

    it('should return empty response error', async () => {
      mockAgent.chat.mockResolvedValueOnce('');
      const result = await sendProactiveMessage({
        message: 'Hello', channel: 'cli',
        sessionId: 'proactive-empty-' + Date.now(),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('空响应');
    });

    it('should handle agent throwing error', async () => {
      mockAgent.chat.mockRejectedValueOnce(new Error('agent error'));
      const result = await sendProactiveMessage({
        message: 'Hello', channel: 'cli',
        sessionId: 'proactive-err-' + Date.now(),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('agent error');
    });

    it('should handle multimodal array message without images', async () => {
      const result = await sendProactiveMessage({
        message: [{ type: 'text', text: 'Hello from array' }] as any,
        channel: 'cli', sessionId: 'proactive-mm-' + Date.now(),
      });
      expect(result.success).toBe(true);
    });

    it('should use session summary in system prompt when present', async () => {
      const id = 'proactive-summary-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.summary = 'Previous conversation about TypeScript';
      const result = await sendProactiveMessage({
        message: 'Follow up', channel: 'cli', sessionId: id,
      });
      expect(result.success).toBe(true);
    });

    it('should handle proactive lastMessageSource', async () => {
      const id = 'proactive-src-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.lastMessageSource = 'proactive';
      const result = await sendProactiveMessage({
        message: 'test', channel: 'cli', sessionId: id,
      });
      expect(result.success).toBe(true);
    });

    it('should handle recovery lastMessageSource', async () => {
      const id = 'proactive-rsrc-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.lastMessageSource = 'recovery';
      const result = await sendProactiveMessage({
        message: 'test', channel: 'cli', sessionId: id,
      });
      expect(result.success).toBe(true);
    });

    it('should generate sessionId when not provided', async () => {
      const result = await sendProactiveMessage({ message: 'Hello', channel: 'cli' });
      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
    });

    it('should handle HITL response', async () => {
      mockHandleHITLResponse.mockResolvedValueOnce('HITL response content');
      const id = 'proactive-hitl-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'cli' });
      const result = await sendProactiveMessage({
        message: 'approve', channel: 'cli', sessionId: id,
      });
      expect(result.success).toBe(true);
      expect(result.response).toBe('HITL response content');
    });

    it('should replay conversation history to agent', async () => {
      const id = 'proactive-replay-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.messages.push(
        { role: 'user', content: 'hi', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'hello', timestamp: new Date().toISOString() },
      );
      mockAgent.addMessage.mockClear();
      await sendProactiveMessage({ message: 'next', channel: 'cli', sessionId: id });
      expect(mockAgent.addMessage).toHaveBeenCalledWith({ role: 'user', content: 'hi' });
      expect(mockAgent.addMessage).toHaveBeenCalledWith({ role: 'assistant', content: 'hello' });
    });

    it('should not replay idle archived history into a fresh active turn', async () => {
      const id = 'proactive-archived-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' }) as Session;
      session.messages.push(
        { role: 'user', content: '给我查询蓝色光标', timestamp: '2026-04-07T08:00:00.000Z' },
        { role: 'assistant', content: '这是蓝色光标结果', timestamp: '2026-04-07T08:01:00.000Z' },
      );
      session.updatedAt = '2026-04-07T08:01:00.000Z';
      saveSession(session);

      mockAgent.addMessage.mockClear();
      await sendProactiveMessage({ message: '新闻', channel: 'cli', sessionId: id });

      expect(mockAgent.addMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('蓝色光标') }),
      );
    });

    it('can list archived segments after idle archival', async () => {
      const id = 'proactive-archive-read-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' }) as Session;
      session.messages.push(
        { role: 'user', content: '昨天的话题', timestamp: '2026-04-07T08:00:00.000Z' },
        { role: 'assistant', content: '昨天的回复', timestamp: '2026-04-07T08:01:00.000Z' },
      );
      session.updatedAt = '2026-04-07T08:01:00.000Z';
      saveSession(session);

      await sendProactiveMessage({ message: '今天的新闻', channel: 'cli', sessionId: id });

      const archived = getArchivedSessionSegments(id);
      expect(archived.length).toBeGreaterThan(0);
    });

    it('can search archived segments by time range', async () => {
      const id = 'proactive-archive-time-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' }) as Session;
      session.messages.push(
        { role: 'user', content: '四月七日的话题', timestamp: '2026-04-07T08:00:00.000Z' },
        { role: 'assistant', content: '旧内容', timestamp: '2026-04-07T08:01:00.000Z' },
      );
      session.updatedAt = '2026-04-07T08:01:00.000Z';
      saveSession(session);

      await sendProactiveMessage({ message: '今天新闻', channel: 'cli', sessionId: id });

      const matches = searchArchivedSessionSegments(id, {
        from: '2026-04-07T00:00:00.000Z',
        to: '2026-04-07T23:59:59.000Z',
      });
      expect(matches.length).toBeGreaterThan(0);
    });

    it('returns empty results when archive search misses', async () => {
      const id = 'proactive-archive-miss-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' }) as Session;
      session.messages.push(
        { role: 'user', content: '四月七日的话题', timestamp: '2026-04-07T08:00:00.000Z' },
        { role: 'assistant', content: '旧内容', timestamp: '2026-04-07T08:01:00.000Z' },
      );
      session.updatedAt = '2026-04-07T08:01:00.000Z';
      saveSession(session);

      await sendProactiveMessage({ message: '今天新闻', channel: 'cli', sessionId: id });

      const matches = searchArchivedSessionSegments(id, { keyword: '不存在的词' });
      expect(matches).toEqual([]);
    });

    it('does not restore archived context for ordinary fresh requests', async () => {
      const id = 'proactive-archive-restore-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' }) as Session;
      session.messages.push(
        { role: 'user', content: '之前我们聊过蓝色光标', timestamp: '2026-04-07T08:00:00.000Z' },
        { role: 'assistant', content: '这是之前的分析', timestamp: '2026-04-07T08:01:00.000Z' },
      );
      session.updatedAt = '2026-04-07T08:01:00.000Z';
      saveSession(session);

      mockAgent.addMessage.mockClear();
      await sendProactiveMessage({ message: '新闻', channel: 'cli', sessionId: id });

      expect(mockAgent.addMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('按用户明确要求恢复的历史对话片段') }),
      );
    });

    it('should replay multimodal user messages with visionDescription', async () => {
      const id = 'proactive-replay-mm-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.messages.push({
        role: 'user', content: 'Look at this image', timestamp: new Date().toISOString(),
        _meta: { originalType: 'multimodal', visionDescription: 'A cat sitting on a desk' },
      });
      mockAgent.addMessage.mockClear();
      await sendProactiveMessage({ message: 'next', channel: 'cli', sessionId: id });
      const calls = mockAgent.addMessage.mock.calls;
      const firstCall = calls[0][0];
      expect(firstCall.role).toBe('user');
      expect(firstCall.content).toContain('图片内容描述');
      expect(firstCall.content).toContain('A cat sitting on a desk');
    });

    it('should call channel handler if registered', async () => {
      const handler = vi.fn(async () => {});
      registerChannelHandler('test-ch', handler);
      const id = 'proactive-handler-' + Date.now();
      await sendProactiveMessage({
        message: 'Hello', channel: 'test-ch' as any, sessionId: id,
      });
      expect(handler).toHaveBeenCalledWith(id, 'mock response');
    });

    it('should set pendingDelivery and lastAiResponse after response', async () => {
      const id = 'proactive-pending-' + Date.now();
      await sendProactiveMessage({ message: 'Hello', channel: 'cli', sessionId: id });
      const session = getSession(id);
      expect(session).toBeDefined();
      expect(session!.pendingDelivery).toBe(true);
      expect(session!.lastAiResponse).toBe('mock response');
    });

    it('should save tool calls in assistant message', async () => {
      mockAgent.getLastToolCalls.mockReturnValueOnce([
        { id: 'tc1', type: 'function', function: { name: 'search', arguments: '{}' } },
      ]);
      const id = 'proactive-tools-' + Date.now();
      await sendProactiveMessage({ message: 'Search something', channel: 'cli', sessionId: id });
      const session = getSession(id);
      const assistantMsg = session!.messages.find(m => m.role === 'assistant');
      expect(assistantMsg?.toolCalls).toHaveLength(1);
      expect(assistantMsg!.toolCalls![0].function.name).toBe('search');
    });

    it('should set _meta.source on user message', async () => {
      const id = 'proactive-meta-source-' + Date.now();
      await sendProactiveMessage({
        message: 'hello', channel: 'cli', sessionId: id,
        context: { source: 'proactive' },
      });
      const session = getSession(id);
      const userMsg = session!.messages.find(m => m.role === 'user');
      expect(userMsg?._meta?.source).toBe('proactive');
    });

    it('should handle non-Error thrown from agent', async () => {
      mockAgent.chat.mockRejectedValueOnce('string error');
      const result = await sendProactiveMessage({
        message: 'Hello', channel: 'cli',
        sessionId: 'proactive-nonerr-' + Date.now(),
      });
      expect(result.success).toBe(false);
    });

    it('should handle whitespace-only response as empty', async () => {
      mockAgent.chat.mockResolvedValueOnce('   ');
      const result = await sendProactiveMessage({
        message: 'Hello', channel: 'cli',
        sessionId: 'proactive-ws-' + Date.now(),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('空响应');
    });
  });

  // ─── continueConversation ──────────────────────────────────────────────
  describe('continueConversation', () => {
    beforeEach(() => {
      initSessionManager({ provider: 'openai', model: 'gpt-4', useTools: false });
      mockAgent.chat.mockResolvedValue('continued response');
    });

    it('should delegate to sendProactiveMessage', async () => {
      const id = 'continue-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'cli' });
      const result = await continueConversation(id, 'next message');
      expect(result.success).toBe(true);
    });
  });

  // ─── getExtraction / resetExtraction ───────────────────────────────────
  describe('getExtraction', () => {
    it('should return extraction manager or null', () => {
      const result = getExtraction();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('should return null when getExtractionManager throws', () => {
      vi.mocked(getExtractionManager).mockImplementationOnce(() => { throw new Error('not init'); });
      const result = getExtraction();
      expect(result).toBeNull();
    });
  });

  describe('resetExtraction', () => {
    it('should call resetExtractionManager', () => {
      vi.mocked(resetExtractionManager).mockClear();
      resetExtraction();
      expect(resetExtractionManager).toHaveBeenCalled();
    });
  });

  // ─── Dedup wrappers ────────────────────────────────────────────────────
  describe('dedup wrappers', () => {
    it('isMessageProcessed returns false for unknown session', () => {
      expect(isMessageProcessed('nonexistent-' + Date.now(), 'msg1')).toBe(false);
    });

    it('getMessageState returns null for unknown session', () => {
      expect(getMessageState('nonexistent-' + Date.now(), 'msg1')).toBeNull();
    });

    it('markMessageProcessing does nothing for unknown session', () => {
      expect(() => markMessageProcessing('nonexistent-' + Date.now(), 'msg1')).not.toThrow();
    });

    it('full dedup lifecycle: processing → completed', () => {
      const id = 'dedup-lifecycle-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'cli' });
      markMessageProcessing(id, 'msg1');
      expect(isMessageProcessed(id, 'msg1')).toBe(true);
      markMessageCompleted(id, 'msg1', 'response text', false);
      expect(isMessageProcessed(id, 'msg1')).toBe(true);
      const state = getMessageState(id, 'msg1');
      expect(state).not.toBeNull();
      expect(state!.status).toBe('completed');
    });

    it('full dedup lifecycle: processing → failed', () => {
      const id = 'dedup-fail-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'cli' });
      markMessageProcessing(id, 'msg2');
      markMessageFailed(id, 'msg2', 'timeout error', 'cached resp', true);
      const state = getMessageState(id, 'msg2');
      expect(state).not.toBeNull();
      expect(state!.status).toBe('failed');
      expect(state!.error).toBe('timeout error');
    });

    it('getCachedAgentResponse returns cached response', () => {
      const id = 'dedup-cache-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'cli' });
      markMessageProcessing(id, 'msg3');
      markMessageCompleted(id, 'msg3', 'cached text', true);
      const cached = getCachedAgentResponse(id, 'msg3');
      expect(cached).not.toBeNull();
      expect(cached!.response).toBe('cached text');
      expect(cached!.usedCardV2).toBe(true);
    });

    it('getCachedAgentResponse returns null for unknown session', () => {
      expect(getCachedAgentResponse('nonexistent-' + Date.now(), 'msg1')).toBeNull();
    });

    it('markMessageProcessed (deprecated) works', () => {
      const id = 'dedup-deprecated-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'cli' });
      markMessageProcessed(id, 'msg4');
      expect(isMessageProcessed(id, 'msg4')).toBe(true);
    });

    it('pruneProcessedMessages works on session', () => {
      const id = 'dedup-prune-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.processedMessageIds = {
        'old': true,
        'new': { status: 'completed', startedAt: Date.now(), completedAt: Date.now(), retryCount: 0 },
      };
      const pruned = pruneProcessedMessages(session);
      expect(pruned).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Proactive messaging wrappers ──────────────────────────────────────
  describe('proactive messaging wrappers', () => {
    it('injectProactiveResult returns false for unknown session', () => {
      expect(injectProactiveResult('nonexistent-' + Date.now(), {
        source: 'test', content: 'result',
      })).toBe(false);
    });

    it('injectProactiveResult injects into existing session', () => {
      const id = 'proactive-inject-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      const result = injectProactiveResult(id, {
        source: 'scheduled-task', content: 'task result', timestamp: Date.now(),
      });
      expect(result).toBe(true);
      expect(session.messages.length).toBe(1);
      expect(session.messages[0].role).toBe('system');
      expect(session.messages[0].content).toContain('task result');
    });

    it('getRecentSessionHistory returns empty for unknown session', () => {
      expect(getRecentSessionHistory('nonexistent-' + Date.now())).toEqual([]);
    });

    it('getRecentSessionHistory returns messages', () => {
      const id = 'proactive-history-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.messages.push(
        { role: 'user', content: 'msg1', timestamp: new Date().toISOString() },
        { role: 'assistant', content: 'msg2', timestamp: new Date().toISOString() },
      );
      const history = getRecentSessionHistory(id, 10);
      expect(history.length).toBe(2);
    });
  });

  // ─── Storage wrappers ─────────────────────────────────────────────────
  describe('storage wrappers', () => {
    it('saveSession does not throw', () => {
      const id = 'storage-save-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      expect(() => saveSession(session)).not.toThrow();
    });

    it('loadAllSessions does not throw', () => {
      expect(() => loadAllSessions()).not.toThrow();
    });

    it('saveAllSessions does not throw', () => {
      expect(() => saveAllSessions()).not.toThrow();
    });

    it('clearOldSessions returns a number', () => {
      const result = clearOldSessions(30);
      expect(typeof result).toBe('number');
    });
  });
});
