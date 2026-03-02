import { z } from 'zod';
import type { SkillToolResult, MaturityAssessment, SkillEvals, GradingResult, BenchmarkResult } from './types';
import { getSkillStore } from './store';

// Tool parameter schemas
export const SkillListSchema = z.object({});

export const SkillGetSchema = z.object({
  name: z.string().describe('Skill name'),
});

export const SkillCreateSchema = z.object({
  name: z.string().describe('Skill name (kebab-case)'),
  description: z.string().describe('What the skill does AND when to trigger'),
  content: z.string().optional().describe('SKILL.md body content'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  triggers: z.array(z.string()).optional().describe('Trigger phrases'),
});

export const SkillUpdateSchema = z.object({
  name: z.string().describe('Skill name'),
  description: z.string().optional().describe('New description'),
  content: z.string().optional().describe('New SKILL.md body'),
  tags: z.array(z.string()).optional().describe('New tags'),
});

export const SkillDeleteSchema = z.object({
  name: z.string().describe('Skill name'),
});

export const SkillSearchSchema = z.object({
  query: z.string().describe('Search query'),
});

export const SkillRecordSchema = z.object({
  name: z.string().describe('Skill name'),
  success: z.boolean().describe('Whether the usage was successful'),
});

export const SkillMaturitySchema = z.object({
  name: z.string().describe('Skill name'),
});

// Tool definitions for AI function calling
export const skillTools = {
  skill_list: {
    name: 'skill_list',
    description: 'List all available skills. Use this to see what skills exist.',
    parameters: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },

  skill_get: {
    name: 'skill_get',
    description: 'Get a skill\'s detailed instructions from SKILL.md. Read and follow the skill content carefully.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name',
        },
      },
      required: ['name'],
    },
  },

  skill_create: {
    name: 'skill_create',
    description: 'Create a new skill. NOTE: For creating skills with proper testing and optimization, use the skill-creator skill (path: skills/skill-creator) which provides a complete workflow including test cases, benchmarking, and iteration. Use skill_create only for quick, simple skill creation when you don\'t need testing.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name (kebab-case, e.g., "web-scraper")',
        },
        description: {
          type: 'string',
          description: 'What the skill does AND when to trigger it',
        },
        content: {
          type: 'string',
          description: 'SKILL.md body content (instructions, examples)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
        triggers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Phrases that should trigger this skill',
        },
      },
      required: ['name', 'description'],
    },
  },

  skill_update: {
    name: 'skill_update',
    description: 'Update an existing skill. NOTE: For substantial improvements, testing, or optimization, use the skill-creator skill instead (path: skills/skill-creator) which provides a complete workflow with evals, benchmarking, and iteration. Use skill_update only for simple, targeted changes like fixing typos or updating descriptions.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
        content: {
          type: 'string',
          description: 'New SKILL.md body content',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'New tags',
        },
      },
      required: ['name'],
    },
  },

  skill_ensure: {
    name: 'skill_ensure',
    description: 'Create a skill if it doesn\'t exist, or update it if it does. NOTE: For substantial skill work (testing, optimization, iteration), use the skill-creator skill (path: skills/skill-creator) instead. Use skill_ensure for quick create-or-update operations when you don\'t need the full workflow.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name (kebab-case)',
        },
        description: {
          type: 'string',
          description: 'What the skill does AND when to trigger it',
        },
        content: {
          type: 'string',
          description: 'SKILL.md body content',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
        triggers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Phrases that should trigger this skill',
        },
      },
      required: ['name', 'description'],
    },
  },

  skill_delete: {
    name: 'skill_delete',
    description: 'Delete a skill. Use when a skill is no longer needed.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name to delete',
        },
      },
      required: ['name'],
    },
  },

  skill_search: {
    name: 'skill_search',
    description: 'Search for skills matching a query.',
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['query'],
    },
  },

  skill_record: {
    name: 'skill_record',
    description: 'Record a skill usage (success or failure). Used for maturity tracking.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name',
        },
        success: {
          type: 'boolean',
          description: 'Whether the usage was successful',
        },
      },
      required: ['name', 'success'],
    },
  },

  skill_maturity: {
    name: 'skill_maturity',
    description: 'Check if a skill is mature enough to be published.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name',
        },
      },
      required: ['name'],
    },
  },

  // New Evaluation System Tools
  skill_evals_get: {
    name: 'skill_evals_get',
    description: 'Get the evaluation test cases for a skill. Use this to see how a skill is tested.',
    parameters: {
      type: 'object' as const,
      properties: {
        skill_name: {
          type: 'string',
          description: 'Skill name',
        },
      },
      required: ['skill_name'],
    },
  },

  skill_evals_set: {
    name: 'skill_evals_set',
    description: 'Create or update evaluation test cases for a skill. Use this to define how to test a skill.',
    parameters: {
      type: 'object' as const,
      properties: {
        skill_name: {
          type: 'string',
          description: 'Skill name',
        },
        evals: {
          type: 'array',
          description: 'Array of eval test cases',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              prompt: { type: 'string' },
              expected_output: { type: 'string' },
              files: { type: 'array', items: { type: 'string' } },
              expectations: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      required: ['skill_name', 'evals'],
    },
  },

  skill_resource_read: {
    name: 'skill_resource_read',
    description: 'Read a bundled resource file from a skill (scripts, references, assets, agents, evals).',
    parameters: {
      type: 'object' as const,
      properties: {
        skill_name: {
          type: 'string',
          description: 'Skill name',
        },
        category: {
          type: 'string',
          enum: ['scripts', 'references', 'assets', 'agents', 'evals'],
          description: 'Resource category',
        },
        filename: {
          type: 'string',
          description: 'File name to read',
        },
      },
      required: ['skill_name', 'category', 'filename'],
    },
  },

  skill_resource_write: {
    name: 'skill_resource_write',
    description: 'Write a bundled resource file to a skill (scripts, references, assets, agents, evals).',
    parameters: {
      type: 'object' as const,
      properties: {
        skill_name: {
          type: 'string',
          description: 'Skill name',
        },
        category: {
          type: 'string',
          enum: ['scripts', 'references', 'assets', 'agents', 'evals'],
          description: 'Resource category',
        },
        filename: {
          type: 'string',
          description: 'File name to write',
        },
        content: {
          type: 'string',
          description: 'File content',
        },
      },
      required: ['skill_name', 'category', 'filename', 'content'],
    },
  },

  skill_structure: {
    name: 'skill_structure',
    description: 'Get the directory structure of a skill (what bundled resources it has).',
    parameters: {
      type: 'object' as const,
      properties: {
        skill_name: {
          type: 'string',
          description: 'Skill name',
        },
      },
      required: ['skill_name'],
    },
  },

  skill_workspace_create: {
    name: 'skill_workspace_create',
    description: 'Create a workspace directory for testing a skill.',
    parameters: {
      type: 'object' as const,
      properties: {
        skill_name: {
          type: 'string',
          description: 'Skill name',
        },
        iteration: {
          type: 'number',
          description: 'Iteration number (default: 1)',
        },
      },
      required: ['skill_name'],
    },
  },
};

// Tool executor
export function executeSkillTool(name: string, params: Record<string, unknown>): SkillToolResult {
  const store = getSkillStore();

  switch (name) {
    case 'skill_list': {
      const skills = store.list();
      return {
        success: true,
        data: skills.map(s => ({
          name: s.name,
          description: s.description,
          tags: s.tags,
          maturityScore: s.maturityScore,
          usageCount: s.usageCount,
          isBuiltin: s.isBuiltin,
          readonly: s.readonly,
        })),
      };
    }

    case 'skill_get': {
      const parsed = SkillGetSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      const skill = store.get(parsed.data.name);
      if (!skill) {
        return { success: false, error: `Skill not found: ${parsed.data.name}` };
      }
      // Return skill with clear instruction format
      return { success: true, data: skill };
    }

    case 'skill_create': {
      const parsed = SkillCreateSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.create({
        name: parsed.data.name,
        description: parsed.data.description,
        content: parsed.data.content,
        tags: parsed.data.tags,
        triggers: parsed.data.triggers,
      });
    }

    case 'skill_update': {
      const parsed = SkillUpdateSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.update(parsed.data.name, {
        description: parsed.data.description,
        content: parsed.data.content,
        tags: parsed.data.tags,
      });
    }

    case 'skill_ensure': {
      // Smart create or update - check if skill exists first
      const parsed = SkillCreateSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }

      const existing = store.get(parsed.data.name);
      if (existing) {
        // Update existing skill
        const result = store.update(parsed.data.name, {
          description: parsed.data.description,
          content: parsed.data.content,
          tags: parsed.data.tags,
        });
        if (result.success) {
          return {
            success: true,
            data: { action: 'updated', name: parsed.data.name },
            message: `Skill "${parsed.data.name}" updated successfully`,
          };
        }
        return result;
      } else {
        // Create new skill
        const result = store.create({
          name: parsed.data.name,
          description: parsed.data.description,
          content: parsed.data.content,
          tags: parsed.data.tags,
          triggers: parsed.data.triggers,
        });
        if (result.success) {
          return {
            success: true,
            data: { action: 'created', name: parsed.data.name },
            message: `Skill "${parsed.data.name}" created successfully`,
          };
        }
        return result;
      }
    }

    case 'skill_delete': {
      const parsed = SkillDeleteSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.delete(parsed.data.name);
    }

    case 'skill_search': {
      const parsed = SkillSearchSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      const skills = store.search(parsed.data.query);
      return {
        success: true,
        data: skills.map(s => ({
          name: s.name,
          description: s.description,
          tags: s.tags,
          maturityScore: s.maturityScore,
        })),
      };
    }

    case 'skill_record': {
      const parsed = SkillRecordSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.recordUsage(parsed.data.name, parsed.data.success);
    }

    case 'skill_maturity': {
      const parsed = SkillMaturitySchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      const assessment = store.assessMaturity(parsed.data.name);
      return { success: true, data: assessment };
    }

    // New Evaluation System Tool Cases
    case 'skill_evals_get': {
      const parsed = z.object({ skill_name: z.string() }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.getEvals(parsed.data.skill_name);
    }

    case 'skill_evals_set': {
      const parsed = z.object({
        skill_name: z.string(),
        evals: z.array(z.any()),
      }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      const evalsData: SkillEvals = {
        skill_name: parsed.data.skill_name,
        evals: parsed.data.evals,
      };
      return store.setEvals(parsed.data.skill_name, evalsData);
    }

    case 'skill_resource_read': {
      const parsed = z.object({
        skill_name: z.string(),
        category: z.enum(['scripts', 'references', 'assets', 'agents', 'evals']),
        filename: z.string(),
      }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.readResource(parsed.data.skill_name, parsed.data.category, parsed.data.filename);
    }

    case 'skill_resource_write': {
      const parsed = z.object({
        skill_name: z.string(),
        category: z.enum(['scripts', 'references', 'assets', 'agents', 'evals']),
        filename: z.string(),
        content: z.string(),
      }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.writeResource(parsed.data.skill_name, parsed.data.category, parsed.data.filename, parsed.data.content);
    }

    case 'skill_structure': {
      const parsed = z.object({ skill_name: z.string() }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.getStructure(parsed.data.skill_name);
    }

    case 'skill_workspace_create': {
      const parsed = z.object({
        skill_name: z.string(),
        iteration: z.number().optional().default(1),
      }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.createWorkspace(parsed.data.skill_name, parsed.data.iteration);
    }

    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// Get all skill tools for AI
export function getSkillToolsForAI() {
  return Object.values(skillTools);
}

// Get all skill tools (alias)
export function getAllSkillTools() {
  return getSkillToolsForAI();
}

// Export tool names
export const SKILL_TOOL_NAMES = Object.keys(skillTools);
