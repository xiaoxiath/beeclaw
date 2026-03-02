import { describe, test, expect } from 'bun:test';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateTotalTokens,
  compressToolResult,
  compressAssistantMessage,
  DEFAULT_CONTEXT_CONFIG,
} from '../context';

describe('Token Estimation', () => {
  describe('estimateTokens', () => {
    test('estimates tokens for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    test('estimates tokens for English text', () => {
      // ~4 chars per token
      const text = 'Hello world this is a test'; // 27 chars
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20); // Should be around 7-10
    });

    test('estimates tokens for Chinese text', () => {
      // ~1.5 chars per token
      const text = '这是一段中文测试文本';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      // Chinese should use fewer tokens per char than English
    });

    test('estimates tokens for code', () => {
      const code = 'function test() { return 1 + 2; }';
      const tokens = estimateTokens(code);
      expect(tokens).toBeGreaterThan(0);
    });

    test('handles mixed content', () => {
      const text = 'Hello 世界! This is 测试 code: x = 1;';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateMessageTokens', () => {
    test('estimates tokens for simple message', () => {
      const msg = { role: 'user', content: 'Hello world' };
      const tokens = estimateMessageTokens(msg);
      expect(tokens).toBeGreaterThan(0);
    });

    test('includes overhead for role', () => {
      const msg = { role: 'user', content: '' };
      const tokens = estimateMessageTokens(msg);
      expect(tokens).toBeGreaterThanOrEqual(4); // Role overhead
    });

    test('estimates tokens for tool call message', () => {
      const msg = {
        role: 'assistant',
        content: 'Let me help you',
        tool_calls: [
          { function: { name: 'search', arguments: '{"query": "test"}' } },
        ],
      };
      const tokens = estimateMessageTokens(msg);
      expect(tokens).toBeGreaterThan(10);
    });

    test('estimates tokens for tool result message', () => {
      const msg = {
        role: 'tool',
        content: '{"success": true, "data": "result"}',
        tool_call_id: 'call_123',
      };
      const tokens = estimateMessageTokens(msg);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateTotalTokens', () => {
    test('sums tokens for all messages', () => {
      const messages = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const total = estimateTotalTokens(messages);
      const sum = messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
      expect(total).toBe(sum);
    });

    test('returns 0 for empty array', () => {
      expect(estimateTotalTokens([])).toBe(0);
    });
  });
});

describe('Context Compression', () => {
  describe('compressToolResult', () => {
    test('compresses large array results', () => {
      const largeArray = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` }));
      const content = JSON.stringify({ success: true, data: largeArray });
      const compressed = compressToolResult(content);

      expect(compressed.length).toBeLessThan(content.length);
      const parsed = JSON.parse(compressed);
      expect(parsed.summary).toContain('100 items');
    });

    test('compresses long string values', () => {
      const longString = 'x'.repeat(1000);
      const content = JSON.stringify({ success: true, data: { text: longString } });
      const compressed = compressToolResult(content);

      expect(compressed.length).toBeLessThan(content.length);
    });

    test('keeps error results intact', () => {
      const content = JSON.stringify({ success: false, error: 'Something went wrong' });
      const compressed = compressToolResult(content);

      const parsed = JSON.parse(compressed);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Something went wrong');
    });

    test('keeps short results intact', () => {
      const content = JSON.stringify({ success: true, data: { count: 5 } });
      const compressed = compressToolResult(content);

      expect(compressed).toBe(content);
    });

    test('handles non-JSON content', () => {
      const content = 'This is plain text that is very long and should be truncated if it exceeds the limit but short text should remain as is';
      const compressed = compressToolResult(content);

      // Short text should remain unchanged
      expect(compressed).toBe(content);
    });
  });

  describe('compressAssistantMessage', () => {
    test('summarizes tool calls', () => {
      const content = '';
      const toolCalls = [
        { function: { name: 'search', arguments: '{"query": "test"}' } },
        { function: { name: 'read', arguments: '{"file": "test.ts"}' } },
      ];
      const compressed = compressAssistantMessage(content, toolCalls);

      expect(compressed).toContain('search()');
      expect(compressed).toContain('read()');
    });

    test('compresses long code blocks', () => {
      // Create a code block longer than 2000 chars to trigger compression
      const codeLine = 'const veryLongVariableName = "some long string value";\n';
      const codeBlock = '```typescript\n' + codeLine.repeat(60) + '```';
      const content = `Here is the code:\n${codeBlock}`;
      expect(content.length).toBeGreaterThan(2000); // Verify it exceeds threshold

      const compressed = compressAssistantMessage(content);

      expect(compressed.length).toBeLessThan(content.length);
      expect(compressed).toContain('[typescript code block');
    });

    test('keeps short content intact', () => {
      const content = 'This is a short response';
      const compressed = compressAssistantMessage(content);

      expect(compressed).toBe(content);
    });
  });
});

describe('Context Config', () => {
  test('has sensible defaults', () => {
    expect(DEFAULT_CONTEXT_CONFIG.maxTokens).toBe(120000);
    expect(DEFAULT_CONTEXT_CONFIG.keepRecent).toBe(6);
    expect(DEFAULT_CONTEXT_CONFIG.keepSystem).toBe(true);
    expect(DEFAULT_CONTEXT_CONFIG.compressionThreshold).toBe(0.8);
  });
});
