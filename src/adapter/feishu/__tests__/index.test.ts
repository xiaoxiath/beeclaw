import { describe, it, expect, vi } from 'vitest';

// Mock bun:sqlite to avoid ESM protocol error
vi.mock('bun:sqlite', () => {
  class MockDatabase {
    constructor() {}
    exec = vi.fn();
    run = vi.fn();
    query = vi.fn(() => ({ all: vi.fn(() => []) }));
    prepare = vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() }));
    transaction = vi.fn((fn: Function) => fn);
    close = vi.fn();
  }
  return { Database: MockDatabase, default: MockDatabase };
});

vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  })),
}));

// Mock MCP SDK to avoid ESM resolution error
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(),
}));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(),
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn(),
}));

// Mock bunqueue to avoid ESM directory import error
vi.mock('bunqueue/client', () => ({
  Queue: vi.fn(),
  Worker: vi.fn(),
}));

describe('adapter/feishu/index exports', () => {
  it('should export expected symbols', async () => {
    const mod = await import('../index');
    expect(mod).toBeDefined();
    // WS Client
    expect(typeof mod.FeishuWSClient).toBe('function');
    expect(typeof mod.initFeishuWSClient).toBe('function');
    expect(typeof mod.getFeishuWSClient).toBe('function');
    expect(typeof mod.resetFeishuWSClient).toBe('function');
    // Send
    expect(typeof mod.sendTextMessage).toBe('function');
    expect(typeof mod.sendPostMessage).toBe('function');
    expect(typeof mod.sendMarkdownMessage).toBe('function');
    expect(typeof mod.sendCardMessage).toBe('function');
    expect(typeof mod.sendMarkdownCard).toBe('function');
    expect(typeof mod.editMessage).toBe('function');
    expect(typeof mod.replyMessage).toBe('function');
    expect(typeof mod.getMessage).toBe('function');
    // Media
    expect(typeof mod.uploadImage).toBe('function');
    expect(typeof mod.uploadFile).toBe('function');
    expect(typeof mod.downloadImage).toBe('function');
    expect(typeof mod.downloadMessageResource).toBe('function');
    expect(typeof mod.sendImageMessage).toBe('function');
    expect(typeof mod.sendFileMessage).toBe('function');
    expect(typeof mod.sendMedia).toBe('function');
    // Card
    expect(typeof mod.CardBuilder).toBe('function');
    expect(typeof mod.createCard).toBe('function');
    expect(typeof mod.buildMarkdownCard).toBe('function');
    expect(typeof mod.buildTextCard).toBe('function');
    expect(typeof mod.buildFormCard).toBe('function');
    expect(typeof mod.buildListCard).toBe('function');
    // Mention
    expect(typeof mod.extractMentionTargets).toBe('function');
    expect(typeof mod.isMentionForwardRequest).toBe('function');
    expect(typeof mod.extractMessageBody).toBe('function');
    expect(typeof mod.formatMentionForText).toBe('function');
    expect(typeof mod.formatMentionForCard).toBe('function');
    expect(typeof mod.formatMentionAllForText).toBe('function');
    expect(typeof mod.formatMentionAllForCard).toBe('function');
    expect(typeof mod.buildMentionedMessage).toBe('function');
    expect(typeof mod.buildMentionedCardContent).toBe('function');
    expect(typeof mod.parseMentionsFromText).toBe('function');
    expect(typeof mod.parseMentionsFromCard).toBe('function');
    expect(typeof mod.stripMentions).toBe('function');
  });
});
