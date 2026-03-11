import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { StreamingMessageController } from '../streaming-controller';
import {
  createToolUseBlock,
  createTextBlock,
} from '../../../../types/content-block';

describe('StreamingMessageController', () => {
  let mockClient: any;
  let controller: StreamingMessageController;

  beforeEach(() => {
    // Create mock client
    mockClient = {
      replyCard: mock(() => Promise.resolve('msg_123')),
      patchCard: mock(() => Promise.resolve()),
    };

    controller = new StreamingMessageController({
      client: mockClient,
      parentMessageId: 'parent_msg',
      chatId: 'chat_123',
      debounceMs: 100, // Fast for testing
    });
  });

  describe('Initial Message', () => {
    test('should send initial card message', async () => {
      const block = createTextBlock('Hello');
      await controller.pushContent(block);

      expect(mockClient.replyCard).toHaveBeenCalledTimes(1);
      expect(controller.getMessageId()).toBe('msg_123');
    });

    test('should mark as initialized after first message', async () => {
      const block = createTextBlock('Test');
      await controller.pushContent(block);

      expect(controller.isFinished()).toBe(false);
    });

    test('should send card with streaming enabled', async () => {
      const block = createToolUseBlock('call_1', 'Bash', { command: 'ls' });
      await controller.pushContent(block);

      const call = mockClient.replyCard.mock.calls[0];
      const card = call[1]; // Second argument is the card
      expect(card.config?.streaming_mode).toBe(true);
    });

    test('should handle send error', async () => {
      mockClient.replyCard = mock(() => Promise.reject(new Error('Send failed')));

      const block = createTextBlock('Test');
      await expect(controller.pushContent(block)).rejects.toThrow('Send failed');
    });

    test('should prevent race condition when multiple blocks pushed concurrently', async () => {
      // Simulate parallel tool execution (the bug scenario from the logs)
      // When 5 tools execute in parallel, each calls pushContent simultaneously
      // Without the fix, this would create 5 separate card replies

      const blocks = [
        createToolUseBlock('call_1', 'stock_quote', { symbol: 'sh000001' }),
        createToolUseBlock('call_2', 'stock_quote', { symbol: 'sz399001' }),
        createToolUseBlock('call_3', 'stock_quote', { symbol: 'sz399006' }),
        createToolUseBlock('call_4', 'stock_quote', { symbol: 'hkHSI' }),
        createToolUseBlock('call_5', 'stock_quote', { symbol: 'hkHSTECH' }),
      ];

      // Push all blocks concurrently (no awaiting between them)
      const promises = blocks.map(block => controller.pushContent(block));
      await Promise.all(promises);

      // Wait for any pending debounced updates
      await new Promise(resolve => setTimeout(resolve, 200));

      // CRITICAL: Should only send ONE replyCard, not 5
      expect(mockClient.replyCard).toHaveBeenCalledTimes(1);

      // Subsequent updates should use patchCard
      expect(mockClient.patchCard).toHaveBeenCalled();
    });
  });

  describe('Debounced Updates', () => {
    test('should debounce updates', async () => {
      // Send initial message
      await controller.pushContent(createTextBlock('Initial'));

      // Push multiple blocks quickly
      controller.pushContent(createToolUseBlock('call_1', 'Bash', { command: 'ls' }));
      controller.pushContent(createToolUseBlock('call_2', 'Read', { file_path: 'test' }));
      controller.pushContent(createTextBlock('Final'));

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should only have 2 calls: initial + one debounced update
      expect(mockClient.patchCard).toHaveBeenCalledTimes(1);
    });

    test('should update with accumulated blocks', async () => {
      // Send initial
      await controller.pushContent(createTextBlock('Initial'));

      // Push more blocks
      controller.pushContent(createToolUseBlock('call_1', 'Bash', { command: 'ls' }));
      controller.pushContent(createTextBlock('Final'));

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check patch was called with updated card
      expect(mockClient.patchCard).toHaveBeenCalled();
      const call = mockClient.patchCard.mock.calls[0];
      const card = call[1];
      expect(card.body.elements).toBeDefined();
    });
  });

  describe('Finish', () => {
    test('should send final update immediately', async () => {
      await controller.pushContent(createTextBlock('Test'));
      await controller.finish();

      // Initial + final update
      expect(mockClient.replyCard).toHaveBeenCalledTimes(1);
      expect(mockClient.patchCard).toHaveBeenCalledTimes(1);
    });

    test('should collapse panels in final update', async () => {
      const block = createToolUseBlock('call_1', 'Bash', { command: 'ls' });
      await controller.pushContent(block);
      await controller.finish();

      const call = mockClient.patchCard.mock.calls[0];
      const card = call[1];

      // Find collapsible panel
      const panel = card.body.elements.find((e: any) => e.tag === 'collapsible_panel');
      expect(panel?.expanded).toBe(false);
    });

    test('should mark as finished', async () => {
      await controller.pushContent(createTextBlock('Test'));
      await controller.finish();

      expect(controller.isFinished()).toBe(true);
    });

    test('should clear pending timer on finish', async () => {
      await controller.pushContent(createTextBlock('Initial'));

      // Push more blocks (will schedule debounced update)
      controller.pushContent(createTextBlock('Update'));

      // Finish immediately (should cancel timer)
      await controller.finish();

      // Wait to ensure timer was cancelled
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should only have initial + final, no debounced update
      expect(mockClient.patchCard).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    test('should handle message revoked error (230011)', async () => {
      await controller.pushContent(createTextBlock('Initial'));

      // Simulate revoked error
      mockClient.patchCard = mock(() =>
        Promise.reject({ code: 230011 })
      );

      controller.pushContent(createTextBlock('Update'));
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should mark as finished
      expect(controller.isFinished()).toBe(true);
    });

    test('should handle message revoked error (231003)', async () => {
      await controller.pushContent(createTextBlock('Initial'));

      mockClient.patchCard = mock(() =>
        Promise.reject({ code: 231003 })
      );

      controller.pushContent(createTextBlock('Update'));
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(controller.isFinished()).toBe(true);
    });

    test('should not stop on other errors', async () => {
      await controller.pushContent(createTextBlock('Initial'));

      let callCount = 0;
      mockClient.patchCard = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject({ code: 500 });
        }
        return Promise.resolve();
      });

      controller.pushContent(createTextBlock('Update 1'));
      await new Promise((resolve) => setTimeout(resolve, 200));

      controller.pushContent(createTextBlock('Update 2'));
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should continue despite error
      expect(controller.isFinished()).toBe(false);
    });
  });

  describe('Block Management', () => {
    test('should accumulate blocks', async () => {
      const block1 = createTextBlock('First');
      const block2 = createToolUseBlock('call_1', 'Bash', { command: 'ls' });
      const block3 = createTextBlock('Second');

      await controller.pushContent(block1);
      controller.pushContent(block2);
      controller.pushContent(block3);

      const blocks = controller.getBlocks();
      expect(blocks).toHaveLength(3);
    });

    test('should preserve block order', async () => {
      const blocks = [
        createToolUseBlock('call_1', 'Bash', { command: 'ls' }),
        createToolUseBlock('call_2', 'Read', { file_path: 'test' }),
        createTextBlock('Final'),
      ];

      for (const block of blocks) {
        await controller.pushContent(block);
      }

      const accumulated = controller.getBlocks();
      expect(accumulated[0].type).toBe('tool_use');
      expect(accumulated[1].type).toBe('tool_use');
      expect(accumulated[2].type).toBe('text');
    });
  });

  describe('Options', () => {
    test('should use custom debounce interval', async () => {
      const customController = new StreamingMessageController({
        client: mockClient,
        parentMessageId: 'parent',
        chatId: 'chat',
        debounceMs: 500,
      });

      await customController.pushContent(createTextBlock('Initial'));
      customController.pushContent(createTextBlock('Update'));

      // Wait 200ms - should not update yet
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(mockClient.patchCard).not.toHaveBeenCalled();

      // Wait longer
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(mockClient.patchCard).toHaveBeenCalled();
    });

    test('should pass replyInThread option', async () => {
      const threadController = new StreamingMessageController({
        client: mockClient,
        parentMessageId: 'parent',
        chatId: 'chat',
        replyInThread: true,
      });

      await threadController.pushContent(createTextBlock('Test'));

      const call = mockClient.replyCard.mock.calls[0];
      const options = call[2];
      expect(options?.replyInThread).toBe(true);
    });
  });
});
