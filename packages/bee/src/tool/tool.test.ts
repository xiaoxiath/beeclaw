/**
 * Tests for ToolRegistry and ToolDispatcher.
 *
 * TDD: Tests written first, then implementation.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolCall, ToolResult } from '../core/types';

// ============================================================================
// ToolRegistry
// ============================================================================

describe('ToolRegistry', () => {
  it('should register and retrieve a tool', async () => {
    const { ToolRegistry } = await import('./registry');
    const registry = new ToolRegistry();

    registry.register({
      name: 'get_weather',
      description: 'Get weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
      execute: async (params) => ({ temp: 22, city: params.city }),
    });

    const tool = registry.get('get_weather');
    expect(tool).toBeDefined();
    expect(tool!.name).toBe('get_weather');

    const result = await tool!.execute({ city: 'Tokyo' });
    expect(result).toEqual({ temp: 22, city: 'Tokyo' });
  });

  it('should return undefined for non-existent tool', async () => {
    const { ToolRegistry } = await import('./registry');
    const registry = new ToolRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should list all registered tools', async () => {
    const { ToolRegistry } = await import('./registry');
    const registry = new ToolRegistry();

    registry.register({
      name: 'tool_a',
      description: 'Tool A',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => null,
    });
    registry.register({
      name: 'tool_b',
      description: 'Tool B',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => null,
    });

    const tools = registry.list();
    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name)).toContain('tool_a');
    expect(tools.map(t => t.name)).toContain('tool_b');
  });

  it('should convert tools to OpenAI format', async () => {
    const { ToolRegistry } = await import('./registry');
    const registry = new ToolRegistry();

    registry.register({
      name: 'search',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
      execute: async () => null,
    });

    const openaiTools = registry.toOpenAIFormat();
    expect(openaiTools).toHaveLength(1);
    expect(openaiTools[0].type).toBe('function');
    expect(openaiTools[0].function.name).toBe('search');
    expect(openaiTools[0].function.description).toBe('Search the web');
    expect(openaiTools[0].function.parameters).toEqual({
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    });
  });

  it('should unregister a tool', async () => {
    const { ToolRegistry } = await import('./registry');
    const registry = new ToolRegistry();

    registry.register({
      name: 'temp',
      description: 'Temporary',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => null,
    });

    expect(registry.unregister('temp')).toBe(true);
    expect(registry.get('temp')).toBeUndefined();
    expect(registry.unregister('temp')).toBe(false);
  });

  it('should check if tool exists', async () => {
    const { ToolRegistry } = await import('./registry');
    const registry = new ToolRegistry();

    registry.register({
      name: 'exists',
      description: 'A tool',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => null,
    });

    expect(registry.has('exists')).toBe(true);
    expect(registry.has('nope')).toBe(false);
  });

  it('should register multiple tools at once', async () => {
    const { ToolRegistry } = await import('./registry');
    const registry = new ToolRegistry();

    registry.registerAll([
      {
        name: 'a',
        description: 'Tool A',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async () => null,
      },
      {
        name: 'b',
        description: 'Tool B',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async () => null,
      },
    ]);

    expect(registry.list()).toHaveLength(2);
  });
});

// ============================================================================
// ToolDispatcher
// ============================================================================

describe('ToolDispatcher', () => {
  it('should dispatch a single tool call', async () => {
    const { ToolDispatcher } = await import('./dispatcher');
    const dispatcher = new ToolDispatcher({
      executor: async (name, params) => ({ result: `${name}: ${JSON.stringify(params)}` }),
    });

    const toolCalls: ToolCall[] = [{
      id: 'tc_1',
      type: 'function',
      function: { name: 'search', arguments: '{"q":"test"}' },
    }];

    const results = await dispatcher.dispatch(toolCalls);
    expect(results).toHaveLength(1);
    expect(results[0].tool_call_id).toBe('tc_1');
    expect(JSON.parse(results[0].content).result).toContain('search');
  });

  it('should dispatch multiple tool calls', async () => {
    const { ToolDispatcher } = await import('./dispatcher');
    const callLog: string[] = [];

    const dispatcher = new ToolDispatcher({
      executor: async (name, params) => {
        callLog.push(name);
        return { ok: true };
      },
    });

    const toolCalls: ToolCall[] = [
      { id: 'tc_1', type: 'function', function: { name: 'tool_a', arguments: '{}' } },
      { id: 'tc_2', type: 'function', function: { name: 'tool_b', arguments: '{}' } },
    ];

    const results = await dispatcher.dispatch(toolCalls);
    expect(results).toHaveLength(2);
    expect(callLog).toEqual(['tool_a', 'tool_b']);
  });

  it('should handle tool execution errors gracefully', async () => {
    const { ToolDispatcher } = await import('./dispatcher');
    const dispatcher = new ToolDispatcher({
      executor: async () => { throw new Error('Tool crashed'); },
    });

    const toolCalls: ToolCall[] = [{
      id: 'tc_err',
      type: 'function',
      function: { name: 'failing', arguments: '{}' },
    }];

    const results = await dispatcher.dispatch(toolCalls);
    expect(results).toHaveLength(1);
    const parsed = JSON.parse(results[0].content);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('Tool crashed');
  });

  it('should handle invalid JSON arguments', async () => {
    const { ToolDispatcher } = await import('./dispatcher');
    const dispatcher = new ToolDispatcher({
      executor: async (name, params) => ({ name, params }),
    });

    const toolCalls: ToolCall[] = [{
      id: 'tc_bad',
      type: 'function',
      function: { name: 'test', arguments: 'not valid json' },
    }];

    const results = await dispatcher.dispatch(toolCalls);
    expect(results).toHaveLength(1);
    const parsed = JSON.parse(results[0].content);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Failed to parse');
  });

  it('should check blocked tools', async () => {
    const { ToolDispatcher } = await import('./dispatcher');
    const dispatcher = new ToolDispatcher({
      executor: async () => null,
      blockedTools: ['dangerous_tool'],
    });

    expect(dispatcher.isToolBlocked('dangerous_tool')).toBe(true);
    expect(dispatcher.isToolBlocked('safe_tool')).toBe(false);
  });

  it('should skip blocked tools and return error', async () => {
    const { ToolDispatcher } = await import('./dispatcher');
    const dispatcher = new ToolDispatcher({
      executor: async () => ({ should: 'not reach' }),
      blockedTools: ['blocked_tool'],
    });

    const toolCalls: ToolCall[] = [{
      id: 'tc_blocked',
      type: 'function',
      function: { name: 'blocked_tool', arguments: '{}' },
    }];

    const results = await dispatcher.dispatch(toolCalls);
    const parsed = JSON.parse(results[0].content);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('blocked');
  });

  it('should accept dynamic tool executor override', async () => {
    const { ToolDispatcher } = await import('./dispatcher');
    const dispatcher = new ToolDispatcher({
      executor: async () => ({ default: true }),
    });

    const toolCalls: ToolCall[] = [{
      id: 'tc_1',
      type: 'function',
      function: { name: 'test', arguments: '{}' },
    }];

    // Override executor per-call
    const results = await dispatcher.dispatch(toolCalls, {
      executor: async () => ({ overridden: true }),
    });

    const parsed = JSON.parse(results[0].content);
    expect(parsed.overridden).toBe(true);
  });
});
