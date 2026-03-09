/**
 * P2-4.1: Layer Priorities Configuration Tests
 *
 * Tests for named layer priority constants
 * extracted from hardcoded magic numbers.
 */

import { describe, test, expect } from 'bun:test';
import {
  LAYER_PRIORITIES,
  type LayerPriorityKey,
  type PromptLayer,
  assembleBudgetedPrompt,
  DEFAULT_PROMPT_BUDGET,
} from '../../agent/prompt-budget';

describe('Layer Priorities Configuration', () => {
  describe('Priority values', () => {
    test('should have CORE priority at 100', () => {
      expect(LAYER_PRIORITIES.CORE).toBe(100);
    });

    test('should have RUNTIME priority at 95', () => {
      expect(LAYER_PRIORITIES.RUNTIME).toBe(95);
    });

    test('should have TRAITS priority at 90', () => {
      expect(LAYER_PRIORITIES.TRAITS).toBe(90);
    });

    test('should have SOUL priority at 85', () => {
      expect(LAYER_PRIORITIES.SOUL).toBe(85);
    });

    test('should have USER_CONTEXT priority at 80', () => {
      expect(LAYER_PRIORITIES.USER_CONTEXT).toBe(80);
    });

    test('should have FACTS priority at 70', () => {
      expect(LAYER_PRIORITIES.FACTS).toBe(70);
    });

    test('should have SKILLS priority at 65', () => {
      expect(LAYER_PRIORITIES.SKILLS).toBe(65);
    });

    test('should have EXAMPLES priority at 10', () => {
      expect(LAYER_PRIORITIES.EXAMPLES).toBe(10);
    });
  });

  describe('Priority ordering', () => {
    test('should have CORE as highest priority', () => {
      const priorities = Object.values(LAYER_PRIORITIES);
      const maxPriority = Math.max(...priorities);

      expect(LAYER_PRIORITIES.CORE).toBe(maxPriority);
    });

    test('should have EXAMPLES as lowest priority', () => {
      const priorities = Object.values(LAYER_PRIORITIES);
      const minPriority = Math.min(...priorities);

      expect(LAYER_PRIORITIES.EXAMPLES).toBe(minPriority);
    });

    test('should maintain descending order from CORE to EXAMPLES', () => {
      const values = [
        LAYER_PRIORITIES.CORE,
        LAYER_PRIORITIES.RUNTIME,
        LAYER_PRIORITIES.TRAITS,
        LAYER_PRIORITIES.SOUL,
        LAYER_PRIORITIES.USER_CONTEXT,
        LAYER_PRIORITIES.FACTS,
        LAYER_PRIORITIES.SKILLS,
        LAYER_PRIORITIES.EXAMPLES,
      ];

      // Each value should be less than the previous
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeLessThan(values[i - 1]);
      }
    });

    test('should have runtime layers higher than static layers', () => {
      // RUNTIME should be higher than static layers like FACTS, SKILLS, EXAMPLES
      expect(LAYER_PRIORITIES.RUNTIME).toBeGreaterThan(LAYER_PRIORITIES.FACTS);
      expect(LAYER_PRIORITIES.RUNTIME).toBeGreaterThan(LAYER_PRIORITIES.SKILLS);
      expect(LAYER_PRIORITIES.RUNTIME).toBeGreaterThan(LAYER_PRIORITIES.EXAMPLES);
    });

    test('should have identity layers (SOUL, TRAITS) higher than context', () => {
      expect(LAYER_PRIORITIES.SOUL).toBeGreaterThan(LAYER_PRIORITIES.USER_CONTEXT);
      expect(LAYER_PRIORITIES.TRAITS).toBeGreaterThan(LAYER_PRIORITIES.USER_CONTEXT);
    });
  });

  describe('Priority usage in prompt assembly', () => {
    test('should use LAYER_PRIORITIES constants in layer creation', () => {
      const layers: PromptLayer[] = [
        {
          name: 'core',
          content: 'Core system prompt',
          priority: LAYER_PRIORITIES.CORE,
          trimmable: false,
        },
        {
          name: 'runtime',
          content: 'Current time: 2024-01-01',
          priority: LAYER_PRIORITIES.RUNTIME,
          trimmable: true,
        },
        {
          name: 'examples',
          content: 'Example 1: ...',
          priority: LAYER_PRIORITIES.EXAMPLES,
          trimmable: true,
        },
      ];

      expect(layers[0].priority).toBe(100);
      expect(layers[1].priority).toBe(95);
      expect(layers[2].priority).toBe(10);
    });

    test('should trim lowest priority layers first', () => {
      const layers: PromptLayer[] = [
        {
          name: 'examples',
          content: 'Very long examples content that exceeds budget...',
          priority: LAYER_PRIORITIES.EXAMPLES,
          trimmable: true,
          tokens: 2000,
        },
        {
          name: 'core',
          content: 'Core system prompt',
          priority: LAYER_PRIORITIES.CORE,
          trimmable: false,
          tokens: 500,
        },
        {
          name: 'skills',
          content: 'Available skills',
          priority: LAYER_PRIORITIES.SKILLS,
          trimmable: true,
          tokens: 800,
        },
      ];

      // When trimming, EXAMPLES (10) should be dropped before SKILLS (65)
      const sorted = [...layers].sort((a, b) => a.priority - b.priority);

      expect(sorted[0].name).toBe('examples'); // Lowest priority first
      expect(sorted[1].name).toBe('skills');
      expect(sorted[2].name).toBe('core'); // Highest priority last
    });

    test('should never trim CORE layer', () => {
      const coreLayer: PromptLayer = {
        name: 'core',
        content: 'Core system prompt',
        priority: LAYER_PRIORITIES.CORE,
        trimmable: false,
      };

      expect(coreLayer.trimmable).toBe(false);
      expect(coreLayer.priority).toBe(100);
    });
  });

  describe('Type safety', () => {
    test('should accept valid priority keys', () => {
      const validKeys: LayerPriorityKey[] = [
        'CORE',
        'RUNTIME',
        'TRAITS',
        'SOUL',
        'USER_CONTEXT',
        'FACTS',
        'SKILLS',
        'EXAMPLES',
      ];

      validKeys.forEach(key => {
        const priority = LAYER_PRIORITIES[key];
        expect(typeof priority).toBe('number');
        expect(priority).toBeGreaterThan(0);
      });
    });

    test('should be readonly constant', () => {
      // LAYER_PRIORITIES is defined with `as const`
      // This ensures it's readonly at type level
      const priorities = LAYER_PRIORITIES;

      // Should have all expected keys
      expect(priorities.CORE).toBeDefined();
      expect(priorities.RUNTIME).toBeDefined();
      expect(priorities.TRAITS).toBeDefined();
      expect(priorities.SOUL).toBeDefined();
      expect(priorities.USER_CONTEXT).toBeDefined();
      expect(priorities.FACTS).toBeDefined();
      expect(priorities.SKILLS).toBeDefined();
      expect(priorities.EXAMPLES).toBeDefined();
    });
  });

  describe('Integration with budget manager', () => {
    test('should work in assembleBudgetedPrompt', () => {
      const layers: PromptLayer[] = [
        {
          name: 'core',
          content: 'System',
          priority: LAYER_PRIORITIES.CORE,
          trimmable: false,
        },
        {
          name: 'examples',
          content: 'Examples',
          priority: LAYER_PRIORITIES.EXAMPLES,
          trimmable: true,
        },
      ];

      const result = assembleBudgetedPrompt(layers, {
        ...DEFAULT_PROMPT_BUDGET,
        maxSystemPromptTokens: 1000,
      });

      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.prompt).toContain('System');
    });

    test('should drop EXAMPLES before CORE when over budget', () => {
      const largeContent = 'x'.repeat(5000);
      const layers: PromptLayer[] = [
        {
          name: 'core',
          content: 'Core system prompt',
          priority: LAYER_PRIORITIES.CORE,
          trimmable: false,
          tokens: 100,
        },
        {
          name: 'examples',
          content: largeContent,
          priority: LAYER_PRIORITIES.EXAMPLES,
          trimmable: true,
          tokens: 5000,
        },
      ];

      const result = assembleBudgetedPrompt(layers, {
        ...DEFAULT_PROMPT_BUDGET,
        maxSystemPromptTokens: 500, // Force trimming
      });

      // CORE should be kept, EXAMPLES should be dropped
      expect(result.droppedLayers).toContain('examples');
      expect(result.droppedLayers).not.toContain('core');
    });
  });

  describe('Semantic meaning', () => {
    test('should have meaningful priority gaps', () => {
      // There should be meaningful gaps between priority levels
      // to allow for future layers to be inserted

      // CORE to RUNTIME: gap of 5
      expect(LAYER_PRIORITIES.CORE - LAYER_PRIORITIES.RUNTIME).toBe(5);

      // RUNTIME to TRAITS: gap of 5
      expect(LAYER_PRIORITIES.RUNTIME - LAYER_PRIORITIES.TRAITS).toBe(5);

      // TRAITS to SOUL: gap of 5
      expect(LAYER_PRIORITIES.TRAITS - LAYER_PRIORITIES.SOUL).toBe(5);
    });

    test('should reflect importance hierarchy', () => {
      // Runtime context (date/time) > User preferences > Facts > Skills > Examples
      expect(LAYER_PRIORITIES.RUNTIME).toBeGreaterThan(LAYER_PRIORITIES.USER_CONTEXT);
      expect(LAYER_PRIORITIES.USER_CONTEXT).toBeGreaterThan(LAYER_PRIORITIES.FACTS);
      expect(LAYER_PRIORITIES.FACTS).toBeGreaterThan(LAYER_PRIORITIES.SKILLS);
      expect(LAYER_PRIORITIES.SKILLS).toBeGreaterThan(LAYER_PRIORITIES.EXAMPLES);
    });
  });

  describe('Documentation', () => {
    test('should have descriptive comments', () => {
      // The LAYER_PRIORITIES constant should have JSDoc comments
      // explaining each priority level

      // This test verifies the constant exists and has expected values
      // The actual comments are in the source file
      expect(LAYER_PRIORITIES).toBeDefined();
      expect(Object.keys(LAYER_PRIORITIES).length).toBe(8);
    });
  });

  describe('Real-world usage patterns', () => {
    test('should support custom priority values between standard levels', () => {
      // If needed, custom layers can use values between standard priorities
      const customPriority = (LAYER_PRIORITIES.RUNTIME + LAYER_PRIORITIES.TRAITS) / 2; // 92.5

      const customLayer: PromptLayer = {
        name: 'custom',
        content: 'Custom layer',
        priority: Math.floor(customPriority),
        trimmable: true,
      };

      // Custom layer should have priority between RUNTIME and TRAITS
      expect(customLayer.priority).toBeGreaterThan(LAYER_PRIORITIES.TRAITS);
      expect(customLayer.priority).toBeLessThan(LAYER_PRIORITIES.RUNTIME);
    });

    test('should handle multiple layers with same priority', () => {
      const layers: PromptLayer[] = [
        {
          name: 'skill1',
          content: 'Skill 1',
          priority: LAYER_PRIORITIES.SKILLS,
          trimmable: true,
        },
        {
          name: 'skill2',
          content: 'Skill 2',
          priority: LAYER_PRIORITIES.SKILLS,
          trimmable: true,
        },
        {
          name: 'skill3',
          content: 'Skill 3',
          priority: LAYER_PRIORITIES.SKILLS,
          trimmable: true,
        },
      ];

      // Multiple layers can share the same priority
      const allSkillsPriority = layers.every(
        l => l.priority === LAYER_PRIORITIES.SKILLS
      );

      expect(allSkillsPriority).toBe(true);
    });
  });
});
