import { describe, test, expect, vi } from 'vitest';
import {
  hasToolCalls,
  extractToolCalls,
  extractContent,
  executeToolCalls,
} from '../api';
import type { AIResponse, ToolCall, ToolExecutor } from '../types';

describe('Agent API Utils', () => {
  describe('hasToolCalls', () => {
    test('returns true when response has tool calls', () => {
      const response: AIResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Test',
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'test_function',
                    arguments: '{"param": "value"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };

      expect(hasToolCalls(response)).toBe(true);
    });

    test('returns false when response has no tool calls', () => {
      const response: AIResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Test response',
            },
            finish_reason: 'stop',
          },
        ],
      };

      expect(hasToolCalls(response)).toBe(false);
    });

    test('returns false when tool_calls array is empty', () => {
      const response: AIResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Test',
              tool_calls: [],
            },
            finish_reason: 'stop',
          },
        ],
      };

      expect(hasToolCalls(response)).toBe(false);
    });

    test('handles multiple choices with tool calls', () => {
      const response: AIResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'func1', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
          {
            message: {
              role: 'assistant',
              content: 'Extra',
            },
            finish_reason: 'stop',
          },
        ],
      };

      expect(hasToolCalls(response)).toBe(true);
    });
  });

  describe('extractToolCalls', () => {
    test('extracts tool calls from response', () => {
      const response: AIResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'search', arguments: '{"query": "test"}' },
                },
                {
                  id: 'call-2',
                  type: 'function',
                  function: { name: 'fetch', arguments: '{"url": "example.com"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };

      const calls = extractToolCalls(response);

      expect(calls).toHaveLength(2);
      expect(calls[0].function.name).toBe('search');
      expect(calls[1].function.name).toBe('fetch');
    });

    test('returns empty array when no tool calls', () => {
      const response: AIResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'No tool calls here',
            },
            finish_reason: 'stop',
          },
        ],
      };

      const calls = extractToolCalls(response);
      expect(calls).toEqual([]);
    });

    test('flattens tool calls from multiple choices', () => {
      const response: AIResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'func1', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call-2',
                  type: 'function',
                  function: { name: 'func2', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };

      const calls = extractToolCalls(response);
      expect(calls).toHaveLength(2);
    });
  });

  describe('extractContent', () => {
    test('extracts content from single choice', () => {
      const response: AIResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello, world!',
            },
            finish_reason: 'stop',
          },
        ],
      };

      expect(extractContent(response)).toBe('Hello, world!');
    });

    test('extracts content from multiple choices', () => {
      const response: AIResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Part 1',
            },
            finish_reason: 'stop',
          },
          {
            message: {
              role: 'assistant',
              content: 'Part 2',
            },
            finish_reason: 'stop',
          },
        ],
      };

      expect(extractContent(response)).toBe('Part 1Part 2');
    });

    test('handles empty content', () => {
      const response: AIResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
            },
            finish_reason: 'stop',
          },
        ],
      };

      expect(extractContent(response)).toBe('');
    });

    test('handles undefined content', () => {
      const response: AIResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: undefined as any,
            },
            finish_reason: 'stop',
          },
        ],
      };

      expect(extractContent(response)).toBe('');
    });
  });

  describe('executeToolCalls', () => {
    test('executes tool calls and returns results', async () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'add',
            arguments: '{"a": 1, "b": 2}',
          },
        },
      ];

      const executor: ToolExecutor = async (name, params) => {
        if (name === 'add') {
          return { result: (params.a as number) + (params.b as number) };
        }
        return { error: 'Unknown function' };
      };

      const results = await executeToolCalls(toolCalls, executor);

      expect(results).toHaveLength(1);
      expect(results[0].tool_call_id).toBe('call-1');
      expect(JSON.parse(results[0].content)).toEqual({ result: 3 });
    });

    test('handles tool execution errors', async () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'failing_func',
            arguments: '{}',
          },
        },
      ];

      const executor: ToolExecutor = async () => {
        throw new Error('Tool execution failed');
      };

      const results = await executeToolCalls(toolCalls, executor);

      expect(results).toHaveLength(1);
      const content = JSON.parse(results[0].content);
      expect(content.success).toBe(false);
      expect(content.error).toBe('Tool execution failed');
    });

    test('handles invalid JSON arguments', async () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'test',
            arguments: 'not valid json',
          },
        },
      ];

      const executor: ToolExecutor = async () => {
        return { success: true };
      };

      const results = await executeToolCalls(toolCalls, executor);

      expect(results).toHaveLength(1);
      const content = JSON.parse(results[0].content);
      expect(content.success).toBe(false);
    });

    test('executes multiple tool calls', async () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'func1', arguments: '{"x": 1}' },
        },
        {
          id: 'call-2',
          type: 'function',
          function: { name: 'func2', arguments: '{"y": 2}' },
        },
      ];

      const executor: ToolExecutor = async (name, params) => {
        return { name, params };
      };

      const results = await executeToolCalls(toolCalls, executor);

      expect(results).toHaveLength(2);
      expect(results[0].tool_call_id).toBe('call-1');
      expect(results[1].tool_call_id).toBe('call-2');
    });
  });
});
