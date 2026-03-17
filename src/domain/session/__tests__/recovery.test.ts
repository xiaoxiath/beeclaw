/**
 * Session Recovery Module Tests
 */

import { describe, test, expect } from 'bun:test';
import { detectUnansweredSessions, recoverUnansweredSessions } from '../recovery';
import type { Session, RecoveryConfig } from '../index';

describe('Session Recovery', () => {
  const defaultConfig: RecoveryConfig = {
    enabled: true,
    maxAge: 300000,  // 5 minutes
    minAge: 10000,   // 10 seconds
    channels: ['feishu'],
    batchSize: 5,
    delayMs: 0,  // No delay in tests
    startupDelay: 0,
  };

  describe('detectUnansweredSessions', () => {
    test('should detect unanswered session', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-test-1',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Hello',
              timestamp: new Date(now - 60000).toISOString(),  // 1 minute ago
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 60000).toISOString(),
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      expect(result).toHaveLength(1);
      expect(result[0].session.id).toBe('feishu-test-1');
      expect(result[0].lastMessageAge).toBeGreaterThanOrEqual(60000);
    });

    test('should skip old messages beyond maxAge', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-old-1',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Old message',
              timestamp: new Date(now - 400000).toISOString(),  // 6+ minutes ago
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 400000).toISOString(),
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      expect(result).toHaveLength(0);
    });

    test('should skip recent messages below minAge', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-recent-1',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Recent message',
              timestamp: new Date(now - 5000).toISOString(),  // 5 seconds ago
            },
          ],
          createdAt: new Date(now - 60000).toISOString(),
          updatedAt: new Date(now - 5000).toISOString(),
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      expect(result).toHaveLength(0);
    });

    test('should skip answered sessions', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-answered-1',
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
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      expect(result).toHaveLength(0);
    });

    test('should detect sessions with pendingRecovery flag', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-recovery-1',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Hello (processing)',
              timestamp: new Date(now - 5000).toISOString(),  // 5 seconds ago (below minAge)
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 5000).toISOString(),
          pendingRecovery: true,  // Marked for recovery (bot restarted during processing)
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      // Should detect even though message is recent (below minAge)
      // because pendingRecovery flag is set
      expect(result).toHaveLength(1);
      expect(result[0].session.id).toBe('feishu-recovery-1');
      expect(result[0].session.pendingRecovery).toBe(true);
    });

    test('should filter by channel', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'cli-test-1',
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
          id: 'feishu-test-2',
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

      expect(result).toHaveLength(1);
      expect(result[0].session.channel).toBe('feishu');
    });

    test('should sort by age (oldest first)', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-test-3',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Message 1',
              timestamp: new Date(now - 30000).toISOString(),  // 30s ago
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 30000).toISOString(),
        },
        {
          id: 'feishu-test-4',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Message 2',
              timestamp: new Date(now - 120000).toISOString(),  // 2m ago
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 120000).toISOString(),
        },
      ];

      const result = await detectUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
      });

      expect(result).toHaveLength(2);
      expect(result[0].session.id).toBe('feishu-test-4');  // Oldest first
      expect(result[1].session.id).toBe('feishu-test-3');
    });
  });

  describe('recoverUnansweredSessions', () => {
    test('should skip if disabled', async () => {
      const config: RecoveryConfig = {
        ...defaultConfig,
        enabled: false,
      };

      const result = await recoverUnansweredSessions(config, {
        getAllSessions: () => [],
      });

      expect(result.recovered).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
    });

    test('should recover unanswered sessions', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-test-5',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Test message',
              timestamp: new Date(now - 60000).toISOString(),
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 60000).toISOString(),
          metadata: { chatId: 'test-chat-id' },
        },
      ];

      let proactiveMessageCalled = false;
      let feishuMessageSent = false;

      const result = await recoverUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
        sendProactiveMessage: async (options) => {
          proactiveMessageCalled = true;
          expect(options.sessionId).toBe('feishu-test-5');
          expect(options.context?.isRecovery).toBe(true);
          return { success: true, response: 'AI generated response' };
        },
        getFeishuClient: () => ({
          sendPostMessage: async (chatId: string, receiveIdType: string, message: string, options?: any) => {
            feishuMessageSent = true;
            expect(chatId).toBe('test-chat-id');
            expect(message).toBe('AI generated response');
            expect(options?.title).toBe('🔄 恢复处理结果');
          },
        }),
      });

      expect(result.recovered).toBe(1);
      expect(result.failed).toBe(0);
      expect(proactiveMessageCalled).toBe(true);
      expect(feishuMessageSent).toBe(true);  // Verify response was sent
    });

    test('should handle recovery failure', async () => {
      const now = Date.now();
      const sessions: Session[] = [
        {
          id: 'feishu-test-6',
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: 'Test message',
              timestamp: new Date(now - 60000).toISOString(),
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 60000).toISOString(),
        },
      ];

      const result = await recoverUnansweredSessions(defaultConfig, {
        getAllSessions: () => sessions,
        sendProactiveMessage: async () => {
          return { success: false, error: 'Test error' };
        },
      });

      expect(result.recovered).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.details[0].error).toBe('Test error');
    });

    test('should process in batches', async () => {
      const now = Date.now();
      const sessions: Session[] = [];
      for (let i = 0; i < 7; i++) {
        sessions.push({
          id: `feishu-test-${i}`,
          userId: 'user1',
          channel: 'feishu',
          messages: [
            {
              role: 'user',
              content: `Message ${i}`,
              timestamp: new Date(now - 60000).toISOString(),
            },
          ],
          createdAt: new Date(now - 3600000).toISOString(),
          updatedAt: new Date(now - 60000).toISOString(),
        });
      }

      const config: RecoveryConfig = {
        ...defaultConfig,
        batchSize: 3,
      };

      const result = await recoverUnansweredSessions(config, {
        getAllSessions: () => sessions,
        sendProactiveMessage: async () => ({ success: true }),
      });

      expect(result.recovered).toBe(7);
    });
  });
});
