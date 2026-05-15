/**
 * Codex (OpenAI Responses API) request adapter — pure-function tests.
 *
 * Covers the request-side conversion: chat messages → input items, tool
 * defs → Responses tool defs, instructions extraction, and the full
 * buildCodexRequestBody round-trip including reasoning + overrides.
 *
 * Response normalization (assistant output → AIResponse) is in A-PR3.
 */

import { describe, test, expect } from 'vitest';
import {
  openaiToolsToResponsesTools,
  chatMessagesToResponsesInput,
  extractInstructions,
  buildCodexRequestBody,
  normalizeCodexResponse,
} from '../codex-adapter';
import type { ChatMessage, OpenAITool } from '../types';

// ─── Tools converter ───────────────────────────────────────────────────────

describe('openaiToolsToResponsesTools', () => {
  const sampleTool: OpenAITool = {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  };

  test('returns undefined for empty / missing input', () => {
    expect(openaiToolsToResponsesTools(undefined)).toBeUndefined();
    expect(openaiToolsToResponsesTools([])).toBeUndefined();
  });

  test('converts a single tool with all fields preserved', () => {
    const out = openaiToolsToResponsesTools([sampleTool]);
    expect(out).toEqual([{
      type: 'function',
      name: 'web_search',
      description: 'Search the web',
      strict: false,
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    }]);
  });

  test('drops tools without a valid name', () => {
    const bad = { type: 'function', function: { name: '', description: 'x', parameters: { type: 'object', properties: {}, required: [] } } } as OpenAITool;
    const ws = { ...sampleTool };
    const out = openaiToolsToResponsesTools([bad, ws]);
    expect(out).toHaveLength(1);
    expect(out![0].name).toBe('web_search');
  });

  test('returns undefined when ALL tools are invalid (no empty array)', () => {
    const bad = { type: 'function', function: { name: '   ', description: '', parameters: { type: 'object', properties: {}, required: [] } } } as OpenAITool;
    expect(openaiToolsToResponsesTools([bad])).toBeUndefined();
  });

  test('defaults parameters when missing', () => {
    const noParams = { type: 'function', function: { name: 'x', description: 'd' } } as any;
    const out = openaiToolsToResponsesTools([noParams]);
    expect(out![0].parameters).toEqual({ type: 'object', properties: {} });
  });
});

// ─── Messages converter ───────────────────────────────────────────────────

describe('chatMessagesToResponsesInput', () => {
  test('user text → message item with input_text part', () => {
    const out = chatMessagesToResponsesInput([
      { role: 'user', content: 'hello' },
    ]);
    expect(out).toEqual([{
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'hello' }],
    }]);
  });

  test('assistant text → message item with output_text part', () => {
    const out = chatMessagesToResponsesInput([
      { role: 'assistant', content: 'hi there' },
    ]);
    expect(out).toEqual([{
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'hi there' }],
    }]);
  });

  test('system messages are dropped (they go in instructions)', () => {
    const out = chatMessagesToResponsesInput([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'hi' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'message', role: 'user' });
  });

  test('multimodal user content with image → input_image part', () => {
    const out = chatMessagesToResponsesInput([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBOR...' } },
        ],
      },
    ]);
    expect(out).toEqual([{
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'what is this?' },
        { type: 'input_image', image_url: 'data:image/png;base64,iVBOR...' },
      ],
    }]);
  });

  test('assistant with tool_calls + text → message item then function_call items', () => {
    const out = chatMessagesToResponsesInput([
      {
        role: 'assistant',
        content: 'Let me search.',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"q":"foo"}' } },
          { id: 'c2', type: 'function', function: { name: 'memory_read', arguments: '{}' } },
        ],
      },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ type: 'message', role: 'assistant' });
    expect(out[1]).toEqual({ type: 'function_call', call_id: 'c1', name: 'web_search', arguments: '{"q":"foo"}' });
    expect(out[2]).toEqual({ type: 'function_call', call_id: 'c2', name: 'memory_read', arguments: '{}' });
  });

  test('assistant with tool_calls but no text → ONLY function_call items (no empty message)', () => {
    const out = chatMessagesToResponsesInput([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('function_call');
  });

  test('tool message with tool_call_id → function_call_output item', () => {
    const out = chatMessagesToResponsesInput([
      { role: 'tool', content: '{"result":"ok"}', tool_call_id: 'c1' },
    ]);
    expect(out).toEqual([{
      type: 'function_call_output',
      call_id: 'c1',
      output: '{"result":"ok"}',
    }]);
  });

  test('tool message WITHOUT tool_call_id is dropped (API needs the pairing)', () => {
    const out = chatMessagesToResponsesInput([
      { role: 'tool', content: 'orphan' } as ChatMessage,
    ]);
    expect(out).toHaveLength(0);
  });

  test('tool message with object content is JSON-stringified', () => {
    const out = chatMessagesToResponsesInput([
      { role: 'tool', content: [{ type: 'text', text: 'x' }] as any, tool_call_id: 'c1' },
    ]);
    expect(out[0]).toMatchObject({ type: 'function_call_output' });
    expect((out[0] as any).output).toContain('"text":"x"');
  });

  test('full multi-turn conversation round-trips in correct order', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'find docs' },
      {
        role: 'assistant',
        content: 'Searching.',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{}' } }],
      },
      { role: 'tool', content: 'results...', tool_call_id: 'c1' },
      { role: 'assistant', content: 'Done.' },
    ];
    const out = chatMessagesToResponsesInput(msgs);
    expect(out.map(i => i.type)).toEqual([
      'message',         // user
      'message',         // assistant text
      'function_call',   // tool call
      'function_call_output', // tool result
      'message',         // assistant final
    ]);
  });
});

// ─── Instructions extraction ───────────────────────────────────────────────

describe('extractInstructions', () => {
  test('returns the system message text', () => {
    expect(extractInstructions([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'hi' },
    ])).toBe('You are helpful.');
  });

  test('joins multiple system messages with double newlines', () => {
    expect(extractInstructions([
      { role: 'system', content: 'A' },
      { role: 'user', content: 'q' },
      { role: 'system', content: 'B' }, // second system mid-conversation
    ])).toBe('A\n\nB');
  });

  test('extracts text from multimodal system content', () => {
    expect(extractInstructions([
      {
        role: 'system',
        content: [{ type: 'text', text: 'sys instruction' }],
      },
    ])).toBe('sys instruction');
  });

  test('returns empty string when no system messages', () => {
    expect(extractInstructions([{ role: 'user', content: 'hi' }])).toBe('');
  });
});

// ─── buildCodexRequestBody ─────────────────────────────────────────────────

describe('buildCodexRequestBody', () => {
  test('minimal: just messages + model', () => {
    const body = buildCodexRequestBody({
      model: 'gpt-5.3-codex',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(body.model).toBe('gpt-5.3-codex');
    expect(body.instructions).toBe('sys');
    expect(body.input).toHaveLength(1);
    expect(body.input[0]).toMatchObject({ type: 'message', role: 'user' });
    // Reasoning enabled by default with medium effort.
    expect(body.reasoning).toEqual({ effort: 'medium' });
    // Tools omitted when not provided.
    expect(body.tools).toBeUndefined();
  });

  test('explicit instructions override the system message extraction', () => {
    const body = buildCodexRequestBody({
      model: 'm',
      messages: [
        { role: 'system', content: 'extracted-but-overridden' },
        { role: 'user', content: 'hi' },
      ],
      instructions: 'custom instructions win',
    });
    expect(body.instructions).toBe('custom instructions win');
  });

  test('respects reasoning_enabled=false (drops reasoning field entirely)', () => {
    const body = buildCodexRequestBody({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      options: { reasoning_enabled: false },
    });
    expect(body.reasoning).toBeUndefined();
  });

  test('uses configured reasoning_effort', () => {
    const body = buildCodexRequestBody({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      options: { reasoning_effort: 'high' },
    });
    expect(body.reasoning).toEqual({ effort: 'high' });
  });

  test('maxTokens maps to max_output_tokens (Responses API field name)', () => {
    const body = buildCodexRequestBody({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 8192,
    });
    expect(body.max_output_tokens).toBe(8192);
  });

  test('drops max_output_tokens when maxTokens is 0 or negative', () => {
    expect(buildCodexRequestBody({
      model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 0,
    }).max_output_tokens).toBeUndefined();
    expect(buildCodexRequestBody({
      model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: -1,
    }).max_output_tokens).toBeUndefined();
  });

  test('request_overrides spread last (can patch ANY field including reasoning)', () => {
    const body = buildCodexRequestBody({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      options: {
        reasoning_effort: 'low',
        request_overrides: {
          temperature: 0.7,
          parallel_tool_calls: false,
          // Even override reasoning if you want.
          reasoning: { effort: 'high' },
        },
      },
    });
    expect((body as any).temperature).toBe(0.7);
    expect((body as any).parallel_tool_calls).toBe(false);
    // Override wins over the option-set value.
    expect(body.reasoning).toEqual({ effort: 'high' });
  });

  test('tools are converted and attached', () => {
    const body = buildCodexRequestBody({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{
        type: 'function',
        function: {
          name: 'foo',
          description: 'd',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      }],
    });
    expect(body.tools).toHaveLength(1);
    expect(body.tools![0]).toMatchObject({ type: 'function', name: 'foo', strict: false });
  });

  // The normalizer tests live in their own describe further down; the
  // builder tests (this block) just ship the request side.
  test('full conversation with tool calls round-trips correctly', () => {
    const body = buildCodexRequestBody({
      model: 'gpt-5.3-codex',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'search docs' },
        {
          role: 'assistant',
          content: 'Looking up.',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"q":"x"}' } }],
        },
        { role: 'tool', content: 'top result', tool_call_id: 'c1' },
        { role: 'assistant', content: 'Found it.' },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'web_search',
          description: 'search',
          parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
      }],
      options: { reasoning_effort: 'high' },
      maxTokens: 4096,
    });

    expect(body.instructions).toBe('sys');
    expect(body.reasoning).toEqual({ effort: 'high' });
    expect(body.max_output_tokens).toBe(4096);
    expect(body.input.map(i => i.type)).toEqual([
      'message', 'message', 'function_call', 'function_call_output', 'message',
    ]);
    expect(body.tools).toHaveLength(1);
    expect(body.tools![0].name).toBe('web_search');
  });
});

// ─── Response normalizer ───────────────────────────────────────────────────

describe('normalizeCodexResponse', () => {
  test('text-only message → content + finish_reason "stop"', () => {
    const out = normalizeCodexResponse({
      id: 'resp_1',
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Hello there.' }],
        },
      ],
    });
    expect(out.id).toBe('resp_1');
    expect(out.choices).toHaveLength(1);
    expect(out.choices[0].message.content).toBe('Hello there.');
    expect(out.choices[0].message.tool_calls).toBeUndefined();
    expect(out.choices[0].finish_reason).toBe('stop');
  });

  test('multi-part text content concatenates correctly', () => {
    const out = normalizeCodexResponse({
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'Part one. ' },
            { type: 'output_text', text: 'Part two.' },
          ],
        },
      ],
    });
    expect(out.choices[0].message.content).toBe('Part one. Part two.');
  });

  test('function_call items → tool_calls + finish_reason "tool_calls"', () => {
    const out = normalizeCodexResponse({
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Searching.' }],
        },
        { type: 'function_call', call_id: 'c1', name: 'web_search', arguments: '{"q":"foo"}' },
        { type: 'function_call', call_id: 'c2', name: 'memory_read', arguments: '{}' },
      ],
    });
    expect(out.choices[0].message.tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'web_search', arguments: '{"q":"foo"}' } },
      { id: 'c2', type: 'function', function: { name: 'memory_read', arguments: '{}' } },
    ]);
    expect(out.choices[0].finish_reason).toBe('tool_calls');
  });

  test('function_call with missing arguments defaults to empty string', () => {
    const out = normalizeCodexResponse({
      output: [
        { type: 'function_call', call_id: 'c1', name: 'foo' },
      ],
    });
    expect(out.choices[0].message.tool_calls![0].function.arguments).toBe('');
  });

  test('function_call with missing call_id or name is dropped', () => {
    const out = normalizeCodexResponse({
      output: [
        { type: 'function_call', name: 'no-id-here' } as any,
        { type: 'function_call', call_id: 'c2' } as any,
        { type: 'function_call', call_id: 'c3', name: 'good' },
      ],
    });
    expect(out.choices[0].message.tool_calls).toHaveLength(1);
    expect(out.choices[0].message.tool_calls![0].function.name).toBe('good');
  });

  test('reasoning-only response → finish_reason "incomplete"', () => {
    // Model emitted only encrypted reasoning, no visible answer.
    const out = normalizeCodexResponse({
      output: [
        { type: 'reasoning', id: 'rs_1', encrypted_content: '<encrypted>' },
      ],
    });
    expect(out.choices[0].message.content).toBeNull();
    expect(out.choices[0].finish_reason).toBe('incomplete');
  });

  test('reasoning + text → finish_reason "stop", reasoning silently dropped', () => {
    const out = normalizeCodexResponse({
      output: [
        { type: 'reasoning', id: 'rs_1', encrypted_content: '<encrypted>' },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'visible answer' }],
        },
      ],
    });
    expect(out.choices[0].message.content).toBe('visible answer');
    expect(out.choices[0].finish_reason).toBe('stop');
  });

  test('falls back to top-level output_text when output[] has no message item', () => {
    const out = normalizeCodexResponse({
      output_text: 'fallback text',
    });
    expect(out.choices[0].message.content).toBe('fallback text');
    expect(out.choices[0].finish_reason).toBe('stop');
  });

  test('empty response → null content, finish_reason "stop"', () => {
    const out = normalizeCodexResponse({});
    expect(out.choices[0].message.content).toBeNull();
    expect(out.choices[0].message.tool_calls).toBeUndefined();
    expect(out.choices[0].finish_reason).toBe('stop');
  });

  test('usage maps input_tokens → prompt_tokens, output_tokens → completion_tokens', () => {
    const out = normalizeCodexResponse({
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x' }] }],
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    });
    expect(out.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
  });

  test('usage falls back to input+output sum when total missing', () => {
    const out = normalizeCodexResponse({
      output: [],
      usage: { input_tokens: 30, output_tokens: 10 },
    });
    expect(out.usage?.total_tokens).toBe(40);
  });

  test('no usage in response → AIResponse omits usage field', () => {
    const out = normalizeCodexResponse({ output: [] });
    expect(out.usage).toBeUndefined();
  });

  test('generates a fallback id when response has none', () => {
    const out = normalizeCodexResponse({ output: [] });
    expect(out.id).toMatch(/^codex-\d+$/);
  });
});

// ─── Tool-call leak recovery (gpt-5.x degeneration) ───────────────────────

describe('normalizeCodexResponse — tool-call leak pattern', () => {
  test('detects "to=functions.X" leak when no real tool_calls → incomplete', () => {
    const out = normalizeCodexResponse({
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Let me look that up.\nto=functions.web_search {"q":"foo"}' }],
        },
      ],
    });
    expect(out.choices[0].finish_reason).toBe('incomplete');
    // Garbage cleared so it doesn't surface as a summary.
    expect(out.choices[0].message.content).toBeNull();
    expect(out.choices[0].message.tool_calls).toBeUndefined();
  });

  test('detects Harmony-prefixed leak ("assistant to=functions.X")', () => {
    const out = normalizeCodexResponse({
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'assistant to=functions.search\n{"q":"x"}' }],
        },
      ],
    });
    expect(out.choices[0].finish_reason).toBe('incomplete');
  });

  test('detects channel-prefixed leak ("<|channel|>commentary to=functions.X")', () => {
    const out = normalizeCodexResponse({
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '<|channel|>commentary to=functions.foo' }],
        },
      ],
    });
    expect(out.choices[0].finish_reason).toBe('incomplete');
  });

  test('does NOT trigger on legitimate prose mentioning "to=functions"', () => {
    // The pattern requires a name char after the dot.
    const out = normalizeCodexResponse({
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Documentation refers to=functions blocks generally.' }],
        },
      ],
    });
    expect(out.choices[0].finish_reason).toBe('stop');
    expect(out.choices[0].message.content).toContain('Documentation');
  });

  test('does NOT trigger when REAL tool_calls accompany the leaked text', () => {
    // If the model also emitted a structured function_call, no need to retry.
    const out = normalizeCodexResponse({
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'note to=functions.search emitted properly' }],
        },
        { type: 'function_call', call_id: 'c1', name: 'search', arguments: '{}' },
      ],
    });
    expect(out.choices[0].finish_reason).toBe('tool_calls');
    expect(out.choices[0].message.tool_calls).toHaveLength(1);
    expect(out.choices[0].message.content).toContain('note to=functions');
  });
});

