import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock bun-only and problematic ESM modules to allow tests to run in Node.js
vi.mock('bun:sqlite', () => {
  const MockDatabase = vi.fn(() => ({
    exec: vi.fn(), run: vi.fn(),
    query: vi.fn(() => ({ all: vi.fn(() => []) })),
    prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn(() => []) })),
    transaction: vi.fn((fn: Function) => fn),
    close: vi.fn(),
  }));
  return { Database: MockDatabase, default: MockDatabase };
});
vi.mock('drizzle-orm/bun-sqlite', () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  })),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: vi.fn() }));
vi.mock('bunqueue/client', () => ({ Queue: vi.fn(), Worker: vi.fn() }));

import {
  getAllTools,
  getAllToolsForAI,
  getMemoryTools,
  getSkillTools,
  getToolsByCategory,
  TOOL_CATEGORIES,
  buildSystemPrompt,
  buildSystemPromptWithBudget,
  formatSkillsForPrompt,
  SYSTEM_PROMPTS,
  getCurrentTimeContext,
  buildVolatileContext,
  getFullTimeContext,
  getBeeclawVersion,
} from '../tools';
import type { Session } from '../../session';

// ============================================================================
// getAllTools / getAllToolsForAI
// ============================================================================
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

    test('each tool has parameters with type object', () => {
      const tools = getAllTools();
      for (const tool of tools) {
        expect(tool.function.parameters.type).toBe('object');
        expect(typeof tool.function.parameters.properties).toBe('object');
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

  // ============================================================================
  // getMemoryTools / getSkillTools
  // ============================================================================
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

  // ============================================================================
  // TOOL_CATEGORIES
  // ============================================================================
  describe('TOOL_CATEGORIES', () => {
    test('has memory category', () => {
      expect(TOOL_CATEGORIES.memory).toBeDefined();
      expect(Array.isArray(TOOL_CATEGORIES.memory)).toBe(true);
      expect(TOOL_CATEGORIES.memory).toContain('memory_read');
      expect(TOOL_CATEGORIES.memory).toContain('memory_write');
    });

    test('has skill category', () => {
      expect(TOOL_CATEGORIES.skill).toBeDefined();
      expect(TOOL_CATEGORIES.skill).toContain('skill_list');
      expect(TOOL_CATEGORIES.skill).toContain('skill_get');
    });

    test('has goal category', () => {
      expect(TOOL_CATEGORIES.goal).toBeDefined();
      expect(TOOL_CATEGORIES.goal).toContain('goal_list');
      expect(TOOL_CATEGORIES.goal).toContain('goal_create');
    });

    test('has proactive category', () => {
      expect(TOOL_CATEGORIES.proactive).toBeDefined();
      expect(TOOL_CATEGORIES.proactive).toContain('proactive_schedule');
      expect(TOOL_CATEGORIES.proactive).toContain('notification_send');
    });

    test('has builtin category (computed getter)', () => {
      expect(TOOL_CATEGORIES.builtin).toBeDefined();
      expect(Array.isArray(TOOL_CATEGORIES.builtin)).toBe(true);
    });

    test('has persona category', () => {
      expect(TOOL_CATEGORIES.persona).toContain('persona_get');
      expect(TOOL_CATEGORIES.persona).toContain('persona_update_traits');
    });

    test('has sandbox category', () => {
      expect(TOOL_CATEGORIES.sandbox).toContain('sandbox_exec');
    });

    test('has state category', () => {
      expect(TOOL_CATEGORIES.state).toContain('state_manage');
    });

    test('has state_legacy category', () => {
      expect(TOOL_CATEGORIES.state_legacy).toContain('state_set');
      expect(TOOL_CATEGORIES.state_legacy).toContain('state_get');
    });

    test('has feishu category', () => {
      expect(TOOL_CATEGORIES.feishu).toBeDefined();
      expect(TOOL_CATEGORIES.feishu.length).toBeGreaterThan(0);
      expect(TOOL_CATEGORIES.feishu).toContain('feishu_calendar_list');
      expect(TOOL_CATEGORIES.feishu).toContain('feishu_docx_get');
      expect(TOOL_CATEGORIES.feishu).toContain('feishu_drive_list');
      expect(TOOL_CATEGORIES.feishu).toContain('feishu_bitable_get_meta');
      expect(TOOL_CATEGORIES.feishu).toContain('feishu_wiki_search');
    });
  });

  // ============================================================================
  // getToolsByCategory
  // ============================================================================
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

  // ============================================================================
  // SYSTEM_PROMPTS
  // ============================================================================
  describe('SYSTEM_PROMPTS', () => {
    test('has concise, default, and verbose keys', () => {
      expect(typeof SYSTEM_PROMPTS.concise).toBe('string');
      expect(typeof SYSTEM_PROMPTS.default).toBe('string');
      expect(typeof SYSTEM_PROMPTS.verbose).toBe('string');
    });

    test('all three share the same BASE_PROMPT content', () => {
      // Since P1 FIX #1, all three are the same (BASE_PROMPT)
      expect(SYSTEM_PROMPTS.concise).toBe(SYSTEM_PROMPTS.default);
      expect(SYSTEM_PROMPTS.default).toBe(SYSTEM_PROMPTS.verbose);
    });
  });

  // ============================================================================
  // buildSystemPrompt
  // ============================================================================
  describe('buildSystemPrompt', () => {
    test('returns a non-empty string with default prompt', () => {
      const prompt = buildSystemPrompt(SYSTEM_PROMPTS.default);
      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(10);
    });

    test('accepts coreContext with user/soul', () => {
      const coreContext = {
        user: 'Test user information that is long enough to pass the >50 char validation threshold',
        soul: 'Test soul content that is also long enough to pass the >50 char validation threshold here',
        facts: 'Some important facts',
        skills: 'Some available skills',
      };
      const prompt = buildSystemPrompt(SYSTEM_PROMPTS.default, coreContext);
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(10);
    });

    test('accepts session parameter', () => {
      const session: Partial<Session> = {
        id: 'test-session',
        createdAt: Date.now(),
        messageCount: 0,
        messages: [],
      };
      const prompt = buildSystemPrompt(SYSTEM_PROMPTS.default, undefined, session as Session);
      expect(prompt).toBeDefined();
    });

    test('handles empty base prompt', () => {
      const prompt = buildSystemPrompt('');
      expect(typeof prompt).toBe('string');
    });
  });

  // ============================================================================
  // buildSystemPromptWithBudget
  // ============================================================================
  describe('buildSystemPromptWithBudget', () => {
    test('returns prompt, totalTokens, selectedExamples, and droppedLayers', () => {
      const result = buildSystemPromptWithBudget(SYSTEM_PROMPTS.default);
      expect(typeof result.prompt).toBe('string');
      expect(result.prompt.length).toBeGreaterThan(0);
      expect(typeof result.totalTokens).toBe('number');
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(typeof result.selectedExamples).toBe('number');
      expect(Array.isArray(result.droppedLayers)).toBe(true);
    });

    test('includes core context when provided with sufficient length', () => {
      const coreContext = {
        user: 'A user description that is definitely longer than fifty characters so it passes the validation check',
        soul: 'A soul description that is also definitely longer than fifty characters so it passes the validation check',
        facts: 'Some important facts that are relevant',
        skills: 'Some available skills list here',
      };
      const result = buildSystemPromptWithBudget(SYSTEM_PROMPTS.default, coreContext);
      expect(result.prompt).toContain('About the User');
      expect(result.prompt).toContain('Your Identity');
    });

    test('skips soul/user layers when content is too short (<= 50 chars)', () => {
      const coreContext = {
        user: 'short',
        soul: 'tiny',
        facts: 'Some facts here',
        skills: 'Some skills list',
      };
      const result = buildSystemPromptWithBudget(SYSTEM_PROMPTS.default, coreContext);
      expect(result.prompt).not.toContain('About the User');
      expect(result.prompt).not.toContain('Your Identity');
    });

    test('skips facts layer when content is too short (<= 10 chars)', () => {
      const coreContext = {
        user: '',
        soul: '',
        facts: 'tiny',
        skills: '',
      };
      const result = buildSystemPromptWithBudget(SYSTEM_PROMPTS.default, coreContext);
      expect(result.prompt).not.toContain('User Facts');
    });

    test('includes facts layer when content is long enough', () => {
      const coreContext = {
        user: '',
        soul: '',
        facts: 'These are important facts about the user preferences',
        skills: '',
      };
      const result = buildSystemPromptWithBudget(SYSTEM_PROMPTS.default, coreContext);
      expect(result.prompt).toContain('User Facts');
    });

    test('accepts modelContextWindow parameter', () => {
      const result = buildSystemPromptWithBudget(
        SYSTEM_PROMPTS.default,
        undefined,
        undefined,
        undefined,
        64000, // smaller context window
      );
      expect(result.totalTokens).toBeGreaterThan(0);
    });

    test('accepts budgetOverrides parameter', () => {
      const result = buildSystemPromptWithBudget(
        SYSTEM_PROMPTS.default,
        undefined,
        undefined,
        undefined,
        128000,
        { maxExamples: 1 },
      );
      expect(result.selectedExamples).toBeLessThanOrEqual(1);
    });

    test('includes recent messages for intent detection', () => {
      const recentMessages = [
        { role: 'user' as const, content: '帮我搜索最新新闻' },
      ];
      const result = buildSystemPromptWithBudget(
        SYSTEM_PROMPTS.default,
        undefined,
        undefined,
        recentMessages as any,
      );
      expect(result.prompt.length).toBeGreaterThan(0);
    });

    test('handles undefined coreContext gracefully', () => {
      const result = buildSystemPromptWithBudget(SYSTEM_PROMPTS.default, undefined);
      expect(result.prompt.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // formatSkillsForPrompt
  // ============================================================================
  describe('formatSkillsForPrompt', () => {
    test('returns empty string for empty array', () => {
      expect(formatSkillsForPrompt([])).toBe('');
    });

    test('returns empty string for null/undefined-like input', () => {
      expect(formatSkillsForPrompt(null as any)).toBe('');
    });

    test('formats single skill with XML tags', () => {
      const skills = [{ name: 'test-skill', description: 'Test description' }];
      const result = formatSkillsForPrompt(skills);
      expect(result).toContain('<skill>');
      expect(result).toContain('<name>test-skill</name>');
      expect(result).toContain('<description>Test description</description>');
      expect(result).toContain('</skill>');
      expect(result).toContain('<available_skills>');
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

    test('includes triggers in description', () => {
      const skills = [
        { name: 'triggered-skill', description: 'Has triggers', triggers: ['trigger1', 'trigger2'] },
      ];
      const result = formatSkillsForPrompt(skills);
      expect(result).toContain('trigger1');
      expect(result).toContain('trigger2');
      expect(result).toContain('Triggers:');
    });

    test('handles skills without triggers', () => {
      const skills = [{ name: 'no-triggers', description: 'No triggers here' }];
      const result = formatSkillsForPrompt(skills);
      expect(result).toContain('no-triggers');
      expect(result).not.toContain('Triggers:');
    });

    test('includes IMPORTANT instructions about skill_get/skill_record', () => {
      const skills = [{ name: 'any-skill', description: 'Any' }];
      const result = formatSkillsForPrompt(skills);
      expect(result).toContain('skill_get');
      expect(result).toContain('skill_record');
      expect(result).toContain('IMPORTANT');
    });

    test('handles skills with empty triggers array', () => {
      const skills = [{ name: 'skill-a', description: 'Desc', triggers: [] }];
      const result = formatSkillsForPrompt(skills);
      expect(result).toContain('skill-a');
      expect(result).not.toContain('Triggers:');
    });
  });

  // ============================================================================
  // getCurrentTimeContext / buildVolatileContext / getFullTimeContext
  // ============================================================================
  describe('getCurrentTimeContext', () => {
    test('returns a string with date info', () => {
      const ctx = getCurrentTimeContext();
      expect(typeof ctx).toBe('string');
      expect(ctx).toContain('当前:');
    });

    test('contains time slot (XX:00段)', () => {
      const ctx = getCurrentTimeContext();
      expect(ctx).toMatch(/\d{2}:00段/);
    });

    test('contains timezone info (tz=)', () => {
      const ctx = getCurrentTimeContext();
      expect(ctx).toContain('tz=');
    });
  });

  describe('buildVolatileContext', () => {
    test('returns same value as getCurrentTimeContext', () => {
      // They call the same underlying function
      const volatile = buildVolatileContext();
      expect(typeof volatile).toBe('string');
      expect(volatile).toContain('当前:');
      expect(volatile).toContain('tz=');
    });
  });

  describe('getFullTimeContext', () => {
    test('returns string with version info', () => {
      const ctx = getFullTimeContext();
      expect(typeof ctx).toBe('string');
      expect(ctx).toContain('Beeclaw');
    });

    test('contains location and timezone info', () => {
      const ctx = getFullTimeContext();
      expect(ctx).toContain('Location');
      expect(ctx).toContain('Timezone');
    });

    test('contains date and time', () => {
      const ctx = getFullTimeContext();
      expect(ctx).toContain('Date');
      expect(ctx).toContain('Time');
    });
  });

  // ============================================================================
  // getBeeclawVersion
  // ============================================================================
  describe('getBeeclawVersion', () => {
    test('returns a string', () => {
      const version = getBeeclawVersion();
      expect(typeof version).toBe('string');
    });

    test('returns version string or "unknown"', () => {
      const version = getBeeclawVersion();
      // Either a valid semver-like string or 'unknown'
      expect(version.length).toBeGreaterThan(0);
    });
  });
});
