import { z } from 'zod';
import type { SkillToolResult, SkillEvals } from './types';
import { getSkillStore } from './store';

// Tool parameter schemas
export const SkillListSchema = z.object({});

export const SkillGetSchema = z.object({
  name: z.string().describe('Skill name'),
});

export const SkillEnsureSchema = z.object({
  name: z.string().describe('Skill name (kebab-case)'),
  description: z.string().describe('What the skill does AND when to trigger'),
  content: z.string().optional().describe('SKILL.md body content'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  triggers: z.array(z.string()).optional().describe('Trigger phrases'),
  dependsOn: z.array(z.string()).optional().describe('Dependencies on other skills'),
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

  skill_ensure: {
    name: 'skill_ensure',
    description: `[RECOMMENDED] Create or update a skill with full quality workflow.

This is the preferred tool for saving skills. It intelligently:
- Creates the skill if it doesn't exist (using skill-creator for full workflow)
- Updates the skill if it already exists (direct update)

**For creating new skills:**
Automatically delegates to skill-creator to ensure:
- Proper structure (SKILL.md, scripts/, references/, evals/)
- Test cases and evaluation
- Iterative refinement
- Quality benchmarking

**For updating existing skills:**
Directly updates the skill content.

Use this tool for all skill creation/updating. The skill-creator workflow ensures high-quality, well-tested skills.`,
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
        dependsOn: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of skill names this skill depends on (will be validated)',
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

  skill_evals_run: {
    name: 'skill_evals_run',
    description: 'Run evaluation test cases for a skill. Executes defined test cases and returns pass/fail results with grading and feedback.',
    parameters: {
      type: 'object' as const,
      properties: {
        skill_name: {
          type: 'string',
          description: 'Skill name to run evals for',
        },
        eval_id: {
          type: 'number',
          description: 'Specific eval ID to run (optional). If not provided, runs all evals.',
        },
      },
      required: ['skill_name'],
    },
  },

  skill_recommend: {
    name: 'skill_recommend',
    description: 'Get skill recommendations based on context. Analyzes user input and returns the most relevant skills with confidence scores.',
    parameters: {
      type: 'object' as const,
      properties: {
        context: {
          type: 'string',
          description: 'User context or task description to match against skills',
        },
      },
      required: ['context'],
    },
  },

  skill_performance: {
    name: 'skill_performance',
    description: 'Get performance metrics for a skill including execution times, success rates, and resource usage.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name to get performance metrics for',
        },
      },
      required: ['name'],
    },
  },

  skill_analyze_failures: {
    name: 'skill_analyze_failures',
    description: 'Analyze failure patterns for a skill and get recommendations for improvement.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name to analyze failures for',
        },
      },
      required: ['name'],
    },
  },

  skill_export: {
    name: 'skill_export',
    description: 'Export a skill to a shareable package. Includes SKILL.md, resources, evals, and all bundled files.',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name to export',
        },
        output_path: {
          type: 'string',
          description: 'Optional output path for the exported file',
        },
      },
      required: ['name'],
    },
  },

  skill_import: {
    name: 'skill_import',
    description: 'Import a skill from a package file. Handles conflicts and validates structure.',
    parameters: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the skill package file (.tar.gz)',
        },
      },
      required: ['file_path'],
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

    case 'skill_ensure': {
      // Smart create or update - check if skill exists first
      const parsed = SkillEnsureSchema.safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }

      const existing = store.get(parsed.data.name);
      if (existing) {
        // Update existing skill - direct update is fine
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
        // Creating new skill - validate dependencies first
        if (parsed.data.triggers && (parsed.data.triggers as any).dependsOn) {
          // If dependsOn is accidentally in triggers, move it
          console.warn('DependsOn should be a separate parameter, not in triggers');
        }

        // Check dependencies before creating
        const store_any = store as any;
        if (store_any.validateDependencies && parsed.data.tags) {
          // Check if dependsOn is in tags (common mistake)
          const dependsOn = (parsed.data as any).dependsOn || [];
          if (dependsOn.length > 0) {
            const validation = store_any.validateDependencies(dependsOn);
            if (!validation.valid) {
              return {
                success: false,
                error: `Cannot create skill: ${validation.errors.join(', ')}`,
                data: { missing_dependencies: validation.missing }
              };
            }
          }
        }

        // Must use skill-creator for quality workflow
        // Return a special response to tell agent to use skill-creator
        return {
          success: false,
          error: 'NEW_SKILL_REQUIRES_CREATOR',
          message: `Creating new skill "${parsed.data.name}" requires skill-creator workflow for quality assurance.`,
          data: {
            needsSkillCreator: true,
            skillName: parsed.data.name,
            skillDescription: parsed.data.description,
            skillContent: parsed.data.content,
            skillTags: parsed.data.tags,
            skillTriggers: parsed.data.triggers,
          },
        };
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

    case 'skill_evals_run': {
      const parsed = z.object({
        skill_name: z.string(),
        eval_id: z.number().optional(),
      }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.runEval(parsed.data.skill_name, parsed.data.eval_id);
    }

    case 'skill_recommend': {
      const parsed = z.object({
        context: z.string(),
      }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      const result = store.recommendSkills(parsed.data.context);
      return { success: true, data: result };
    }

    case 'skill_performance': {
      const parsed = z.object({
        name: z.string(),
      }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      const metrics = store.getPerformanceMetrics(parsed.data.name);
      return { success: true, data: metrics };
    }

    case 'skill_analyze_failures': {
      const parsed = z.object({
        name: z.string(),
      }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      const analysis = store.analyzeFailures(parsed.data.name);
      return { success: true, data: analysis };
    }

    case 'skill_export': {
      const parsed = z.object({
        name: z.string(),
        output_path: z.string().optional(),
      }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      try {
        const result = store.exportSkill(parsed.data.name, parsed.data.output_path);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    case 'skill_import': {
      const parsed = z.object({
        file_path: z.string(),
      }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      try {
        const result = store.importSkill(parsed.data.file_path);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
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
