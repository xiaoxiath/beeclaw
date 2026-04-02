/**
 * Tool Executor — Extracted from agent/index.ts
 *
 * Contains the default tool executor factory and inner dispatch logic.
 * The executor routes tool calls to the appropriate handler (plugin, memory,
 * skill, goal, proactive, persona, builtin, feishu, MCP) and wraps
 * network-facing tools with circuit breaker protection.
 */

import { getCircuitBreakerRegistry, CircuitOpenError, CIRCUIT_BREAKER_PRESETS } from '../../infra/resilience/circuit-breaker';

import type { ToolExecutor, UserContext } from './types';
import { logger } from '../../infra/observability/logger';
import { getSkillStore } from '../skills/store';
import { executeMemoryTool } from '../memory/tools';
import { executeSkillTool } from '../skills/tools';
import { executeGoalTool } from './goal/tools';
import { executeProactiveTool } from '../proactive/tools';
import { executePersonaTool } from './persona/tools';
import { executeBuiltinTool, isBuiltinTool } from '../tools';
// Task 3: Use port interfaces instead of direct adapter imports
import { getMCPManagerPort, getPluginRegistryPort } from '../ports';
// Phase 2: Feature flags for optional tool modules
import { resolveToolFeatureFlags } from './tools';

// Inlined from MCPClientManager static methods (avoid adapter import)
function isMCPToolName(name: string): boolean {
  return name.startsWith('mcp_');
}
function parseMCPToolName(name: string): { serverId: string; toolName: string } | null {
  if (!name.startsWith('mcp_')) return null;
  const withoutPrefix = name.slice(4);
  const separatorIndex = withoutPrefix.indexOf('__');
  if (separatorIndex === -1) return null;
  return {
    serverId: withoutPrefix.substring(0, separatorIndex),
    toolName: withoutPrefix.substring(separatorIndex + 2),
  };
}

/**
 * Create a default tool executor with circuit breaker protection.
 *
 * The executor dispatches tool calls to the appropriate handler based on
 * the tool name prefix, and wraps network-facing tools (feishu_, mcp_,
 * web_search, deep_research) with circuit breaker resilience.
 */
export function createDefaultToolExecutor(): ToolExecutor {
  // Initialize circuit breaker registry with tool-specific presets
  const cbRegistry = getCircuitBreakerRegistry();
  cbRegistry.registerToolConfig('web_search', CIRCUIT_BREAKER_PRESETS.mcp_tool);
  cbRegistry.registerToolConfig('deep_research', { failureThreshold: 2, cooldownMs: 120_000 });

  return async (name: string, params: Record<string, unknown>, userContext?: UserContext) => {
    // Determine if this tool needs circuit breaker protection
    const needsCircuitBreaker = (
      name.startsWith('feishu_') ||
      name.startsWith('mcp_') ||
      name === 'web_search' ||
      name === 'deep_research' ||
      isBuiltinTool(name) && ['web_search', 'deep_research'].includes(name)
    );

    // If circuit breaker applies, wrap the execution
    if (needsCircuitBreaker) {
      try {
        return await cbRegistry.execute(name, async () => {
          return await _executeToolInner(name, params, userContext);
        });
      } catch (error) {
        if (error instanceof CircuitOpenError) {
          const remainSec = Math.round(error.cooldownRemainingMs / 1000);
          return {
            success: false,
            error: `Tool "${name}" is temporarily unavailable (circuit breaker open). ` +
                   `Too many recent failures. Will auto-recover in ~${remainSec}s. ` +
                   `Please try an alternative approach or wait.`,
          };
        }
        // Re-throw non-circuit-breaker errors as tool failure
        const errorMsg = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMsg };
      }
    }

    // Non-protected tools: execute directly
    return _executeToolInner(name, params, userContext);
  };
}

/**
 * Inner tool execution logic (separated for circuit breaker wrapping).
 *
 * Dispatches to the correct handler based on tool name/prefix:
 *   1. Plugin tools (highest priority)
 *   2. memory_* -> executeMemoryTool
 *   3. skill_* -> executeSkillTool
 *   4. goal_* -> executeGoalTool
 *   5. proactive_* / notification_* / schedule_once -> executeProactiveTool
 *   6. persona_* -> executePersonaTool
 *   7. Builtin tools -> executeBuiltinTool
 *   8. feishu_* -> migrated to skill
 *   9. mcp_* -> MCPClientManager
 */
export async function _executeToolInner(
  name: string,
  params: Record<string, unknown>,
  _userContext?: UserContext,
): Promise<{ success: boolean; data?: unknown; error?: string; _contentBlock?: boolean }> {
    // Plugin tools (highest priority)
    try {
      const registry = getPluginRegistryPort();
      if (registry && registry.tools.has(name)) {
        const tool = registry.tools.get(name)!;
        return tool.execute(params);
      }
    } catch (error) {
      logger.debug('Plugin system not initialized, continue to other tools:', error);
    }

    // Memory tools
    if (name.startsWith('memory_')) {
      return executeMemoryTool(name, params);
    }

    // Skill tools
    if (name.startsWith('skill_')) {
      const result = await executeSkillTool(name, params);

      // Handle skill_ensure requiring skill-creator workflow
      if (name === 'skill_ensure' && result.success === false && result.error === 'NEW_SKILL_REQUIRES_CREATOR') {
        const store = getSkillStore();
        const skillBasePath = store.getBasePath();

        return {
          success: false,
          error: `Creating new skill "${(result.data as any)?.skillName}" requires skill-creator workflow.

**IMPORTANT: User skills must be created in the correct directory:**
📁 Target directory: ${skillBasePath}

Please follow these steps:

1. **Read skill-creator skill:**
   skill_get({ name: "skill-creator" })

2. **Follow skill-creator workflow to design the skill**

3. **Create the skill in the correct directory:**
   - Use file_write or shell commands to create skill files
   - Skill directory: ${skillBasePath}/${(result.data as any)?.skillName}/
   - Required file: ${skillBasePath}/${(result.data as any)?.skillName}/SKILL.md
   - Optional: scripts/, references/, evals/, assets/ subdirectories

4. **Verify creation:**
   skill_get({ name: "${(result.data as any)?.skillName}" })

The skill-creator provides:
- Proper skill structure (SKILL.md, scripts/, references/, evals/)
- Test cases and evaluation
- Iterative refinement
- Quality benchmarking

**Skill Location:**
- User skills (AI-created): ${skillBasePath}/
- Built-in skills (project): skills/ (DO NOT create here)

This ensures skills are in the correct location and follow quality standards.`,
        };
      }

      return result;
    }

    // Goal tools (Phase 2: conditional — requires config.goals.enabled !== false)
    if (name.startsWith('goal_')) {
      const { goalToolsEnabled } = resolveToolFeatureFlags();
      if (!goalToolsEnabled) {
        return {
          success: false,
          error: 'Goal management is not enabled. Set goals.enabled: true in config to use goal tools.',
        };
      }
      return executeGoalTool(name, params);
    }

    // Proactive tools (Phase 2: conditional — requires daemon mode or config.proactive.enabled)
    if (name.startsWith('proactive_') || name.startsWith('notification_') || name === 'schedule_once') {
      const { proactiveToolsEnabled } = resolveToolFeatureFlags();
      if (!proactiveToolsEnabled) {
        return {
          success: false,
          error: 'Proactive scheduling is not enabled. It requires daemon mode (feishu bot or web server) or set proactive.enabled: true in config.',
        };
      }
      return executeProactiveTool(name, params);
    }

    // Persona tools (Phase 2: conditional — requires config.persona.enabled !== false)
    if (name.startsWith('persona_')) {
      const { personaToolsEnabled } = resolveToolFeatureFlags();
      if (!personaToolsEnabled) {
        return {
          success: false,
          error: 'Persona customization is not enabled. Set persona.enabled: true in config to use persona tools.',
        };
      }
      return executePersonaTool(name, params);
    }

    // Builtin tools
    if (isBuiltinTool(name)) {
      return executeBuiltinTool(name, params);
    }

    // Feishu tools - now handled by feishu-cli-toolkit skill
    if (name.startsWith('feishu_')) {
      return {
        success: false,
        error: `Feishu tool "${name}" has been migrated to feishu-cli-toolkit skill. ` +
              `Please use the skill directly by describing what you want to do. ` +
              `Example: "创建一个日程" or "列出我的云空间文件". ` +
              `See /skills/skills/feishu-cli-toolkit/SKILL.md for available commands`,
      };
    }

    // MCP tools (format: mcp_{serverId}_{toolName})
    if (isMCPToolName(name)) {
      try {
        const manager = getMCPManagerPort();
        if (!manager) {
          return { success: false, error: 'MCP manager not initialized' };
        }
        const parsed = parseMCPToolName(name);
        if (!parsed) {
          return {
            success: false,
            error: `Invalid MCP tool name format: ${name}`,
          };
        }
        const result = await manager.executeTool(parsed.serverId, parsed.toolName, params);
        return {
          success: result.success,
          data: result.data,
          error: result.error,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: `MCP tool execution failed: ${errorMsg}`,
        };
      }
    }

    return {
      success: false,
      error: `Unknown tool: ${name}`,
    };
}
