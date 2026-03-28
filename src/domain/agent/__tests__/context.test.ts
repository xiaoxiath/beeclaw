import { describe, test, expect, vi } from 'vitest';

// Mock tiktoken / gpt-tokenizer so the lazy loader doesn't interfere
vi.mock('tiktoken', () => { throw new Error('not installed'); });
vi.mock('gpt-tokenizer', () => { throw new Error('not installed'); });

import {
  estimateTokens,
  estimateMessageTokens,
  estimateTotalTokens,
  estimateTokensPrecise,
  compressToolResult,
  compressAssistantMessage,
  cleanTokenStats,
  formatTokenStats,
  getModelContextWindow,
  calculateContextConfig,
  getTokenCalibrationFactor,
  getTokenCalibrationSampleCount,
  DEFAULT_CONTEXT_CONFIG,
  DEFAULT_TOKEN_STATS_CONFIG,
  MODEL_CONTEXT_WINDOWS,
  type TokenStats,
} from '../context';

// ============================================================================
// estimateTokens
// ============================================================================
describe('Token Estimation', () => {
  describe('estimateTokens', () => {
    test('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    test('returns 0 for falsy input', () => {
      expect(estimateTokens(null as any)).toBe(0);
      expect(estimateTokens(undefined as any)).toBe(0);
    });

    test('estimates tokens for English text', () => {
      const text = 'Hello world this is a test';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20);
    });

    test('estimates tokens for Chinese text', () => {
      const text = '这是一段中文测试文本';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
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

    test('adds overhead of at least 4 tokens', () => {
      const tokens = estimateTokens('a');
      expect(tokens).toBeGreaterThanOrEqual(4);
    });

    test('precise=true still produces valid result (no real tokenizer)', () => {
      const precise = estimateTokens('Hello world', true);
      expect(precise).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // estimateTokensPrecise
  // ============================================================================
  describe('estimateTokensPrecise', () => {
    test('delegates to estimateTokens with precise=true', () => {
      expect(estimateTokensPrecise('Hello world')).toBeGreaterThan(0);
    });

    test('returns 0 for empty text', () => {
      expect(estimateTokensPrecise('')).toBe(0);
    });
  });

  // ============================================================================
  // Calibration helpers
  // ============================================================================
  describe('Token calibration helpers', () => {
    test('getTokenCalibrationFactor returns positive number', () => {
      const factor = getTokenCalibrationFactor();
      expect(typeof factor).toBe('number');
      expect(factor).toBeGreaterThan(0);
    });

    test('getTokenCalibrationSampleCount returns non-negative number', () => {
      const count = getTokenCalibrationSampleCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // estimateMessageTokens
  // ============================================================================
  describe('estimateMessageTokens', () => {
    test('estimates tokens for simple message', () => {
      const msg = { role: 'user', content: 'Hello world' };
      const tokens = estimateMessageTokens(msg);
      expect(tokens).toBeGreaterThan(0);
    });

    test('includes overhead for role', () => {
      const msg = { role: 'user', content: '' };
      const tokens = estimateMessageTokens(msg);
      expect(tokens).toBeGreaterThanOrEqual(4);
    });

    test('handles undefined content', () => {
      const msg = { role: 'system' };
      const tokens = estimateMessageTokens(msg);
      expect(tokens).toBeGreaterThanOrEqual(4);
    });

    test('handles multimodal text content', () => {
      const tokens = estimateMessageTokens({
        role: 'user',
        content: [{ type: 'text', text: 'Describe this' }],
      });
      expect(tokens).toBeGreaterThan(4);
    });

    test('handles multimodal image_url content (~100 tokens)', () => {
      const tokens = estimateMessageTokens({
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } }],
      });
      expect(tokens).toBeGreaterThanOrEqual(104);
    });

    test('handles mixed multimodal content', () => {
      const tokens = estimateMessageTokens({
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this image' },
          { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } },
        ],
      });
      expect(tokens).toBeGreaterThan(104);
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

    test('handles multiple tool_calls', () => {
      const msg = {
        role: 'assistant',
        content: '',
        tool_calls: [
          { function: { name: 'web_search', arguments: '{"q":"a"}' } },
          { function: { name: 'memory_read', arguments: '{"path":"/core"}' } },
        ],
      };
      const tokens = estimateMessageTokens(msg);
      expect(tokens).toBeGreaterThan(8); // 4 role + 4*2 tool overhead + names + args
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

  // ============================================================================
  // estimateTotalTokens
  // ============================================================================
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

// ============================================================================
// MODEL_CONTEXT_WINDOWS & getModelContextWindow
// ============================================================================
describe('MODEL_CONTEXT_WINDOWS', () => {
  test('contains expected model entries', () => {
    expect(MODEL_CONTEXT_WINDOWS['gpt-4']).toBe(128000);
    expect(MODEL_CONTEXT_WINDOWS['gpt-4o']).toBe(128000);
    expect(MODEL_CONTEXT_WINDOWS['gpt-3.5-turbo']).toBe(16385);
    expect(MODEL_CONTEXT_WINDOWS['claude-3-opus']).toBe(200000);
    expect(MODEL_CONTEXT_WINDOWS['glm-4']).toBe(128000);
    expect(MODEL_CONTEXT_WINDOWS['glm-5']).toBe(200000);
    expect(MODEL_CONTEXT_WINDOWS['abab6.5-chat']).toBe(245000);
    expect(MODEL_CONTEXT_WINDOWS['deepseek-chat']).toBe(32768);
    expect(MODEL_CONTEXT_WINDOWS['moonshot-v1-128k']).toBe(128000);
  });
});

describe('getModelContextWindow', () => {
  test('direct match for known model', () => {
    expect(getModelContextWindow('gpt-4')).toBe(128000);
    expect(getModelContextWindow('gpt-3.5-turbo')).toBe(16385);
    expect(getModelContextWindow('claude-3-opus')).toBe(200000);
  });

  test('normalizes to lowercase', () => {
    expect(getModelContextWindow('GPT-4')).toBe(128000);
    expect(getModelContextWindow('GPT-4O')).toBe(128000);
  });

  test('partial match for model variants', () => {
    // gpt-4-0125-preview includes 'gpt-4' substring
    expect(getModelContextWindow('gpt-4-0125-preview')).toBe(128000);
  });

  test('returns default 128000 for unknown model', () => {
    expect(getModelContextWindow('totally-unknown-model-xyz')).toBe(128000);
  });

  test('matches MiniMax models', () => {
    expect(getModelContextWindow('abab6.5-chat')).toBe(245000);
  });

  test('matches DeepSeek models', () => {
    expect(getModelContextWindow('deepseek-chat')).toBe(32768);
  });

  test('matches Moonshot models', () => {
    expect(getModelContextWindow('moonshot-v1-128k')).toBe(128000);
    expect(getModelContextWindow('moonshot-v1-8k')).toBe(8192);
  });
});

// ============================================================================
// calculateContextConfig
// ============================================================================
describe('calculateContextConfig', () => {
  test('returns config with calculated maxTokens', () => {
    const config = calculateContextConfig('gpt-4');
    expect(config.maxTokens).toBeGreaterThan(0);
    expect(config.maxTokens).toBeLessThanOrEqual(120000);
    expect(config.keepRecent).toBe(DEFAULT_CONTEXT_CONFIG.keepRecent);
    expect(config.keepSystem).toBe(DEFAULT_CONTEXT_CONFIG.keepSystem);
    expect(config.compressionThreshold).toBe(DEFAULT_CONTEXT_CONFIG.compressionThreshold);
  });

  test('reserves space for responseMaxTokens', () => {
    const config = calculateContextConfig('gpt-4', 4096);
    expect(config.maxTokens).toBeGreaterThan(0);
    // With 4096 response tokens, maxTokens should be 128000 - ceil(4096*1.1) capped at 120000
    expect(config.maxTokens).toBeLessThanOrEqual(120000);
  });

  test('applies 150K safety cap for large context models (200K+)', () => {
    const config = calculateContextConfig('claude-3-opus');
    expect(config.maxTokens).toBeLessThanOrEqual(150000);
  });

  test('applies 120K safety cap for standard models', () => {
    const config = calculateContextConfig('gpt-4');
    expect(config.maxTokens).toBeLessThanOrEqual(120000);
  });

  test('allows customConfig overrides', () => {
    const config = calculateContextConfig('gpt-4', undefined, {
      keepRecent: 10,
      compressionThreshold: 0.7,
    });
    expect(config.keepRecent).toBe(10);
    expect(config.compressionThreshold).toBe(0.7);
  });

  test('customConfig maxTokens takes precedence', () => {
    const config = calculateContextConfig('gpt-4', undefined, {
      maxTokens: 50000,
    });
    expect(config.maxTokens).toBe(50000);
  });

  test('uses 25% reserve when no responseMaxTokens provided', () => {
    const config = calculateContextConfig('gpt-4');
    // 128000 - 128000*0.25 = 96000, capped at 120000 -> 96000
    expect(config.maxTokens).toBe(96000);
  });
});

// ============================================================================
// Context Compression
// ============================================================================
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

    test('compresses long string values (>500 chars)', () => {
      const longString = 'x'.repeat(1000);
      const content = JSON.stringify({ success: true, data: { text: longString } });
      const compressed = compressToolResult(content);
      expect(compressed.length).toBeLessThan(content.length);
    });

    test('compresses long arrays in object data (>10 items)', () => {
      const longArr = Array.from({ length: 20 }, (_, i) => i);
      const content = JSON.stringify({ success: true, data: { items: longArr } });
      const compressed = compressToolResult(content);
      const parsed = JSON.parse(compressed);
      expect(parsed.data.items.length).toBeLessThan(20);
    });

    test('keeps error results intact', () => {
      const content = JSON.stringify({ success: false, error: 'Something went wrong' });
      const compressed = compressToolResult(content);
      const parsed = JSON.parse(compressed);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Something went wrong');
    });

    test('keeps error results without success field', () => {
      const content = JSON.stringify({ error: 'Something went wrong' });
      const compressed = compressToolResult(content);
      const parsed = JSON.parse(compressed);
      expect(parsed.error).toBe('Something went wrong');
    });

    test('keeps short results intact', () => {
      const content = JSON.stringify({ success: true, data: { count: 5 } });
      const compressed = compressToolResult(content);
      expect(compressed).toBe(content);
    });

    test('handles non-JSON content', () => {
      const content = 'This is plain text';
      const compressed = compressToolResult(content);
      expect(compressed).toBe(content);
    });

    test('truncates long non-JSON content (>1000 chars)', () => {
      const content = 'x'.repeat(1500);
      const compressed = compressToolResult(content);
      expect(compressed).toContain('[compressed]');
      expect(compressed.length).toBeLessThan(content.length);
    });

    test('truncates long JSON fallback (>1000 chars total)', () => {
      // JSON that has no data/error fields but is too long
      const content = JSON.stringify({ info: 'x'.repeat(1500) });
      const compressed = compressToolResult(content);
      expect(compressed).toContain('[compressed]');
    });

    test('handles success=true with primitive data', () => {
      const content = JSON.stringify({ success: true, data: 42 });
      const compressed = compressToolResult(content);
      expect(compressed.length).toBeLessThanOrEqual(content.length + 1);
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

    test('includes content alongside tool call summary', () => {
      const toolCalls = [{ function: { name: 'test', arguments: '{}' } }];
      const compressed = compressAssistantMessage('Some context', toolCalls);
      expect(compressed).toContain('test()');
      expect(compressed).toContain('Some context');
    });

    test('compresses long code blocks', () => {
      const codeLine = 'const veryLongVariableName = "some long string value";\n';
      const codeBlock = '```typescript\n' + codeLine.repeat(60) + '```';
      const content = `Here is the code:\n${codeBlock}`;
      expect(content.length).toBeGreaterThan(2000);
      const compressed = compressAssistantMessage(content);
      expect(compressed.length).toBeLessThan(content.length);
      expect(compressed).toContain('[typescript code block');
    });

    test('handles code block without language annotation', () => {
      const longCode = 'line of code;\n'.repeat(200);
      const content = `Here:\n\`\`\`\n${longCode}\`\`\``;
      expect(content.length).toBeGreaterThan(2000);
      const compressed = compressAssistantMessage(content);
      expect(compressed.length).toBeLessThan(content.length);
    });

    test('truncates very long content after code block compression', () => {
      const content = 'x'.repeat(3000);
      const compressed = compressAssistantMessage(content);
      expect(compressed.length).toBeLessThan(content.length);
      expect(compressed).toContain('[content compressed]');
    });

    test('keeps short content intact', () => {
      const content = 'This is a short response';
      const compressed = compressAssistantMessage(content);
      expect(compressed).toBe(content);
    });

    test('returns empty string for empty content without tool calls', () => {
      expect(compressAssistantMessage('')).toBe('');
    });

    test('handles empty toolCalls array (no summary)', () => {
      expect(compressAssistantMessage('Hello', [])).toBe('Hello');
    });

    test('handles undefined toolCalls', () => {
      expect(compressAssistantMessage('Hello', undefined)).toBe('Hello');
    });
  });
});

// ============================================================================
// cleanTokenStats
// ============================================================================
describe('cleanTokenStats', () => {
  test('removes skill attribution line', () => {
    const content = 'Hello world\n\n---\n_📋 Used skill: web-search_';
    expect(cleanTokenStats(content)).toBe('Hello world');
  });

  test('removes block token stats (markdown table format)', () => {
    const content = 'Hello world\n\n---\n### 📊 Token Stats\n| Metric | Value |\n|--------|-------|\n| This turn | +100 tokens |';
    expect(cleanTokenStats(content)).toBe('Hello world');
  });

  test('removes trailing --- separator', () => {
    const content = 'Hello world\n\n---\n';
    expect(cleanTokenStats(content)).toBe('Hello world');
  });

  test('returns content unchanged when no stats present', () => {
    const content = 'Just regular content with no stats';
    expect(cleanTokenStats(content)).toBe(content);
  });

  test('handles empty string', () => {
    expect(cleanTokenStats('')).toBe('');
  });

  test('removes multiple skill attributions', () => {
    const content = 'Result\n\n---\n_📋 Used skill: skill-a, skill-b_';
    expect(cleanTokenStats(content)).toBe('Result');
  });

  test('handles content with block stats followed by end of string', () => {
    const content = 'Main content\n\n---\n### 📊 Token Stats\n| Col1 | Col2 |\n| a | b |';
    const cleaned = cleanTokenStats(content);
    expect(cleaned).toBe('Main content');
  });
});

// ============================================================================
// formatTokenStats
// ============================================================================
describe('formatTokenStats', () => {
  const baseStats: TokenStats = {
    promptTokens: 1000,
    completionTokens: 200,
    totalTokens: 1200,
    contextTokensBefore: 5000,
    contextTokensAfter: 5200,
    maxContextTokens: 120000,
    contextUtilization: 4.3,
  };

  test('inline format (default) contains key info', () => {
    const result = formatTokenStats(baseStats);
    expect(result).toContain('Tokens: +200');
    expect(result).toContain('5200/120000');
    expect(result).toContain('4.3%');
    expect(result).toContain('✅');
  });

  test('inline format shows 📊 emoji when utilization >60% and <=80%', () => {
    const stats = { ...baseStats, contextUtilization: 65.0 };
    const result = formatTokenStats(stats);
    expect(result).toContain('📊');
  });

  test('inline format shows ⚠️ emoji when utilization >80%', () => {
    const stats = { ...baseStats, contextUtilization: 85.0 };
    const result = formatTokenStats(stats);
    expect(result).toContain('⚠️');
  });

  test('block format produces markdown table', () => {
    const result = formatTokenStats(baseStats, 'block');
    expect(result).toContain('### 📊 Token Stats');
    expect(result).toContain('| Metric | Value |');
    expect(result).toContain('+200 tokens');
  });

  test('utilization bar shows correct fill for 50%', () => {
    const stats = { ...baseStats, contextUtilization: 50.0 };
    const result = formatTokenStats(stats, 'inline');
    expect(result).toContain('[█████░░░░░]');
  });

  test('utilization bar shows all empty for 0%', () => {
    const stats = { ...baseStats, contextUtilization: 0 };
    const result = formatTokenStats(stats, 'inline');
    expect(result).toContain('[░░░░░░░░░░]');
  });

  test('utilization bar shows all filled for 100%', () => {
    const stats = { ...baseStats, contextUtilization: 100 };
    const result = formatTokenStats(stats, 'inline');
    expect(result).toContain('[██████████]');
  });

  test('handles NaN utilization gracefully', () => {
    const stats = { ...baseStats, contextUtilization: NaN };
    const result = formatTokenStats(stats, 'inline');
    // generateUtilizationBar returns '░░░░░░░░░░░' (no brackets) for NaN
    expect(result).toContain('░░░░░░░░░░░');
  });
});

// ============================================================================
// Defaults
// ============================================================================
describe('Config defaults', () => {
  test('DEFAULT_CONTEXT_CONFIG has sensible defaults', () => {
    expect(DEFAULT_CONTEXT_CONFIG.maxTokens).toBe(120000);
    expect(DEFAULT_CONTEXT_CONFIG.keepRecent).toBe(6);
    expect(DEFAULT_CONTEXT_CONFIG.keepSystem).toBe(true);
    expect(DEFAULT_CONTEXT_CONFIG.compressionThreshold).toBe(0.8);
  });

  test('DEFAULT_TOKEN_STATS_CONFIG has correct defaults', () => {
    expect(DEFAULT_TOKEN_STATS_CONFIG.showTokenStats).toBe(false);
    expect(DEFAULT_TOKEN_STATS_CONFIG.tokenStatsFormat).toBe('inline');
  });
});
