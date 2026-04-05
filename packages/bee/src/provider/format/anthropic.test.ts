/**
 * Tests for Anthropic format conversion.
 *
 * TDD: Tests written first, then implementation.
 * Covers convertToAnthropicFormat and convertFromAnthropicFormat.
 */

import { describe, it, expect } from 'vitest';
import type { ChatMessage, OpenAITool, AIResponse, ToolCall } from '../../core/types';

// These will be implemented in anthropic.ts
import {
  convertToAnthropicFormat,
  convertFromAnthropicFormat,
} from './anthropic';

// ============================================================================
// convertToAnthropicFormat
// ============================================================================

describe('convertToAnthropicFormat', () => {
  it('should convert system messages to top-level system field', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ];

    const result = convertToAnthropicFormat(messages);

    expect(result.system).toBe('You are a helpful assistant.');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('should concatenate multiple system messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Rule 1.' },
      { role: 'system', content: 'Rule 2.' },
      { role: 'user', content: 'Go' },
    ];

    const result = convertToAnthropicFormat(messages);

    expect(result.system).toBe('Rule 1.\n\nRule 2.');
    expect(result.messages).toHaveLength(1);
  });

  it('should convert assistant messages with tool_calls', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'Let me check.',
        tool_calls: [
          {
            id: 'tc_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
          },
        ],
      },
    ];

    const result = convertToAnthropicFormat(messages);

    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0] as any;
    expect(msg.role).toBe('assistant');
    expect(msg.content).toEqual([
      { type: 'text', text: 'Let me check.' },
      {
        type: 'tool_use',
        id: 'tc_1',
        name: 'get_weather',
        input: { city: 'Tokyo' },
      },
    ]);
  });

  it('should convert assistant messages with only tool_calls (no text)', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc_2',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"test"}' },
          },
        ],
      },
    ];

    const result = convertToAnthropicFormat(messages);

    const msg = result.messages[0] as any;
    // Empty content string should not produce a text block
    expect(msg.content).toEqual([
      {
        type: 'tool_use',
        id: 'tc_2',
        name: 'search',
        input: { q: 'test' },
      },
    ]);
  });

  it('should convert tool messages to user/tool_result format', () => {
    const messages: ChatMessage[] = [
      {
        role: 'tool',
        content: '{"temp": 22}',
        tool_call_id: 'tc_1',
      },
    ];

    const result = convertToAnthropicFormat(messages);

    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0] as any;
    expect(msg.role).toBe('user');
    expect(msg.content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'tc_1',
        content: '{"temp": 22}',
      },
    ]);
  });

  it('should pass through user messages unchanged', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'What is the weather?' },
    ];

    const result = convertToAnthropicFormat(messages);

    expect(result.messages).toEqual([
      { role: 'user', content: 'What is the weather?' },
    ]);
  });

  it('should convert OpenAI tools to Anthropic format', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
    ];
    const tools: OpenAITool[] = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather for a city',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      },
    ];

    const result = convertToAnthropicFormat(messages, tools);

    expect(result.tools).toEqual([
      {
        name: 'get_weather',
        description: 'Get weather for a city',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ]);
  });

  it('should return no tools when tools array is empty', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
    const result = convertToAnthropicFormat(messages, []);
    expect(result.tools).toBeUndefined();
  });

  it('should handle no system message (undefined system)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
    ];

    const result = convertToAnthropicFormat(messages);
    expect(result.system).toBeUndefined();
  });
});

// ============================================================================
// convertFromAnthropicFormat
// ============================================================================

describe('convertFromAnthropicFormat', () => {
  it('should convert text-only Anthropic response', () => {
    const anthropicResponse = {
      id: 'msg_123',
      model: 'claude-sonnet-4-6',
      content: [
        { type: 'text', text: 'Hello! How can I help you?' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 8 },
    };

    const result = convertFromAnthropicFormat(anthropicResponse);

    expect(result.id).toBe('msg_123');
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.content).toBe('Hello! How can I help you?');
    expect(result.choices[0].message.role).toBe('assistant');
    expect(result.choices[0].finish_reason).toBe('end_turn');
  });

  it('should convert tool_use blocks to tool_calls', () => {
    const anthropicResponse = {
      id: 'msg_456',
      model: 'claude-sonnet-4-6',
      content: [
        { type: 'text', text: 'Checking weather...' },
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'get_weather',
          input: { city: 'Tokyo', unit: 'celsius' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 20, output_tokens: 15 },
    };

    const result = convertFromAnthropicFormat(anthropicResponse);

    expect(result.choices[0].message.content).toBe('Checking weather...');
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    const tc = result.choices[0].message.tool_calls![0];
    expect(tc.id).toBe('tu_1');
    expect(tc.type).toBe('function');
    expect(tc.function.name).toBe('get_weather');
    expect(JSON.parse(tc.function.arguments)).toEqual({ city: 'Tokyo', unit: 'celsius' });
    expect(result.choices[0].finish_reason).toBe('tool_calls');
  });

  it('should convert tool_use only (no text)', () => {
    const anthropicResponse = {
      id: 'msg_789',
      model: 'claude-sonnet-4-6',
      content: [
        {
          type: 'tool_use',
          id: 'tu_2',
          name: 'search',
          input: { q: 'test' },
        },
      ],
      stop_reason: 'tool_use',
    };

    const result = convertFromAnthropicFormat(anthropicResponse);

    expect(result.choices[0].message.content).toBeNull();
    expect(result.choices[0].message.tool_calls).toHaveLength(1);
    expect(result.choices[0].message.tool_calls![0].function.name).toBe('search');
  });

  it('should handle multiple tool_use blocks', () => {
    const anthropicResponse = {
      id: 'msg_multi',
      model: 'claude-sonnet-4-6',
      content: [
        { type: 'tool_use', id: 'tu_a', name: 'tool_a', input: { x: 1 } },
        { type: 'tool_use', id: 'tu_b', name: 'tool_b', input: { y: 2 } },
      ],
      stop_reason: 'tool_use',
    };

    const result = convertFromAnthropicFormat(anthropicResponse);

    expect(result.choices[0].message.tool_calls).toHaveLength(2);
    expect(result.choices[0].message.tool_calls![0].function.name).toBe('tool_a');
    expect(result.choices[0].message.tool_calls![1].function.name).toBe('tool_b');
  });

  it('should handle empty content array', () => {
    const anthropicResponse = {
      id: 'msg_empty',
      model: 'claude-sonnet-4-6',
      content: [],
      stop_reason: 'end_turn',
    };

    const result = convertFromAnthropicFormat(anthropicResponse);

    expect(result.choices[0].message.content).toBeNull();
    expect(result.choices[0].message.tool_calls).toBeUndefined();
  });

  it('should generate id when missing from response', () => {
    const anthropicResponse = {
      content: [{ type: 'text', text: 'Hi' }],
      stop_reason: 'end_turn',
    };

    const result = convertFromAnthropicFormat(anthropicResponse);

    // Should have a generated id or empty string fallback
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
  });

  it('should set finish_reason to stop_reason value when no tool_calls', () => {
    const anthropicResponse = {
      id: 'msg_stop',
      content: [{ type: 'text', text: 'Done.' }],
      stop_reason: 'max_tokens',
    };

    const result = convertFromAnthropicFormat(anthropicResponse);

    expect(result.choices[0].finish_reason).toBe('max_tokens');
  });
});
