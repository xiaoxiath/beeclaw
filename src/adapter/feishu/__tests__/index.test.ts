import { describe, it, expect } from 'bun:test';

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
    expect(typeof mod.editMessage).toBe('function');
    expect(typeof mod.replyMessage).toBe('function');
    expect(typeof mod.getMessage).toBe('function');
    // Media
    expect(typeof mod.uploadImage).toBe('function');
    expect(typeof mod.uploadFile).toBe('function');
    expect(typeof mod.sendImageMessage).toBe('function');
    expect(typeof mod.sendMedia).toBe('function');
    // Card
    expect(typeof mod.CardBuilder).toBe('function');
    expect(typeof mod.createCard).toBe('function');
    expect(typeof mod.buildMarkdownCard).toBe('function');
    // Mention
    expect(typeof mod.extractMentionTargets).toBe('function');
    expect(typeof mod.stripMentions).toBe('function');
  });
});
