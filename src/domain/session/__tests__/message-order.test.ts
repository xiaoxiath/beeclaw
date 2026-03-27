/**
 * Message Order and Recovery Tests
 *
 * These tests verify that the recovery system doesn't cause message ordering issues
 */

import { describe, test, expect, vi } from 'vitest';

// Mock bun-only and problematic ESM modules to allow tests to run in Node.js
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

import { detectUnansweredSessions, type RecoveryConfig } from '../recovery';
import type { Session } from '../index';

const defaultConfig: RecoveryConfig = {
  enabled: true,
  maxAge: 300000,  // 5 minutes
  minAge: 10000,   // 10 seconds
  channels: ['feishu'],
  batchSize: 5,
  delayMs: 0,
  startupDelay: 0,
};

describe('Message Order and Recovery', () => {
  describe('PendingRecovery flag cleanup', () => {
    test('should clear stale pendingRecovery flag for answered sessions', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-answered-recovery',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Hello',
              timestamp: new Date(now - 120000).toISOString(),
            },
            {
              role: 'assistant',
              content: 'Hi there!',
              timestamp: new Date(now - 60000).toISOString(),
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 60000).toISOString(),
          pendingRecovery: true,  // Stale flag (should be cleared)
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      // Should not detect as unanswered (already has assistant response)
      expect(result).toHaveLength(0);

      // Should clear the stale pendingRecovery flag
      expect(sessions[0].pendingRecovery).toBe(false);
    });

    test('should not detect sessions with assistant response as unanswered', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-answered',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Question 1',
              timestamp: new Date(now - 120000).toISOString(),
            },
            {
              role: 'assistant',
              content: 'Answer 1',
              timestamp: new Date(now - 60000).toISOString(),
            },
            {
              role: 'user',
              content: 'Question 2',
              timestamp: new Date(now - 30000).toISOString(),
            },
            {
              role: 'assistant',
              content: 'Answer 2',
              timestamp: new Date(now - 15000).toISOString(),
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 15000).toISOString(),
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      expect(result).toHaveLength(0);
    });

    test('should detect unanswered sessions even with pendingRecovery', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-unanswered-recovery',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Hello (processing interrupted)',
              timestamp: new Date(now - 30000).toISOString(),  // 30s ago (below minAge)
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 30000).toISOString(),
          pendingRecovery: true,  // Bot restarted during processing
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      // Should detect even though message is recent (below minAge)
      // because pendingRecovery flag is set
      expect(result).toHaveLength(1);
      expect(result[0].session.id).toBe('feishu-unanswered-recovery');
      expect(result[0].session.pendingRecovery).toBe(true);
    });
  });

  describe('Multiple messages scenario', () => {
    test('should handle rapid sequential messages correctly', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-rapid-messages',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Message A',
              timestamp: new Date(now - 120000).toISOString(),
            },
            {
              role: 'assistant',
              content: 'Response to A',
              timestamp: new Date(now - 110000).toISOString(),
            },
            {
              role: 'user',
              content: 'Message B',
              timestamp: new Date(now - 100000).toISOString(),
            },
            {
              role: 'assistant',
              content: 'Response to B',
              timestamp: new Date(now - 90000).toISOString(),
            },
            {
              role: 'user',
              content: 'Message C',
              timestamp: new Date(now - 80000).toISOString(),
            },
            {
              role: 'assistant',
              content: 'Response to C',
              timestamp: new Date(now - 70000).toISOString(),
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 70000).toISOString(),
          pendingRecovery: true,  // Stale flag from old restart
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      // Should not detect - all messages are answered
      expect(result).toHaveLength(0);

      // Should clear stale pendingRecovery flag
      expect(sessions[0].pendingRecovery).toBe(false);
    });

    test('should detect only the last unanswered message', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-partial-answered',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Message A',
              timestamp: new Date(now - 120000).toISOString(),
            },
            {
              role: 'assistant',
              content: 'Response to A',
              timestamp: new Date(now - 110000).toISOString(),
            },
            {
              role: 'user',
              content: 'Message B (unanswered)',
              timestamp: new Date(now - 60000).toISOString(),
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 60000).toISOString(),
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      // Should detect only the last unanswered message
      expect(result).toHaveLength(1);
      expect(result[0].session.id).toBe('feishu-partial-answered');
      expect(result[0].lastMessageContent).toBe('Message B (unanswered)');
    });
  });

  describe('Edge cases', () => {
    test('should handle empty session gracefully', async () => {
      const sessions: Session[] = [
        {
          id: 'feishu-empty',
          userId: 'user1',
          channel: 'feishu',
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      expect(result).toHaveLength(0);
    });

    test('should handle session with only assistant messages', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-assistant-only',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'assistant',
              content: 'Proactive message',
              timestamp: new Date(now - 60000).toISOString(),
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 60000).toISOString(),
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      expect(result).toHaveLength(0);
    });

    test('should respect channel filter', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'cli-unanswered',
          userId: 'user1',
          channel: 'cli',
          messages: [
            {
              role: 'user',
              content: 'Hello from CLI',
              timestamp: new Date(now - 60000).toISOString(),
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 60000).toISOString(),
        },
        {
          id: 'feishu-unanswered',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Hello from Feishu',
              timestamp: new Date(now - 60000).toISOString(),
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 60000).toISOString(),
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      // Should only detect feishu channel
      expect(result).toHaveLength(1);
      expect(result[0].session.channel).toBe('feishu');
    });
  });
});
