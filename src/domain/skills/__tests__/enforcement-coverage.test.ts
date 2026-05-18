import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockGetSkillStore: vi.fn(),
}));

vi.mock('../store', () => ({
  getSkillStore: mocks.mockGetSkillStore,
}));

vi.mock('../../../infra/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

import { SkillEnforcementEngine } from '../enforcement';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-1',
    name: 'test-skill',
    description: 'A test skill',
    tools: ['web_search', 'memory_read'],
    examples: ['example 1'],
    ...overrides,
  };
}

describe('SkillEnforcementEngine coverage', () => {
  let engine: SkillEnforcementEngine;
  const mockLogger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new SkillEnforcementEngine({}, mockLogger);
  });

  // ========================================================================
  // matchSkillsForQuery - store is null
  // ========================================================================
  describe('matchSkillsForQuery - store is null', () => {
    it('should return not matched when store is null', () => {
      mocks.mockGetSkillStore.mockReturnValue(null);
      const result = engine.matchSkillsForQuery('some query');
      expect(result.matched).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.directive).toBe('');
    });
  });

  // ========================================================================
  // matchSkillsForQuery - skills found (lines 122-130, 139-169)
  // ========================================================================
  describe('matchSkillsForQuery - skills found', () => {
    it('should return matched result with directive when skills are found', () => {
      const skill1 = makeSkill({ id: 'sk1', name: 'Research Skill', tools: ['web_search'] });
      const skill2 = makeSkill({ id: 'sk2', name: 'Memory Skill', tools: [] });
      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => [skill1, skill2]),
        get: vi.fn(),
      });

      const result = engine.matchSkillsForQuery('search the web');
      expect(result.matched).toBe(true);
      expect(result.skills).toHaveLength(2);
      expect(result.skills[0].skill).toBe(skill1);
      expect(result.skills[0].score).toBe(1);
      expect(result.skills[0].matchedOn).toEqual(['Research Skill']);

      // Directive should contain skill info
      expect(result.directive).toContain('<skill-enforcement>');
      expect(result.directive).toContain('Research Skill');
      expect(result.directive).toContain('sk1');
      expect(result.directive).toContain('Required tools');
      expect(result.directive).toContain('web_search');
      expect(result.directive).toContain('ENFORCEMENT RULES');
      expect(result.directive).toContain('OUTPUT REQUIREMENTS');
      expect(result.directive).toContain('</skill-enforcement>');

      // Logger should be called
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Matched 2 skill(s)'),
      );
    });

    it('should not include Required tools line when skill has no tools', () => {
      const skill = makeSkill({ tools: [] });
      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => [skill]),
        get: vi.fn(),
      });

      const result = engine.matchSkillsForQuery('query');
      expect(result.directive).not.toContain('Required tools');
    });

    it('should not include Required tools when tools is undefined', () => {
      const skill = makeSkill({ tools: undefined });
      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => [skill]),
        get: vi.fn(),
      });

      const result = engine.matchSkillsForQuery('query');
      expect(result.directive).not.toContain('Required tools');
    });

    it('should limit to maxRecommendations', () => {
      const skills = [
        makeSkill({ id: 'sk1', name: 'S1' }),
        makeSkill({ id: 'sk2', name: 'S2' }),
        makeSkill({ id: 'sk3', name: 'S3' }),
        makeSkill({ id: 'sk4', name: 'S4' }),
      ];
      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => skills),
        get: vi.fn(),
      });

      // Default maxRecommendations is 3
      const result = engine.matchSkillsForQuery('query');
      expect(result.skills).toHaveLength(3);
    });
  });

  // ========================================================================
  // recordToolCall - with active traces (lines 180-184)
  // ========================================================================
  describe('recordToolCall - active trace matching', () => {
    it('should record tool call when matching an active trace', () => {
      const skill = makeSkill({ id: 'sk1', name: 'Research', tools: ['web_search', 'memory_read'] });
      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => []),
        get: vi.fn((id: string) => id === 'sk1' ? skill : null),
      });

      // Start tracking
      const traceId = engine.startSkillTracking('sk1');
      expect(traceId).not.toBe('');

      // Record a matching tool call
      engine.recordToolCall('web_search', { query: 'test' });

      const traces = engine.getTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0].toolCallsMade).toContain('web_search');
      expect(traces[0].stepsCompleted).toBe(1);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('step completed: web_search'),
      );
    });

    it('should not record tool call when tool does not match skill tools', () => {
      const skill = makeSkill({ id: 'sk1', name: 'Research', tools: ['web_search'] });
      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => []),
        get: vi.fn((id: string) => id === 'sk1' ? skill : null),
      });

      engine.startSkillTracking('sk1');
      engine.recordToolCall('memory_write', {}); // not in skill's tools

      const traces = engine.getTraces();
      expect(traces[0].toolCallsMade).toHaveLength(0);
      expect(traces[0].stepsCompleted).toBe(0);
    });

    it('should handle store returning null for skill during recordToolCall', () => {
      const skill = makeSkill({ id: 'sk1', name: 'Research', tools: ['web_search'] });
      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => []),
        get: vi.fn((id: string) => {
          // First call (startSkillTracking) returns skill, subsequent calls return null
          if (id === 'sk1') return skill;
          return null;
        }),
      });

      engine.startSkillTracking('sk1');

      // Now make get return null
      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => []),
        get: vi.fn(() => null),
      });

      // Should not throw
      engine.recordToolCall('web_search', {});
      const traces = engine.getTraces();
      expect(traces[0].stepsCompleted).toBe(0);
    });

    it('should handle skill with no tools array during recordToolCall', () => {
      const skill = makeSkill({ id: 'sk1', name: 'NoTools', tools: undefined });
      let callCount = 0;
      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => []),
        get: vi.fn((id: string) => {
          callCount++;
          if (callCount === 1) return makeSkill({ id: 'sk1', name: 'NoTools', tools: ['web_search'] });
          return makeSkill({ id: 'sk1', name: 'NoTools', tools: undefined });
        }),
      });

      engine.startSkillTracking('sk1');
      engine.recordToolCall('web_search', {});

      const traces = engine.getTraces();
      // tools is undefined so .includes check won't match
      expect(traces[0].stepsCompleted).toBe(0);
    });
  });

  // ========================================================================
  // startSkillTracking - success (lines 196-202)
  // ========================================================================
  describe('startSkillTracking - success', () => {
    it('should create trace for valid skill', () => {
      const skill = makeSkill({ id: 'sk1', name: 'Research', tools: ['web_search', 'memory_read'] });
      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => []),
        get: vi.fn(() => skill),
      });

      const traceId = engine.startSkillTracking('sk1');
      expect(traceId).toContain('sk1');

      const traces = engine.getTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0].skillId).toBe('sk1');
      expect(traces[0].skillName).toBe('Research');
      expect(traces[0].stepsExpected).toBe(2);
      expect(traces[0].stepsCompleted).toBe(0);
      expect(traces[0].toolCallsMade).toEqual([]);
      expect(traces[0].complete).toBe(false);
      expect(traces[0].issues).toEqual([]);
    });

    it('should handle skill with no tools (stepsExpected = 0)', () => {
      const skill = makeSkill({ id: 'sk2', name: 'Simple', tools: undefined });
      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => []),
        get: vi.fn(() => skill),
      });

      engine.startSkillTracking('sk2');
      const traces = engine.getTraces();
      expect(traces[0].stepsExpected).toBe(0);
    });

    it('should return empty string when store is null', () => {
      mocks.mockGetSkillStore.mockReturnValue(null);
      const traceId = engine.startSkillTracking('sk1');
      expect(traceId).toBe('');
    });
  });

  // ========================================================================
  // validateOutputCompleteness - check 3: missing tool references (lines 255-260)
  // ========================================================================
  describe('validateOutputCompleteness - missing tool references', () => {
    it('should flag missing tool references for skill with examples and tools', () => {
      const skill = makeSkill({
        name: 'Research Skill',
        tools: ['web_search', 'memory_read'],
        examples: ['example usage'],
      });

      // Long enough output but doesn't mention any tools
      const output = 'A'.repeat(300) + ' here is a long response about research';
      const issues = engine.validateOutputCompleteness(output, [skill as any]);

      const toolIssue = issues.find(i => i.includes('requires tools'));
      expect(toolIssue).toBeDefined();
      expect(toolIssue).toContain('web_search');
      expect(toolIssue).toContain('memory_read');
    });

    it('should not flag when tools are mentioned in output', () => {
      const skill = makeSkill({
        name: 'Research Skill',
        tools: ['web_search'],
        examples: ['example'],
      });

      const output = 'A'.repeat(300) + ' I used web_search to find the results';
      const issues = engine.validateOutputCompleteness(output, [skill as any]);

      const toolIssue = issues.find(i => i.includes('requires tools'));
      expect(toolIssue).toBeUndefined();
    });

    it('should not flag when skill has no examples', () => {
      const skill = makeSkill({
        name: 'No Examples Skill',
        tools: ['web_search'],
        examples: [],
      });

      const output = 'A'.repeat(300) + ' here is a response';
      const issues = engine.validateOutputCompleteness(output, [skill as any]);

      const toolIssue = issues.find(i => i.includes('requires tools'));
      expect(toolIssue).toBeUndefined();
    });

    it('should not flag when skill has examples but no tools', () => {
      const skill = makeSkill({
        name: 'Toolless Skill',
        tools: [],
        examples: ['example'],
      });

      const output = 'A'.repeat(300) + ' here is a response';
      const issues = engine.validateOutputCompleteness(output, [skill as any]);

      const toolIssue = issues.find(i => i.includes('requires tools'));
      expect(toolIssue).toBeUndefined();
    });

    it('should log when issues are found', () => {
      const skill = makeSkill({
        name: 'Test Skill',
        tools: ['special_tool'],
        examples: ['ex1'],
      });

      engine.validateOutputCompleteness('short output', [skill as any]);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Output validation found'),
        );
    });
  });

  // ========================================================================
  // clearTraces and getTraces
  // ========================================================================
  describe('trace management', () => {
    it('should clear all traces', () => {
      const skill = makeSkill();
      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => []),
        get: vi.fn(() => skill),
      });

      engine.startSkillTracking('sk1');
      expect(engine.getTraces()).toHaveLength(1);

      engine.clearTraces();
      expect(engine.getTraces()).toHaveLength(0);
    });
  });

  // ========================================================================
  // buildRetryPrompt
  // ========================================================================
  describe('buildRetryPrompt', () => {
    it('should include all issues and instructions', () => {
      const prompt = engine.buildRetryPrompt(['Issue A', 'Issue B']);
      expect(prompt).toContain('Issue A');
      expect(prompt).toContain('Issue B');
      expect(prompt).toContain('COMPLETE response');
      expect(prompt).toContain('do not truncate');
    });
  });

  // ========================================================================
  // Constructor with custom config
  // ========================================================================
  describe('constructor', () => {
    it('should merge custom config with defaults', () => {
      const customEngine = new SkillEnforcementEngine({
        matchThreshold: 0.5,
        maxRecommendations: 5,
      });

      mocks.mockGetSkillStore.mockReturnValue({
        search: vi.fn(() => [
          makeSkill({ id: 's1', name: 'S1' }),
          makeSkill({ id: 's2', name: 'S2' }),
          makeSkill({ id: 's3', name: 'S3' }),
          makeSkill({ id: 's4', name: 'S4' }),
          makeSkill({ id: 's5', name: 'S5' }),
          makeSkill({ id: 's6', name: 'S6' }),
        ]),
        get: vi.fn(),
      });

      const result = customEngine.matchSkillsForQuery('query');
      expect(result.skills).toHaveLength(5); // maxRecommendations = 5
    });
  });
});
