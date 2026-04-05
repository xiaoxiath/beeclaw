/**
 * Tests for Agent class.
 *
 * TDD: Tests written first, then implementation.
 * The Agent is the main orchestrator — constructor injection, no singletons.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ChatMessage, AIResponse, OpenAITool, ToolCall } from '../core/types';
import { Agent } from './agent';

// ============================================================================
// Helper: Create a mock AI client
// ============================================================================

function createMockResponse(content: string, toolCalls?: ToolCall[]): AIResponse {
  return {
    id: `resp_${Date.now()}`,
    choices: [{
      index: 0,
      message: {
        role: 'assistant' as const,
        content,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls ? 'tool_calls' : 'stop',
    }],
  };
}

function createMockAIClient(responses: AIResponse[]) {
  let callIndex = 0;
  return {
    callAI: vi.fn(async () => {
      const resp = responses[callIndex++] ?? createMockResponse('No more responses');
      return resp;
    }),
    streamAI: vi.fn(async function* () {
      yield 'mock stream';
    }),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Agent', () => {
  it('should create agent with config', () => {
    const aiClient = createMockAIClient([createMockResponse('Hello!')]);
    const agent = new Agent({
      aiClient: aiClient as any,
      provider: { type: 'openai', apiKey: 'test-key' },
      model: 'gpt-4o',
      systemPrompt: 'You are a test assistant.',
    });

    expect(agent).toBeDefined();
  });

  it('should handle a simple chat with no tools', async () => {
    const aiClient = createMockAIClient([
      createMockResponse('Hello! How can I help?'),
    ]);

    const agent = new Agent({
      aiClient: aiClient as any,
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
    });

    const response = await agent.chat('Hi there');
    expect(response.content).toBe('Hello! How can I help?');
    expect(aiClient.callAI).toHaveBeenCalledTimes(1);
  });

  it('should include system prompt in messages', async () => {
    const aiClient = createMockAIClient([createMockResponse('Response')]);

    const agent = new Agent({
      aiClient: aiClient as any,
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
      systemPrompt: 'You are a helpful assistant.',
    });

    await agent.chat('Hi');

    const calls = aiClient.callAI.mock.calls as any[];
    const callArgs = calls[0][0];
    expect(callArgs.messages[0]).toEqual({
      role: 'system',
      content: 'You are a helpful assistant.',
    });
  });

  it('should handle tool calls in a loop', async () => {
    const toolCalls: ToolCall[] = [{
      id: 'tc_1',
      type: 'function',
      function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
    }];

    const aiClient = createMockAIClient([
      createMockResponse('', toolCalls),  // First response: tool call
      createMockResponse('The weather in Tokyo is sunny, 22°C.'),  // After tool result
    ]);

    const toolExecutor = vi.fn(async (_name: string, params: Record<string, unknown>) => ({
      success: true,
      data: { temp: 22, condition: 'sunny', city: params.city },
    }));

    const agent = new Agent({
      aiClient: aiClient as any,
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
      toolExecutor,
    });

    const response = await agent.chat("What's the weather in Tokyo?");
    expect(response.content).toBe('The weather in Tokyo is sunny, 22°C.');

    // Should have called AI twice (once for tool call, once after result)
    expect(aiClient.callAI).toHaveBeenCalledTimes(2);

    // Tool should have been called
    expect(toolExecutor).toHaveBeenCalledWith('get_weather', { city: 'Tokyo' });
  });

  it('should respect maxIterations to prevent infinite loops', async () => {
    // AI keeps returning tool calls
    const endlessToolCalls: ToolCall[] = [{
      id: 'tc_loop',
      type: 'function',
      function: { name: 'loop_tool', arguments: '{}' },
    }];

    const aiClient = createMockAIClient([
      createMockResponse('', endlessToolCalls),
      createMockResponse('', endlessToolCalls),
      createMockResponse('', endlessToolCalls),
    ]);

    const toolExecutor = vi.fn(async () => ({ success: true, data: { ok: true } }));

    const agent = new Agent({
      aiClient: aiClient as any,
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
      toolExecutor,
      maxIterations: 2,
    });

    await agent.chat('Loop test');
    // Should stop after max iterations
    expect(aiClient.callAI.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('should track conversation history', async () => {
    const aiClient = createMockAIClient([
      createMockResponse('First response'),
      createMockResponse('Second response'),
    ]);

    const agent = new Agent({
      aiClient: aiClient as any,
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
    });

    await agent.chat('First question');
    await agent.chat('Second question');

    // Second call should include history
    const calls = aiClient.callAI.mock.calls as any[];
    const secondCallArgs = calls[1][0];
    expect(secondCallArgs.messages.length).toBeGreaterThanOrEqual(3);
  });

  it('should clear conversation history', async () => {
    const aiClient = createMockAIClient([
      createMockResponse('Response'),
      createMockResponse('Fresh response'),
    ]);

    const agent = new Agent({
      aiClient: aiClient as any,
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
    });

    await agent.chat('First question');
    agent.clearHistory();
    await agent.chat('New question');

    // After clear, second call should have minimal history
    const calls = aiClient.callAI.mock.calls as any[];
    const secondCallArgs = calls[1][0];
    expect(secondCallArgs.messages.filter((m: ChatMessage) => m.role === 'assistant').length).toBe(0);
  });

  it('should pass tools to AI client', async () => {
    const aiClient = createMockAIClient([createMockResponse('Done')]);

    const tools: OpenAITool[] = [{
      type: 'function',
      function: {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    }];

    const agent = new Agent({
      aiClient: aiClient as any,
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
      tools,
    });

    await agent.chat('Use the tool');

    const calls = aiClient.callAI.mock.calls as any[];
    const callArgs = calls[0][0];
    expect(callArgs.tools).toEqual(tools);
  });

  it('should handle AI client errors gracefully', async () => {
    const aiClient = {
      callAI: vi.fn(async () => { throw new Error('API rate limit'); }),
    };

    const agent = new Agent({
      aiClient: aiClient as any,
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
    });

    await expect(agent.chat('Hi')).rejects.toThrow('API rate limit');
  });

  it('should handle streaming via chatStream', async () => {
    const aiClient = {
      callAI: vi.fn(),
      streamAI: vi.fn(async function* () {
        yield 'Hello';
        yield ' world';
      }),
    };

    const agent = new Agent({
      aiClient: aiClient as any,
      provider: { type: 'openai', apiKey: 'key' },
      model: 'gpt-4o',
    });

    const chunks: string[] = [];
    for await (const event of agent.chatStream('Hi')) {
      if (event.type === 'content') {
        chunks.push(event.content);
      }
    }

    expect(chunks).toEqual(['Hello', ' world']);
  });
});
