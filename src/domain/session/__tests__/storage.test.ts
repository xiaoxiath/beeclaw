import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(() => {}),
    error: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    debug: vi.fn(() => {}),
  },
}));

const mockWriteFileAtomic = vi.fn(() => {});
const mockReadFileWithRecovery = vi.fn(() => null);
const mockCleanupTempFiles = vi.fn(() => {});
vi.mock('../../../infra/utils/atomic-fs', () => ({
  writeFileAtomic: (...args: any[]) => mockWriteFileAtomic(...args),
  readFileWithRecovery: (...args: any[]) => mockReadFileWithRecovery(...args),
  cleanupTempFiles: (...args: any[]) => mockCleanupTempFiles(...args),
}));

const mockDb = {
  select: vi.fn(() => mockDb),
  from: vi.fn(() => mockDb),
  where: vi.fn(() => mockDb),
  limit: vi.fn(() => mockDb),
  all: vi.fn(() => []),
  insert: vi.fn(() => mockDb),
  values: vi.fn(() => mockDb),
  run: vi.fn(),
  update: vi.fn(() => mockDb),
  set: vi.fn(() => mockDb),
  delete: vi.fn(() => mockDb),
};
vi.mock('../../../infra/db', () => ({
  getDataConnection: vi.fn(() => mockDb),
}));

vi.mock('../../../infra/db/schema', () => ({
  sessions: { id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: any, b: any) => ({ a, b })),
}));

const mockHookRunner = {
  runBeforeMessageWrite: vi.fn(() => null),
};
vi.mock('../../ports', () => ({
  getPluginRegistryPort: vi.fn(() => null),
  getHookRunnerPort: vi.fn(() => mockHookRunner),
}));

// Mock fs module partially
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
    readdirSync: vi.fn(() => []),
    unlinkSync: vi.fn(),
  };
});

import { getPluginRegistryPort, getHookRunnerPort } from '../../ports';
import {
  getSessionFilePath,
  isValidSession,
  saveSession,
  loadSession,
  loadSessionFromSQLite,
  saveSessionToSQLite,
  deleteSessionFile,
  loadAllSessions,
  clearOldSessions,
  saveAllSessions,
} from '../storage';

import type { Session } from '../index';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-session',
    userId: 'user1',
    channel: 'feishu',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.all.mockReturnValue([]);
  });

  // ─── getSessionFilePath ───────────────────────────────────────────────
  describe('getSessionFilePath', () => {
    it('should build path from storagePath and sessionId', () => {
      const result = getSessionFilePath('/data/sessions', 'my-session-123');
      expect(result).toBe('/data/sessions/my-session-123.json');
    });

    it('should sanitize special characters in sessionId', () => {
      const result = getSessionFilePath('/data', 'user@domain/path');
      expect(result).not.toContain('@');
      expect(result.endsWith('.json')).toBe(true);
    });

    it('should preserve allowed characters', () => {
      const result = getSessionFilePath('/data', 'feishu-user_123');
      expect(result).toBe('/data/feishu-user_123.json');
    });

    it('should sanitize dots and spaces', () => {
      const result = getSessionFilePath('/data', 'ses.sion name');
      expect(result).not.toContain(' ');
      expect(result).toContain('.json'); // only the extension dot
    });
  });

  // ─── isValidSession ───────────────────────────────────────────────────
  describe('isValidSession', () => {
    it('should return true for valid session', () => {
      expect(isValidSession({ id: 's1', messages: [] })).toBe(true);
    });

    it('should return true for session with extra fields', () => {
      expect(isValidSession({ id: 's1', messages: [], summary: 'test', metadata: {} })).toBe(true);
    });

    it('should return false for null', () => {
      expect(isValidSession(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidSession(undefined)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(isValidSession('string')).toBe(false);
      expect(isValidSession(42)).toBe(false);
      expect(isValidSession(true)).toBe(false);
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

    it('should return false if messages is missing', () => {
      expect(isValidSession({ id: 's1' })).toBe(false);
    });
  });

  // ─── saveSession ──────────────────────────────────────────────────────
  describe('saveSession', () => {
    it('should write session to disk using writeFileAtomic', () => {
      const session = makeSession();
      saveSession(session, '/data');
      expect(mockWriteFileAtomic).toHaveBeenCalledWith(
        expect.stringContaining('test-session.json'),
        expect.any(String),
      );
    });

    it('should serialize session as JSON', () => {
      const session = makeSession({ id: 'json-test' });
      saveSession(session, '/data');
      const writtenJson = mockWriteFileAtomic.mock.calls[0][1];
      const parsed = JSON.parse(writtenJson);
      expect(parsed.id).toBe('json-test');
    });

    it('should call hook runner if plugin registry and hook runner are available', () => {
      vi.mocked(getPluginRegistryPort).mockReturnValueOnce({} as any);
      vi.mocked(getHookRunnerPort).mockReturnValueOnce(mockHookRunner as any);

      const session = makeSession();
      saveSession(session, '/data');
      expect(mockHookRunner.runBeforeMessageWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: session.id,
          messages: session.messages,
        }),
      );
    });

    it('should apply modified messages from hook runner', () => {
      vi.mocked(getPluginRegistryPort).mockReturnValueOnce({} as any);
      vi.mocked(getHookRunnerPort).mockReturnValueOnce(mockHookRunner as any);
      mockHookRunner.runBeforeMessageWrite.mockReturnValueOnce({
        messages: [{ role: 'user', content: 'modified', timestamp: '2024-01-01' }],
        metadata: { hooked: true },
      });

      const session = makeSession({ messages: [{ role: 'user', content: 'original', timestamp: '2024-01-01' }] });
      saveSession(session, '/data');

      expect(session.messages[0].content).toBe('modified');
      expect(session.metadata).toEqual({ hooked: true });
    });

    it('should not crash when hook runner returns null', () => {
      vi.mocked(getPluginRegistryPort).mockReturnValueOnce({} as any);
      vi.mocked(getHookRunnerPort).mockReturnValueOnce(mockHookRunner as any);
      mockHookRunner.runBeforeMessageWrite.mockReturnValueOnce(null);

      const session = makeSession();
      expect(() => saveSession(session, '/data')).not.toThrow();
    });

    it('should handle writeFileAtomic error gracefully', () => {
      mockWriteFileAtomic.mockImplementationOnce(() => { throw new Error('write error'); });
      const session = makeSession();
      expect(() => saveSession(session, '/data')).not.toThrow();
    });

    it('should handle plugin system not initialized', () => {
      vi.mocked(getPluginRegistryPort).mockImplementationOnce(() => { throw new Error('not init'); });
      const session = makeSession();
      expect(() => saveSession(session, '/data')).not.toThrow();
    });
  });

  // ─── loadSession ──────────────────────────────────────────────────────
  describe('loadSession', () => {
    it('should return null when readFileWithRecovery returns null', () => {
      mockReadFileWithRecovery.mockReturnValueOnce(null);
      const result = loadSession('test-id', '/data');
      expect(result).toBeNull();
    });

    it('should return session when readFileWithRecovery returns valid data', () => {
      const sessionData = makeSession({ id: 'loaded-session' });
      mockReadFileWithRecovery.mockReturnValueOnce(sessionData);
      const result = loadSession('loaded-session', '/data');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('loaded-session');
    });

    it('should pass isValidSession as validator', () => {
      mockReadFileWithRecovery.mockReturnValueOnce(null);
      loadSession('test', '/data');
      // The second argument should be the validator function
      expect(mockReadFileWithRecovery).toHaveBeenCalledWith(
        expect.any(String),
        isValidSession,
      );
    });

    it('should handle exception from readFileWithRecovery', () => {
      mockReadFileWithRecovery.mockImplementationOnce(() => { throw new Error('read error'); });
      const result = loadSession('test', '/data');
      expect(result).toBeNull();
    });
  });

  // ─── loadSessionFromSQLite ────────────────────────────────────────────
  describe('loadSessionFromSQLite', () => {
    it('should return null when USE_SQLITE is false (default)', () => {
      const result = loadSessionFromSQLite('test-id');
      expect(result).toBeNull();
    });
  });

  // ─── saveSessionToSQLite ──────────────────────────────────────────────
  describe('saveSessionToSQLite', () => {
    it('should return early when USE_SQLITE is false (default)', () => {
      const session = makeSession();
      saveSessionToSQLite(session);
      // Should not call db methods
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  // ─── deleteSessionFile ────────────────────────────────────────────────
  describe('deleteSessionFile', () => {
    it('should delete file if it exists', () => {
      vi.mocked(existsSync).mockReturnValueOnce(true);
      deleteSessionFile('test-session', '/data');
      expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('test-session.json'));
    });

    it('should not call unlinkSync if file does not exist', () => {
      vi.mocked(existsSync).mockReturnValueOnce(false);
      deleteSessionFile('test-session', '/data');
      expect(unlinkSync).not.toHaveBeenCalled();
    });

    it('should handle unlinkSync error gracefully', () => {
      vi.mocked(existsSync).mockReturnValueOnce(true);
      vi.mocked(unlinkSync).mockImplementationOnce(() => { throw new Error('delete error'); });
      expect(() => deleteSessionFile('test-session', '/data')).not.toThrow();
    });
  });

  // ─── loadAllSessions ──────────────────────────────────────────────────
  describe('loadAllSessions', () => {
    it('should return 0 if storagePath does not exist', () => {
      vi.mocked(existsSync).mockReturnValueOnce(false);
      const map = new Map();
      const result = loadAllSessions('/nonexistent', map);
      expect(result).toBe(0);
    });

    it('should call cleanupTempFiles', () => {
      vi.mocked(existsSync).mockReturnValueOnce(true);
      vi.mocked(readdirSync).mockReturnValueOnce([] as any);
      const map = new Map();
      loadAllSessions('/data', map);
      expect(mockCleanupTempFiles).toHaveBeenCalledWith('/data');
    });

    it('should load JSON files and populate sessions map', () => {
      vi.mocked(existsSync).mockReturnValueOnce(true);
      vi.mocked(readdirSync).mockReturnValueOnce(['s1.json', 's2.json'] as any);
      vi.mocked(readFileSync)
        .mockReturnValueOnce(JSON.stringify({ id: 's1', messages: [] }))
        .mockReturnValueOnce(JSON.stringify({ id: 's2', messages: [] }));

      const map = new Map();
      const result = loadAllSessions('/data', map);
      expect(result).toBe(2);
      expect(map.has('s1')).toBe(true);
      expect(map.has('s2')).toBe(true);
    });

    it('should skip .bak and .tmp files', () => {
      vi.mocked(existsSync).mockReturnValueOnce(true);
      vi.mocked(readdirSync).mockReturnValueOnce(['s1.json', 'backup.json.bak', 'temp.json.tmp'] as any);
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify({ id: 's1', messages: [] }));

      const map = new Map();
      const result = loadAllSessions('/data', map);
      expect(result).toBe(1);
    });

    it('should skip non-JSON files', () => {
      vi.mocked(existsSync).mockReturnValueOnce(true);
      vi.mocked(readdirSync).mockReturnValueOnce(['readme.txt', 's1.json'] as any);
      vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify({ id: 's1', messages: [] }));

      const map = new Map();
      const result = loadAllSessions('/data', map);
      expect(result).toBe(1);
    });

    it('should handle parse error gracefully and continue', () => {
      vi.mocked(existsSync).mockReturnValueOnce(true);
      vi.mocked(readdirSync).mockReturnValueOnce(['bad.json', 'good.json'] as any);
      vi.mocked(readFileSync)
        .mockReturnValueOnce('not valid json{{{')
        .mockReturnValueOnce(JSON.stringify({ id: 'good', messages: [] }));

      const map = new Map();
      const result = loadAllSessions('/data', map);
      expect(result).toBe(1);
      expect(map.has('good')).toBe(true);
    });
  });

  // ─── clearOldSessions ─────────────────────────────────────────────────
  describe('clearOldSessions', () => {
    it('should delete sessions older than specified days', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
      const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

      const sessionsMap = new Map<string, any>([
        ['old-s', { id: 'old-s', updatedAt: oldDate.toISOString() }],
        ['new-s', { id: 'new-s', updatedAt: recentDate.toISOString() }],
      ]);

      const deleteFn = vi.fn(() => true);
      const cleared = clearOldSessions(sessionsMap, deleteFn, 30);
      expect(cleared).toBe(1);
      expect(deleteFn).toHaveBeenCalledWith('old-s');
    });

    it('should return 0 when no sessions are old', () => {
      const sessionsMap = new Map<string, any>([
        ['s1', { id: 's1', updatedAt: new Date().toISOString() }],
      ]);
      const deleteFn = vi.fn(() => true);
      const cleared = clearOldSessions(sessionsMap, deleteFn, 30);
      expect(cleared).toBe(0);
    });

    it('should use default 30 days when daysOld not specified', () => {
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const sessionsMap = new Map<string, any>([
        ['old', { id: 'old', updatedAt: oldDate.toISOString() }],
      ]);
      const deleteFn = vi.fn(() => true);
      const cleared = clearOldSessions(sessionsMap, deleteFn);
      expect(cleared).toBe(1);
    });

    it('should handle empty map', () => {
      const deleteFn = vi.fn(() => true);
      const cleared = clearOldSessions(new Map(), deleteFn, 30);
      expect(cleared).toBe(0);
    });
  });

  // ─── saveAllSessions ──────────────────────────────────────────────────
  describe('saveAllSessions', () => {
    it('should call saveFn for each session', () => {
      const saveFn = vi.fn(() => {});
      const sessionsMap = new Map<string, any>([
        ['s1', { id: 's1' }],
        ['s2', { id: 's2' }],
      ]);
      saveAllSessions(sessionsMap, saveFn);
      expect(saveFn).toHaveBeenCalledTimes(2);
    });

    it('should handle empty map', () => {
      const saveFn = vi.fn(() => {});
      saveAllSessions(new Map(), saveFn);
      expect(saveFn).not.toHaveBeenCalled();
    });

    it('should continue saving even if one throws', () => {
      let callCount = 0;
      const saveFn = vi.fn(() => {
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
