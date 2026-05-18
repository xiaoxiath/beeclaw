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
import { getMemoryToolsForAI, getCoreMemoryTools, getAdvancedMemoryTools } from '../memory';
import { getSkillToolsForAI, getCoreSkillTools, getManagementSkillTools } from '../skills';
import { getGoalToolsForAI } from './goal';
import { getProactiveToolsForAI } from '../proactive';
import { getBuiltinToolsConditional, builtinToolNames } from '../tools';
import { getPersonaToolsForAI, getTraitSystemPrompt } from './persona';
import { getGoalStore } from './goal/store';
import { resolveUserLocation, resolveUserTimezone } from '../tools/timezone';
// Feishu tools are now handled by feishu-cli-toolkit skill
// Task 3: Use port interfaces instead of direct adapter imports
import { getMCPManagerPort, getPluginRegistryPort } from '../ports';
import { getLogger } from '../../infra/observability/logger';

// Two namespaces: `agent.tools` for the registry/loader chatter and
// `memory.prompt` for the per-turn prompt-budget tracing (much higher
// volume — INFOs demoted to DEBUG below).
const logger = getLogger('agent.tools');
const promptLogger = getLogger('memory.prompt');
import { getConfig } from '../../infra/config';
import { adapterRegistry } from '../../infra/entry';
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
// Phase 2: Feature Flags for Optional Tool Modules
// ---------------------------------------------------------------------------

/**
 * Resolve whether each optional tool module should be loaded.
 *
 * The resolution logic:
 * - goals:     enabled by default (backward compat); disabled via config.goals.enabled = false
 * - proactive: disabled by default; enabled in daemon mode (bot/web adapters) OR config.proactive.enabled = true
 * - persona:   enabled by default (backward compat); disabled via config.persona.enabled = false
 *
 * Exported so that tool-executor.ts can check the same flags for graceful degradation.
 */
export function resolveToolFeatureFlags(): {
  goalToolsEnabled: boolean;
  proactiveToolsEnabled: boolean;
  personaToolsEnabled: boolean;
} {
  let config: ReturnType<typeof getConfig> | null = null;
  try {
    config = getConfig();
  } catch {
    // Config not yet loaded (e.g. during early init) — use defaults
  }

  // Goal tools — default enabled for backward compat
  const goalToolsEnabled = config?.goals?.enabled !== false;

  // Proactive tools — only load in daemon mode (feishu bot, web server) or explicit config
  const proactiveToolsEnabled = (() => {
    // Explicit config override takes precedence
    if (config?.proactive?.enabled === true) return true;
    if (config?.proactive?.enabled === false) return false;

    // Auto-detect: enable for persistent adapters (bot/web/daemon), not CLI one-shot
    try {
      const adapters = adapterRegistry.getAll();
      return adapters.some((a: { type: string }) => a.type === 'bot' || a.type === 'web' || a.type === 'daemon');
    } catch {
      return false; // Adapter registry not ready — conservative default
    }
  })();

  // Persona tools — default enabled for backward compat
  const personaToolsEnabled = config?.persona?.enabled !== false;

  return { goalToolsEnabled, proactiveToolsEnabled, personaToolsEnabled };
}

// ---------------------------------------------------------------------------
// Tool Collection — with conditional loading (Phase 2)
// ---------------------------------------------------------------------------

export function getAllTools(options?: { isSubagentContext?: boolean }): OpenAITool[] {
  const { goalToolsEnabled, proactiveToolsEnabled, personaToolsEnabled } = resolveToolFeatureFlags();

  // Phase 4: Use core memory tools by default, advanced on demand
  const memoryTools = getCoreMemoryTools();
  const advancedMemory = getAdvancedMemoryTools();

  // Phase 4: Use core skill tools by default, management on demand
  const skillTools = getCoreSkillTools();
  const managementSkill = getManagementSkillTools();

  // Detect sandbox status to enable mutual exclusion of file/sandbox tools
  let sandboxEnabled = false;
  try {
    sandboxEnabled = getConfig().sandbox?.enabled ?? false;
  } catch {
    // Config not loaded yet — default to no exclusion
  }

  // Phase 4: Use conditional builtin tool loading
  const builtinTools = getBuiltinToolsConditional({
    sandboxEnabled,
    isSubagentContext: options?.isSubagentContext ?? false,
  });

  // Optional modules — loaded conditionally based on feature flags
  const goalTools = goalToolsEnabled ? getGoalToolsForAI() : [];
  const proactiveTools = proactiveToolsEnabled ? getProactiveToolsForAI() : [];
  const personaTools = personaToolsEnabled ? getPersonaToolsForAI() : [];

  if (!goalToolsEnabled) {
    logger.debug('[Tools] Goal tools disabled (config.goals.enabled = false)');
  }
  if (!proactiveToolsEnabled) {
    logger.debug('[Tools] Proactive tools disabled (not in daemon mode and config.proactive.enabled != true)');
  }
  if (!personaToolsEnabled) {
    logger.debug('[Tools] Persona tools disabled (config.persona.enabled = false)');
  }

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

  const coreTools = [
    ...memoryTools.map(t => toOpenAITool(t as ToolDefinition)),
    ...skillTools.map(t => toOpenAITool(t as ToolDefinition)),
    ...goalTools.map(t => toOpenAITool(t as ToolDefinition)),
    ...proactiveTools.map(t => toOpenAITool(t as ToolDefinition)),
    ...builtinTools.map(t => toOpenAITool(t as ToolDefinition)),
    ...personaTools,
    // Feishu tools removed - now handled by feishu-cli-toolkit skill
    ...mcpTools,
    ...pluginTools,
  ];

  // Phase 4: Conditionally add advanced/management tools
  // These are only loaded when explicitly needed (e.g., maintenance tasks)
  const advancedTools = [
    ...advancedMemory.map(t => toOpenAITool(t as ToolDefinition)),
    ...managementSkill.map(t => toOpenAITool(t as ToolDefinition)),
  ];

  const allTools = [...coreTools, ...advancedTools];

  logger.info(`[Tools] Loaded ${allTools.length} tools: core=${coreTools.length}, advanced=${advancedTools.length} (goal=${goalToolsEnabled}, proactive=${proactiveToolsEnabled}, persona=${personaToolsEnabled})`);

  return allTools;
}

export const getAllToolsForAI = getAllTools;

export function getMemoryTools(): OpenAITool[] {
  return getMemoryToolsForAI().map(toOpenAITool);
}

/**
 * Get only core memory tools (Phase 4).
 */
export function getCoreMemoryToolsForAI(): OpenAITool[] {
  return getCoreMemoryTools().map(toOpenAITool);
}

export function getSkillTools(): OpenAITool[] {
  return getSkillToolsForAI().map(toOpenAITool);
}

/**
 * Get only core skill tools (Phase 4).
 */
export function getCoreSkillToolsForAI(): OpenAITool[] {
  return getCoreSkillTools().map(toOpenAITool);
}

// ---------------------------------------------------------------------------
// Tool Categories (unchanged)
// ---------------------------------------------------------------------------

export const TOOL_CATEGORIES = {
  // --- Always-loaded core modules ---
  memory: ['memory_ls', 'memory_grep', 'memory_read', 'memory_write', 'memory_record'],
  skill: [
    'skill_list', 'skill_get', 'skill_ensure', 'skill_delete', 'skill_search',
    'skill_record', 'skill_maturity', 'skill_evals_get', 'skill_evals_set',
    'skill_resource_read', 'skill_resource_write', 'skill_structure', 'skill_workspace_create',
    // Note: skill_create, skill_update were never registered tools — they were ghost entries
    // from an earlier design. Skill creation is handled via skill_record. (cleaned v0.5.0)
  ],

  // --- Optional modules — loaded conditionally based on config (Phase 2) ---
  goal: ['goal_list', 'goal_get', 'goal_create', 'goal_update', 'goal_checkpoint', 'goal_decompose', 'goal_delete', 'goal_summary'],                                    // Requires config.goals.enabled !== false (default: true)
  proactive: ['proactive_schedule', 'proactive_pattern', 'proactive_list', 'proactive_cancel', 'proactive_enable', 'proactive_disable', 'schedule_once', 'notification_send', 'notification_list', 'notification_mark_read', 'notification_delete', 'notification_history', 'notification_stats'],  // Requires daemon mode (bot/web) or config.proactive.enabled === true (default: false)
  persona: ['persona_get', 'persona_update_traits', 'persona_export', 'persona_import', 'persona_explain_traits'],  // Requires config.persona.enabled !== false (default: true)

  // --- Other always-loaded modules ---
  state: ['state_manage', 'state_query', 'state_lock_manage'],

  // [CLEANED v0.5.0] state_legacy — These individual state tools (state_set, state_get, etc.)
  // were consolidated into state_manage / state_query / state_lock_manage in v0.4.0.
  // The legacy names are kept here only for reference; they are no longer registered as tools.
  // Migrated: state_set, state_get, state_delete, state_update, state_exists, state_list,
  //           state_stats, state_lock, state_unlock → state_manage / state_query / state_lock_manage
  state_legacy: [] as string[],

  get builtin() { return [...builtinToolNames]; },
  sandbox: ['sandbox_exec', 'sandbox_write_file', 'sandbox_read_file', 'sandbox_list_files', 'sandbox_status'],

  // [CLEANED v0.5.0] feishu — All Feishu tools have been migrated to the
  // feishu-cli-toolkit skill. These tool names are no longer registered as
  // builtin tools; they are provided dynamically when the skill is loaded
  // via skill_ensure({name: "feishu-cli-toolkit"}).
  //
  // Migration history:
  //   - v0.4.x: feishu_calendar_*, feishu_docx_*, feishu_drive_*,
  //             feishu_bitable_*, feishu_wiki_* → feishu-cli-toolkit skill
  //   - The tool names below are preserved as documentation only.
  feishu: [] as string[],
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

/**
 * Time-period labels for Chinese locale.
 * Quantized to hourly slots to maximise KV Cache hit rate —
 * all requests within the same clock-hour produce identical strings.
 */
const TIME_PERIODS: [number, string][] = [
  [6, '凌晨'], [9, '早上'], [12, '上午'], [14, '中午'],
  [17, '下午'], [19, '傍晚'], [24, '晚上'],
];

function getTimePeriod(hour: number): string {
  for (const [upper, label] of TIME_PERIODS) {
    if (hour < upper) return label;
  }
  return '晚上';
}

/**
 * Build the **volatile** runtime context string.
 *
 * Time is quantized to 5-minute slots (e.g. `下午 15:45`) so that
 * requests within the same 5-minute window produce byte-identical
 * strings — preserving reasonable LLM prefix-cache (KV Cache) hit
 * rate while keeping the reported time accurate to within 5 minutes.
 *
 * Previous implementation quantized to hourly slots (`15:00段`), which
 * could be off by up to 59 minutes and used an ambiguous "段" suffix
 * that confused the LLM about the actual time.
 *
 * Uses `Intl.DateTimeFormat.formatToParts()` for reliable hour/minute
 * extraction across all timezones, avoiding locale-dependent parsing.
 *
 * Weather and holiday are NOT included here — they are available as
 * on-demand tools (`weather`, `get_holiday_info`).
 */
export function getCurrentTimeContext(): string {
  const userLocation = resolveUserLocation();
  const userTimezone = resolveUserTimezone();

  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    timeZone: userTimezone,
  });

  // Use formatToParts for reliable hour/minute extraction (no locale parsing)
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: userTimezone,
  }).formatToParts(now);

  const hourStr = parts.find(p => p.type === 'hour')?.value ?? '00';
  const minuteStr = parts.find(p => p.type === 'minute')?.value ?? '00';
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  // Quantize to 5-minute boundary for cache friendliness
  const quantizedMinute = Math.floor(minute / 5) * 5;
  const period = getTimePeriod(hour);
  const timeSlot = `${String(hour).padStart(2, '0')}:${String(quantizedMinute).padStart(2, '0')}`;

  return `[Runtime Context] 当前真实时间: ${dateStr} ${period} ${timeSlot}, ${userLocation}, tz=${userTimezone}。注意: 对话历史中提到的时间可能是过去的，以此处标注的时间为准。`;
}

/**
 * Build the volatile system message content.
 *
 * Placed in a SEPARATE `{ role: 'system' }` message (messages[1]) so that
 * the stable prompt prefix (messages[0]) is never mutated by time changes,
 * preserving the LLM's KV Cache.
 */
export function buildVolatileContext(): string {
  return getCurrentTimeContext();
}

/**
 * Full time context with version info — used in beeclaw_info tool only,
 * NOT in the volatile system message (to avoid unnecessary cache bust).
 */
export function getFullTimeContext(): string {
  const userLocation = resolveUserLocation();
  const userTimezone = resolveUserTimezone();
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const version = getBeeclawVersion();

  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    timeZone: userTimezone,
  });
  const timeStr = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: userTimezone,
  });

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
    promptLogger.debug('Adding skills layer:', {
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
    promptLogger.warn('Skills layer NOT added:', {
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

  // Layer 8: Goals & session stats (relatively stable across turns)
  // NOTE: Volatile time context is NO LONGER embedded here.
  // It lives in a separate system message (messages[1]) so that the
  // stable prefix (messages[0]) stays byte-identical across turns,
  // enabling LLM prefix-cache (KV Cache) reuse.
  // Weather & holiday data are now on-demand tools, not prompt-injected.
  const stableRuntimeParts: string[] = [];

  const goalsContext = getActiveGoalsContext();
  if (goalsContext) stableRuntimeParts.push(goalsContext);

  const statsContext = getSessionStatsContext(sessionContext);
  if (statsContext) stableRuntimeParts.push(statsContext);

  if (stableRuntimeParts.length > 0) {
    layers.push({
      name: 'runtime-stable',
      content: `\n---\n\n${stableRuntimeParts.join('\n\n')}`,
      priority: LAYER_PRIORITIES.RUNTIME,
      trimmable: true,  // goals/stats can be trimmed if budget is tight
    });
  }

  // --- Assemble with budget ---
  const result = assembleBudgetedPrompt(layers, budgetConfig);

  // Log final result
  promptLogger.debug('Final prompt assembly:', {
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
// Skill Formatting + injection-defence sanitisation
//
// base.md classifies skill content as UNTRUSTED (it lives on disk and may
// be authored by anyone), but skill `name`/`description`/`triggers` are
// injected verbatim into the system prompt. A poisoned skill could try to
// fake role boundaries ("system: …"), insert section separators ("---"),
// drop new-prompt blocks via newlines, or smuggle "ignore previous
// instructions" phrasing. The sanitiser below scrubs these patterns
// before the text crosses the prompt boundary.
//
// The defence is conservative — it scrubs the syntactic markers that an
// attacker would need to *look like* a new prompt section. CJK content
// and ordinary descriptive language pass through unchanged.
// ---------------------------------------------------------------------------

/** Phrases an attacker uses to try to override the system prompt. */
const INJECTION_PHRASES: RegExp[] = [
  // The {previous|prior|above} word is the load-bearing signal; the suffix
  // (instructions/rules/prompts) is optional so a bare "ignore previous"
  // appearing in a trigger is also caught.
  /ignore\s+(?:all\s+)?(?:previous|prior|above)(?:\s+(?:instructions?|rules?|prompts?))?/gi,
  /disregard\s+(?:the\s+)?(?:previous|prior|above|system)\s*(?:instructions?|rules?|prompts?)?/gi,
  /forget\s+(?:all\s+)?(?:previous|prior|above)\s*(?:instructions?|rules?|prompts?|context)?/gi,
  /you\s+are\s+now\s+(?:a|an|the)?/gi,
  /new\s+(?:system\s+)?(?:instructions?|prompts?|rules?)\s*[:：]/gi,
  /override\s+(?:the\s+)?(?:system\s+)?(?:prompt|instructions?|rules?)/gi,
];

/** Strip role headers, XML chat tags, and section separators. */
const STRUCTURAL_PATTERNS: RegExp[] = [
  /\b(?:system|user|assistant|human|ai)\s*[:：]/gi,
  /<\/?(?:system|user|assistant|human|ai)\b[^>]*>/gi,
  /-{3,}/g,                  // any run of 3+ hyphens (section break)
  /={3,}/g,                  // ditto for "===" headers
];

/** Allowed name pattern: kebab-case-ish identifiers only. */
const NAME_ALLOWED = /[^a-zA-Z0-9_-]/g;

/**
 * Scrub a free-text skill field (description or trigger) before it crosses
 * the prompt boundary.
 *
 * Steps (order matters):
 *  1. Coerce to string and flatten whitespace (kills multiline injection)
 *  2. Drop control characters and zero-width joiners
 *  3. Drop backticks (would break the markdown bullet's inline-code grammar)
 *  4. Strip role markers, XML chat tags, section separators
 *  5. Replace explicit injection phrases with a placeholder so the
 *     LLM still sees that *something* was filtered
 *  6. Truncate to maxLen with an ellipsis suffix
 *
 * @param raw    User-controlled string from skill metadata
 * @param maxLen Hard cap on output length
 */
function sanitizeSkillField(raw: string | undefined, maxLen: number): string {
  if (!raw) return '';
  let s = String(raw);

  // 1. Flatten whitespace runs (newlines, tabs → single space).
  s = s.replace(/[\s]+/g, ' ');

  // 2. Drop ASCII control chars and common zero-width joiners.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');

  // 3. Drop backticks (markdown code fences inside a bullet are ambiguous).
  s = s.replace(/`/g, '');

  // 4. Strip structural markers that mimic prompt sections.
  for (const pat of STRUCTURAL_PATTERNS) {
    s = s.replace(pat, ' ');
  }

  // 5. Redact explicit override phrases.
  for (const pat of INJECTION_PHRASES) {
    s = s.replace(pat, '[redacted]');
  }

  // 6. Collapse any whitespace runs the substitutions introduced.
  s = s.replace(/\s+/g, ' ').trim();

  // 7. Truncate.
  if (s.length > maxLen) s = s.slice(0, maxLen - 2) + '..';
  return s;
}

/**
 * Scrub a skill name. Names anchor identity in the prompt and feed
 * skill_get() lookups, so we enforce a strict allowlist.
 */
function sanitizeSkillName(raw: string | undefined): string {
  if (!raw) return '';
  // Drop the structural patterns first (so "system: foo" → " foo" → "foo"),
  // then apply the allowlist, then cap length.
  let s = String(raw);
  for (const pat of STRUCTURAL_PATTERNS) s = s.replace(pat, '');
  s = s.replace(NAME_ALLOWED, '');
  if (s.length > 60) s = s.slice(0, 60);
  return s || 'unnamed-skill';
}

export function formatSkillsForPrompt(
  skills: Array<{ name: string; description: string; triggers?: string[] }>
): string {
  if (!skills || skills.length === 0) return '';

  // Compressed format: skill name + short desc + key triggers
  // Balances token efficiency (~1100 tokens for 30 skills) with matching accuracy.
  const maxDescLen = 45;
  const maxTriggerLen = 30;
  const maxTriggers = 3;

  const skillList = skills.map(skill => {
    const safeName = sanitizeSkillName(skill.name);
    const safeDesc = sanitizeSkillField(skill.description, maxDescLen);

    const triggerArr = skill.triggers ?? [];
    const keyTriggers = triggerArr
      .slice(0, maxTriggers)
      .map(t => sanitizeSkillField(t, maxTriggerLen))
      .filter(t => t.length > 0);
    const hasMore = triggerArr.length > maxTriggers;
    const triggerStr = keyTriggers.length > 0
      ? ` [${keyTriggers.join(', ')}${hasMore ? ', ...' : ''}]`
      : '';

    return `- **${safeName}**: ${safeDesc}${triggerStr}`;
  }).join('\n');

  return `## Available Skills (${skills.length})

${skillList}

**Usage**: Call \`skill_get(name)\` to load full workflow before execution.`;
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
