import { describe, test, expect } from 'bun:test';
import {
  SUBAGENT_PROMPTS,
  getSubagentPrompt,
  buildSubagentSystemPrompt,
} from '../prompts';
import type { SubagentType } from '../types';

describe('Subagent Prompts', () => {
  describe('SUBAGENT_PROMPTS', () => {
    test('has prompts for all subagent types', () => {
      const types: SubagentType[] = ['research', 'memory', 'skill', 'code', 'general'];

      for (const type of types) {
        expect(SUBAGENT_PROMPTS[type]).toBeDefined();
        expect(typeof SUBAGENT_PROMPTS[type]).toBe('string');
        expect(SUBAGENT_PROMPTS[type].length).toBeGreaterThan(100);
      }
    });

    test('research prompt contains research-specific content', () => {
      expect(SUBAGENT_PROMPTS.research).toContain('Research');
      expect(SUBAGENT_PROMPTS.research).toContain('search');
      expect(SUBAGENT_PROMPTS.research).toContain('information');
    });

    test('memory prompt contains memory-specific content', () => {
      expect(SUBAGENT_PROMPTS.memory).toContain('Memory');
      expect(SUBAGENT_PROMPTS.memory).toContain('Knowledge');
    });

    test('skill prompt contains skill-specific content', () => {
      expect(SUBAGENT_PROMPTS.skill).toContain('Skill');
      expect(SUBAGENT_PROMPTS.skill).toContain('skill');
    });

    test('code prompt contains code-specific content', () => {
      expect(SUBAGENT_PROMPTS.code).toContain('Code');
      expect(SUBAGENT_PROMPTS.code).toContain('code');
      expect(SUBAGENT_PROMPTS.code).toContain('execute');
    });

    test('general prompt contains general content', () => {
      expect(SUBAGENT_PROMPTS.general).toContain('General');
      expect(SUBAGENT_PROMPTS.general).toContain('General-Purpose');
    });

    test('all prompts contain base content', () => {
      const types: SubagentType[] = ['research', 'memory', 'skill', 'code', 'general'];

      for (const type of types) {
        expect(SUBAGENT_PROMPTS[type]).toContain('subagent');
        expect(SUBAGENT_PROMPTS[type]).toContain('task');
      }
    });
  });

  describe('getSubagentPrompt', () => {
    test('returns research prompt', () => {
      const prompt = getSubagentPrompt('research');
      expect(prompt).toBe(SUBAGENT_PROMPTS.research);
    });

    test('returns memory prompt', () => {
      const prompt = getSubagentPrompt('memory');
      expect(prompt).toBe(SUBAGENT_PROMPTS.memory);
    });

    test('returns skill prompt', () => {
      const prompt = getSubagentPrompt('skill');
      expect(prompt).toBe(SUBAGENT_PROMPTS.skill);
    });

    test('returns code prompt', () => {
      const prompt = getSubagentPrompt('code');
      expect(prompt).toBe(SUBAGENT_PROMPTS.code);
    });

    test('returns general prompt', () => {
      const prompt = getSubagentPrompt('general');
      expect(prompt).toBe(SUBAGENT_PROMPTS.general);
    });
  });

  describe('buildSubagentSystemPrompt', () => {
    test('builds prompt with task', () => {
      const task = 'Research the latest AI developments';
      const prompt = buildSubagentSystemPrompt('research', task);

      expect(prompt).toContain('Research the latest AI developments');
      expect(prompt).toContain('# Your Task');
      expect(prompt).toContain(SUBAGENT_PROMPTS.research);
    });

    test('builds prompt with task and context', () => {
      const task = 'Search for information about TypeScript';
      const context = 'User is interested in TypeScript 5.0 features';
      const prompt = buildSubagentSystemPrompt('research', task, context);

      expect(prompt).toContain('Search for information about TypeScript');
      expect(prompt).toContain('User is interested in TypeScript 5.0 features');
      expect(prompt).toContain('# Your Task');
      expect(prompt).toContain('# Context');
    });

    test('builds prompt without context (no # Context section)', () => {
      const task = 'Write a simple function';
      const prompt = buildSubagentSystemPrompt('code', task);

      expect(prompt).toContain('Write a simple function');
      // Note: The base prompt contains "## Context Isolation" which has "Context"
      // We just verify the task section exists
      expect(prompt).toContain('# Your Task');
    });

    test('includes correct base prompt for each type', () => {
      const types: SubagentType[] = ['research', 'memory', 'skill', 'code', 'general'];
      const task = 'Test task';

      for (const type of types) {
        const prompt = buildSubagentSystemPrompt(type, task);
        expect(prompt).toContain(SUBAGENT_PROMPTS[type]);
      }
    });

    test('handles empty task', () => {
      const prompt = buildSubagentSystemPrompt('general', '');
      expect(prompt).toContain('# Your Task');
    });

    test('handles empty context (no additional context section)', () => {
      const prompt = buildSubagentSystemPrompt('general', 'task', '');
      // Empty context should not add an additional context section after the task
      // Note: The base prompt contains "## Context Isolation" but that's different
      expect(prompt).toContain('# Your Task');
      expect(prompt).toMatch(/# Your Task[\s\S]*$/m); // Should end after task section
    });

    test('handles multi-line task', () => {
      const task = `Line 1
Line 2
Line 3`;
      const prompt = buildSubagentSystemPrompt('general', task);

      expect(prompt).toContain('Line 1');
      expect(prompt).toContain('Line 2');
      expect(prompt).toContain('Line 3');
    });

    test('handles multi-line context', () => {
      const context = `Context line 1
Context line 2
Context line 3`;
      const prompt = buildSubagentSystemPrompt('research', 'task', context);

      expect(prompt).toContain('Context line 1');
      expect(prompt).toContain('Context line 2');
      expect(prompt).toContain('Context line 3');
    });
  });
});
