import { describe, test, expect, vi } from 'vitest';
import {
  ContentBlockSchema,
  ThinkingBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
  TextBlockSchema,
  ImageBlockSchema,
  isThinkingBlock,
  isToolUseBlock,
  isToolResultBlock,
  isTextBlock,
  isImageBlock,
  createThinkingBlock,
  createToolUseBlock,
  createToolResultBlock,
  createTextBlock,
  createImageBlock,
  validateContentBlocks,
  type ContentBlock,
} from '../content-block';

describe('ContentBlock Types', () => {
  describe('ThinkingBlock', () => {
    test('should create valid thinking block', () => {
      const block = createThinkingBlock('Agent is thinking...');
      expect(block.type).toBe('thinking');
      expect(block.thinking).toBe('Agent is thinking...');
    });

    test('should validate thinking block', () => {
      const result = ThinkingBlockSchema.safeParse({
        type: 'thinking',
        thinking: 'Test thinking',
      });
      expect(result.success).toBe(true);
    });

    test('should fail invalid thinking block', () => {
      const result = ThinkingBlockSchema.safeParse({
        type: 'thinking',
        // missing thinking field
      });
      expect(result.success).toBe(false);
    });

    test('type guard should work', () => {
      const block: ContentBlock = createThinkingBlock('Test');
      expect(isThinkingBlock(block)).toBe(true);
      expect(isToolUseBlock(block)).toBe(false);
    });
  });

  describe('ToolUseBlock', () => {
    test('should create valid tool use block', () => {
      const block = createToolUseBlock('call_123', 'web_search', { query: 'test' });
      expect(block.type).toBe('tool_use');
      expect(block.id).toBe('call_123');
      expect(block.name).toBe('web_search');
      expect(block.input).toEqual({ query: 'test' });
    });

    test('should validate tool use block', () => {
      const result = ToolUseBlockSchema.safeParse({
        type: 'tool_use',
        id: 'call_456',
        name: 'Bash',
        input: { command: 'ls' },
      });
      expect(result.success).toBe(true);
    });

    test('should fail invalid tool use block', () => {
      const result = ToolUseBlockSchema.safeParse({
        type: 'tool_use',
        id: 'call_789',
        // missing name and input
      });
      expect(result.success).toBe(false);
    });

    test('type guard should work', () => {
      const block: ContentBlock = createToolUseBlock('id', 'test', {});
      expect(isToolUseBlock(block)).toBe(true);
      expect(isTextBlock(block)).toBe(false);
    });
  });

  describe('ToolResultBlock', () => {
    test('should create valid tool result block', () => {
      const block = createToolResultBlock('call_123', 'Result content');
      expect(block.type).toBe('tool_result');
      expect(block.toolUseId).toBe('call_123');
      expect(block.content).toBe('Result content');
      expect(block.isError).toBeUndefined();
    });

    test('should create tool result block with error flag', () => {
      const block = createToolResultBlock('call_456', 'Error occurred', true);
      expect(block.isError).toBe(true);
    });

    test('should validate tool result block', () => {
      const result = ToolResultBlockSchema.safeParse({
        type: 'tool_result',
        toolUseId: 'call_789',
        content: 'Success',
        isError: false,
      });
      expect(result.success).toBe(true);
    });

    test('should fail invalid tool result block', () => {
      const result = ToolResultBlockSchema.safeParse({
        type: 'tool_result',
        toolUseId: 'call_000',
        // missing content
      });
      expect(result.success).toBe(false);
    });

    test('type guard should work', () => {
      const block: ContentBlock = createToolResultBlock('id', 'result');
      expect(isToolResultBlock(block)).toBe(true);
      expect(isImageBlock(block)).toBe(false);
    });
  });

  describe('TextBlock', () => {
    test('should create valid text block', () => {
      const block = createTextBlock('Final answer text');
      expect(block.type).toBe('text');
      expect(block.text).toBe('Final answer text');
    });

    test('should validate text block', () => {
      const result = TextBlockSchema.safeParse({
        type: 'text',
        text: 'Hello world',
      });
      expect(result.success).toBe(true);
    });

    test('should fail invalid text block', () => {
      const result = TextBlockSchema.safeParse({
        type: 'text',
        // missing text field
      });
      expect(result.success).toBe(false);
    });

    test('type guard should work', () => {
      const block: ContentBlock = createTextBlock('test');
      expect(isTextBlock(block)).toBe(true);
      expect(isThinkingBlock(block)).toBe(false);
    });
  });

  describe('ImageBlock', () => {
    test('should create valid image block with base64', () => {
      const block = createImageBlock('base64', 'image/png', 'iVBORw0KGgo...');
      expect(block.type).toBe('image');
      expect(block.source.type).toBe('base64');
      expect(block.source.mediaType).toBe('image/png');
      expect(block.source.data).toBe('iVBORw0KGgo...');
    });

    test('should create valid image block with url', () => {
      const block = createImageBlock('url', 'image/jpeg', 'https://example.com/img.jpg');
      expect(block.source.type).toBe('url');
    });

    test('should validate image block', () => {
      const result = ImageBlockSchema.safeParse({
        type: 'image',
        source: {
          type: 'base64',
          mediaType: 'image/png',
          data: 'base64data',
        },
      });
      expect(result.success).toBe(true);
    });

    test('should fail invalid image block', () => {
      const result = ImageBlockSchema.safeParse({
        type: 'image',
        source: {
          type: 'invalid', // invalid type
          mediaType: 'image/png',
          data: 'data',
        },
      });
      expect(result.success).toBe(false);
    });

    test('type guard should work', () => {
      const block: ContentBlock = createImageBlock('url', 'image/png', 'url');
      expect(isImageBlock(block)).toBe(true);
      expect(isToolUseBlock(block)).toBe(false);
    });
  });

  describe('ContentBlock Union', () => {
    test('should validate any content block type', () => {
      const blocks = [
        { type: 'thinking', thinking: 'Hmm...' },
        { type: 'tool_use', id: '1', name: 'test', input: {} },
        { type: 'tool_result', toolUseId: '1', content: 'result' },
        { type: 'text', text: 'answer' },
        { type: 'image', source: { type: 'url', mediaType: 'image/png', data: 'url' } },
      ];

      blocks.forEach((block) => {
        const result = ContentBlockSchema.safeParse(block);
        expect(result.success).toBe(true);
      });
    });

    test('should fail invalid block type', () => {
      const result = ContentBlockSchema.safeParse({
        type: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('validateContentBlocks', () => {
    test('should validate array of content blocks', () => {
      const blocks = [
        createThinkingBlock('Thinking...'),
        createToolUseBlock('1', 'web_search', { query: 'test' }),
        createToolResultBlock('1', 'Search results'),
        createTextBlock('Final answer'),
      ];

      const validated = validateContentBlocks(blocks);
      expect(validated).toHaveLength(4);
    });

    test('should throw on invalid block', () => {
      const blocks = [
        { type: 'thinking', thinking: 'Valid' },
        { type: 'invalid' }, // Invalid
      ];

      expect(() => validateContentBlocks(blocks)).toThrow();
    });
  });
});
