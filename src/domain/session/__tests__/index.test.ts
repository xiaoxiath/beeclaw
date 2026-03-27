import { describe, it, expect, beforeEach, vi } from 'vitest';

// Heavy mocking for the session index module
vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(() => {}), error: vi.fn(() => {}), warn: vi.fn(() => {}), debug: vi.fn(() => {}) },
}));
vi.mock('../../../infra/utils/atomic-fs', () => ({
  writeFileAtomic: vi.fn(() => {}), readFileWithRecovery: vi.fn(() => null), cleanupTempFiles: vi.fn(() => {}),
}));
vi.mock('../../../infra/db', () => ({ getDataConnection: vi.fn(() => ({})) }));
vi.mock('../../../infra/db/schema', () => ({ sessions: { id: 'id' } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => ({})) }));
vi.mock('../../ports', () => ({
  getPluginRegistryPort: vi.fn(() => null),
  getHookRunnerPort: vi.fn(() => null),
  getChannelClientPort: vi.fn(() => null),
  getMessageControllerFactory: vi.fn(() => null),
}));
vi.mock('../../agent', () => ({
  createAgent: vi.fn(() => ({ chat: vi.fn(async () => 'response'), addMessage: vi.fn(() => {}) })),
  SYSTEM_PROMPTS: { default: 'You are helpful.' },
  getAllToolsForAI: vi.fn(() => []),
  buildSystemPrompt: vi.fn((s: string) => s),
  formatSkillsForPrompt: vi.fn(() => ''),
}));
vi.mock('../../agent/api', () => ({ callAI: vi.fn(async () => ({ choices: [{ message: { content: 'summary' } }] })) }));
vi.mock('../../agent/fast-llm-judge', () => ({ getFastModelFromConfig: vi.fn(() => null) }));
vi.mock('../../memory', () => ({ getMemoryStore: vi.fn(() => ({ getCoreContext: () => ({}) })) }));
vi.mock('../../skills/store', () => ({ getSkillStore: vi.fn(() => ({ list: () => [] })) }));
vi.mock('../../tools/deep-analysis', () => ({
  setDeepAnalysisContext: vi.fn(() => {}), clearDeepAnalysisContext: vi.fn(() => {}),
}));
vi.mock('../../extraction', () => ({
  initExtractionManager: vi.fn(() => {}), getExtractionManager: vi.fn(() => null),
  resetExtractionManager: vi.fn(() => {}),
}));
vi.mock('../../../infra/config/schema', () => ({}));
vi.mock('../../../infra/resilience/session-lock', () => ({
  SessionMessageQueue: { getInstance: vi.fn(() => ({ enqueue: vi.fn(async (id: string, fn: Function) => fn()) })), resetInstance: vi.fn(() => {}) },
}));
vi.mock('../../../app', () => ({ getConfig_: vi.fn(() => ({})) }));
vi.mock('../../../infra/resilience/smart-timeout', () => ({ SmartTimeout: class {} }));
vi.mock('../hitl-manager', () => ({ handleHITLResponse: vi.fn(async () => null) }));
vi.mock('../../../infra/config/resilience-config', () => ({
  resolveConfig: vi.fn(() => ({ timeout: { turnTimeoutMs: 120000 } })),
}));

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
} from '../index';

describe('session/index', () => {
  describe('generateSessionId', () => {
    it('should combine channel and identifiers', () => {
      expect(generateSessionId('feishu', 'user1', 'chat1')).toBe('feishu-user1-chat1');
    });

    it('should work with single identifier', () => {
      expect(generateSessionId('cli', 'user1')).toBe('cli-user1');
    });
  });

  describe('MAX_RECOVERY_ATTEMPTS', () => {
    it('should be a positive number', () => {
      expect(MAX_RECOVERY_ATTEMPTS).toBeGreaterThan(0);
    });
  });

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
  });

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

  describe('listSessions', () => {
    it('should return array of sessions', () => {
      const list = listSessions();
      expect(Array.isArray(list)).toBe(true);
    });

    it('should filter by channel', () => {
      const id = 'test-filter-' + Date.now();
      getOrCreateSession({ sessionId: id, channel: 'feishu', userId: 'u1' });
      const filtered = listSessions({ channel: 'webhook' });
      const found = filtered.find(s => s.id === id);
      expect(found).toBeUndefined();
    });
  });

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
  });

  describe('clearRecoveryFlag', () => {
    it('should clear recovery flag on existing session', () => {
      const id = 'test-recovery-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.pendingRecovery = true;
      clearRecoveryFlag(id);
      expect(session.pendingRecovery).toBe(false);
      expect(session.responseDelivered).toBe(true);
    });
  });

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
  });

  describe('calculateRecoveryBackoff', () => {
    it('should return -1 for unknown session', () => {
      expect(calculateRecoveryBackoff('unknown-' + Date.now())).toBe(-1);
    });

    it('should return increasing backoff delays', () => {
      const id = 'test-backoff-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.consecutiveRecoveryFailures = 0;

      const d1 = calculateRecoveryBackoff(id);
      expect(d1).toBe(1000); // 1s

      const d2 = calculateRecoveryBackoff(id);
      expect(d2).toBe(4000); // 4s

      const d3 = calculateRecoveryBackoff(id);
      expect(d3).toBe(16000); // 16s
    });

    it('should return -1 after max failures', () => {
      const id = 'test-maxfail-' + Date.now();
      const session = getOrCreateSession({ sessionId: id, channel: 'cli' });
      session.consecutiveRecoveryFailures = 5;

      expect(calculateRecoveryBackoff(id)).toBe(-1);
    });
  });
});
