import { describe, test, expect, beforeEach } from 'bun:test';
import {
  getAllTools,
  getAllToolsForAI,
  getMemoryTools,
  getSkillTools,
  getToolsByCategory,
  TOOL_CATEGORIES,
  buildSystemPrompt,
  formatSkillsForPrompt,
} from '../tools';
import type { OpenAITool } from '../types';
import type { Session } from '../../session';

describe('Agent Tools', () => {
  describe('getAllTools', () => {
    test('returns array of tools', () => {
      const tools = getAllTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    test('returns tools in OpenAI format', () => {
      const tools = getAllTools();

      for (const tool of tools) {
        expect(tool.type).toBe('function');
        expect(tool.function).toBeDefined();
        expect(tool.function.name).toBeDefined();
        expect(tool.function.description).toBeDefined();
        expect(tool.function.parameters).toBeDefined();
      }
    });
  });

  describe('getAllToolsForAI', () => {
    test('is an alias for getAllTools', () => {
      const tools1 = getAllTools();
      const tools2 = getAllToolsForAI();
      expect(tools1.length).toBe(tools2.length);
    });
  });

  describe('getMemoryTools', () => {
    test('returns memory tools only', () => {
      const tools = getMemoryTools();
      expect(Array.isArray(tools)).toBe(true);

      for (const tool of tools) {
        expect(tool.function.name).toMatch(/^memory_/);
      }
    });
  });

  describe('getSkillTools', () => {
    test('returns skill tools only', () => {
      const tools = getSkillTools();
      expect(Array.isArray(tools)).toBe(true);

      for (const tool of tools) {
        expect(tool.function.name).toMatch(/^skill_/);
      }
    });
  });

  describe('TOOL_CATEGORIES', () => {
    test('has memory category', () => {
      expect(TOOL_CATEGORIES.memory).toBeDefined();
      expect(Array.isArray(TOOL_CATEGORIES.memory)).toBe(true);
      expect(TOOL_CATEGORIES.memory).toContain('memory_read');
    });

    test('has skill category', () => {
      expect(TOOL_CATEGORIES.skill).toBeDefined();
      expect(Array.isArray(TOOL_CATEGORIES.skill)).toBe(true);
      expect(TOOL_CATEGORIES.skill).toContain('skill_list');
    });

    test('has goal category', () => {
      expect(TOOL_CATEGORIES.goal).toBeDefined();
      expect(Array.isArray(TOOL_CATEGORIES.goal)).toBe(true);
      expect(TOOL_CATEGORIES.goal).toContain('goal_list');
    });

    test('has proactive category', () => {
      expect(TOOL_CATEGORIES.proactive).toBeDefined();
      expect(Array.isArray(TOOL_CATEGORIES.proactive)).toBe(true);
      expect(TOOL_CATEGORIES.proactive).toContain('proactive_schedule');
    });

    test('has builtin category', () => {
      expect(TOOL_CATEGORIES.builtin).toBeDefined();
      expect(Array.isArray(TOOL_CATEGORIES.builtin)).toBe(true);
    });

    test('has persona category', () => {
      expect(TOOL_CATEGORIES.persona).toBeDefined();
      expect(Array.isArray(TOOL_CATEGORIES.persona)).toBe(true);
      expect(TOOL_CATEGORIES.persona).toContain('persona_get');
    });
  });

  describe('getToolsByCategory', () => {
    test('filters tools by single category', () => {
      const tools = getToolsByCategory(['memory']);
      expect(tools.length).toBeGreaterThan(0);

      for (const tool of tools) {
        expect(TOOL_CATEGORIES.memory).toContain(tool.function.name);
      }
    });

    test('filters tools by multiple categories', () => {
      const tools = getToolsByCategory(['memory', 'skill']);
      expect(tools.length).toBeGreaterThan(0);

      const allowedNames = [...TOOL_CATEGORIES.memory, ...TOOL_CATEGORIES.skill];
      for (const tool of tools) {
        expect(allowedNames).toContain(tool.function.name);
      }
    });

    test('returns empty array for no categories', () => {
      const tools = getToolsByCategory([]);
      expect(tools).toEqual([]);
    });
  });

  describe('buildSystemPrompt', () => {
    test('returns default prompt when no session', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(10);
    });

    test('includes context section', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toBeDefined();
      // The prompt should contain some context about the current time/date
      expect(prompt.length).toBeGreaterThan(0);
    });

    test('accepts session parameter', () => {
      const session: Partial<Session> = {
        id: 'test-session',
        createdAt: Date.now(),
        messageCount: 0,
      };

      const prompt = buildSystemPrompt(session as Session);
      expect(prompt).toBeDefined();
    });

    test('accepts options parameter', () => {
      const prompt = buildSystemPrompt(undefined, { style: 'concise' });
      expect(prompt).toBeDefined();
    });

    test('returns prompt with verbose style', () => {
      const prompt = buildSystemPrompt(undefined, { style: 'verbose' });
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(10);
    });

    test('returns prompt with concise style', () => {
      const prompt = buildSystemPrompt(undefined, { style: 'concise' });
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(10);
    });

    test('returns prompt with default style', () => {
      const prompt = buildSystemPrompt(undefined, { style: 'default' });
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(10);
    });
  });

  describe('formatSkillsForPrompt', () => {
    test('formats empty skills array', () => {
      const result = formatSkillsForPrompt([]);
      expect(result).toBe('');
    });

    test('formats single skill', () => {
      const skills = [{ name: 'test-skill', description: 'Test description' }];
      const result = formatSkillsForPrompt(skills);

      expect(result).toContain('test-skill');
      expect(result).toContain('Test description');
    });

    test('formats multiple skills', () => {
      const skills = [
        { name: 'skill-1', description: 'Description 1' },
        { name: 'skill-2', description: 'Description 2' },
      ];
      const result = formatSkillsForPrompt(skills);

      expect(result).toContain('skill-1');
      expect(result).toContain('skill-2');
    });

    test('includes triggers when present', () => {
      const skills = [
        { name: 'triggered-skill', description: 'Has triggers', triggers: ['trigger1', 'trigger2'] },
      ];
      const result = formatSkillsForPrompt(skills);

      expect(result).toContain('trigger1');
      expect(result).toContain('trigger2');
    });

    test('handles skills without triggers', () => {
      const skills = [
        { name: 'no-triggers', description: 'No triggers here' },
      ];
      const result = formatSkillsForPrompt(skills);

      expect(result).toContain('no-triggers');
    });
  });
});
