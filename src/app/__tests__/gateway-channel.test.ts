import { describe, test, expect, beforeEach } from 'bun:test';
import {
  MultiChannelMessageGateway,
  getMessageGateway,
  resetMessageGateway,
} from '../gateway-channel';
import type { MessageChannel, ChannelType, MessageResult } from '../types';

describe('MultiChannelMessageGateway', () => {
  let gateway: MultiChannelMessageGateway;

  beforeEach(() => {
    resetMessageGateway();
    gateway = getMessageGateway();
  });

  describe('postMultimodal [AUDIT FIX M-1]', () => {
    // Mock channel that supports multimodal
    const createMultimodalChannel = (): MessageChannel => ({
      type: 'test-multimodal' as ChannelType,
      async postMessage(content, options?) {
        return { messageId: 'test-id', success: true };
      },
      async replyMessage(options, content) {
        return { messageId: 'test-id', success: true };
      },
      supportsUpdates: () => false,
      async healthCheck() {
        return true;
      },
      async sendMultimodal(content, options?) {
        return { messageId: 'multimodal-id', success: true };
      },
    });

    // Mock channel that does NOT support multimodal
    const createTextOnlyChannel = (): MessageChannel => ({
      type: 'test-text-only' as ChannelType,
      async postMessage(content, options?) {
        return { messageId: 'text-id', success: true };
      },
      async replyMessage(options, content) {
        return { messageId: 'text-id', success: true };
      },
      supportsUpdates: () => false,
      async healthCheck() {
        return true;
      },
      // No sendMultimodal method
    });

    test('uses sendMultimodal when available', async () => {
      const channel = createMultimodalChannel();
      gateway.registerChannel(channel);

      const content = [
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ];

      const result = await gateway.postMultimodal('test-multimodal', content);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('multimodal-id');
    });

    test('falls back to text when sendMultimodal fails', async () => {
      const channel = createMultimodalChannel();
      // Override sendMultimodal to throw error
      channel.sendMultimodal = async () => {
        throw new Error('Multimodal not supported');
      };
      gateway.registerChannel(channel);

      const content = [
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
      ];

      const result = await gateway.postMultimodal('test-multimodal', content);

      // Should fall back to postMessage (which returns test-id by default)
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('test-id');
    });

    test('extracts text from multimodal content when channel does not support it', async () => {
      let capturedContent: any = null;
      const channel = createTextOnlyChannel();
      // Override postMessage to capture what was sent
      channel.postMessage = async (content, options?) => {
        capturedContent = content;
        return { messageId: 'captured-id', success: true };
      };
      gateway.registerChannel(channel);

      const content = [
        { type: 'text', text: 'Hello world' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        { type: 'text', text: 'More text' },
      ];

      const result = await gateway.postMultimodal('test-text-only', content);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('captured-id');
      expect(capturedContent).toContain('Hello world');
      expect(capturedContent).toContain('More text');
      expect(capturedContent).toContain('[Image: https://example.com/image.jpg...]');
    });

    test('truncates long image URLs in fallback', async () => {
      let capturedContent: any = null;
      const channel = createTextOnlyChannel();
      channel.postMessage = async (content, options?) => {
        capturedContent = content;
        return { messageId: 'captured-id', success: true };
      };
      gateway.registerChannel(channel);

      const longUrl = 'https://example.com/' + 'a'.repeat(100) + '.jpg';
      const content = [
        { type: 'image_url', image_url: { url: longUrl } },
      ];

      await gateway.postMultimodal('test-text-only', content);

      // URL should be truncated to 50 characters
      expect(capturedContent).toContain('[Image:');
      const urlInContent = capturedContent.match(/\[Image: (.*?)\.\.\.\]/)?.[1];
      expect(urlInContent?.length).toBe(50);
    });

    test('handles string content directly', async () => {
      let capturedContent: any = null;
      const channel = createTextOnlyChannel();
      channel.postMessage = async (content, options?) => {
        capturedContent = content;
        return { messageId: 'captured-id', success: true };
      };
      gateway.registerChannel(channel);

      const result = await gateway.postMultimodal('test-text-only', 'Plain text');

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('captured-id');
      expect(capturedContent).toBe('Plain text');
    });

    test('returns error for non-existent channel', async () => {
      const result = await gateway.postMultimodal('non-existent', 'text');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Channel not found');
    });
  });
});
