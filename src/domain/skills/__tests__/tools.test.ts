import { describe, it, expect, vi } from 'vitest';

vi.mock('../store', () => ({
  getSkillStore: vi.fn(() => ({
    list: vi.fn(() => []),
    get: vi.fn(() => null),
    create: vi.fn(async () => ({ success: true })),
    update: vi.fn(async () => ({ success: true })),
    delete: vi.fn(() => ({ success: true })),
    recordUsage: vi.fn(() => {}),
    assessMaturity: vi.fn(() => ({ maturityScore: 50 })),
    search: vi.fn(() => []),
    getEvals: vi.fn(() => ({ success: false })),
    setEvals: vi.fn(() => ({ success: true })),
    runEval: vi.fn(async () => ({ success: true })),
  })),
}));

import {
  skillTools,
  executeSkillTool,
  getSkillToolsForAI,
  getAllSkillTools,
  SKILL_TOOL_NAMES,
} from '../tools';

describe('skills/tools', () => {
  describe('skillTools', () => {
    it('should define skill_list tool', () => {
      expect(skillTools.skill_list).toBeDefined();
      expect(skillTools.skill_list.name).toBe('skill_list');
    });

    it('should define skill_get tool', () => {
      expect(skillTools.skill_get).toBeDefined();
      expect(skillTools.skill_get.name).toBe('skill_get');
    });

    it('should define skill_ensure tool', () => {
      expect(skillTools.skill_ensure).toBeDefined();
      expect(skillTools.skill_ensure.name).toBe('skill_ensure');
    });

    it('should define skill_delete tool', () => {
      expect(skillTools.skill_delete).toBeDefined();
      expect(skillTools.skill_delete.name).toBe('skill_delete');
    });
  });

  describe('SKILL_TOOL_NAMES', () => {
    it('should include known tool names', () => {
      expect(SKILL_TOOL_NAMES).toContain('skill_list');
      expect(SKILL_TOOL_NAMES).toContain('skill_get');
      expect(SKILL_TOOL_NAMES).toContain('skill_ensure');
      expect(SKILL_TOOL_NAMES).toContain('skill_delete');
    });
  });

  describe('getSkillToolsForAI', () => {
    it('should return an array', () => {
      const tools = getSkillToolsForAI();
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe('getAllSkillTools', () => {
    it('should return the skillTools object', () => {
      const tools = getAllSkillTools();
      expect(tools).toEqual(Object.values(skillTools));
    });
  });

  describe('executeSkillTool', () => {
    it('should execute skill_list', async () => {
      const result = await executeSkillTool('skill_list', {});
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should return error for unknown tool', async () => {
      const result = await executeSkillTool('unknown_tool', {});
      expect(result.success).toBe(false);
    });
  });
});
