import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    info: vi.fn(() => {}),
    warn: vi.fn(() => {}),
    debug: vi.fn(() => {}),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import { injectProactiveResult, getRecentSessionHistory } from '../proactive-messaging';

describe('proactive-messaging', () => {
  // ─── injectProactiveResult ────────────────────────────────────────────
  describe('injectProactiveResult', () => {
    it('should return false when session is undefined', () => {
      const saveFn = vi.fn(() => {});
      const result = injectProactiveResult(undefined, { source: 'test', content: 'hello' }, saveFn);
      expect(result).toBe(false);
      expect(saveFn).not.toHaveBeenCalled();
    });

    it('should inject message into session and call saveFn', () => {
      const saveFn = vi.fn(() => {});
      const session: any = {
        id: 'test-session',
        messages: [],
        updatedAt: '',
      };

      const result = injectProactiveResult(
        session,
        { source: 'daily-report', content: 'Report content' },
        saveFn,
      );

      expect(result).toBe(true);
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].role).toBe('system');
      expect(session.messages[0].content).toContain('daily-report');
      expect(session.messages[0].content).toContain('Report content');
      expect(session.messages[0]._meta?.source).toBe('proactive');
      expect(saveFn).toHaveBeenCalledWith(session);
    });

    it('should use provided timestamp', () => {
      const saveFn = vi.fn(() => {});
      const session: any = { id: 's1', messages: [], updatedAt: '' };
      const ts = new Date('2025-01-01T00:00:00Z').getTime();

      injectProactiveResult(session, { source: 'cron', content: 'data', timestamp: ts }, saveFn);

      expect(session.messages[0].timestamp).toBe('2025-01-01T00:00:00.000Z');
    });

    it('should use current time when no timestamp provided', () => {
      const saveFn = vi.fn(() => {});
      const session: any = { id: 's1', messages: [], updatedAt: '' };

      injectProactiveResult(session, { source: 'cron', content: 'data' }, saveFn);

      // Timestamp should be recent (within last second)
      const msgTime = new Date(session.messages[0].timestamp).getTime();
      expect(Date.now() - msgTime).toBeLessThan(2000);
    });
  });

  // ─── getRecentSessionHistory ──────────────────────────────────────────
  describe('getRecentSessionHistory', () => {
    it('should return empty array for null session', () => {
      expect(getRecentSessionHistory(null)).toEqual([]);
    });

    it('should return empty array for undefined session', () => {
      expect(getRecentSessionHistory(undefined)).toEqual([]);
    });

    it('should return empty array for session with no messages', () => {
      expect(getRecentSessionHistory({ messages: [] } as any)).toEqual([]);
    });

    it('should return last N messages', () => {
      const messages = [
        { role: 'user', content: 'msg1', timestamp: 't1' },
        { role: 'assistant', content: 'msg2', timestamp: 't2' },
        { role: 'user', content: 'msg3', timestamp: 't3' },
      ];
      const session: any = { messages };

      const result = getRecentSessionHistory(session, 2);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('msg2');
      expect(result[1].content).toBe('msg3');
    });

    it('should default to 10 messages max', () => {
      const messages = Array.from({ length: 15 }, (_, i) => ({
        role: 'user',
        content: `msg${i}`,
        timestamp: `t${i}`,
      }));
      const session: any = { messages };

      const result = getRecentSessionHistory(session);
      expect(result).toHaveLength(10);
    });

    it('should return all messages when fewer than maxMessages', () => {
      const messages = [{ role: 'user', content: 'only', timestamp: 't' }];
      const result = getRecentSessionHistory({ messages } as any, 10);
      expect(result).toHaveLength(1);
    });
  });
});
