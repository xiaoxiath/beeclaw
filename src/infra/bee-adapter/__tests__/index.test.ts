/**
 * Tests for the beeclaw → bee adapter layer.
 *
 * TDD: Tests written first, then implementation.
 */

import { describe, it, expect } from 'vitest';
import { toProviderConfig, resetBeeAdapter, createToolRegistryFromOpenAI } from '../index';

// ============================================================================
// toProviderConfig
// ============================================================================

describe('toProviderConfig', () => {
  it('should convert basic OpenAI provider', () => {
    const provider = {
      name: 'openai-main',
      type: 'openai' as const,
      apiKey: 'sk-test-key',
    };

    const config = toProviderConfig(provider);
    expect(config.type).toBe('openai');
    expect(config.apiKey).toBe('sk-test-key');
  });

  it('should convert provider with custom baseUrl', () => {
    const provider = {
      name: 'custom',
      type: 'openai' as const,
      apiKey: 'key',
      baseUrl: 'https://custom.api.com/v1',
    };

    const config = toProviderConfig(provider);
    expect(config.baseUrl).toBe('https://custom.api.com/v1');
  });

  it('should convert Anthropic provider', () => {
    const provider = {
      name: 'anthropic',
      type: 'anthropic' as const,
      apiKey: 'ant-key',
    };

    const config = toProviderConfig(provider);
    expect(config.type).toBe('anthropic');
    expect(config.apiKey).toBe('ant-key');
  });
});

// ============================================================================
// resetBeeAdapter
// ============================================================================

describe('resetBeeAdapter', () => {
  it('should not throw when called', () => {
    expect(() => resetBeeAdapter()).not.toThrow();
  });
});

// ============================================================================
// createToolRegistryFromOpenAI
// ============================================================================

describe('createToolRegistryFromOpenAI', () => {
  it('should create registry with tools', () => {
    const tools = [
      {
        type: 'function' as const,
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

    const executor = async (name: string, params: Record<string, unknown>) => ({
      success: true,
      data: `Weather for ${params.city}`,
    });

    const registry = createToolRegistryFromOpenAI(tools, executor);

    expect(registry.has('get_weather')).toBe(true);
    expect(registry.list()).toHaveLength(1);
  });

  it('should convert tools to OpenAI format', () => {
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'search',
          description: 'Search the web',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      },
    ];

    const executor = async () => ({ success: true });
    const registry = createToolRegistryFromOpenAI(tools, executor);
    const openaiFormat = registry.toOpenAIFormat();

    expect(openaiFormat).toHaveLength(1);
    expect(openaiFormat[0].type).toBe('function');
    expect(openaiFormat[0].function.name).toBe('search');
    expect(openaiFormat[0].function.parameters).toEqual(tools[0].function.parameters);
  });

  it('should execute tools through registry', async () => {
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'calc',
          description: 'Calculate',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const executor = async (name: string, params: Record<string, unknown>) => ({
      success: true,
      tool: name,
      params,
    });

    const registry = createToolRegistryFromOpenAI(tools, executor);
    const tool = registry.get('calc')!;

    const result = await tool.execute({ x: 1 });
    expect(result).toEqual({ success: true, tool: 'calc', params: { x: 1 } });
  });

  it('should handle empty tools array', () => {
    const registry = createToolRegistryFromOpenAI([], async () => ({}));
    expect(registry.list()).toHaveLength(0);
    expect(registry.toOpenAIFormat()).toEqual([]);
  });

  it('should handle multiple tools', () => {
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'tool_a',
          description: 'Tool A',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'tool_b',
          description: 'Tool B',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const registry = createToolRegistryFromOpenAI(tools, async () => ({}));
    expect(registry.list()).toHaveLength(2);
    expect(registry.has('tool_a')).toBe(true);
    expect(registry.has('tool_b')).toBe(true);
  });
});
