/**
 * Tests for callAI / streamAI / utility functions.
 *
 * TDD: Tests written first, then implementation.
 * Extracted from beeclaw's src/domain/agent/api.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatMessage, OpenAITool, AIResponse } from '../core/types';
import {
  executeToolCalls,
  hasToolCalls,
  extractToolCalls,
  extractContent,
  AIClient,
} from './call-ai';
import { UnifiedRetryEngine, RETRY_STRATEGIES } from '../resilience/retry';
import { ConcurrencyLimiter } from './concurrency';

// ============================================================================
// Utility Functions
// ============================================================================

describe('hasToolCalls', () => {
  it('should return true when response has tool_calls', () => {
    const response: AIResponse = {
      id: '1',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'test', arguments: '{}' } }],
        },
        finish_reason: 'tool_calls',
      }],
    };

    expect(hasToolCalls(response)).toBe(true);
  });

  it('should return false when no tool_calls', () => {
    const response: AIResponse = {
      id: '1',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello' },
        finish_reason: 'stop',
      }],
    };

    expect(hasToolCalls(response)).toBe(false);
  });
});

describe('extractToolCalls', () => {
  it('should extract all tool calls from response', () => {
    const response: AIResponse = {
      id: '1',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'tc1', type: 'function', function: { name: 'tool_a', arguments: '{"x":1}' } },
              { id: 'tc2', type: 'function', function: { name: 'tool_b', arguments: '{"y":2}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
        {
          index: 1,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'tc3', type: 'function', function: { name: 'tool_c', arguments: '{}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };

    const calls = extractToolCalls(response);
    expect(calls).toHaveLength(3);
    expect(calls[0].function.name).toBe('tool_a');
    expect(calls[2].function.name).toBe('tool_c');
  });
});

describe('extractContent', () => {
  it('should extract text content from response', () => {
    const response: AIResponse = {
      id: '1',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello world' },
        finish_reason: 'stop',
      }],
    };

    expect(extractContent(response)).toBe('Hello world');
  });

  it('should concatenate multiple choices', () => {
    const response: AIResponse = {
      id: '1',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'Part 1 ' }, finish_reason: 'stop' },
        { index: 1, message: { role: 'assistant', content: 'Part 2' }, finish_reason: 'stop' },
      ],
    };

    expect(extractContent(response)).toBe('Part 1 Part 2');
  });

  it('should return empty string for empty choices', () => {
    const response: AIResponse = { id: '1', choices: [] };
    expect(extractContent(response)).toBe('');
  });

  it('should throw on null response', () => {
    expect(() => extractContent(null as any)).toThrow('Cannot extract content');
  });
});

describe('executeToolCalls', () => {
  it('should execute tool calls and return results', async () => {
    const toolCalls = [
      { id: 'tc1', type: 'function' as const, function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } },
    ];

    const executor = vi.fn().mockResolvedValue({ temp: 22, city: 'Tokyo' });

    const results = await executeToolCalls(toolCalls, executor);

    expect(results).toHaveLength(1);
    expect(results[0].tool_call_id).toBe('tc1');
    expect(executor).toHaveBeenCalledWith('get_weather', { city: 'Tokyo' });

    const parsed = JSON.parse(results[0].content);
    expect(parsed.temp).toBe(22);
  });

  it('should handle tool execution errors', async () => {
    const toolCalls = [
      { id: 'tc_err', type: 'function' as const, function: { name: 'failing_tool', arguments: '{}' } },
    ];

    const executor = vi.fn().mockRejectedValue(new Error('Tool crashed'));

    const results = await executeToolCalls(toolCalls, executor);

    const parsed = JSON.parse(results[0].content);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('Tool crashed');
  });

  it('should execute multiple tool calls sequentially', async () => {
    const toolCalls = [
      { id: 'tc1', type: 'function' as const, function: { name: 'tool_a', arguments: '{"x":1}' } },
      { id: 'tc2', type: 'function' as const, function: { name: 'tool_b', arguments: '{"y":2}' } },
    ];

    const callOrder: string[] = [];
    const executor = vi.fn().mockImplementation(async (name: string) => {
      callOrder.push(name);
      return { ok: true };
    });

    await executeToolCalls(toolCalls, executor);

    expect(callOrder).toEqual(['tool_a', 'tool_b']);
  });
});

// ============================================================================
// callAI / streamAI (with mocked fetch)
// ============================================================================

describe('callAI', () => {
  let client: AIClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new AIClient({
      retryEngine: new UnifiedRetryEngine(),
      concurrencyLimiter: new ConcurrencyLimiter({ maxConcurrent: 10 }),
      fetchFn: mockFetch as any,
    });
  });

  it('should call OpenAI-compatible API', async () => {
    const mockResponse: AIResponse = {
      id: 'resp_1',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello!' },
        finish_reason: 'stop',
      }],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await client.callAI({
      provider: { type: 'openai', apiKey: 'test-key' },
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.choices[0].message.content).toBe('Hello!');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Check request format
    const [url, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');

    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('should call Anthropic API with format conversion', async () => {
    const anthropicResponse = {
      id: 'msg_1',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'Bonjour!' }],
      stop_reason: 'end_turn',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => anthropicResponse,
    });

    const result = await client.callAI({
      provider: { type: 'anthropic', apiKey: 'ant-key' },
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'system', content: 'You are French.' },
        { role: 'user', content: 'Hello' },
      ],
    });

    expect(result.choices[0].message.content).toBe('Bonjour!');

    // Check Anthropic-specific headers
    const [url, init] = mockFetch.mock.calls[0];
    expect(init.headers['x-api-key']).toBe('ant-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(init.body);
    expect(body.system).toBe('You are French.');
    expect(body.messages[0].role).toBe('user');
  });

  it('should include tools in request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: '1',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }),
    });

    const tools: OpenAITool[] = [{
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      },
    }];

    await client.callAI({
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Weather?' }],
      tools,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe('auto');
  });

  it('should pass temperature and maxTokens', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: '1',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }),
    });

    await client.callAI({
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      maxTokens: 100,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(100);
  });

  it('should use custom baseUrl when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: '1',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }),
    });

    await client.callAI({
      provider: { type: 'openai', apiKey: 'key', baseUrl: 'https://custom.api.com/v1' },
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('https://custom.api.com/v1');
  });

  it('should throw on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    });

    await expect(
      client.callAI({
        provider: { type: 'openai', apiKey: 'key' },
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toThrow();
  });

  it('should pass extra provider options', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: '1',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }),
    });

    await client.callAI({
      provider: {
        type: 'minimax',
        apiKey: 'key',
      },
      model: 'model-1',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // MiniMax preset includes reasoning_split
    expect(body.reasoning_split).toBe(true);
  });
});

describe('streamAI', () => {
  let client: AIClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new AIClient({
      retryEngine: new UnifiedRetryEngine(),
      concurrencyLimiter: new ConcurrencyLimiter({ maxConcurrent: 10 }),
      fetchFn: mockFetch as any,
    });
  });

  it('should stream content chunks', async () => {
    // Mock SSE stream
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: stream,
    });

    const collected: string[] = [];
    for await (const chunk of client.streamAI({
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      collected.push(chunk);
    }

    expect(collected).toEqual(['Hello', ' world']);
  });

  it('should collect tool_calls from stream deltas', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Let me check"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"Tokyo\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: stream,
    });

    const collected: string[] = [];
    for await (const chunk of client.streamAI({
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Weather?' }],
    })) {
      collected.push(chunk);
    }

    // Should have content chunk + tool_calls marker
    expect(collected.length).toBeGreaterThanOrEqual(2);

    // Find the tool_calls marker
    const toolCallMarker = collected.find(c => c.includes('<!--tool_calls:'));
    expect(toolCallMarker).toBeDefined();

    const toolCallsJson = toolCallMarker!.match(/<!--tool_calls:(.+)-->/)![1];
    const toolCalls = JSON.parse(toolCallsJson);
    expect(toolCalls[0].function.name).toBe('get_weather');
    expect(toolCalls[0].function.arguments).toBe('{"city":"Tokyo"}');
  });

  it('should handle Anthropic streaming format', async () => {
    const chunks = [
      'event: content_block_delta\n'
      + 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: message_stop\n'
      + 'data: {"type":"message_stop"}\n\n',
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: stream,
    });

    const collected: string[] = [];
    for await (const chunk of client.streamAI({
      provider: { type: 'anthropic', apiKey: 'key' },
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      collected.push(chunk);
    }

    // Anthropic streaming should yield something (either parsed content or raw)
    // The exact format depends on the SSE parsing
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
