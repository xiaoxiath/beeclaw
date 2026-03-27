import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Heavy mocking for the session index module
mock.module('../../../infra/observability/logger', () => ({
  logger: { info: mock(() => {}), error: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}) },
}));
mock.module('../../../infra/utils/atomic-fs', () => ({
  writeFileAtomic: mock(() => {}), readFileWithRecovery: mock(() => null), cleanupTempFiles: mock(() => {}),
}));
mock.module('../../../infra/db', () => ({ getDataConnection: mock(() => ({})) }));
mock.module('../../../infra/db/schema', () => ({ sessions: { id: 'id' } }));
mock.module('drizzle-orm', () => ({ eq: mock(() => ({})) }));
mock.module('../../ports', () => ({
  getPluginRegistryPort: mock(() => null),
  getHookRunnerPort: mock(() => null),
  getChannelClientPort: mock(() => null),
  getMessageControllerFactory: mock(() => null),
}));
mock.module('../../agent', () => ({
  createAgent: mock(() => ({ chat: mock(async () => 'response'), addMessage: mock(() => {}) })),
  SYSTEM_PROMPTS: { default: 'You are helpful.' },
  getAllToolsForAI: mock(() => []),
  buildSystemPrompt: mock((s: string) => s),
  formatSkillsForPrompt: mock(() => ''),
}));
mock.module('../../agent/api', () => ({ callAI: mock(async () => ({ choices: [{ message: { content: 'summary' } }] })) }));
mock.module('../../agent/fast-llm-judge', () => ({ getFastModelFromConfig: mock(() => null) }));
mock.module('../../memory', () => ({ getMemoryStore: mock(() => ({ getCoreContext: () => ({}) })) }));
mock.module('../../skills/store', () => ({ getSkillStore: mock(() => ({ list: () => [] })) }));
mock.module('../../tools/deep-analysis', () => ({
  setDeepAnalysisContext: mock(() => {}), clearDeepAnalysisContext: mock(() => {}),
}));
mock.module('../../extraction', () => ({
  initExtractionManager: mock(() => {}), getExtractionManager: mock(() => null),
  resetExtractionManager: mock(() => {}),
}));
mock.module('../../../infra/config/schema', () => ({}));
mock.module('../../../infra/resilience/session-lock', () => ({
  SessionMessageQueue: { getInstance: mock(() => ({ enqueue: mock(async (id: string, fn: Function) => fn()) })), resetInstance: mock(() => {}) },
}));
mock.module('../../../app', () => ({ getConfig_: mock(() => ({})) }));
mock.module('../../../infra/resilience/smart-timeout', () => ({ SmartTimeout: class {} }));
mock.module('../hitl-manager', () => ({ handleHITLResponse: mock(async () => null) }));
mock.module('../../../infra/config/resilience-config', () => ({
  resolveConfig: mock(() => ({ timeout: { turnTimeoutMs: 120000 } })),
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
