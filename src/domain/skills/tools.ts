import { z } from 'zod';
import type { SkillToolResult, SkillEvals } from './types';
import { getSkillStore } from './store';
import { logger } from '../../infra/observability/logger';

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

  // Consolidated Evaluation System Tool (recommended)
  skill_evals: {
    name: 'skill_evals',
    description: `Manage evaluation test cases for a skill with a unified interface.

**Actions:**
- **get**: Get evaluation test cases for a skill
- **set**: Create or update evaluation test cases
- **run**: Run evaluation test cases and get pass/fail results

**Best practices:**
1. Use 'get' to review existing test cases
2. Use 'set' to define comprehensive test scenarios
3. Use 'run' to validate skill behavior

**Examples:**
\`\`\`javascript
// Get evals
skill_evals({ action: "get", skill_name: "my-skill" })

// Set evals
skill_evals({
  action: "set",
  skill_name: "my-skill",
  evals: [
    {
      id: 1,
      name: "Test case 1",
      prompt: "Test prompt",
      expected_output: "Expected result"
    }
  ]
})

// Run evals
skill_evals({ action: "run", skill_name: "my-skill" })
\`\`\``,
    parameters: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set', 'run'],
          description: 'Action to perform',
        },
        skill_name: {
          type: 'string',
          description: 'Skill name',
        },
        evals: {
          type: 'array',
          description: 'Array of eval test cases (for set action)',
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
        eval_id: {
          type: 'number',
          description: 'Specific eval ID to run (for run action, optional)',
        },
      },
      required: ['action', 'skill_name'],
    },
  },

  // Removed legacy tools (use consolidated skill_evals instead):
  // - skill_evals_get
  // - skill_evals_set
  // - skill_evals_run
};

// Tool executor
export async function executeSkillTool(name: string, params: Record<string, unknown>): Promise<SkillToolResult> {
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
          logger.warn('DependsOn should be a separate parameter, not in triggers');
        }

        // Check dependencies before creating — uses the canonical graph
        // validator so missing deps AND cycles are both caught.
        const dependsOn = ((parsed.data as any).dependsOn ?? []) as string[];
        if (dependsOn.length > 0) {
          const validation = store.validateNewSkillDependencies(parsed.data.name, dependsOn);
          if (!validation.valid) {
            return {
              success: false,
              error: `Cannot create skill: ${validation.errors.join(', ')}`,
              data: { missing_dependencies: validation.missing }
            };
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

    // Consolidated skill_evals tool
    case 'skill_evals': {
      const parsed = z.object({
        action: z.enum(['get', 'set', 'run']),
        skill_name: z.string(),
        evals: z.array(z.any()).optional(),
        eval_id: z.number().optional(),
      }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }

      switch (parsed.data.action) {
        case 'get':
          return store.getEvals(parsed.data.skill_name);
        case 'set': {
          if (!parsed.data.evals) {
            return { success: false, error: 'evals parameter required for set action' };
          }
          const evalsData: SkillEvals = {
            skill_name: parsed.data.skill_name,
            evals: parsed.data.evals,
          };
          return store.setEvals(parsed.data.skill_name, evalsData);
        }
        case 'run':
          return store.runEval(parsed.data.skill_name, parsed.data.eval_id);
        default:
          return { success: false, error: `Unknown action: ${parsed.data.action}` };
      }
    }

    // Legacy skill_evals_get tool (deprecated, use skill_evals instead)
    case 'skill_evals_get': {
      const parsed = z.object({ skill_name: z.string() }).safeParse(params);
      if (!parsed.success) {
        return { success: false, error: parsed.error.message };
      }
      return store.getEvals(parsed.data.skill_name);
    }

    // Legacy skill_evals_set tool (deprecated, use skill_evals instead)
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

    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// ============================================================================
// Phase 4: Layered Tool Loading
// ============================================================================

/** Core skill tool names — always registered */
const CORE_SKILL_TOOL_NAMES = [
  'skill_list',
  'skill_get',
  'skill_ensure',
  'skill_search',
] as const;

/** Management skill tool names — conditionally registered */
const MANAGEMENT_SKILL_TOOL_NAMES = [
  'skill_delete',
  'skill_record',
  'skill_maturity',
  'skill_evals',
] as const;

/**
 * Get core skill tools (always registered).
 * These are the essential tools for using skills.
 */
export function getCoreSkillTools() {
  return CORE_SKILL_TOOL_NAMES
    .filter(name => name in skillTools)
    .map(name => skillTools[name as keyof typeof skillTools]);
}

/**
 * Get management skill tools (conditionally registered).
 * These are maintenance/admin tools for skill lifecycle management.
 */
export function getManagementSkillTools() {
  return MANAGEMENT_SKILL_TOOL_NAMES
    .filter(name => name in skillTools)
    .map(name => skillTools[name as keyof typeof skillTools]);
}

// Get all skill tools for AI (backward compatible — returns all)
export function getSkillToolsForAI() {
  return Object.values(skillTools);
}

// Get all skill tools (alias, backward compatible)
export function getAllSkillTools() {
  return getSkillToolsForAI();
}

// Export tool names (backward compatible — all tool names)
export const SKILL_TOOL_NAMES = Object.keys(skillTools);

// Export layered name arrays for external use
export { CORE_SKILL_TOOL_NAMES, MANAGEMENT_SKILL_TOOL_NAMES };
