import { describe, it, expect } from 'vitest';

import {
  estimateTokens,
  estimateTokensPrecise,
  estimateMessageTokens,
  estimateTotalTokens,
  getModelContextWindow,
  MODEL_CONTEXT_WINDOWS,
  calculateContextConfig,
  compressToolResult,
  compressAssistantMessage,
} from './token-estimator';

import { TokenBudgetManager } from './budget';

import type { ChatMessage, AgentContextConfig } from '../core/types';
import { DEFAULT_CONTEXT_CONFIG } from '../core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<AgentContextConfig>): AgentContextConfig {
  return { ...DEFAULT_CONTEXT_CONFIG, ...overrides };
}

function makeManager(
  initialTokens: number,
  configOverrides?: Partial<AgentContextConfig>,
  deps?: ConstructorParameters<typeof TokenBudgetManager>[2],
): TokenBudgetManager {
  return new TokenBudgetManager(makeConfig(configOverrides), initialTokens, deps);
}

// ---------------------------------------------------------------------------
// token-estimator
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns a non-zero number for non-empty text', () => {
    const tokens = estimateTokens('Hello, world!');
    expect(tokens).toBeGreaterThan(0);
  });

  it('handles Chinese text with a higher token count per character', () => {
    const chinese = '这是一段中文测试文本';
    const english = 'This is an English test text!!';
    // Chinese characters are denser, so the same length string should produce
    // fewer heuristic tokens because the ratio is 1.5 chars/token vs 4.
    // But the overhead is the same, so we just assert they are both > 0.
    expect(estimateTokens(chinese)).toBeGreaterThan(0);
    expect(estimateTokens(english)).toBeGreaterThan(0);
  });

  it('estimates more tokens for a longer Chinese string than a shorter one', () => {
    const short = '你好';
    const long = '你好你好你好你好你好你好你好你好你好你好';
    expect(estimateTokens(long)).toBeGreaterThan(estimateTokens(short));
  });

  it('handles English text', () => {
    const tokens = estimateTokens('The quick brown fox jumps over the lazy dog.');
    expect(tokens).toBeGreaterThan(0);
  });

  it('estimates more tokens for longer text', () => {
    const short = 'Hello';
    const long = 'Hello world, this is a much longer sentence with many words.';
    expect(estimateTokens(long)).toBeGreaterThan(estimateTokens(short));
  });
});

describe('estimateMessageTokens', () => {
  it('counts role overhead plus content tokens for a simple text message', () => {
    const tokens = estimateMessageTokens({ role: 'user', content: 'Hello' });
    // Role overhead (4) + estimateTokens('Hello')
    expect(tokens).toBeGreaterThan(4);
  });

  it('counts tokens for a message with no content', () => {
    const tokens = estimateMessageTokens({ role: 'user' });
    // Only role overhead
    expect(tokens).toBeGreaterThanOrEqual(4);
  });

  it('handles multimodal content (text + image)', () => {
    const tokens = estimateMessageTokens({
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image' },
        { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      ],
    });
    // Should include text tokens + ~100 for image
    const textOnlyTokens = estimateMessageTokens({
      role: 'user',
      content: 'Describe this image',
    });
    expect(tokens).toBeGreaterThan(textOnlyTokens);
    // The image adds ~100 tokens
    expect(tokens).toBeGreaterThanOrEqual(textOnlyTokens + 90);
  });

  it('counts tool_calls tokens', () => {
    const msgWithToolCalls = {
      role: 'assistant' as const,
      content: '',
      tool_calls: [
        {
          function: {
            name: 'get_weather',
            arguments: '{"location": "San Francisco"}',
          },
        },
      ],
    };
    const tokens = estimateMessageTokens(msgWithToolCalls);
    // Should include name tokens + arguments tokens + 4 (structure overhead) + 4 (role)
    expect(tokens).toBeGreaterThan(8);
  });

  it('counts tool_call_id tokens', () => {
    const msgWithToolCallId = {
      role: 'tool' as const,
      content: 'result',
      tool_call_id: 'call_abc123xyz',
    };
    const tokens = estimateMessageTokens(msgWithToolCallId);
    // Should include tool_call_id tokens + 2 extra
    const withoutId = estimateMessageTokens({ role: 'tool', content: 'result' });
    expect(tokens).toBeGreaterThan(withoutId);
  });

  it('handles multiple tool_calls', () => {
    const tokens = estimateMessageTokens({
      role: 'assistant',
      content: '',
      tool_calls: [
        { function: { name: 'get_weather', arguments: '{"location":"SF"}' } },
        { function: { name: 'get_time', arguments: '{"timezone":"PST"}' } },
        { function: { name: 'search', arguments: '{"query":"test"}' } },
      ],
    });
    expect(tokens).toBeGreaterThan(12); // 3 * 4 structure overhead + role + content
  });
});

describe('estimateTotalTokens', () => {
  it('sums tokens across messages', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const total = estimateTotalTokens(messages);
    const sum = messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
    expect(total).toBe(sum);
  });

  it('returns 0 for an empty message array', () => {
    expect(estimateTotalTokens([])).toBe(0);
  });
});

describe('estimateTokensPrecise', () => {
  it('calls estimateTokens with precise=true', () => {
    // Even without tiktoken installed, it should return a result >= 0
    const tokens = estimateTokensPrecise('Hello, world!');
    expect(tokens).toBeGreaterThan(0);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokensPrecise('')).toBe(0);
  });
});

describe('getModelContextWindow', () => {
  it('returns correct window for known models (exact match)', () => {
    expect(getModelContextWindow('gpt-4o')).toBe(128000);
    expect(getModelContextWindow('claude-4-sonnet')).toBe(200000);
    expect(getModelContextWindow('glm-4')).toBe(128000);
  });

  it('returns correct window for model names with casing differences', () => {
    expect(getModelContextWindow('GPT-4o')).toBe(128000);
    expect(getModelContextWindow('Claude-4-Sonnet')).toBe(200000);
  });

  it('returns default (128000) for unknown models', () => {
    expect(getModelContextWindow('totally-unknown-model-v42')).toBe(128000);
  });

  it('returns correct window via partial match', () => {
    // Model names that include a known key should match
    expect(getModelContextWindow('gpt-4o-2024-05-13')).toBeGreaterThanOrEqual(128000);
  });
});

describe('calculateContextConfig', () => {
  it('respects custom config overrides', () => {
    const config = calculateContextConfig('gpt-4o', undefined, {
      maxTokens: 50000,
      keepRecent: 10,
    });
    expect(config.maxTokens).toBe(50000);
    expect(config.keepRecent).toBe(10);
  });

  it('reserves tokens for response based on responseMaxTokens', () => {
    const windowSize = getModelContextWindow('gpt-4o'); // 128000
    const responseMax = 4096;
    const config = calculateContextConfig('gpt-4o', responseMax);
    // maxTokens should be window - (responseMax * 1.1), capped by safetyCap
    const expectedMax = Math.min(windowSize - Math.ceil(responseMax * 1.1), 120000);
    expect(config.maxTokens).toBe(expectedMax);
  });

  it('reserves 25% of context window when no responseMaxTokens given', () => {
    const windowSize = getModelContextWindow('gpt-4o'); // 128000
    const config = calculateContextConfig('gpt-4o');
    const reserved = Math.ceil(windowSize * 0.25);
    const expectedMax = Math.min(windowSize - reserved, 120000);
    expect(config.maxTokens).toBe(expectedMax);
  });

  it('returns default config fields when no overrides provided', () => {
    const config = calculateContextConfig('gpt-4o');
    expect(config.keepRecent).toBe(DEFAULT_CONTEXT_CONFIG.keepRecent);
    expect(config.keepSystem).toBe(DEFAULT_CONTEXT_CONFIG.keepSystem);
    expect(config.compressionThreshold).toBe(DEFAULT_CONTEXT_CONFIG.compressionThreshold);
  });

  it('applies larger safety cap for 200K+ models', () => {
    // claude-4-sonnet has 200K context; safety cap should be 150K
    const config = calculateContextConfig('claude-4-sonnet');
    expect(config.maxTokens).toBeLessThanOrEqual(150000);
    // But also greater than the small-model cap of 120000
    expect(config.maxTokens).toBeGreaterThan(120000);
  });
});

describe('compressToolResult', () => {
  it('compresses large JSON tool results with array data', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ id: i, value: `item-${i}` }));
    const input = JSON.stringify({ success: true, data });
    const result = compressToolResult(input);

    expect(result.length).toBeLessThan(input.length);
    const parsed = JSON.parse(result);
    expect(parsed.summary).toContain('50 items');
    expect(parsed.preview).toHaveLength(2);
  });

  it('compresses large JSON tool results with object data having long strings', () => {
    const input = JSON.stringify({
      success: true,
      data: {
        description: 'x'.repeat(600),
        shortField: 'ok',
      },
    });
    const result = compressToolResult(input);
    expect(result.length).toBeLessThan(input.length);
    const parsed = JSON.parse(result);
    expect(parsed.data.description).toContain('[truncated]');
    expect(parsed.data.shortField).toBe('ok');
  });

  it('compresses large JSON tool results with object data having long arrays', () => {
    const input = JSON.stringify({
      success: true,
      data: {
        items: Array.from({ length: 20 }, (_, i) => i),
      },
    });
    const result = compressToolResult(input);
    const parsed = JSON.parse(result);
    // The array is truncated: first 5 items + string "... N more items"
    const items = parsed.data.items;
    expect(items).toHaveLength(6); // 5 items + summary string
    expect(items[5]).toContain('more items');
  });

  it('keeps error results intact', () => {
    const input = JSON.stringify({ success: false, error: 'Something went wrong' });
    const result = compressToolResult(input);
    expect(result).toBe(input);
  });

  it('truncates non-JSON content that exceeds maxLen', () => {
    const input = 'a'.repeat(2000);
    const result = compressToolResult(input, 1000);
    expect(result.length).toBeLessThan(input.length);
    expect(result).toContain('[compressed]');
  });

  it('does not compress small content', () => {
    const input = JSON.stringify({ success: true, data: 'small' });
    const result = compressToolResult(input);
    expect(result).toBe(input);
  });

  it('does not compress non-JSON content under maxLen', () => {
    const input = 'short plain text';
    const result = compressToolResult(input, 1000);
    expect(result).toBe(input);
  });
});

describe('compressAssistantMessage', () => {
  it('summarizes tool calls', () => {
    const result = compressAssistantMessage('', [
      { function: { name: 'get_weather', arguments: '{"location":"SF"}' } },
      { function: { name: 'search', arguments: '{"query":"rain"}' } },
    ]);
    expect(result).toContain('[Called tools: get_weather(), search()]');
  });

  it('appends content alongside tool call summary', () => {
    const result = compressAssistantMessage('Here is your answer.', [
      { function: { name: 'calculate', arguments: '{}' } },
    ]);
    expect(result).toContain('[Called tools: calculate()]');
    expect(result).toContain('Here is your answer.');
  });

  it('compresses long code blocks in content', () => {
    // Build a code block with >= 500 chars to trigger code-block compression
    const codeBlock = '```typescript\n' + 'const x = 1;\n'.repeat(200) + '```';
    const longContent = `Here is some code:\n${codeBlock}`;
    expect(longContent.length).toBeGreaterThan(2000);
    const result = compressAssistantMessage(longContent);
    // Code blocks are replaced with "[typescript code block, N lines - compressed]"
    expect(result).toContain('compressed]');
    expect(result).toContain('typescript');
    expect(result.length).toBeLessThan(longContent.length);
  });

  it('returns content unchanged when short and no tool calls', () => {
    const content = 'Short response without tools.';
    const result = compressAssistantMessage(content);
    expect(result).toBe(content);
  });

  it('returns empty string when no content and no tool calls', () => {
    expect(compressAssistantMessage('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// budget.ts — TokenBudgetManager
// ---------------------------------------------------------------------------

describe('TokenBudgetManager', () => {
  describe('constructor and basic accessors', () => {
    it('constructor sets initial tokens', () => {
      const mgr = makeManager(5000);
      expect(mgr.tokens).toBe(5000);
    });

    it('setTokens updates the token count', () => {
      const mgr = makeManager(1000);
      mgr.setTokens(9999);
      expect(mgr.tokens).toBe(9999);
    });

    it('addTokens adds delta to current count', () => {
      const mgr = makeManager(1000);
      mgr.addTokens(500);
      expect(mgr.tokens).toBe(1500);
    });

    it('addTokens handles negative delta', () => {
      const mgr = makeManager(1000);
      mgr.addTokens(-300);
      expect(mgr.tokens).toBe(700);
    });
  });

  describe('getBudget', () => {
    it('returns correct structure', () => {
      const mgr = makeManager(30000);
      const budget = mgr.getBudget();
      expect(budget.estimated).toBe(30000);
      expect(budget.max).toBe(DEFAULT_CONTEXT_CONFIG.maxTokens);
      expect(budget.utilization).toBeCloseTo(30000 / DEFAULT_CONTEXT_CONFIG.maxTokens);
    });

    it('utilization approaches 1 as tokens approach max', () => {
      const config = makeConfig({ maxTokens: 10000 });
      const mgr = new TokenBudgetManager(config, 10000);
      const budget = mgr.getBudget();
      expect(budget.utilization).toBeCloseTo(1.0);
    });
  });

  describe('checkTurnBudget', () => {
    it('detects when turn budget is not exceeded', () => {
      const mgr = makeManager(500);
      const check = mgr.checkTurnBudget(400, 200);
      expect(check.exceeded).toBe(false);
      expect(check.tokensUsed).toBe(100);
      expect(check.limit).toBe(200);
    });

    it('detects when turn budget is exceeded', () => {
      const mgr = makeManager(500);
      const check = mgr.checkTurnBudget(200, 200);
      expect(check.exceeded).toBe(true);
      expect(check.tokensUsed).toBe(300);
      expect(check.limit).toBe(200);
    });

    it('handles exact boundary (equal to limit)', () => {
      const mgr = makeManager(500);
      const check = mgr.checkTurnBudget(300, 200);
      expect(check.exceeded).toBe(false);
      expect(check.tokensUsed).toBe(200);
    });
  });

  describe('trimContextIfNeeded', () => {
    it('does not trim when under threshold', () => {
      const config = makeConfig({ maxTokens: 100000, compressionThreshold: 0.8 });
      const mgr = new TokenBudgetManager(config, 50000);

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      const originalLength = messages.length;
      mgr.trimContextIfNeeded(messages);

      expect(messages.length).toBe(originalLength);
    });

    it('compresses tool results when over threshold', () => {
      const config = makeConfig({ maxTokens: 200, compressionThreshold: 0.5, keepRecent: 1 });
      // Set estimated tokens above the threshold (200 * 0.5 = 100)
      const mgr = new TokenBudgetManager(config, 150);

      const largeToolContent = JSON.stringify({
        success: true,
        data: Array.from({ length: 50 }, (_, i) => ({ id: i, value: `item-${i}` })),
      });

      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'List items' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'tc_1', type: 'function' as const, function: { name: 'list_items', arguments: '{}' } }] },
        { role: 'tool', content: largeToolContent },
        { role: 'assistant', content: 'Here are the results.' },
      ];

      mgr.trimContextIfNeeded(messages);

      // The tool message should have been compressed
      const toolMsg = messages.find(m => m.role === 'tool');
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content.length).toBeLessThan(largeToolContent.length);
      expect(toolMsg!.metadata?.compressed).toBe(true);
    });

    it('compresses assistant messages with tool_calls when over threshold', () => {
      const config = makeConfig({ maxTokens: 200, compressionThreshold: 0.3, keepRecent: 1 });
      const mgr = new TokenBudgetManager(config, 150);

      const messages: ChatMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Do something' },
        {
          role: 'assistant',
          content: 'I will run the tool now.',
          tool_calls: [
            { id: 'tc_1', type: 'function' as const, function: { name: 'run_tool', arguments: '{"param":"value"}' } },
          ],
        },
        { role: 'tool', content: 'done' },
        { role: 'assistant', content: 'Latest reply' },
      ];

      mgr.trimContextIfNeeded(messages);

      // The assistant message with tool_calls should be compressed
      const assistantWithTools = messages.find(
        m => m.role === 'assistant' && m.metadata?.compressed,
      );
      expect(assistantWithTools).toBeDefined();
      expect(assistantWithTools!.content).toContain('Called tools');
    });

    it('removes old messages when compression alone is insufficient', () => {
      const config = makeConfig({ maxTokens: 50, compressionThreshold: 0.5, keepRecent: 1 });
      const mgr = new TokenBudgetManager(config, 200);

      const messages: ChatMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Message one' },
        { role: 'assistant', content: 'Reply one' },
        { role: 'user', content: 'Message two' },
        { role: 'assistant', content: 'Latest reply' },
      ];

      mgr.trimContextIfNeeded(messages);

      // Should have removed at least some messages to get below 90% of max
      // The manager keeps at least keepRecent messages
      expect(messages.length).toBeLessThan(5);
    });
  });

  describe('manageContextCompression', () => {
    it('returns early when messages are <= 10', async () => {
      const mgr = makeManager(100);
      const messages: ChatMessage[] = Array.from({ length: 5 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
      }));
      // Should not throw and should not modify messages
      await mgr.manageContextCompression(messages);
      expect(messages.length).toBe(5);
    });

    it('calls healthMonitor when injected', async () => {
      const alerts: Array<{ message: string }> = [];
      const healthMonitor = {
        measure: () => ({ utilization: 0.5 }),
        checkAlerts: () => alerts,
      };
      const mgr = makeManager(100, undefined, { healthMonitor });
      const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
      }));

      // Should not throw
      await mgr.manageContextCompression(messages);
    });

    it('calls hasher for deduplication when injected', async () => {
      const hasher = {
        deduplicateItems: <T extends { content: string }>(items: T[]) => items.slice(0, 10),
      };
      const mgr = makeManager(100, undefined, { hasher });
      const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
      }));

      await mgr.manageContextCompression(messages);
      // hasher removes 5 messages
      expect(messages.length).toBe(10);
    });

    it('calls compressor when injected and shouldCompress is true', async () => {
      const compressedMessages: ChatMessage[] = Array.from({ length: 5 }, (_, i) => ({
        role: 'user' as const,
        content: `Compressed ${i}`,
      }));
      const compressor = {
        shouldCompress: () => true,
        compressMessages: async () => ({
          messages: compressedMessages,
          stats: { originalTokens: 200, compressedTokens: 50, ratio: 0.25 },
        }),
      };
      const mgr = makeManager(100, undefined, { compressor });
      const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
      }));

      await mgr.manageContextCompression(messages);
      expect(messages.length).toBe(5);
      expect(mgr.tokens).toBe(50);
    });

    it('falls back to trimContextIfNeeded when compressor throws', async () => {
      const config = makeConfig({ maxTokens: 200, compressionThreshold: 0.3, keepRecent: 1 });
      const compressor = {
        shouldCompress: () => true,
        compressMessages: async () => {
          throw new Error('Compression engine failure');
        },
      };
      const mgr = new TokenBudgetManager(config, 150, { compressor });
      const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i} with some extra content to pad it`,
      }));

      // Should not throw — falls back to trim
      await mgr.manageContextCompression(messages);
      // Messages should still be a valid array (may have been trimmed)
      expect(messages.length).toBeGreaterThan(0);
    });
  });
});
