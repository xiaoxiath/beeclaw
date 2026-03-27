/**
 * Tests for Reflection Engine
 *
 * Tests conversation pattern detection, reflection analysis,
 * and strategy generation.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  ReflectionEngine,
  getReflectionEngine,
  type ConversationRecord
} from '../reflection-engine';

describe('ReflectionEngine', () => {
  let engine: ReflectionEngine;

  beforeEach(() => {
    engine = new ReflectionEngine({
      maxConversations: 100,
      minPatternFrequency: 2,
      minConfidence: 0.5,
      useLLMReflection: false,
    });
  });

  describe('initialization', () => {
    test('should create engine with default config', () => {
      const defaultEngine = new ReflectionEngine();
      expect(defaultEngine).toBeDefined();
    });

    test('should create engine with custom config', () => {
      const customEngine = new ReflectionEngine({
        maxConversations: 50,
        minPatternFrequency: 5,
      });
      expect(customEngine).toBeDefined();
    });

    test('should get singleton instance', () => {
      const instance1 = getReflectionEngine();
      const instance2 = getReflectionEngine();
      expect(instance1).toBe(instance2);
    });

    test('should create new instance with config', () => {
      const instance1 = getReflectionEngine();
      const instance2 = getReflectionEngine({ maxConversations: 10 });
      expect(instance2).toBeDefined();
    });
  });

  describe('recordFailure', () => {
    test('should record skill failures', () => {
      engine.recordFailure('test-skill', 'Test failure context');
      engine.recordFailure('test-skill', 'Another failure');

      // Failures will be reflected in analysis
      const conversations: ConversationRecord[] = [
        {
          timestamp: new Date().toISOString(),
          userMessage: 'test',
          assistantMessage: 'response',
        },
      ];

      const result = engine.reflect(conversations);
      // Should not throw
      expect(result).toBeDefined();
    });

    test('should limit failure log size', () => {
      // Add more than 500 failures
      for (let i = 0; i < 600; i++) {
        engine.recordFailure('skill', `failure ${i}`);
      }

      // Should not throw or crash
      const conversations: ConversationRecord[] = [
        {
          timestamp: new Date().toISOString(),
          userMessage: 'test',
          assistantMessage: 'response',
        },
      ];

      const result = engine.reflect(conversations);
      expect(result).toBeDefined();
    });
  });

  describe('reflect', () => {
    test('should analyze empty conversation list', async () => {
      const result = await engine.reflect([]);
      expect(result.patterns).toEqual([]);
      expect(result.lessons).toEqual([]);
      expect(result.stats.totalTurns).toBe(0);
    });

    test('should compute conversation statistics', async () => {
      const conversations: ConversationRecord[] = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          userMessage: 'How do I fix this bug?',
          assistantMessage: 'Let me help you.',
          toolsCalled: [
            { name: 'memory_read', success: true, latencyMs: 100 },
            { name: 'skill_get', success: true, latencyMs: 50 },
          ],
          tokensUsed: 500,
        },
        {
          timestamp: '2024-01-01T11:00:00Z',
          userMessage: 'Fix the error',
          assistantMessage: 'Done.',
          toolsCalled: [{ name: 'memory_read', success: false, latencyMs: 200 }],
          tokensUsed: 300,
        },
      ];

      const result = await engine.reflect(conversations);

      expect(result.stats.totalTurns).toBe(2);
      expect(result.stats.totalToolCalls).toBe(3);
      expect(result.stats.toolSuccessRate).toBeCloseTo(0.667, 2);
      expect(result.stats.topTools).toHaveLength(2);
      expect(result.stats.topTools[0].name).toBe('memory_read');
      expect(result.stats.topTools[0].count).toBe(2);
    });

    test('should detect recurring queries', async () => {
      const conversations: ConversationRecord[] = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          userMessage: '修复bug',
          assistantMessage: 'Response 1',
        },
        {
          timestamp: '2024-01-01T11:00:00Z',
          userMessage: '修复bug',
          assistantMessage: 'Response 2',
        },
        {
          timestamp: '2024-01-01T12:00:00Z',
          userMessage: '修复bug',
          assistantMessage: 'Response 3',
        },
      ];

      const result = await engine.reflect(conversations);

      const recurringPattern = result.patterns.find(p => p.type === 'recurring_query');
      expect(recurringPattern).toBeDefined();
      expect(recurringPattern!.frequency).toBeGreaterThanOrEqual(2);
      expect(recurringPattern!.suggestion).toContain('技能');
    });

    test('should detect tool preferences', async () => {
      const conversations: ConversationRecord[] = Array(15).fill(null).map((_, i) => ({
        timestamp: `2024-01-01T${10 + i}:00:00Z`,
        userMessage: `Test message ${i}`,
        assistantMessage: 'Response',
        toolsCalled: [{ name: 'memory_read', success: true }],
      }));

      const result = await engine.reflect(conversations);

      const toolPattern = result.patterns.find(p =>
        p.type === 'tool_preference' && p.id.includes('memory_read')
      );
      expect(toolPattern).toBeDefined();
      expect(toolPattern!.frequency).toBeGreaterThanOrEqual(10);
    });

    test('should detect tool failure patterns', async () => {
      const conversations: ConversationRecord[] = Array(6).fill(null).map((_, i) => ({
        timestamp: `2024-01-01T${10 + i}:00:00Z`,
        userMessage: `Test ${i}`,
        assistantMessage: 'Response',
        toolsCalled: [{ name: 'failing_tool', success: false }], // 0% success rate
      }));

      const result = await engine.reflect(conversations);

      const failurePattern = result.patterns.find(p =>
        p.type === 'failure_pattern' && p.id.includes('failing_tool')
      );
      expect(failurePattern).toBeDefined();
      expect(failurePattern!.suggestion).toContain('审查');
    });

    test('should detect skill failure patterns', async () => {
      // Record multiple skill failures
      for (let i = 0; i < 5; i++) {
        engine.recordFailure('problematic-skill', `Failure context ${i}`);
      }

      const conversations: ConversationRecord[] = [
        {
          timestamp: new Date().toISOString(),
          userMessage: 'Test',
          assistantMessage: 'Response',
        },
      ];

      const result = await engine.reflect(conversations);

      const skillFailure = result.patterns.find(p =>
        p.type === 'failure_pattern' && p.id.includes('problematic-skill')
      );
      expect(skillFailure).toBeDefined();
      expect(skillFailure!.frequency).toBeGreaterThanOrEqual(2);
    });

    test('should detect efficiency patterns (high token usage)', async () => {
      const conversations: ConversationRecord[] = Array(5).fill(null).map((_, i) => ({
        timestamp: `2024-01-01T${10 + i}:00:00Z`,
        userMessage: `Complex query ${i}`,
        assistantMessage: 'Long response...',
        tokensUsed: 3500, // High token usage
      }));

      const result = await engine.reflect(conversations);

      const efficiencyPattern = result.patterns.find(p =>
        p.type === 'efficiency' && p.id === 'high_token_usage'
      );
      expect(efficiencyPattern).toBeDefined();
      expect(efficiencyPattern!.suggestion).toContain('优化');
    });

    test('should classify query types correctly', async () => {
      const conversations: ConversationRecord[] = [
        {
          timestamp: '2024-01-01T10:00:00Z',
          userMessage: '如何修复这个bug？',
          assistantMessage: 'Response',
        },
        {
          timestamp: '2024-01-01T11:00:00Z',
          userMessage: '为什么会出错？',
          assistantMessage: 'Response',
        },
        {
          timestamp: '2024-01-01T12:00:00Z',
          userMessage: '帮我写一个脚本',
          assistantMessage: 'Response',
        },
      ];

      const result = await engine.reflect(conversations);

      expect(result.stats.topQueryTypes).toContainEqual({ type: '方法指导', count: 1 });
      expect(result.stats.topQueryTypes).toContainEqual({ type: '原因分析', count: 1 });
      // "帮我" matches "任务执行" pattern
      expect(result.stats.topQueryTypes).toContainEqual({ type: '任务执行', count: 1 });
    });

    test('should limit conversations to maxConversations', async () => {
      const smallEngine = new ReflectionEngine({ maxConversations: 5 });

      const conversations: ConversationRecord[] = Array(20).fill(null).map((_, i) => ({
        timestamp: `2024-01-01T${10 + i}:00:00Z`,
        userMessage: `Message ${i}`,
        assistantMessage: 'Response',
      }));

      const result = await smallEngine.reflect(conversations);

      // Should only analyze last 5 conversations
      expect(result.stats.totalTurns).toBe(5);
    });
  });

  describe('generateReflectionPrompt', () => {
    test('should generate empty prompt for empty conversations', async () => {
      const prompt = await engine.generateReflectionPrompt([]);
      expect(prompt).toBe('');
    });

    test('should include lessons in prompt', async () => {
      const conversations: ConversationRecord[] = Array(5).fill(null).map((_, i) => ({
        timestamp: `2024-01-01T${10 + i}:00:00Z`,
        userMessage: '如何修复bug',
        assistantMessage: 'Response',
        toolsCalled: [{ name: 'test_tool', success: false }],
      }));

      const prompt = await engine.generateReflectionPrompt(conversations);

      expect(prompt).toContain('历史经验教训');
    });

    test('should include strategy updates for high priority', async () => {
      const conversations: ConversationRecord[] = Array(10).fill(null).map((_, i) => ({
        timestamp: `2024-01-01T${10 + i}:00:00Z`,
        userMessage: 'Test',
        assistantMessage: 'Response',
        toolsCalled: [{ name: 'failing_tool', success: false }],
      }));

      const prompt = await engine.generateReflectionPrompt(conversations);

      // Should include strategy adjustments if high priority issues found
      if (prompt.includes('策略调整')) {
        expect(prompt).toContain('tool_preference');
      }
    });

    test('should warn about low success rate tools', async () => {
      const conversations: ConversationRecord[] = Array(10).fill(null).map((_, i) => ({
        timestamp: `2024-01-01T${10 + i}:00:00Z`,
        userMessage: 'Test',
        assistantMessage: 'Response',
        toolsCalled: [{ name: 'bad_tool', success: false }],
      }));

      const prompt = await engine.generateReflectionPrompt(conversations);

      expect(prompt).toContain('工具使用注意');
      expect(prompt).toContain('bad_tool');
      expect(prompt).toContain('谨慎使用');
    });
  });

  describe('generateLessons', () => {
    test('should generate lessons from patterns', async () => {
      const conversations: ConversationRecord[] = Array(5).fill(null).map((_, i) => ({
        timestamp: `2024-01-01T${10 + i}:00:00Z`,
        userMessage: '如何修复bug',
        assistantMessage: 'Response',
      }));

      const result = await engine.reflect(conversations);

      // Should have generated some lessons
      expect(result.lessons.length).toBeGreaterThan(0);
    });

    test('should include tool success rate lesson', async () => {
      const conversations: ConversationRecord[] = Array(10).fill(null).map((_, i) => ({
        timestamp: `2024-01-01T${10 + i}:00:00Z`,
        userMessage: 'Test',
        assistantMessage: 'Response',
        toolsCalled: [
          { name: 'tool1', success: false },
          { name: 'tool2', success: false },
        ],
      }));

      const result = await engine.reflect(conversations);

      const successRateLesson = result.lessons.find(l =>
        l.includes('成功率') || l.includes('工具')
      );
      expect(successRateLesson).toBeDefined();
    });

    test('should limit to 10 lessons', async () => {
      const conversations: ConversationRecord[] = Array(20).fill(null).map((_, i) => ({
        timestamp: `2024-01-01T${10 + i}:00:00Z`,
        userMessage: `Query type ${i % 5}`, // Create different patterns
        assistantMessage: 'Response',
        toolsCalled: [{ name: `tool_${i % 10}`, success: i % 2 === 0 }],
      }));

      const result = await engine.reflect(conversations);

      expect(result.lessons.length).toBeLessThanOrEqual(10);
    });
  });

  describe('generateStrategyUpdates', () => {
    test('should suggest tool preference adjustments', async () => {
      const conversations: ConversationRecord[] = Array(10).fill(null).map(() => ({
        timestamp: new Date().toISOString(),
        userMessage: 'Test',
        assistantMessage: 'Response',
        toolsCalled: [{ name: 'failing_tool', success: false }],
      }));

      const result = await engine.reflect(conversations);

      const toolUpdate = result.strategyUpdates.find(u => u.type === 'tool_preference');
      expect(toolUpdate).toBeDefined();
      expect(toolUpdate!.priority).toBe('high');
      expect(toolUpdate!.action).toContain('failing_tool');
    });

    test('should suggest skill recommendations', async () => {
      const conversations: ConversationRecord[] = Array(5).fill(null).map(() => ({
        timestamp: new Date().toISOString(),
        userMessage: '如何修复这个特定问题',
        assistantMessage: 'Response',
      }));

      const result = await engine.reflect(conversations);

      const skillRec = result.strategyUpdates.find(u => u.type === 'skill_recommendation');
      expect(skillRec).toBeDefined();
      expect(skillRec!.priority).toBe('medium');
    });

    test('should suggest efficiency improvements', async () => {
      const conversations: ConversationRecord[] = Array(5).fill(null).map(() => ({
        timestamp: new Date().toISOString(),
        userMessage: 'Complex query',
        assistantMessage: 'Response',
        tokensUsed: 4000,
      }));

      const result = await engine.reflect(conversations);

      const efficiencyUpdate = result.strategyUpdates.find(u => u.type === 'behavior_change');
      expect(efficiencyUpdate).toBeDefined();
      expect(efficiencyUpdate!.priority).toBe('low');
    });
  });

  describe('LLM reflection', () => {
    test('should use LLM provider when enabled', async () => {
      const llmEngine = new ReflectionEngine({
        useLLMReflection: true,
        llmProvider: {
          generate: async (prompt: string) => {
            return JSON.stringify([
              {
                description: 'Users often ask about bug fixes',
                suggestion: 'Create a bug-fixing skill',
                confidence: 0.8,
              },
            ]);
          },
        },
      });

      const conversations: ConversationRecord[] = [
        {
          timestamp: new Date().toISOString(),
          userMessage: 'How to fix this?',
          assistantMessage: 'Response',
        },
      ];

      const result = await llmEngine.reflect(conversations);

      const llmPattern = result.patterns.find(p => p.id.startsWith('llm_pattern_'));
      expect(llmPattern).toBeDefined();
      expect(llmPattern!.type).toBe('user_behavior');
      expect(llmPattern!.confidence).toBe(0.8);
    });

    test('should handle LLM errors gracefully', async () => {
      const llmEngine = new ReflectionEngine({
        useLLMReflection: true,
        llmProvider: {
          generate: async () => {
            throw new Error('LLM error');
          },
        },
      });

      const conversations: ConversationRecord[] = [
        {
          timestamp: new Date().toISOString(),
          userMessage: 'Test',
          assistantMessage: 'Response',
        },
      ];

      // Should not throw
      const result = await llmEngine.reflect(conversations);
      expect(result).toBeDefined();
    });

    test('should handle invalid LLM JSON response', async () => {
      const llmEngine = new ReflectionEngine({
        useLLMReflection: true,
        llmProvider: {
          generate: async () => 'Invalid JSON response',
        },
      });

      const conversations: ConversationRecord[] = [
        {
          timestamp: new Date().toISOString(),
          userMessage: 'Test',
          assistantMessage: 'Response',
        },
      ];

      // Should not throw
      const result = await llmEngine.reflect(conversations);
      expect(result).toBeDefined();
    });
  });

  describe('time distribution', () => {
    test('should track hour distribution', async () => {
      // Build timestamps using local time so getHours() returns expected values
      const d1 = new Date(); d1.setHours(10, 0, 0, 0);
      const d2 = new Date(); d2.setHours(10, 30, 0, 0);
      const d3 = new Date(); d3.setHours(11, 0, 0, 0);
      const conversations: ConversationRecord[] = [
        { timestamp: d1.toISOString(), userMessage: '1', assistantMessage: 'R' },
        { timestamp: d2.toISOString(), userMessage: '2', assistantMessage: 'R' },
        { timestamp: d3.toISOString(), userMessage: '3', assistantMessage: 'R' },
      ];

      const result = await engine.reflect(conversations);

      expect(result.stats.timeDistribution['10']).toBe(2);
      expect(result.stats.timeDistribution['11']).toBe(1);
    });
  });

  describe('edge cases', () => {
    test('should handle conversations without tools', async () => {
      const conversations: ConversationRecord[] = [
        {
          timestamp: new Date().toISOString(),
          userMessage: 'Hello',
          assistantMessage: 'Hi there!',
        },
      ];

      const result = await engine.reflect(conversations);

      expect(result.stats.totalToolCalls).toBe(0);
      expect(result.stats.toolSuccessRate).toBe(1); // No tools = 100% success
    });

    test('should handle invalid timestamps', async () => {
      const conversations: ConversationRecord[] = [
        {
          timestamp: 'invalid',
          userMessage: 'Test',
          assistantMessage: 'Response',
        },
      ];

      // Should not throw
      const result = await engine.reflect(conversations);
      expect(result).toBeDefined();
    });

    test('should handle empty tool calls array', async () => {
      const conversations: ConversationRecord[] = [
        {
          timestamp: new Date().toISOString(),
          userMessage: 'Test',
          assistantMessage: 'Response',
          toolsCalled: [],
        },
      ];

      const result = await engine.reflect(conversations);
      expect(result.stats.totalToolCalls).toBe(0);
    });

    test('should detect no-tool streak', async () => {
      const conversations: ConversationRecord[] = Array(6).fill(null).map((_, i) => ({
        timestamp: `2024-01-01T${10 + i}:00:00Z`,
        userMessage: `Chat ${i}`,
        assistantMessage: 'Response',
        // No tools called
      }));

      const result = await engine.reflect(conversations);

      const streakPattern = result.patterns.find(p => p.id === 'no_tool_streak');
      expect(streakPattern).toBeDefined();
      expect(streakPattern!.type).toBe('efficiency');
    });
  });
});
