/**
 * Tests for CLIChannel
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Mock logger
mock.module('../../../infra/observability/logger', () => ({
  logger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}));

import { CLIChannel } from '../channel';

describe('CLIChannel', () => {
  let channel: CLIChannel;

  beforeEach(() => {
    channel = new CLIChannel();
  });

  describe('type', () => {
    it('is "cli"', () => {
      expect(channel.type).toBe('cli');
    });
  });

  describe('postMessage', () => {
    it('returns success with a messageId for string content', async () => {
      const result = await channel.postMessage('hello world');
      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^cli-\d+$/);
    });

    it('returns success for multimodal content with text parts', async () => {
      const content = [
        { type: 'text' as const, text: 'Hello' },
        { type: 'text' as const, text: 'World' },
      ];
      const result = await channel.postMessage(content);
      expect(result.success).toBe(true);
      expect(result.messageId).toBeTruthy();
    });

    it('handles image_url parts as [Image]', async () => {
      const content = [
        { type: 'text' as const, text: 'Check this:' },
        { type: 'image_url' as const, image_url: { url: 'http://example.com/img.png' } },
      ];
      const result = await channel.postMessage(content);
      expect(result.success).toBe(true);
    });

    it('returns failure when an error occurs', async () => {
      // Force an error by passing content that will throw in contentToString
      // We can mock the logger.debug to throw
      const { logger } = await import('../../../infra/observability/logger');
      const originalDebug = logger.debug;
      (logger as any).debug = mock(() => { throw new Error('write fail'); });

      const result = await channel.postMessage('test');
      expect(result.success).toBe(false);
      expect(result.error).toBe('write fail');
      expect(result.messageId).toBe('');

      (logger as any).debug = originalDebug;
    });

    it('handles non-Error throws', async () => {
      const { logger } = await import('../../../infra/observability/logger');
      const originalDebug = logger.debug;
      (logger as any).debug = mock(() => { throw 'string error'; });

      const result = await channel.postMessage('test');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');

      (logger as any).debug = originalDebug;
    });

    it('accepts optional options parameter', async () => {
      const result = await channel.postMessage('msg', { sessionId: 'sess-1' });
      expect(result.success).toBe(true);
    });
  });

  describe('replyMessage', () => {
    it('delegates to postMessage', async () => {
      const result = await channel.replyMessage(
        { sessionId: 'sess-1' },
        'reply text'
      );
      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^cli-\d+$/);
    });
  });

  describe('updateMessageContent', () => {
    it('does not throw (no-op)', async () => {
      await expect(
        channel.updateMessageContent({ sessionId: 's', messageId: 'm' })
      ).resolves.toBeUndefined();
    });
  });

  describe('supportsUpdates', () => {
    it('returns false', () => {
      expect(channel.supportsUpdates()).toBe(false);
    });
  });

  describe('healthCheck', () => {
    it('always returns true', async () => {
      expect(await channel.healthCheck()).toBe(true);
    });
  });
});
