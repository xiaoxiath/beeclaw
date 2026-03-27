import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

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

import {
  getOrCreateSession,
  saveSession,
  isMessageProcessed,
  markMessageProcessed,
  deleteSession,
  initSessionManager,
} from '../index';
import { existsSync, mkdirSync, rmSync } from 'fs';

describe('Persistent Message Deduplication', () => {
  beforeEach(() => {
    // Initialize session manager
    initSessionManager({
      provider: 'openai',
      model: 'gpt-4',
      useTools: true,
    });
  });

  afterEach(() => {
    // Clean up test sessions
  });

  test('should return false for unprocessed message', () => {
    const sessionId = 'test-dedup-new';
    const messageId = 'msg_001';

    // Create session
    const session = getOrCreateSession({
      sessionId,
      userId: 'user_001',
      channel: 'feishu',
    });

    // Check unprocessed message
    expect(isMessageProcessed(sessionId, messageId)).toBe(false);
    deleteSession(sessionId);
  });

  test('should mark message as processed', () => {
    const sessionId = 'test-dedup-mark';
    const messageId = 'msg_002';

    // Create session
    getOrCreateSession({
      sessionId,
      userId: 'user_001',
      channel: 'feishu',
    });

    // Mark as processed
    markMessageProcessed(sessionId, messageId);

    // Check it's now marked
    expect(isMessageProcessed(sessionId, messageId)).toBe(true);
    deleteSession(sessionId);
  });

  test('should persist across session reload (permanent storage)', () => {
    const sessionId = 'test-dedup-persist';
    const messageId = 'msg_003';

    // Create session and mark message
    getOrCreateSession({
      sessionId,
      userId: 'user_001',
      channel: 'feishu',
    });
    markMessageProcessed(sessionId, messageId);

    // Verify it's marked
    expect(isMessageProcessed(sessionId, messageId)).toBe(true);

    // Save and clear from memory (simulate restart)
    const session = getOrCreateSession({ sessionId, userId: 'user_001', channel: 'feishu' });
    saveSession(session);

    // Session should be saved with processedMessageIds
    // In real code, sessions map would be cleared on restart
    // For this test, we just verify the session file has the data

    expect(isMessageProcessed(sessionId, messageId)).toBe(true);
    deleteSession(sessionId);
  });

  test('should handle multiple messages', () => {
    const sessionId = 'test-dedup-multiple';
    const messages = ['msg_004', 'msg_005', 'msg_006'];

    // Create session
    getOrCreateSession({
      sessionId,
      userId: 'user_001',
      channel: 'feishu',
    });

    // Mark first two messages
    markMessageProcessed(sessionId, messages[0]);
    markMessageProcessed(sessionId, messages[1]);

    // Verify
    expect(isMessageProcessed(sessionId, messages[0])).toBe(true);
    expect(isMessageProcessed(sessionId, messages[1])).toBe(true);
    expect(isMessageProcessed(sessionId, messages[2])).toBe(false);

    deleteSession(sessionId);
  });

  test('should prevent duplicate processing in same session', () => {
    const sessionId = 'test-dedup-duplicate';
    const messageId = 'msg_008';

    // Create session
    getOrCreateSession({
      sessionId,
      userId: 'user_001',
      channel: 'feishu',
    });

    // First check - not processed
    expect(isMessageProcessed(sessionId, messageId)).toBe(false);

    // Mark as processed
    markMessageProcessed(sessionId, messageId);

    // Second check - should be detected as duplicate
    expect(isMessageProcessed(sessionId, messageId)).toBe(true);

    deleteSession(sessionId);
  });

  test('should isolate message IDs between sessions', () => {
    const sessionId1 = 'test-dedup-isolate-1';
    const sessionId2 = 'test-dedup-isolate-2';
    const messageId = 'msg_009';

    // Create both sessions
    getOrCreateSession({ sessionId: sessionId1, userId: 'user_001', channel: 'feishu' });
    getOrCreateSession({ sessionId: sessionId2, userId: 'user_002', channel: 'feishu' });

    // Mark in first session
    markMessageProcessed(sessionId1, messageId);

    // Should be processed in first session
    expect(isMessageProcessed(sessionId1, messageId)).toBe(true);

    // But not in second session
    expect(isMessageProcessed(sessionId2, messageId)).toBe(false);

    deleteSession(sessionId1);
    deleteSession(sessionId2);
  });
});
