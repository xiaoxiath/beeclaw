import { describe, test, expect, beforeEach } from 'bun:test';
import {
  initSessionManager,
  getOrCreateSession,
  getSession,
  listSessions,
  deleteSession,
  getSessionStats,
  registerChannelHandler,
  type Session,
} from '../index';

describe('Session Manager', () => {
  beforeEach(() => {
    // Clear all sessions before each test by deleting them
    const sessions = listSessions();
    for (const session of sessions) {
      deleteSession(session.id);
    }
  });

  describe('getOrCreateSession', () => {
    test('creates new session', () => {
      const session = getOrCreateSession({
        sessionId: 'test-session-1',
        channel: 'cli',
      });

      expect(session).toBeDefined();
      expect(session.id).toBe('test-session-1');
      expect(session.channel).toBe('cli');
      expect(session.messages).toEqual([]);
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
    });

    test('creates session with all options', () => {
      const session = getOrCreateSession({
        sessionId: 'test-session-2',
        userId: 'user-123',
        channel: 'feishu',
        metadata: { source: 'test' },
      });

      expect(session.userId).toBe('user-123');
      expect(session.channel).toBe('feishu');
      expect(session.metadata).toEqual({ source: 'test' });
    });

    test('returns existing session', () => {
      const session1 = getOrCreateSession({
        sessionId: 'same-session',
        channel: 'cli',
      });

      const session2 = getOrCreateSession({
        sessionId: 'same-session',
        channel: 'cli',
      });

      expect(session1.id).toBe(session2.id);
      expect(session1.createdAt).toBe(session2.createdAt);
    });

    test('updates timestamp when getting existing session', async () => {
      const session1 = getOrCreateSession({
        sessionId: 'timestamp-test',
        channel: 'cli',
      });

      // Save the original timestamp before the update
      const originalUpdatedAt = session1.updatedAt;

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      const session2 = getOrCreateSession({
        sessionId: 'timestamp-test',
        channel: 'cli',
      });

      // session2 should have a newer timestamp than the original
      expect(session2.updatedAt).not.toBe(originalUpdatedAt);
    });

    test('uses default user ID when not provided', () => {
      const session = getOrCreateSession({
        sessionId: 'default-user-test',
        channel: 'api',
      });

      expect(session.userId).toBe('default-user');
    });
  });

  describe('getSession', () => {
    test('returns existing session', () => {
      getOrCreateSession({
        sessionId: 'get-test',
        channel: 'cli',
      });

      const session = getSession('get-test');
      expect(session).toBeDefined();
      expect(session?.id).toBe('get-test');
    });

    test('returns undefined for non-existent session', () => {
      const session = getSession('non-existent');
      expect(session).toBeUndefined();
    });
  });

  describe('listSessions', () => {
    test('lists all sessions', () => {
      getOrCreateSession({ sessionId: 'list-1', channel: 'cli' });
      getOrCreateSession({ sessionId: 'list-2', channel: 'feishu' });
      getOrCreateSession({ sessionId: 'list-3', channel: 'api' });

      const sessions = listSessions();
      expect(sessions.length).toBe(3);
    });

    test('filters by channel', () => {
      getOrCreateSession({ sessionId: 'filter-cli-1', channel: 'cli' });
      getOrCreateSession({ sessionId: 'filter-cli-2', channel: 'cli' });
      getOrCreateSession({ sessionId: 'filter-feishu', channel: 'feishu' });

      const cliSessions = listSessions({ channel: 'cli' });
      expect(cliSessions.length).toBe(2);
      expect(cliSessions.every(s => s.channel === 'cli')).toBe(true);
    });

    test('filters by userId', () => {
      getOrCreateSession({ sessionId: 'user-a', channel: 'cli', userId: 'userA' });
      getOrCreateSession({ sessionId: 'user-b', channel: 'cli', userId: 'userB' });
      getOrCreateSession({ sessionId: 'user-a-2', channel: 'cli', userId: 'userA' });

      const userASessions = listSessions({ userId: 'userA' });
      expect(userASessions.length).toBe(2);
    });

    test('returns empty array when no sessions', () => {
      // Clear all sessions
      const sessions = listSessions();
      for (const s of sessions) {
        deleteSession(s.id);
      }

      const result = listSessions();
      expect(result).toEqual([]);
    });
  });

  describe('deleteSession', () => {
    test('deletes existing session', () => {
      getOrCreateSession({ sessionId: 'delete-test', channel: 'cli' });

      const result = deleteSession('delete-test');
      expect(result).toBe(true);
      expect(getSession('delete-test')).toBeUndefined();
    });

    test('returns false for non-existent session', () => {
      const result = deleteSession('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getSessionStats', () => {
    test('returns empty stats when no sessions', () => {
      // Clear all sessions first
      const sessions = listSessions();
      for (const s of sessions) {
        deleteSession(s.id);
      }

      const stats = getSessionStats();
      expect(stats.total).toBe(0);
      expect(stats.byChannel).toEqual({});
    });

    test('returns correct stats', async () => {
      // Clear sessions first
      const existing = listSessions();
      for (const s of existing) {
        deleteSession(s.id);
      }

      // Create sessions with delays to ensure different timestamps
      getOrCreateSession({ sessionId: 'stats-1', channel: 'cli' });
      await new Promise(resolve => setTimeout(resolve, 10));
      getOrCreateSession({ sessionId: 'stats-2', channel: 'cli' });
      await new Promise(resolve => setTimeout(resolve, 10));
      getOrCreateSession({ sessionId: 'stats-3', channel: 'feishu' });

      const stats = getSessionStats();

      expect(stats.total).toBe(3);
      expect(stats.byChannel['cli']).toBe(2);
      expect(stats.byChannel['feishu']).toBe(1);
      expect(stats.oldestSession).toBe('stats-1');
      expect(stats.newestSession).toBe('stats-3');
    });
  });

  describe('registerChannelHandler', () => {
    test('registers handler without error', () => {
      expect(() => {
        registerChannelHandler('test-channel', async () => {});
      }).not.toThrow();
    });
  });

  // Note: sendProactiveMessage and continueConversation tests are skipped
  // because they require Agent initialization with valid provider config
  describe('Agent integration (requires initialization)', () => {
    test.skip('sendProactiveMessage creates session and gets response', async () => {
      // Would require initSessionManager with valid provider
    });

    test.skip('sendProactiveMessage returns error when not initialized', async () => {
      // Would need to reset agent config
    });

    test.skip('continueConversation maintains history', async () => {
      // Would require initSessionManager with valid provider
    });

    test.skip('continueConversation returns error for non-existent session', async () => {
      // Would require initSessionManager with valid provider
    });

    test.skip('broadcastToChannel sends to all sessions', async () => {
      // Would require initSessionManager with valid provider
    });
  });
});
