import { readFileSync } from 'fs';
import { join } from 'path';
import { getMemoryToolsForAI } from '../memory';
import { getSkillToolsForAI } from '../skills';
import { getGoalToolsForAI } from '../goal';
import { getProactiveToolsForAI } from '../proactive';
import { getBuiltinToolsForAI, builtinToolNames } from '../tools';
import { getPersonaToolsForAI, getTraitSystemPrompt } from '../persona';
import { getGoalStore } from '../goal/store';
import { getDateContext } from '../utils/holiday';
import { getWeatherContext } from '../utils/weather';
import {
  calendarToolDefinitions,
  docxToolDefinitions,
  driveToolDefinitions,
  bitableToolDefinitions,
  wikiToolDefinitions,
} from '../feishu';
import { getMCPManager } from '../mcp';
import { getPluginRegistry } from '../plugins';
import { logger } from '../utils/logger';
import type { OpenAITool } from './types';
import type { Session } from '../session';

// ---------------------------------------------------------------------------
// Tool Definition Types & Conversion
// ---------------------------------------------------------------------------

type ToolDefinition = {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
};

function toOpenAITool(tool: ToolDefinition): OpenAITool {
  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters.properties,
        required: tool.parameters.required || [],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tool Collection
// ---------------------------------------------------------------------------

export function getAllTools(): OpenAITool[] {
  const memoryTools = getMemoryToolsForAI();
  const skillTools = getSkillToolsForAI();
  const goalTools = getGoalToolsForAI();
  const proactiveTools = getProactiveToolsForAI();
  const builtinTools = getBuiltinToolsForAI();
  const personaTools = getPersonaToolsForAI();

  const feishuTools = [
    ...Object.values(calendarToolDefinitions),
    ...Object.values(docxToolDefinitions),
    ...Object.values(driveToolDefinitions),
    ...Object.values(bitableToolDefinitions),
    ...Object.values(wikiToolDefinitions),
  ];

  let mcpTools: OpenAITool[] = [];
  try {
    const mcpManager = getMCPManager();
    mcpTools = mcpManager.getAllToolsAsOpenAI();
  } catch {
    // MCP not initialized
  }

  // Plugin tools
  let pluginTools: OpenAITool[] = [];
  try {
    const registry = getPluginRegistry();
    pluginTools = Array.from(registry.tools.values()).map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  } catch {
    // Plugin system not initialized
  }

  return [
    ...memoryTools.map(toOpenAITool),
    ...skillTools.map(toOpenAITool),
    ...goalTools.map(toOpenAITool),
    ...proactiveTools.map(toOpenAITool),
    ...builtinTools.map(toOpenAITool),
    ...personaTools,
    ...feishuTools.map(toOpenAITool),
    ...mcpTools,
    ...pluginTools,
  ];
}

export const getAllToolsForAI = getAllTools;

export function getMemoryTools(): OpenAITool[] {
  return getMemoryToolsForAI().map(toOpenAITool);
}

export function getSkillTools(): OpenAITool[] {
  return getSkillToolsForAI().map(toOpenAITool);
}

// ---------------------------------------------------------------------------
// Tool Categories
// ---------------------------------------------------------------------------

export const TOOL_CATEGORIES = {
  memory: ['memory_ls', 'memory_grep', 'memory_read', 'memory_write', 'memory_record'],
  skill: ['skill_list', 'skill_get', 'skill_create', 'skill_update', 'skill_delete', 'skill_search', 'skill_record', 'skill_maturity', 'skill_evals_get', 'skill_evals_set', 'skill_resource_read', 'skill_resource_write', 'skill_structure', 'skill_workspace_create'],
  goal: ['goal_list', 'goal_get', 'goal_create', 'goal_update', 'goal_checkpoint', 'goal_decompose', 'goal_delete', 'goal_summary'],
  proactive: ['proactive_schedule', 'proactive_pattern', 'proactive_list', 'proactive_cancel', 'proactive_enable', 'proactive_disable', 'schedule_once', 'notification_send', 'notification_list', 'notification_mark_read', 'notification_delete', 'notification_history', 'notification_stats'],
  builtin: [...builtinToolNames],
  persona: ['persona_get', 'persona_update_traits', 'persona_export', 'persona_import', 'persona_explain_traits'],
  feishu: [
    'feishu_calendar_list', 'feishu_calendar_get', 'feishu_calendar_event_create', 'feishu_calendar_event_list', 'feishu_calendar_event_get', 'feishu_calendar_event_update', 'feishu_calendar_event_delete', 'feishu_calendar_event_search', 'feishu_calendar_today', 'feishu_calendar_quick_event',
    'feishu_docx_get', 'feishu_docx_list_children', 'feishu_docx_search', 'feishu_docx_create_text', 'feishu_docx_append', 'feishu_docx_update', 'feishu_docx_delete', 'feishu_docx_create_table',
    'feishu_drive_list', 'feishu_drive_get', 'feishu_drive_create_folder', 'feishu_drive_move', 'feishu_drive_copy', 'feishu_drive_rename', 'feishu_drive_delete', 'feishu_drive_search', 'feishu_drive_download', 'feishu_drive_upload', 'feishu_drive_share',
    'feishu_bitable_get_meta', 'feishu_bitable_list_tables', 'feishu_bitable_list_fields', 'feishu_bitable_create_field', 'feishu_bitable_list_records', 'feishu_bitable_get_record', 'feishu_bitable_create_record', 'feishu_bitable_update_record', 'feishu_bitable_delete_record', 'feishu_bitable_create_app',
    'feishu_wiki_list_spaces', 'feishu_wiki_get_space', 'feishu_wiki_list_nodes', 'feishu_wiki_get_node', 'feishu_wiki_create_page', 'feishu_wiki_move_node', 'feishu_wiki_rename_node', 'feishu_wiki_delete_node', 'feishu_wiki_copy_node', 'feishu_wiki_search', 'feishu_wiki_tree',
  ],
};

export function getToolsByCategory(categories: (keyof typeof TOOL_CATEGORIES)[]): OpenAITool[] {
  const allTools = getAllToolsForAI();
  const toolNames = categories.flatMap(c => TOOL_CATEGORIES[c]);
  return allTools.filter(t => toolNames.includes(t.function.name));
}

// ---------------------------------------------------------------------------
// Prompt Layers — Separated by change frequency for optimal caching
// ---------------------------------------------------------------------------

/**
 * LAYER 0: Immutable core — identity, safety, priority, rules.
 * Changes only on product iteration. Ideal for prompt caching prefix.
 */
function loadPromptLayer(filename: string): string {
  try {
    const filePath = join(__dirname, 'prompts', filename);
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    logger.warn(`Failed to load prompt layer "${filename}":`, error);
    return '';
  }
}

const BASE_PROMPT = loadPromptLayer('base.md');
const EXAMPLES_VERBOSE = loadPromptLayer('examples-verbose.md');

/**
 * Three prompt tiers — all share the same BASE_PROMPT core.
 *
 * - concise:  base only (~1200 tokens) — for simple follow-up turns
 * - default:  base + trait personality (~1500 tokens) — standard mode
 * - verbose:  base + trait personality + worked examples (~2500 tokens) — onboarding or complex tasks
 */
export const SYSTEM_PROMPTS = {
  concise: BASE_PROMPT,
  default: BASE_PROMPT,   // trait personality injected dynamically in buildSystemPrompt
  verbose: `${BASE_PROMPT}\n\n---\n\n${EXAMPLES_VERBOSE}`,
};

// ---------------------------------------------------------------------------
// Dynamic Context Builders
// ---------------------------------------------------------------------------

export function getBeeclawVersion(): string {
  try {
    const packageJsonPath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getCurrentTimeContext(): string {
 export function getCurrentTimeContext(): string {
  const { resolveUserLocation, resolveUserTimezone } = '../utils/timezone';

  const userLocation = resolveUserLocation();
  const userTimezone = resolveUserTimezone();

  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    timeZone: userTimezone,
  });
  const timeStr = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: userTimezone,
  });

  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const version = getBeeclawVersion();

  let locationInfo = `**Location**: ${userLocation}`;
  let timezoneInfo = `**Timezone**: ${userTimezone}`;

  if (userTimezone !== systemTimezone) {
    timezoneInfo += ` (系统: ${systemTimezone})`;
  }

  return `${locationInfo} | **Date**: ${dateStr} | **Time**: ${timeStr} | ${timezoneInfo} | **Beeclaw**: v${version}`;
}

/**
 * Build the final system prompt.
 *
 * Assembly order (optimized for LLM attention & prompt caching):
 *
 *   1. [IMMUTABLE]    Core identity + rules          ← highest attention (beginning) + cache prefix
 *   2. [IMMUTABLE]    Trait personality (if available)
 *   3. [SLOW-CHANGE]  SOUL.md / USER.md / facts / skills
 *   4. [VOLATILE]     Time / holiday / weather / goals / session stats  ← high attention (end)
 *
 * Rationale:
 * - LLMs attend most to the beginning and end of prompts (U-shaped attention)
 * - Immutable layers at the front maximize prompt-prefix caching hit rate
 * - Volatile context at the end gets strong attention AND doesn't bust the cache
 */
export function buildSystemPrompt(
  basePrompt: string,
  coreContext?: { user: string; soul: string; facts?: string; skills?: string },
  sessionContext?: Session
): string {
  const parts: string[] = [];

  // ── Layer 1: Immutable core (from base.md or variant) ──
  parts.push(basePrompt);

  // ── Layer 2: Trait personality ──
  const traitPrompt = getTraitSystemPrompt();
  if (traitPrompt) {
    parts.push(`\n---\n\n# Personality Traits\n\n${traitPrompt}`);
  }

  // ── Layer 3: Slow-changing user context ──
  if (coreContext) {
    if (coreContext.soul && coreContext.soul.trim().length > 50) {
      parts.push(`\n---\n\n# Your Identity (SOUL.md)\n\n${coreContext.soul}`);
    }
    if (coreContext.user && coreContext.user.trim().length > 50) {
      parts.push(`\n---\n\n# About the User\n\n${coreContext.user}`);
    }
    if (coreContext.facts && coreContext.facts.trim().length > 10) {
      parts.push(`\n---\n\n# User Facts & Lessons Learned\n\n${coreContext.facts}`);
    }
    if (coreContext.skills && coreContext.skills.trim().length > 10) {
      parts.push(`\n---\n\n# Available Skills\n\n${coreContext.skills}`);
    }
  }

  // ── Layer 4: Volatile runtime context (at the END for attention + cache-friendliness) ──
  const volatileParts: string[] = [];

  volatileParts.push(`# Runtime Context\n\n${getCurrentTimeContext()}`);

  try {
    const holidayContext = getDateContext();
    if (holidayContext) volatileParts.push(holidayContext);
  } catch (error) {
    logger.debug('Failed to get holiday info:', error);
  }

  try {
    const weatherContext = getWeatherContext();
    if (weatherContext) volatileParts.push(weatherContext);
  } catch (error) {
    logger.debug('Failed to get weather info:', error);
  }

  const goalsContext = getActiveGoalsContext();
  if (goalsContext) volatileParts.push(goalsContext);

  const statsContext = getSessionStatsContext(sessionContext);
  if (statsContext) volatileParts.push(statsContext);

  if (volatileParts.length > 0) {
    parts.push(`\n---\n\n${volatileParts.join('\n\n')}`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Skill Formatting
// ---------------------------------------------------------------------------

/**
 * Format skills for prompt injection.
 *
 * CHANGED: skill_get is now MANDATORY before execution — this is the
 * single source of truth for skill workflow steps. The summaries here
 * are for trigger matching only, NOT for execution.
 */
export function formatSkillsForPrompt(
  skills: Array<{ name: string; description: string; triggers?: string[] }>
): string {
  if (!skills || skills.length === 0) return '';

  const skillEntries = skills.map(skill => {
    const triggers = skill.triggers?.length ? ` Triggers: ${skill.triggers.join(', ')}.` : '';
    return `<skill>
<name>${skill.name}</name>
<description>${skill.description}${triggers}</description>
</skill>`;
  }).join('\n');

  return `<available_skills>
${skillEntries}
</available_skills>

**IMPORTANT**: These are summaries for matching only. Before executing any skill, you MUST:
1. Call \`skill_get(name)\` to load the full workflow.
2. Follow the loaded steps exactly.
3. Call \`skill_record()\` after execution with success/failure.`;
}

// ---------------------------------------------------------------------------
// Context Helpers
// ---------------------------------------------------------------------------

function getActiveGoalsContext(): string | null {
  try {
    const goalStore = getGoalStore();
    const goals = goalStore.list().filter(g => g.state === 'active');
    if (goals.length === 0) return null;

    const sortedGoals = goals.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    const now = Date.now();
    const dueSoonGoals = goals.filter(g => {
      if (!g.targetDate) return false;
      const days = (new Date(g.targetDate).getTime() - now) / (1000 * 60 * 60 * 24);
      return days > 0 && days < 7;
    });

    let context = `## Active Goals\n\n**Total**: ${goals.length}`;

    const recent = sortedGoals[0];
    if (recent) {
      context += ` | **Recent**: "${recent.title}" (${recent.progress}%)`;
    }

    if (dueSoonGoals.length > 0) {
      const list = dueSoonGoals.map(g => {
        const days = Math.ceil((new Date(g.targetDate!).getTime() - now) / (1000 * 60 * 60 * 24));
        return `"${g.title}" (${days}d)`;
      }).join(', ');
      context += `\n**Due Soon**: ${list}`;
    }

    return context;
  } catch {
    return null;
  }
}

function getSessionStatsContext(session?: Session): string | null {
  if (!session) return null;

  const messageCount = session.messages.length;
  const userMessages = session.messages.filter(m => m.role === 'user').length;

  const toolUsage: Record<string, number> = {};
  for (const msg of session.messages) {
    if (msg.role === 'assistant' && msg.content) {
      const matches = msg.content.match(/Using tool: (\w+)/g);
      if (matches) {
        for (const match of matches) {
          const toolName = match.replace('Using tool: ', '');
          toolUsage[toolName] = (toolUsage[toolName] || 0) + 1;
        }
      }
    }
  }

  const topTools = Object.entries(toolUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${name}(${count})`)
    .join(', ');

  let context = `## Session\n\n**Messages**: ${messageCount} (${userMessages} from user)`;
  if (topTools) context += ` | **Top Tools**: ${topTools}`;

  return context;
}
