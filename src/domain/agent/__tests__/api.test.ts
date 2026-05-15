import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { AIResponse, ToolCall, ToolExecutor } from '../types';

// ---------------------------------------------------------------------------
// Mocks — must be declared before import of the module under test
// ---------------------------------------------------------------------------

// Mock logger
vi.mock('@infra/observability/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock concurrency limiter
const mockRelease = vi.fn();
const mockAcquire = vi.fn();
const mockExecute = vi.fn();
vi.mock('@infra/ai/concurrency-limiter', () => ({
  getLLMConcurrencyLimiter: () => ({
    acquire: mockAcquire,
    execute: mockExecute,
  }),
  LLMRequestPriority: { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 },
}));

// Mock retry engine
const mockRetryExecute = vi.fn();
vi.mock('@infra/resilience/unified-retry', () => ({
  getRetryEngine: () => ({
    execute: mockRetryExecute,
  }),
  RETRY_STRATEGIES: {
    agent: { maxRetries: 3 },
    api: { maxRetries: 2 },
    tool: { maxRetries: 1 },
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Import module under test (after mocks)
// ---------------------------------------------------------------------------
import {
  callAI,
  streamAI,
  hasToolCalls,
  extractToolCalls,
  extractContent,
  executeToolCalls,
} from '../api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(type: string, opts: { baseUrl?: string; apiKey?: string; options?: Record<string, unknown> } = {}) {
  return {
    name: `test-${type}`,
    type: type as any,
    apiKey: opts.apiKey ?? 'test-key',
    baseUrl: opts.baseUrl,
    default: false,
    models: {},
    options: opts.options,
  };
}

function makeOpenAIJsonResponse(content: string, toolCalls?: ToolCall[]): any {
  return {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls ? 'tool_calls' : 'stop',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

function makeAnthropicJsonResponse(textBlocks: string[], toolBlocks?: Array<{ id: string; name: string; input: any }>): any {
  const content: any[] = textBlocks.map(t => ({ type: 'text', text: t }));
  if (toolBlocks) {
    for (const tb of toolBlocks) {
      content.push({ type: 'tool_use', id: tb.id, name: tb.name, input: tb.input });
    }
  }
  return {
    id: 'msg_abc',
    model: 'claude-3-sonnet',
    content,
    stop_reason: toolBlocks ? 'tool_use' : 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

// Setup the retry engine mock to directly invoke the fn and wrap in success
function setupRetrySuccess() {
  mockRetryExecute.mockImplementation(async (_label: string, fn: () => Promise<any>) => {
    const value = await fn();
    return { success: true, value };
  });
}

function setupRetryFailure(error?: Error) {
  mockRetryExecute.mockResolvedValue({
    success: false,
    error: error ? { originalError: error } : null,
  });
}

function setupDefaultMocks() {
  // Re-establish implementations that clearAllMocks wipes
  mockRelease.mockImplementation(() => {});
  mockAcquire.mockResolvedValue(mockRelease);
  mockExecute.mockImplementation(async (fn: () => Promise<any>, _opts?: any) => fn());
  setupRetrySuccess();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // ========================================================================
  // getProviderConfig (tested indirectly through callAI)
  // ========================================================================
  describe('getProviderConfig (via callAI)', () => {
    test('uses known provider baseUrl for openai', async () => {
      const resp = makeOpenAIJsonResponse('hello');
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      await callAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.anything(),
      );
    });

    test('uses known provider baseUrl for zhipu', async () => {
      const resp = makeOpenAIJsonResponse('hello');
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      await callAI({
        provider: makeProvider('zhipu'),
        model: 'glm-4',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
        expect.anything(),
      );
    });

    test('uses custom baseUrl when provided', async () => {
      const resp = makeOpenAIJsonResponse('hello');
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      await callAI({
        provider: makeProvider('custom', { baseUrl: 'https://my-llm.example.com/v1' }),
        model: 'my-model',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://my-llm.example.com/v1',
        expect.anything(),
      );
    });

    test('throws for unknown provider type without baseUrl', async () => {
      await expect(
        callAI({
          provider: makeProvider('foobar' as any),
          model: 'x',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow('Unknown provider type: foobar');
    });

    test('codex provider posts to /v1/responses with bearer auth', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'resp_codex_1',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'codex says hi' }],
          }],
          usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
        }),
      });

      const result = await callAI({
        provider: makeProvider('codex', { apiKey: 'sk-codex-test' }),
        model: 'gpt-5.3-codex',
        messages: [
          { role: 'system', content: 'be concise' },
          { role: 'user', content: 'hi' },
        ],
      });

      // Default base URL + /v1/responses path.
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://api.openai.com/v1/responses');
      const init = callArgs[1] as RequestInit;
      expect(init.method).toBe('POST');
      expect((init.headers as any)['Authorization']).toBe('Bearer sk-codex-test');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('gpt-5.3-codex');
      expect(body.instructions).toBe('be concise');
      expect(body.input[0]).toMatchObject({ type: 'message', role: 'user' });

      // Response normalized into AIResponse.
      expect(result.choices[0].message.content).toBe('codex says hi');
      expect(result.usage).toEqual({ prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 });
    });

    test('codex provider honors custom baseUrl', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ output: [] }),
      });

      await callAI({
        provider: makeProvider('codex', {
          baseUrl: 'https://my-codex-proxy.example.com',
        }),
        model: 'gpt-5.3-codex',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(mockFetch.mock.calls[0][0]).toBe('https://my-codex-proxy.example.com/v1/responses');
    });

    test('codex provider surfaces API error responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('rate limit'),
      });

      await expect(
        callAI({
          provider: makeProvider('codex'),
          model: 'gpt-5.3-codex',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow(/Codex Responses API error: 429.*rate limit/);
    });

    test('custom baseUrl provider passes extraBody from options', async () => {
      const resp = makeOpenAIJsonResponse('hello');
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      await callAI({
        provider: makeProvider('openai', {
          baseUrl: 'https://custom.example.com/v1',
          options: { extraBody: { custom_flag: true } },
        }),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      });

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.custom_flag).toBe(true);
    });
  });

  // ========================================================================
  // callAI — OpenAI path
  // ========================================================================
  describe('callAI — OpenAI path', () => {
    test('sends correct request body with tools, temperature, topP, maxTokens', async () => {
      const resp = makeOpenAIJsonResponse('answer');
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      const tools = [{ type: 'function' as const, function: { name: 'my_tool', description: 'desc', parameters: { type: 'object' } } }];

      await callAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
        tools,
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 1000,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4');
      expect(body.temperature).toBe(0.7);
      expect(body.top_p).toBe(0.9);
      expect(body.max_tokens).toBe(1000);
      expect(body.tools).toEqual(tools);
      expect(body.tool_choice).toBe('auto');
    });

    test('omits tools and tool_choice when not provided', async () => {
      const resp = makeOpenAIJsonResponse('answer');
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      await callAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
      expect(body.tool_choice).toBeUndefined();
    });

    test('sets Authorization header with Bearer token', async () => {
      const resp = makeOpenAIJsonResponse('ok');
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      await callAI({
        provider: makeProvider('openai', { apiKey: 'sk-secret' }),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer sk-secret');
      expect(headers['Content-Type']).toBe('application/json');
    });

    test('returns parsed JSON response', async () => {
      const resp = makeOpenAIJsonResponse('hello world');
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      const result = await callAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.choices[0].message.content).toBe('hello world');
    });

    test('throws when fetch returns non-ok response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('Server Error') });

      await expect(
        callAI({
          provider: makeProvider('openai'),
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow('AI API error: 500 - Server Error');
    });

    test('throws when retry engine reports failure', async () => {
      setupRetryFailure(new Error('rate limited'));

      await expect(
        callAI({
          provider: makeProvider('openai'),
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow('rate limited');
    });

    test('throws generic error when retry fails without originalError', async () => {
      setupRetryFailure();

      await expect(
        callAI({
          provider: makeProvider('openai'),
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow('AI API call failed');
    });

    test('uses concurrency limiter execute()', async () => {
      const resp = makeOpenAIJsonResponse('ok');
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      await callAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
        concurrency: { caller: 'Agent.chat', priority: 0 },
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ caller: 'Agent.chat', priority: 0 }),
      );
    });

    test('defaults concurrency caller to "callAI"', async () => {
      const resp = makeOpenAIJsonResponse('ok');
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      await callAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ caller: 'callAI' }),
      );
    });
  });

  // ========================================================================
  // callAI — MiniMax reasoning details
  // ========================================================================
  describe('callAI — MiniMax reasoning', () => {
    test('includes extraBody (reasoning_split) for minimax', async () => {
      const resp = makeOpenAIJsonResponse('answer');
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      await callAI({
        provider: makeProvider('minimax'),
        model: 'abab6.5',
        messages: [{ role: 'user', content: 'hi' }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reasoning_split).toBe(true);
    });

    test('prepends <thinking> block when reasoning_details present', async () => {
      const resp = {
        id: 'chatcmpl-123',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'final answer',
            reasoning_details: [{ text: 'step 1' }, { text: 'step 2' }],
          },
          finish_reason: 'stop',
        }],
      };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      const result = await callAI({
        provider: makeProvider('minimax'),
        model: 'abab6.5',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.choices[0].message.content).toContain('<thinking>');
      expect(result.choices[0].message.content).toContain('step 1');
      expect(result.choices[0].message.content).toContain('step 2');
      expect(result.choices[0].message.content).toContain('final answer');
    });

    test('skips reasoning_details when array is empty', async () => {
      const resp = {
        id: 'chatcmpl-123',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'answer', reasoning_details: [] },
          finish_reason: 'stop',
        }],
      };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      const result = await callAI({
        provider: makeProvider('minimax'),
        model: 'abab6.5',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.choices[0].message.content).toBe('answer');
    });

    test('handles reasoning_details with missing text fields', async () => {
      const resp = {
        id: 'chatcmpl-123',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'answer',
            reasoning_details: [{ text: 'good' }, {}, { text: '' }],
          },
          finish_reason: 'stop',
        }],
      };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      const result = await callAI({
        provider: makeProvider('minimax'),
        model: 'abab6.5',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.choices[0].message.content).toContain('<thinking>');
      expect(result.choices[0].message.content).toContain('good');
    });

    test('handles includeReasoning option for non-minimax provider', async () => {
      const resp = {
        id: 'chatcmpl-123',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'answer',
            reasoning_details: [{ text: 'thought' }],
          },
          finish_reason: 'stop',
        }],
      };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      const result = await callAI({
        provider: makeProvider('openai', { options: { includeReasoning: true } }),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.choices[0].message.content).toContain('<thinking>');
      expect(result.choices[0].message.content).toContain('thought');
    });
  });

  // ========================================================================
  // callAI — Zhipu reasoning_content
  // ========================================================================
  describe('callAI — Zhipu reasoning_content', () => {
    test('uses reasoning_content as content when finalContent is empty', async () => {
      const resp = {
        id: 'chatcmpl-123',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '', reasoning_content: 'deep thought result' },
          finish_reason: 'stop',
        }],
      };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      const result = await callAI({
        provider: makeProvider('zhipu'),
        model: 'glm-4.7-flashx',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.choices[0].message.content).toBe('deep thought result');
    });

    test('prefers finalContent when both reasoning_content and content exist', async () => {
      const resp = {
        id: 'chatcmpl-123',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'actual answer', reasoning_content: 'thinking stuff' },
          finish_reason: 'stop',
        }],
      };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      const result = await callAI({
        provider: makeProvider('zhipu'),
        model: 'glm-4.7-flashx',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.choices[0].message.content).toBe('actual answer');
    });

    test('ignores reasoning_content when it is not a string', async () => {
      const resp = {
        id: 'chatcmpl-123',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'answer', reasoning_content: 123 },
          finish_reason: 'stop',
        }],
      };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      const result = await callAI({
        provider: makeProvider('zhipu'),
        model: 'glm-4.7-flashx',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.choices[0].message.content).toBe('answer');
    });
  });

  // ========================================================================
  // callAI — Anthropic path
  // ========================================================================
  describe('callAI — Anthropic path', () => {
    test('converts messages to Anthropic format and sends correct headers', async () => {
      const anthropicResp = makeAnthropicJsonResponse(['Hello from Claude']);
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(anthropicResp) });

      await callAI({
        provider: makeProvider('anthropic', { apiKey: 'sk-ant-key' }),
        model: 'claude-3-sonnet',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'hi' },
        ],
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-api-key']).toBe('sk-ant-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['Content-Type']).toBe('application/json');

      expect(mockFetch.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
    });

    test('sends system as top-level field with concatenation', async () => {
      const anthropicResp = makeAnthropicJsonResponse(['ok']);
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(anthropicResp) });

      await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [
          { role: 'system', content: 'System A' },
          { role: 'system', content: 'System B' },
          { role: 'user', content: 'hi' },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toBe('System A\n\nSystem B');
      expect(body.messages.every((m: any) => m.role !== 'system')).toBe(true);
    });

    test('converts assistant messages with tool_calls to tool_use blocks', async () => {
      const anthropicResp = makeAnthropicJsonResponse(['ok']);
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(anthropicResp) });

      await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [
          { role: 'user', content: 'search for foo' },
          {
            role: 'assistant',
            content: 'Let me search',
            tool_calls: [{
              id: 'tc_1',
              type: 'function',
              function: { name: 'search', arguments: '{"q":"foo"}' },
            }],
          },
          { role: 'tool', content: '{"results":[]}', tool_call_id: 'tc_1' } as any,
          { role: 'user', content: 'thanks' },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg.content).toEqual([
        { type: 'text', text: 'Let me search' },
        { type: 'tool_use', id: 'tc_1', name: 'search', input: { q: 'foo' } },
      ]);
      const toolResultMsg = body.messages.find((m: any) =>
        m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
      );
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.content[0].tool_use_id).toBe('tc_1');
    });

    test('handles assistant message with invalid JSON arguments gracefully', async () => {
      const anthropicResp = makeAnthropicJsonResponse(['ok']);
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(anthropicResp) });

      await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'tc_1',
              type: 'function',
              function: { name: 'tool', arguments: 'not-json{' },
            }],
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
      const toolUse = assistantMsg.content.find((b: any) => b.type === 'tool_use');
      expect(toolUse.input).toEqual({});
    });

    test('converts Anthropic response to OpenAI format with tool_calls', async () => {
      const anthropicResp = makeAnthropicJsonResponse(
        ['Hello from Claude'],
        [{ id: 'toolu_1', name: 'search', input: { query: 'test' } }],
      );
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(anthropicResp) });

      const result = await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].message.content).toBe('Hello from Claude');
      expect(result.choices[0].message.tool_calls).toHaveLength(1);
      expect(result.choices[0].message.tool_calls![0].function.name).toBe('search');
      expect(result.choices[0].message.tool_calls![0].function.arguments).toBe('{"query":"test"}');
      expect(result.choices[0].finish_reason).toBe('tool_calls');
    });

    test('converts Anthropic response with only text (no tools)', async () => {
      const anthropicResp = makeAnthropicJsonResponse(['Just text']);
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(anthropicResp) });

      const result = await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.choices[0].message.content).toBe('Just text');
      expect(result.choices[0].message.tool_calls).toBeUndefined();
      expect(result.choices[0].finish_reason).toBe('end_turn');
    });

    test('handles Anthropic response with missing fields', async () => {
      const resp = { content: [{ type: 'tool_use', name: 'x', input: {} }] };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      const result = await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.choices[0].message.tool_calls![0].id).toMatch(/^call_/);
      expect(result.id).toBe('');
      expect(result.model).toBe('');
    });

    test('converts tools to Anthropic format with input_schema', async () => {
      const anthropicResp = makeAnthropicJsonResponse(['ok']);
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(anthropicResp) });

      const tools = [{
        type: 'function' as const,
        function: {
          name: 'my_tool',
          description: 'A tool',
          parameters: { type: 'object', properties: { x: { type: 'string' } } },
        },
      }];

      await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
        tools,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toEqual([{
        name: 'my_tool',
        description: 'A tool',
        input_schema: { type: 'object', properties: { x: { type: 'string' } } },
      }]);
    });

    test('omits tools in Anthropic body when not provided', async () => {
      const anthropicResp = makeAnthropicJsonResponse(['ok']);
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(anthropicResp) });

      await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
    });

    test('sets max_tokens to 4096 by default for Anthropic', async () => {
      const anthropicResp = makeAnthropicJsonResponse(['ok']);
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(anthropicResp) });

      await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(4096);
    });

    test('uses provided maxTokens for Anthropic', async () => {
      const anthropicResp = makeAnthropicJsonResponse(['ok']);
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(anthropicResp) });

      await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 2000,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(2000);
    });

    test('passes temperature and topP for Anthropic', async () => {
      const anthropicResp = makeAnthropicJsonResponse(['ok']);
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(anthropicResp) });

      await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.5,
        topP: 0.8,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.5);
      expect(body.top_p).toBe(0.8);
    });

    test('throws Anthropic API error on non-ok response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 429, text: () => Promise.resolve('Rate limited') });

      await expect(
        callAI({
          provider: makeProvider('anthropic'),
          model: 'claude-3-sonnet',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow('Anthropic API error: 429 - Rate limited');
    });

    test('throws on Anthropic retry failure', async () => {
      setupRetryFailure(new Error('Anthropic timeout'));

      await expect(
        callAI({
          provider: makeProvider('anthropic'),
          model: 'claude-3-sonnet',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow('Anthropic timeout');
    });

    test('throws generic error on Anthropic retry failure without originalError', async () => {
      setupRetryFailure();

      await expect(
        callAI({
          provider: makeProvider('anthropic'),
          model: 'claude-3-sonnet',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toThrow('Anthropic API call failed');
    });

    test('handles empty Anthropic content array', async () => {
      const resp = { id: 'msg', model: 'claude-3', content: [], stop_reason: 'end_turn' };
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(resp) });

      const result = await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.choices[0].message.content).toBe(null);
    });

    test('handles assistant message with content only (no tool_calls) in conversion', async () => {
      const anthropicResp = makeAnthropicJsonResponse(['ok']);
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(anthropicResp) });

      await callAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'Sure thing' },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg.content).toEqual([{ type: 'text', text: 'Sure thing' }]);
    });
  });

  // ========================================================================
  // streamAI
  // ========================================================================
  describe('streamAI', () => {
    function makeSSEStream(events: string[]): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      let index = 0;
      return new ReadableStream({
        pull(controller) {
          if (index < events.length) {
            controller.enqueue(encoder.encode(events[index] + '\n'));
            index++;
          } else {
            controller.close();
          }
        },
      });
    }

    test('yields content chunks from SSE stream', async () => {
      const stream = makeSSEStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" World"}}]}',
        'data: [DONE]',
      ]);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const chunks: string[] = [];
      for await (const chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ' World']);
    });

    test('collects tool_calls from delta chunks and yields as special comment', async () => {
      const stream = makeSSEStream([
        'data: {"choices":[{"delta":{"content":"Let me search"}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc_1","type":"function","function":{"name":"search","arguments":""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test\\"}"}}]}}]}',
        'data: [DONE]',
      ]);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const chunks: string[] = [];
      for await (const chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toBe('Let me search');
      const toolCallChunk = chunks.find(c => c.includes('<!--tool_calls:'));
      expect(toolCallChunk).toBeDefined();
      const tcJson = JSON.parse(toolCallChunk!.match(/<!--tool_calls:(.+)-->/)?.[1] || '[]');
      expect(tcJson).toHaveLength(1);
      expect(tcJson[0].function.name).toBe('search');
      expect(tcJson[0].function.arguments).toBe('{"q":"test"}');
    });

    test('acquires and releases concurrency permit', async () => {
      const stream = makeSSEStream(['data: [DONE]']);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      for await (const _chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      })) { /* consume */ }

      expect(mockAcquire).toHaveBeenCalledWith(
        expect.objectContaining({ caller: 'streamAI' }),
      );
      expect(mockRelease).toHaveBeenCalled();
    });

    test('releases permit even when body is null (early return)', async () => {
      mockFetch.mockResolvedValue({ ok: true, body: null });

      const chunks: string[] = [];
      for await (const chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        chunks.push(chunk);
      }

      expect(mockRelease).toHaveBeenCalled();
      expect(chunks).toEqual([]);
    });

    test('throws when stream fetch fails and still releases permit', async () => {
      setupRetryFailure(new Error('Stream connection failed'));

      const gen = streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      });

      await expect(async () => {
        for await (const _chunk of gen) { /* consume */ }
      }).rejects.toThrow('Stream connection failed');

      expect(mockRelease).toHaveBeenCalled();
    });

    test('throws generic error on stream retry failure without originalError', async () => {
      setupRetryFailure();

      const gen = streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      });

      await expect(async () => {
        for await (const _chunk of gen) { /* consume */ }
      }).rejects.toThrow('AI API stream call failed');
    });

    test('handles raw JSON lines without data: prefix', async () => {
      const stream = makeSSEStream([
        '{"choices":[{"delta":{"content":"raw line"}}]}',
        'data: [DONE]',
      ]);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const chunks: string[] = [];
      for await (const chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toContain('raw line');
    });

    test('handles message.content from raw JSON (non-delta)', async () => {
      const stream = makeSSEStream([
        '{"choices":[{"message":{"content":"from message"}}]}',
        'data: [DONE]',
      ]);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const chunks: string[] = [];
      for await (const chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toContain('from message');
    });

    test('skips invalid JSON lines silently', async () => {
      const stream = makeSSEStream([
        'data: not-valid-json',
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        'data: [DONE]',
      ]);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const chunks: string[] = [];
      for await (const chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['ok']);
    });

    test('collects tool_calls from raw JSON lines', async () => {
      const stream = makeSSEStream([
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc_raw","type":"function","function":{"name":"raw_tool","arguments":"{\\"a\\":1}"}}]}}]}',
        'data: [DONE]',
      ]);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const chunks: string[] = [];
      for await (const chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        chunks.push(chunk);
      }

      const toolCallChunk = chunks.find(c => c.includes('<!--tool_calls:'));
      expect(toolCallChunk).toBeDefined();
      const tcJson = JSON.parse(toolCallChunk!.match(/<!--tool_calls:(.+)-->/)?.[1] || '[]');
      expect(tcJson[0].function.name).toBe('raw_tool');
    });

    test('yields tool_calls at end of stream even without [DONE]', async () => {
      const stream = makeSSEStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc_eof","type":"function","function":{"name":"eof_tool","arguments":"{}"}}]}}]}',
      ]);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const chunks: string[] = [];
      for await (const chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        chunks.push(chunk);
      }

      const toolCallChunk = chunks.find(c => c.includes('<!--tool_calls:'));
      expect(toolCallChunk).toBeDefined();
    });

    test('handles multiple tool_calls with different indices', async () => {
      const stream = makeSSEStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc_0","type":"function","function":{"name":"tool_a","arguments":"{}"}},{"index":1,"id":"tc_1","type":"function","function":{"name":"tool_b","arguments":""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{\\"x\\":1}"}}]}}]}',
        'data: [DONE]',
      ]);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const chunks: string[] = [];
      for await (const chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        chunks.push(chunk);
      }

      const toolCallChunk = chunks.find(c => c.includes('<!--tool_calls:'));
      const tcJson = JSON.parse(toolCallChunk!.match(/<!--tool_calls:(.+)-->/)?.[1] || '[]');
      expect(tcJson).toHaveLength(2);
      expect(tcJson[0].function.name).toBe('tool_a');
      expect(tcJson[1].function.name).toBe('tool_b');
      expect(tcJson[1].function.arguments).toBe('{"x":1}');
    });

    test('uses Anthropic format for stream when provider is anthropic', async () => {
      const stream = makeSSEStream([
        'data: {"choices":[{"delta":{"content":"Claude streaming"}}]}',
        'data: [DONE]',
      ]);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const chunks: string[] = [];
      for await (const chunk of streamAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3-sonnet',
        messages: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: 'hi' },
        ],
      })) {
        chunks.push(chunk);
      }

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      expect(body.system).toBe('Be helpful');
      expect(body.max_tokens).toBe(4096);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['x-api-key']).toBeDefined();
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    test('passes temperature, topP, maxTokens for non-anthropic stream', async () => {
      const stream = makeSSEStream(['data: [DONE]']);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      for await (const _chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.3,
        topP: 0.7,
        maxTokens: 500,
      })) { /* consume */ }

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.3);
      expect(body.top_p).toBe(0.7);
      expect(body.max_tokens).toBe(500);
    });

    test('adds tools and tool_choice for non-anthropic stream', async () => {
      const stream = makeSSEStream(['data: [DONE]']);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      const tools = [{ type: 'function' as const, function: { name: 't', description: '', parameters: {} } }];

      for await (const _chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
        tools,
      })) { /* consume */ }

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toEqual(tools);
      expect(body.tool_choice).toBe('auto');
    });

    test('uses custom concurrency caller', async () => {
      const stream = makeSSEStream(['data: [DONE]']);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      for await (const _chunk of streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
        concurrency: { caller: 'Agent.chatStream', priority: 0, timeoutMs: 5000 },
      })) { /* consume */ }

      expect(mockAcquire).toHaveBeenCalledWith(
        expect.objectContaining({
          caller: 'Agent.chatStream',
          priority: 0,
          timeoutMs: 5000,
        }),
      );
    });

    test('passes temp and topP in Anthropic stream body', async () => {
      const stream = makeSSEStream(['data: [DONE]']);
      mockFetch.mockResolvedValue({ ok: true, body: stream });

      for await (const _chunk of streamAI({
        provider: makeProvider('anthropic'),
        model: 'claude-3',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.2,
        topP: 0.6,
      })) { /* consume */ }

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.2);
      expect(body.top_p).toBe(0.6);
    });

    test('stream non-ok fetch throws error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve('Unavailable') });

      const gen = streamAI({
        provider: makeProvider('openai'),
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      });

      await expect(async () => {
        for await (const _chunk of gen) { /* consume */ }
      }).rejects.toThrow('AI API error: 503 - Unavailable');
    });
  });

  // ========================================================================
  // hasToolCalls
  // ========================================================================
  describe('hasToolCalls', () => {
    test('returns true when response has tool calls', () => {
      const response: AIResponse = {
        choices: [{
          message: {
            role: 'assistant', content: 'Test',
            tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'test_function', arguments: '{}' } }],
          },
          finish_reason: 'tool_calls',
        }],
      };
      expect(hasToolCalls(response)).toBe(true);
    });

    test('returns false when response has no tool calls', () => {
      const response: AIResponse = {
        choices: [{ message: { role: 'assistant', content: 'Test response' }, finish_reason: 'stop' }],
      };
      expect(hasToolCalls(response)).toBe(false);
    });

    test('returns false when tool_calls array is empty', () => {
      const response: AIResponse = {
        choices: [{ message: { role: 'assistant', content: 'Test', tool_calls: [] }, finish_reason: 'stop' }],
      };
      expect(hasToolCalls(response)).toBe(false);
    });

    test('handles multiple choices — true if any has tool_calls', () => {
      const response: AIResponse = {
        choices: [
          {
            message: { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'func1', arguments: '{}' } }] },
            finish_reason: 'tool_calls',
          },
          { message: { role: 'assistant', content: 'Extra' }, finish_reason: 'stop' },
        ],
      };
      expect(hasToolCalls(response)).toBe(true);
    });

    test('returns false when tool_calls is undefined on all choices', () => {
      const response: AIResponse = {
        choices: [
          { message: { role: 'assistant', content: 'a' }, finish_reason: 'stop' },
          { message: { role: 'assistant', content: 'b' }, finish_reason: 'stop' },
        ],
      };
      expect(hasToolCalls(response)).toBe(false);
    });
  });

  // ========================================================================
  // extractToolCalls
  // ========================================================================
  describe('extractToolCalls', () => {
    test('extracts tool calls from response', () => {
      const response: AIResponse = {
        choices: [{
          message: {
            role: 'assistant', content: '',
            tool_calls: [
              { id: 'call-1', type: 'function', function: { name: 'search', arguments: '{"query":"test"}' } },
              { id: 'call-2', type: 'function', function: { name: 'fetch', arguments: '{"url":"example.com"}' } },
            ],
          },
          finish_reason: 'tool_calls',
        }],
      };
      const calls = extractToolCalls(response);
      expect(calls).toHaveLength(2);
      expect(calls[0].function.name).toBe('search');
      expect(calls[1].function.name).toBe('fetch');
    });

    test('returns empty array when no tool calls', () => {
      const response: AIResponse = {
        choices: [{ message: { role: 'assistant', content: 'No tool calls' }, finish_reason: 'stop' }],
      };
      expect(extractToolCalls(response)).toEqual([]);
    });

    test('flattens tool calls from multiple choices', () => {
      const response: AIResponse = {
        choices: [
          { message: { role: 'assistant', content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'f1', arguments: '{}' } }] }, finish_reason: 'tool_calls' },
          { message: { role: 'assistant', content: '', tool_calls: [{ id: '2', type: 'function', function: { name: 'f2', arguments: '{}' } }] }, finish_reason: 'tool_calls' },
        ],
      };
      expect(extractToolCalls(response)).toHaveLength(2);
    });
  });

  // ========================================================================
  // extractContent
  // ========================================================================
  describe('extractContent', () => {
    test('extracts content from single choice', () => {
      expect(extractContent({
        choices: [{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
      })).toBe('Hello!');
    });

    test('joins content from multiple choices', () => {
      expect(extractContent({
        choices: [
          { message: { role: 'assistant', content: 'Part 1' }, finish_reason: 'stop' },
          { message: { role: 'assistant', content: 'Part 2' }, finish_reason: 'stop' },
        ],
      })).toBe('Part 1Part 2');
    });

    test('handles empty content', () => {
      expect(extractContent({
        choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      })).toBe('');
    });

    test('handles undefined content', () => {
      expect(extractContent({
        choices: [{ message: { role: 'assistant', content: undefined as any }, finish_reason: 'stop' }],
      })).toBe('');
    });

    test('throws on null response', () => {
      expect(() => extractContent(null as any)).toThrow('Cannot extract content from null response');
    });

    test('throws on undefined response', () => {
      expect(() => extractContent(undefined as any)).toThrow('Cannot extract content from null response');
    });

    test('throws when choices is missing', () => {
      expect(() => extractContent({} as any)).toThrow('Invalid response format: missing or invalid choices array');
    });

    test('throws when choices is not an array', () => {
      expect(() => extractContent({ choices: 'not-array' } as any)).toThrow('Invalid response format');
    });

    test('returns empty string when choices array is empty', () => {
      expect(extractContent({ choices: [] } as any)).toBe('');
    });
  });

  // ========================================================================
  // executeToolCalls
  // ========================================================================
  describe('executeToolCalls', () => {
    test('executes tool calls and returns results', async () => {
      const toolCalls: ToolCall[] = [{
        id: 'call-1', type: 'function',
        function: { name: 'add', arguments: '{"a": 1, "b": 2}' },
      }];
      const executor: ToolExecutor = async (_name, params) => ({
        result: (params.a as number) + (params.b as number),
      });

      const results = await executeToolCalls(toolCalls, executor);
      expect(results).toHaveLength(1);
      expect(results[0].tool_call_id).toBe('call-1');
      expect(JSON.parse(results[0].content)).toEqual({ result: 3 });
    });

    test('handles tool execution errors with Error', async () => {
      const toolCalls: ToolCall[] = [{
        id: 'call-1', type: 'function',
        function: { name: 'failing', arguments: '{}' },
      }];
      const executor: ToolExecutor = async () => { throw new Error('Tool execution failed'); };

      const results = await executeToolCalls(toolCalls, executor);
      const content = JSON.parse(results[0].content);
      expect(content.success).toBe(false);
      expect(content.error).toBe('Tool execution failed');
    });

    test('handles invalid JSON arguments', async () => {
      const toolCalls: ToolCall[] = [{
        id: 'call-1', type: 'function',
        function: { name: 'test', arguments: 'not valid json' },
      }];
      const executor: ToolExecutor = async () => ({ success: true });

      const results = await executeToolCalls(toolCalls, executor);
      const content = JSON.parse(results[0].content);
      expect(content.success).toBe(false);
    });

    test('executes multiple tool calls sequentially', async () => {
      const order: string[] = [];
      const toolCalls: ToolCall[] = [
        { id: 'call-1', type: 'function', function: { name: 'func1', arguments: '{"x":1}' } },
        { id: 'call-2', type: 'function', function: { name: 'func2', arguments: '{"y":2}' } },
      ];
      const executor: ToolExecutor = async (name, params) => {
        order.push(name);
        return { name, params };
      };

      const results = await executeToolCalls(toolCalls, executor);
      expect(results).toHaveLength(2);
      expect(order).toEqual(['func1', 'func2']);
    });

    test('handles non-Error throw', async () => {
      const toolCalls: ToolCall[] = [{
        id: 'call-1', type: 'function',
        function: { name: 'weird', arguments: '{}' },
      }];
      const executor: ToolExecutor = async () => { throw 'string error'; };

      const results = await executeToolCalls(toolCalls, executor);
      const content = JSON.parse(results[0].content);
      expect(content.success).toBe(false);
      expect(content.error).toBe('Unknown error');
    });

    test('handles large object result (log preview truncation)', async () => {
      const toolCalls: ToolCall[] = [{
        id: 'call-1', type: 'function',
        function: { name: 'big', arguments: '{}' },
      }];
      const bigResult = { data: 'x'.repeat(500) };
      const executor: ToolExecutor = async () => bigResult;

      const results = await executeToolCalls(toolCalls, executor);
      expect(JSON.parse(results[0].content)).toEqual(bigResult);
    });

    test('handles executor returning string result', async () => {
      const toolCalls: ToolCall[] = [{
        id: 'call-1', type: 'function',
        function: { name: 'str', arguments: '{}' },
      }];
      const executor: ToolExecutor = async () => 'plain string';

      const results = await executeToolCalls(toolCalls, executor);
      expect(JSON.parse(results[0].content)).toBe('plain string');
    });
  });
});
