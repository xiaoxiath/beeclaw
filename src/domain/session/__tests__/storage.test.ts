import { describe, it, expect, beforeEach, mock } from 'bun:test';

mock.module('../../../infra/observability/logger', () => ({
  logger: {
    info: mock(() => {}),
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  },
}));

mock.module('../../../infra/utils/atomic-fs', () => ({
  writeFileAtomic: mock(() => {}),
  readFileWithRecovery: mock(() => null),
  cleanupTempFiles: mock(() => {}),
}));

mock.module('../../../infra/db', () => ({
  getDataConnection: mock(() => ({})),
}));

mock.module('../../../infra/db/schema', () => ({
  sessions: { id: 'id' },
}));

mock.module('drizzle-orm', () => ({
  eq: mock((a: any, b: any) => ({ a, b })),
}));

mock.module('../../ports', () => ({
  getPluginRegistryPort: mock(() => null),
  getHookRunnerPort: mock(() => null),
}));

import {
  getSessionFilePath,
  isValidSession,
  saveSession,
  loadSession,
  deleteSessionFile,
  loadAllSessions,
  clearOldSessions,
  saveAllSessions,
} from '../storage';

describe('storage', () => {
  // ─── getSessionFilePath ───────────────────────────────────────────────
  describe('getSessionFilePath', () => {
    it('should build path from storagePath and sessionId', () => {
      const result = getSessionFilePath('/data/sessions', 'my-session-123');
      expect(result).toBe('/data/sessions/my-session-123.json');
    });

    it('should sanitize special characters in sessionId', () => {
      const result = getSessionFilePath('/data', 'user@domain/path');
      expect(result).not.toContain('@');
      expect(result).not.toContain('/path');
      expect(result).toEndWith('.json');
    });

    it('should preserve allowed characters', () => {
      const result = getSessionFilePath('/data', 'feishu-user_123');
      expect(result).toBe('/data/feishu-user_123.json');
    });
  });

  // ─── isValidSession ───────────────────────────────────────────────────
  describe('isValidSession', () => {
    it('should return true for valid session', () => {
      expect(isValidSession({ id: 's1', messages: [] })).toBe(true);
    });

    it('should return false for null', () => {
      expect(isValidSession(null)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(isValidSession('string')).toBe(false);
      expect(isValidSession(42)).toBe(false);
    });

    it('should return false if id is missing', () => {
      expect(isValidSession({ messages: [] })).toBe(false);
    });

    it('should return false if id is not string', () => {
      expect(isValidSession({ id: 123, messages: [] })).toBe(false);
    });

    it('should return false if messages is not array', () => {
      expect(isValidSession({ id: 's1', messages: 'not-array' })).toBe(false);
    });
  });

  // ─── clearOldSessions ─────────────────────────────────────────────────
  describe('clearOldSessions', () => {
    it('should delete sessions older than specified days', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
      const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago

      const sessionsMap = new Map<string, any>([
        ['old-s', { id: 'old-s', updatedAt: oldDate.toISOString() }],
        ['new-s', { id: 'new-s', updatedAt: recentDate.toISOString() }],
      ]);

      const deleteFn = mock(() => true);
      const cleared = clearOldSessions(sessionsMap, deleteFn, 30);

      expect(cleared).toBe(1);
      expect(deleteFn).toHaveBeenCalledWith('old-s');
    });

    it('should return 0 when no sessions are old', () => {
      const sessionsMap = new Map<string, any>([
        ['s1', { id: 's1', updatedAt: new Date().toISOString() }],
      ]);
      const deleteFn = mock(() => true);
      const cleared = clearOldSessions(sessionsMap, deleteFn, 30);
      expect(cleared).toBe(0);
    });
  });

  // ─── saveAllSessions ──────────────────────────────────────────────────
  describe('saveAllSessions', () => {
    it('should call saveFn for each session', () => {
      const saveFn = mock(() => {});
      const sessionsMap = new Map<string, any>([
        ['s1', { id: 's1' }],
        ['s2', { id: 's2' }],
      ]);

      saveAllSessions(sessionsMap, saveFn);
      expect(saveFn).toHaveBeenCalledTimes(2);
    });

    it('should handle empty map', () => {
      const saveFn = mock(() => {});
      saveAllSessions(new Map(), saveFn);
      expect(saveFn).not.toHaveBeenCalled();
    });

    it('should continue saving even if one throws', () => {
      let callCount = 0;
      const saveFn = mock(() => {
        callCount++;
        if (callCount === 1) throw new Error('save error');
      });
      const sessionsMap = new Map<string, any>([
        ['s1', { id: 's1' }],
        ['s2', { id: 's2' }],
      ]);

      saveAllSessions(sessionsMap, saveFn);
      expect(saveFn).toHaveBeenCalledTimes(2);
    });
  });
});
