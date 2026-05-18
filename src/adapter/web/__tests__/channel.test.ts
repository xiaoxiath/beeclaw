import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import { WebChannel, getWebChannel, resetWebChannel } from '../channel';
import type { WebMessageEvent } from '../channel';

describe('WebChannel', () => {
  let channel: WebChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    resetWebChannel();
    channel = new WebChannel();
  });

  // ─── Properties ───
  describe('properties', () => {
    it('has type "web"', () => {
      expect(channel.type).toBe('web');
    });
  });

  // ─── postMessage ───
  describe('postMessage', () => {
    it('returns a successful result with messageId', async () => {
      const result = await channel.postMessage('Hello');

      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^web-/);
    });

    it('emits to session-specific listeners', async () => {
      const listener = vi.fn();
      channel.addListener('session-1', listener);

      await channel.postMessage('Hello', { sessionId: 'session-1' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        type: 'post',
        content: 'Hello',
        sessionId: 'session-1',
      }));
    });

    it('emits to wildcard listeners', async () => {
      const listener = vi.fn();
      channel.addListener('*', listener);

      await channel.postMessage('Hello', { sessionId: 'session-1' });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('emits to both session and wildcard listeners', async () => {
      const sessionListener = vi.fn();
      const wildcardListener = vi.fn();
      channel.addListener('session-1', sessionListener);
      channel.addListener('*', wildcardListener);

      await channel.postMessage('Hello', { sessionId: 'session-1' });

      expect(sessionListener).toHaveBeenCalledTimes(1);
      expect(wildcardListener).toHaveBeenCalledTimes(1);
    });

    it('broadcasts without sessionId (only wildcard receives)', async () => {
      const sessionListener = vi.fn();
      const wildcardListener = vi.fn();
      channel.addListener('session-1', sessionListener);
      channel.addListener('*', wildcardListener);

      await channel.postMessage('Hello');

      expect(sessionListener).not.toHaveBeenCalled();
      expect(wildcardListener).toHaveBeenCalledTimes(1);
    });

    it('includes metadata in the event', async () => {
      const listener = vi.fn();
      channel.addListener('s1', listener);

      await channel.postMessage('Hello', {
        sessionId: 's1',
        metadata: { key: 'value' },
      });

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        metadata: { key: 'value' },
      }));
    });

    it('handles listener errors gracefully', async () => {
      const badListener = vi.fn(() => { throw new Error('Listener crash'); });
      const goodListener = vi.fn();
      channel.addListener('s1', badListener);
      channel.addListener('s1', goodListener);

      const result = await channel.postMessage('Hello', { sessionId: 's1' });

      expect(result.success).toBe(true);
      // Good listener still gets called despite bad listener throwing
      expect(goodListener).toHaveBeenCalledTimes(1);
    });

    it('handles wildcard listener errors gracefully', async () => {
      const badListener = vi.fn(() => { throw new Error('Wildcard crash'); });
      channel.addListener('*', badListener);

      const result = await channel.postMessage('Hello', { sessionId: 's1' });

      expect(result.success).toBe(true);
    });
  });

  // ─── replyMessage ───
  describe('replyMessage', () => {
    it('returns a successful result with reply messageId', async () => {
      const result = await channel.replyMessage(
        { sessionId: 's1', parentMessageId: 'msg-1' },
        'Reply content'
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^web-reply-/);
    });

    it('emits reply event to session listeners', async () => {
      const listener = vi.fn();
      channel.addListener('s1', listener);

      await channel.replyMessage(
        { sessionId: 's1', parentMessageId: 'msg-1', metadata: { tag: 'test' } },
        'Reply content'
      );

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        type: 'reply',
        content: 'Reply content',
        sessionId: 's1',
        parentMessageId: 'msg-1',
        metadata: { tag: 'test' },
      }));
    });

    it('handles error in reply', async () => {
      // Force an internal error by making the listener throw during emit
      // Since the try-catch only catches actual thrown errors from the method itself,
      // we need a different approach. Let's verify the catch path exists.
      const listener = vi.fn(() => { throw new Error('Emit error'); });
      channel.addListener('s1', listener);

      // The error in the listener is caught within emit, so replyMessage still succeeds
      const result = await channel.replyMessage(
        { sessionId: 's1' },
        'Reply'
      );

      expect(result.success).toBe(true);
    });
  });

  // ─── updateMessageContent ───
  describe('updateMessageContent', () => {
    it('emits update event', async () => {
      const listener = vi.fn();
      channel.addListener('s1', listener);

      await channel.updateMessageContent({
        sessionId: 's1',
        messageId: 'msg-1',
      });

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        type: 'update',
        messageId: 'msg-1',
        sessionId: 's1',
      }));
    });
  });

  // ─── supportsUpdates ───
  describe('supportsUpdates', () => {
    it('returns true', () => {
      expect(channel.supportsUpdates()).toBe(true);
    });
  });

  // ─── healthCheck ───
  describe('healthCheck', () => {
    it('returns true', async () => {
      const result = await channel.healthCheck();
      expect(result).toBe(true);
    });
  });

  // ─── addListener / removeListener ───
  describe('addListener', () => {
    it('returns a cleanup function that removes the listener', async () => {
      const listener = vi.fn();
      const cleanup = channel.addListener('s1', listener);

      await channel.postMessage('Test', { sessionId: 's1' });
      expect(listener).toHaveBeenCalledTimes(1);

      cleanup();

      await channel.postMessage('Test2', { sessionId: 's1' });
      expect(listener).toHaveBeenCalledTimes(1); // Not called again
    });

    it('cleans up the session set when last listener is removed', async () => {
      const listener = vi.fn();
      const cleanup = channel.addListener('s1', listener);

      expect(channel.activeListenerCount).toBe(1);

      cleanup();

      expect(channel.activeListenerCount).toBe(0);
    });

    it('does not remove other listeners for the same session', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const cleanup1 = channel.addListener('s1', listener1);
      channel.addListener('s1', listener2);

      cleanup1();

      await channel.postMessage('Test', { sessionId: 's1' });
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  // ─── activeListenerCount ───
  describe('activeListenerCount', () => {
    it('returns 0 with no listeners', () => {
      expect(channel.activeListenerCount).toBe(0);
    });

    it('counts listeners across sessions', () => {
      channel.addListener('s1', vi.fn());
      channel.addListener('s1', vi.fn());
      channel.addListener('s2', vi.fn());

      expect(channel.activeListenerCount).toBe(3);
    });
  });

  // ─── Singleton ───
  describe('getWebChannel / resetWebChannel', () => {
    it('returns the same instance on multiple calls', () => {
      const c1 = getWebChannel();
      const c2 = getWebChannel();
      expect(c1).toBe(c2);
    });

    it('returns a new instance after reset', () => {
      const c1 = getWebChannel();
      resetWebChannel();
      const c2 = getWebChannel();
      expect(c1).not.toBe(c2);
    });
  });
});
