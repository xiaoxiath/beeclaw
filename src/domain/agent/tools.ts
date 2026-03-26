/**
 * [P1 FIX #1] Updated tools.ts — Dynamic Prompt Assembly with Budget Management
 *
 * Changes from original:
 * 1. buildSystemPrompt() now accepts optional `budgetConfig` and `recentMessages`
 *    to enable dynamic example selection and layer-wise budget trimming.
 * 2. New function `buildSystemPromptWithBudget()` wraps the full flow:
 *    detect intent → select examples → assemble layers → trim to budget.
 * 3. SYSTEM_PROMPTS.verbose no longer statically concatenates all examples.
 * 4. All original exports preserved for backward compatibility.
 *
 * Replace: src/agent/tools.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { getMemoryToolsForAI } from '../memory';
import { getSkillToolsForAI } from '../skills';
import { getGoalToolsForAI } from './goal';
import { getProactiveToolsForAI } from '../proactive';
import { getBuiltinToolsForAI, builtinToolNames } from '../tools';
import { getPersonaToolsForAI, getTraitSystemPrompt } from './persona';
import { getGoalStore } from './goal/store';
import { getDateContext } from '../tools/holiday';
import { getWeatherContext } from '../tools/weather';
import { resolveUserLocation, resolveUserTimezone } from '../tools/timezone';
// Feishu tools are now handled by feishu-cli-toolkit skill
// Task 3: Use port interfaces instead of direct adapter imports
import { getMCPManagerPort, getPluginRegistryPort } from '../ports';
import { logger } from '../../infra/observability/logger';
import { estimateTokens } from './context';
import type { OpenAITool, ChatMessage } from './types';
import type { Session } from '../session';
import {
  type PromptBudgetConfig,
  LAYER_PRIORITIES,
  type TaggedExample,
  calculatePromptBudget,
  parseExamplesIntoTagged,
  detectUserIntent,
  selectExamples,
  assembleBudgetedPrompt,
  type PromptLayer,
} from './prompt-budget';

// ---------------------------------------------------------------------------
// Tool Definition Types & Conversion (unchanged)
// ---------------------------------------------------------------------------

type ToolDefinition = {
  name: string;
  description: string;
  parameters?: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  input_schema?: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
};

function toOpenAITool(tool: ToolDefinition): OpenAITool {
  // Support both 'parameters' and 'input_schema' formats
  const schema = tool.parameters || tool.input_schema || {
    type: 'object',
    properties: {},
    required: [],
  };

  return {
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: schema.properties,
        required: schema.required || [],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tool Collection (unchanged)
// ---------------------------------------------------------------------------

export function getAllTools(): OpenAITool[] {
  const memoryTools = getMemoryToolsForAI();
  const skillTools = getSkillToolsForAI();
  const goalTools = getGoalToolsForAI();
  const proactiveTools = getProactiveToolsForAI();
  const builtinTools = getBuiltinToolsForAI();
  const personaTools = getPersonaToolsForAI();

  // Feishu tools are now handled by feishu-cli-toolkit skill
  // const feishuTools = [];

  let mcpTools: OpenAITool[] = [];
  try {
    const mcpManager = getMCPManagerPort();
    if (mcpManager) {
      mcpTools = mcpManager.getAllToolsAsOpenAI();
    }
  } catch {
    // MCP not initialized
  }

  let pluginTools: OpenAITool[] = [];
  try {
    const registry = getPluginRegistryPort();
    if (registry) {
      pluginTools = Array.from(registry.tools.values()).map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }
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
    // Feishu tools removed - now handled by feishu-cli-toolkit skill
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
// Tool Categories (unchanged)
// ---------------------------------------------------------------------------

export const TOOL_CATEGORIES = {
  memory: ['memory_ls', 'memory_grep', 'memory_read', 'memory_write', 'memory_record'],
  skill: ['skill_list', 'skill_get', 'skill_ensure', 'skill_delete', 'skill_search', 'skill_record', 'skill_maturity', 'skill_evals_get', 'skill_evals_set', 'skill_resource_read', 'skill_resource_write', 'skill_structure', 'skill_workspace_create'],
  goal: ['goal_list', 'goal_get', 'goal_create', 'goal_update', 'goal_checkpoint', 'goal_decompose', 'goal_delete', 'goal_summary'],
  proactive: ['proactive_schedule', 'proactive_pattern', 'proactive_list', 'proactive_cancel', 'proactive_enable', 'proactive_disable', 'schedule_once', 'notification_send', 'notification_list', 'notification_mark_read', 'notification_delete', 'notification_history', 'notification_stats'],
  state: ['state_manage', 'state_query', 'state_lock_manage'],
  state_legacy: ['state_set', 'state_get', 'state_delete', 'state_update', 'state_exists', 'state_list', 'state_stats', 'state_lock', 'state_unlock'],
  get builtin() { return [...builtinToolNames]; },
  sandbox: ['sandbox_exec', 'sandbox_write_file', 'sandbox_read_file', 'sandbox_list_files', 'sandbox_status'],
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
 * [P1 FIX #1] Pre-parse examples into tagged entries at module load time.
 * This avoids re-parsing on every prompt build.
 */
let _cachedTaggedExamples: TaggedExample[] | null = null;
function getTaggedExamples(): TaggedExample[] {
  if (!_cachedTaggedExamples) {
    _cachedTaggedExamples = parseExamplesIntoTagged(EXAMPLES_VERBOSE);
    logger.debug(`[PromptBudget] Parsed ${_cachedTaggedExamples.length} tagged examples from examples-verbose.md`);
  }
  return _cachedTaggedExamples;
}

/**
 * Three prompt tiers — all share the same BASE_PROMPT core.
 * [P1 FIX #1] verbose tier no longer statically inlines ALL examples.
 */
export const SYSTEM_PROMPTS = {
  concise: BASE_PROMPT,
  default: BASE_PROMPT,
  verbose: BASE_PROMPT, // Examples are now injected dynamically via buildSystemPromptWithBudget()
};

// ---------------------------------------------------------------------------
// Dynamic Context Builders (unchanged from original)
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

  const locationInfo = `**Location**: ${userLocation}`;
  let timezoneInfo = `**Timezone**: ${userTimezone}`;

  if (userTimezone !== systemTimezone) {
    timezoneInfo += ` (系统: ${systemTimezone})`;
  }

  return `${locationInfo} | **Date**: ${dateStr} | **Time**: ${timeStr} | ${timezoneInfo} | **Beeclaw**: v${version}`;
}

// ---------------------------------------------------------------------------
// [P1 FIX #1] NEW: Budget-aware System Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build system prompt with dynamic example selection and token budget management.
 *
 * This is the NEW recommended entry point for prompt assembly. It replaces
 * the old static approach where all examples were always included.
 *
 * @param basePrompt - The base prompt text (usually SYSTEM_PROMPTS.default)
 * @param coreContext - User/soul context from memory store
 * @param sessionContext - Current session for stats
 * @param recentMessages - Recent conversation messages for intent detection
 * @param modelContextWindow - Model's total context window (e.g., 128000)
 * @param budgetOverrides - Optional overrides for budget config
 */
export function buildSystemPromptWithBudget(
  basePrompt: string,
  coreContext?: { user: string; soul: string; facts?: string; skills?: string },
  sessionContext?: Session,
  recentMessages?: ChatMessage[],
  modelContextWindow: number = 128000,
  budgetOverrides?: Partial<PromptBudgetConfig>,
): {
  prompt: string;
  totalTokens: number;
  selectedExamples: number;
  droppedLayers: string[];
} {
  const budgetConfig = calculatePromptBudget(modelContextWindow, budgetOverrides);

  // --- Build prompt layers with priorities ---
  const layers: PromptLayer[] = [];

  // Layer 1: Immutable core (highest priority — never trimmed)
  layers.push({
    name: 'core',
    content: basePrompt,
    priority: LAYER_PRIORITIES.CORE,
    trimmable: false,
  });

  // Layer 2: Trait personality (high priority)
  const traitPrompt = getTraitSystemPrompt();
  if (traitPrompt) {
    layers.push({
      name: 'traits',
      content: `\n---\n\n# Personality Traits\n\n${traitPrompt}`,
      priority: LAYER_PRIORITIES.TRAITS,
      trimmable: true,
    });
  }

  // Layer 3: Soul context (high priority)
  if (coreContext?.soul && coreContext.soul.trim().length > 50) {
    layers.push({
      name: 'soul',
      content: `\n---\n\n# Your Identity (SOUL.md)\n\n${coreContext.soul}`,
      priority: LAYER_PRIORITIES.SOUL,
      trimmable: true,
    });
  }

  // Layer 4: User context (medium-high priority)
  if (coreContext?.user && coreContext.user.trim().length > 50) {
    layers.push({
      name: 'user-context',
      content: `\n---\n\n# About the User\n\n${coreContext.user}`,
      priority: LAYER_PRIORITIES.USER_CONTEXT,
      trimmable: true,
    });
  }

  // Layer 5: Facts (medium priority — trimmable)
  if (coreContext?.facts && coreContext.facts.trim().length > 10) {
    layers.push({
      name: 'facts',
      content: `\n---\n\n# User Facts & Lessons Learned\n\n${coreContext.facts}`,
      priority: LAYER_PRIORITIES.FACTS,
      trimmable: true,
    });
  }

  // Layer 6: Skills list (medium priority — trimmable)
  if (coreContext?.skills && coreContext.skills.trim().length > 10) {
    const skillsTokens = estimateTokens(coreContext.skills);
    logger.info('[PromptBudget] 📚 Adding skills layer:', {
      contentLength: coreContext.skills.length,
      estimatedTokens: skillsTokens,
      priority: LAYER_PRIORITIES.SKILLS,
      preview: coreContext.skills.substring(0, 300),
    });

    layers.push({
      name: 'skills',
      content: `\n---\n\n# Available Skills\n\n${coreContext.skills}`,
      priority: LAYER_PRIORITIES.SKILLS,
      trimmable: true,
    });
  } else {
    logger.warn('[PromptBudget] ⚠️  Skills layer NOT added:', {
      hasContext: !!coreContext?.skills,
      contentLength: coreContext?.skills?.length || 0,
      trimmedLength: coreContext?.skills?.trim().length || 0,
    });
  }

  // Layer 7: [P1 FIX #1] Dynamic examples — selected by intent, lowest priority
  let selectedExampleCount = 0;
  if (budgetConfig.dynamicExamples) {
    const taggedExamples = getTaggedExamples();
    const userIntents = recentMessages
      ? detectUserIntent(recentMessages)
      : new Set(['general']);

    // Calculate remaining budget for examples
    const nonExampleTokens = layers.reduce((sum, l) => sum + estimateTokens(l.content), 0);
    const exampleBudget = Math.max(0, budgetConfig.maxSystemPromptTokens - nonExampleTokens - 200); // 200 buffer for volatile

    if (exampleBudget > 200 && taggedExamples.length > 0) {
      const selected = selectExamples(taggedExamples, userIntents, exampleBudget, budgetConfig.maxExamples);
      selectedExampleCount = selected.length;

      if (selected.length > 0) {
        const examplesContent = selected.map(e => e.content).join('\n\n---\n\n');
        layers.push({
          name: 'examples',
          content: `\n---\n\n# Worked Examples\n\n${examplesContent}`,
          priority: LAYER_PRIORITIES.EXAMPLES,  // Lowest priority — first to be dropped
          trimmable: true,
        });
      }
    }
  }

  // Layer 8: Volatile runtime context (medium priority — important for recency)
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
    layers.push({
      name: 'runtime',
      content: `\n---\n\n${volatileParts.join('\n\n')}`,
      // [FIX] Raised from 75→95 and marked non-trimmable.
      // Runtime context contains current date/time which is critical for
      // time-sensitive searches and skill executions. Dropping it causes
      // the agent to lose temporal awareness and return stale data.
      priority: LAYER_PRIORITIES.RUNTIME,
      trimmable: false,
    });
  }

  // --- Assemble with budget ---
  const result = assembleBudgetedPrompt(layers, budgetConfig);

  // Log final result
  logger.info('[PromptBudget] 📊 Final prompt assembly:', {
    totalLayers: layers.length,
    totalTokens: result.totalTokens,
    budget: budgetConfig.maxSystemPromptTokens,
    droppedLayers: result.droppedLayers,
    truncatedLayers: result.truncatedLayers,
    skillsDropped: result.droppedLayers.includes('skills'),
    examplesSelected: selectedExampleCount,
  });

  if (result.droppedLayers.length > 0 || result.truncatedLayers.length > 0) {
    logger.debug(`[PromptBudget] System prompt: ${result.totalTokens} tokens (budget: ${budgetConfig.maxSystemPromptTokens})`);
    if (result.droppedLayers.length > 0) {
      logger.debug(`[PromptBudget] Dropped layers: ${result.droppedLayers.join(', ')}`);
    }
  }

  return {
    prompt: result.prompt,
    totalTokens: result.totalTokens,
    selectedExamples: selectedExampleCount,
    droppedLayers: result.droppedLayers,
  };
}

/**
 * Original buildSystemPrompt — preserved for backward compatibility.
 * Internally delegates to buildSystemPromptWithBudget when possible.
 */
export function buildSystemPrompt(
  basePrompt: string,
  coreContext?: { user: string; soul: string; facts?: string; skills?: string },
  sessionContext?: Session
): string {
  // Use the budgeted version with defaults
  const result = buildSystemPromptWithBudget(
    basePrompt,
    coreContext,
    sessionContext,
    undefined,  // no recent messages available in legacy path
    128000,     // default context window
  );
  return result.prompt;
}

// ---------------------------------------------------------------------------
// Skill Formatting (unchanged)
// ---------------------------------------------------------------------------

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
// Context Helpers (unchanged)
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

// Re-export prompt budget utilities for external usage
export {
  calculatePromptBudget,
  type PromptBudgetConfig,
  type PromptLayer,
} from './prompt-budget';
