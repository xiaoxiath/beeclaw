import { describe, test, expect, beforeEach } from 'bun:test';
import {
  initSessionManager,
  getOrCreateSession,
  getSession,
  listSessions,
  deleteSession,
  getSessionStats,
  registerChannelHandler,
  calculateRecoveryBackoff,
  getSessionSummary,
  confirmDelivery,
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

  // [AUDIT FIX P-3] Tests for new session recovery and context functions
  describe('calculateRecoveryBackoff', () => {
    test('returns exponential backoff delays', async () => {
      const session = getOrCreateSession({ sessionId: 'backoff-test', channel: 'cli' });

      // Reset any previous failures
      confirmDelivery('backoff-test');

      // First attempt: 1s (4^0 = 1)
      const delay1 = calculateRecoveryBackoff('backoff-test');
      expect(delay1).toBe(1000);

      // Second attempt: 4s (4^1 = 4)
      const delay2 = calculateRecoveryBackoff('backoff-test');
      expect(delay2).toBe(4000);

      // Third attempt: 16s (4^2 = 16)
      const delay3 = calculateRecoveryBackoff('backoff-test');
      expect(delay3).toBe(16000);

      // Fourth attempt: 64s (4^3 = 64)
      const delay4 = calculateRecoveryBackoff('backoff-test');
      expect(delay4).toBe(64000);

      // Fifth attempt: 256s (4^4 = 256)
      const delay5 = calculateRecoveryBackoff('backoff-test');
      expect(delay5).toBe(256000);

      // Sixth attempt: should return -1 (max exceeded)
      const delay6 = calculateRecoveryBackoff('backoff-test');
      expect(delay6).toBe(-1);
    });

    test('resets backoff on confirmDelivery', async () => {
      const session = getOrCreateSession({ sessionId: 'backoff-reset-test', channel: 'cli' });

      // Trigger some failures
      calculateRecoveryBackoff('backoff-reset-test');
      calculateRecoveryBackoff('backoff-reset-test');

      // Confirm delivery
      confirmDelivery('backoff-reset-test');

      // Next attempt should start from 1s again
      const delay = calculateRecoveryBackoff('backoff-reset-test');
      expect(delay).toBe(1000);
    });

    test('returns -1 for non-existent session', () => {
      const delay = calculateRecoveryBackoff('non-existent-session');
      expect(delay).toBe(-1);
    });
  });

  describe('getSessionSummary', () => {
    test('returns empty string for non-existent session', () => {
      const summary = getSessionSummary('non-existent-session');
      expect(summary).toBe('');
    });

    test('returns empty string for session with no messages', () => {
      const session = getOrCreateSession({ sessionId: 'empty-session', channel: 'cli' });
      const summary = getSessionSummary('empty-session');
      expect(summary).toBe('');
    });

    test('returns formatted recent messages', async () => {
      const session = getOrCreateSession({ sessionId: 'summary-test', channel: 'cli' });

      // Add some messages directly to session
      const updatedSession = getSession('summary-test');
      if (updatedSession) {
        updatedSession.messages = [
          { role: 'user', content: 'First message', timestamp: new Date().toISOString() },
          { role: 'assistant', content: 'Second message', timestamp: new Date().toISOString() },
          { role: 'user', content: 'Third message', timestamp: new Date().toISOString() },
        ];
      }

      const summary = getSessionSummary('summary-test', 3);
      expect(summary).toContain('[user] First message');
      expect(summary).toContain('[assistant] Second message');
      expect(summary).toContain('[user] Third message');
    });

    test('limits to maxMessages parameter', async () => {
      const session = getOrCreateSession({ sessionId: 'summary-limit-test', channel: 'cli' });

      // Add 10 messages
      const updatedSession = getSession('summary-limit-test');
      if (updatedSession) {
        for (let i = 0; i < 10; i++) {
          updatedSession.messages.push({
            role: 'user',
            content: `Message ${i}`,
            timestamp: new Date().toISOString(),
          });
        }
      }

      const summary = getSessionSummary('summary-limit-test', 5);
      const lines = summary.split('\n');

      // Should only include last 5 messages
      expect(lines.length).toBe(5);
      expect(summary).toContain('Message 5');
      expect(summary).toContain('Message 9');
      expect(summary).not.toContain('Message 0');
      expect(summary).not.toContain('Message 4');
    });

    test('truncates long messages to 200 characters', async () => {
      const session = getOrCreateSession({ sessionId: 'truncate-test', channel: 'cli' });

      const longContent = 'A'.repeat(300);
      const updatedSession = getSession('truncate-test');
      if (updatedSession) {
        updatedSession.messages = [
          { role: 'user', content: longContent, timestamp: new Date().toISOString() },
        ];
      }

      const summary = getSessionSummary('truncate-test', 1);
      expect(summary.length).toBeLessThan(250); // [user] prefix + 200 chars + '...'
      expect(summary).toContain('...');
    });
  });
});
