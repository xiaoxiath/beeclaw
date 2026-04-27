/**
 * Built-in Tools for Beeclaw — Aggregation Entry
 *
 * This file serves as the central aggregation point for all builtin tools.
 * Individual tool implementations have been extracted into focused submodules:
 *
 *   - search-tools.ts   — WebSearch, WebFetch
 *   - time-tools.ts     — Time, Weather
 *   - info-tools.ts     — BeeclawInfo
 *   - calc-tools.ts     — Calc, CodeExecute, ClaudeCode
 *   - finance-tools.ts  — [DEPRECATED] Migrated to beeclaw-hedge-fund-research skill
 *   - file-system-tools.ts — FileRead/Write/List/Delete, Shell
 *   - deep-research-tools.ts — DeepResearch
 *
 * Shared types and utilities remain here to avoid circular dependencies.
 *
 * ## Migration History (v0.5.0)
 * - stock_quote, stock_history, stock_financial, stock_info → beeclaw-hedge-fund-research skill
 * - datasource_health_check → internal-only (removed from LLM tool exposure)
 * - create_chart → removed from LLM tool registry (renderer still available internally)
 * - get_holiday_info → deprecated, use web_search instead
 */

import { z } from 'zod';
import { getSearchConfig } from '../../infra/config';
import { logger } from '../../infra/observability/logger';
import type { MemoryToolResult } from '../memory/types';
import {
  type SpawnSubagentParams,
  type SpawnParallelParams,
} from '../subagent/tools';
import {
  executeSpawnSubagent,
  executeSpawnParallel,
} from '../subagent/executor';
import {
  type StateSetParams,
  type StateGetParams,
  type StateDeleteParams,
  type StateUpdateParams,
  type StateExistsParams,
  type StateListParams,
  type StateLockParams,
  type StateUnlockParams,
} from '../subagent/state-tools-consolidated';
import {
  stateManageTool,
  stateQueryTool,
  stateLockManageTool,
  type StateManageParams,
  type StateQueryParams,
  type StateLockManageParams,
} from '../subagent/state-tools-consolidated';
import {
  executeStateSet,
  executeStateGet,
  executeStateDelete,
  executeStateUpdate,
  executeStateExists,
  executeStateList,
  executeStateStats,
  executeStateLock,
  executeStateUnlock,
  executeStateManage,
  executeStateQuery,
  executeStateLockManage,
} from '../subagent/state-executor';
import {
  requestDeepAnalysisTool,
  executeRequestDeepAnalysis
} from './deep-analysis';
import {
  updateUserSettingsTool,
  executeUpdateUserSettings,
} from './user-settings';
import {
  askUserQuestionTool,
  executeAskUserQuestion,
} from './user-interaction';
import {
  sandboxTools,
  executeSandboxTool,
} from '../sandbox/tools';
import {
  processDatasourceHealthCheck,
  DataSourceHealthChecker,
} from './datasource-health';
import { FINANCE_MIGRATION_MESSAGE } from './finance-tools';

// ============================================================================
// Re-export all submodule tools
// ============================================================================

// Search tools
export {
  WebSearchSchema,
  webSearchTool,
  executeWebSearch,
  WebFetchSchema,
  webFetchTool,
  executeWebFetch,
} from './search-tools';

// Time & Weather tools
export {
  TimeSchema,
  timeTool,
  executeTime,
  WeatherSchema,
  weatherTool,
  executeWeather,
} from './time-tools';

// Info tools
export {
  beeclawInfoTool,
  executeBeeclawInfo,
} from './info-tools';

// Calc & Code tools
export {
  CalcSchema,
  calcTool,
  executeCalc,
  CodeExecuteSchema,
  codeExecuteTool,
  executeCode,
  ClaudeCodeSchema,
  claudeCodeTool,
  executeClaudeCode,
} from './calc-tools';

// Finance tools — DEPRECATED stubs for backward compatibility
// These re-exports are kept so that any external code importing from builtin.ts
// will still compile, but the executors return migration messages at runtime.
export {
  StockQuoteSchema,
  stockQuoteTool,
  executeStockQuote,
  StockHistorySchema,
  stockHistoryTool,
  executeStockHistory,
  StockFinancialSchema,
  stockFinancialTool,
  executeStockFinancial,
  StockInfoSchema,
  stockInfoTool,
  executeStockInfo,
} from './finance-tools';

// Finance migration exports
export { FINANCE_TOOL_NAMES, FINANCE_MIGRATION_MESSAGE } from './finance-tools';

// File system & Shell tools
export {
  FileReadSchema,
  fileReadTool,
  executeFileRead,
  FileWriteSchema,
  fileWriteTool,
  executeFileWrite,
  FileListSchema,
  fileListTool,
  executeFileList,
  FileDeleteSchema,
  fileDeleteTool,
  executeFileDelete,
  ShellSchema,
  shellTool,
  executeShell,
  isCommandSafe,
  ensureOutputDirs,
  isPathAllowed,
} from './file-system-tools';

// Deep Research tools
export {
  DeepResearchSchema,
  deepResearchTool,
  executeDeepResearch,
} from './deep-research-tools';

// ============================================================================
// Shared Types & Utilities (kept here to avoid circular deps)
// ============================================================================

// Module-level health checker instance (initialized via setupHealthChecker)
let _healthChecker: DataSourceHealthChecker | null = null;

export function setupHealthChecker(checker: DataSourceHealthChecker): void {
  _healthChecker = checker;
}

export function getHealthChecker(): DataSourceHealthChecker | null {
  return _healthChecker;
}

export type BuiltinToolResult = MemoryToolResult;

/**
 * Clean up text to save tokens - remove excessive whitespace and newlines
 */
export function cleanText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')       // Remove trailing spaces before newlines
    .replace(/\n[ \t]+/g, '\n')       // Remove leading spaces after newlines
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Multiple newlines with spaces -> 2 newlines
    .replace(/\n{3,}/g, '\n\n')       // Max 2 consecutive newlines
    .replace(/[ \t]{2,}/g, ' ')       // Max 1 consecutive space
    .trim();
}

// ============================================================================
// Subagent Tools (kept here — they are thin wrappers, not worth a separate file)
// ============================================================================

export const spawnSubagentToolDef = {
  name: 'spawn_subagent',
  description: `Spawn a specialized subagent to handle a specific task.

Use this tool when you need to delegate a focused task to a specialized agent.
The subagent will have access to a limited set of tools appropriate for its type.

Available subagent types:
- explorer: Read-only local code/data/document exploration
- reviewer: Read-only review with concrete findings and evidence
- researcher: Official docs/external source research
- triager: Logs, tests, incidents, and root-cause analysis
- worker: Bounded implementation within explicit ownership
- verifier: Test/build/lint/behavior verification
- memory: Memory operations, knowledge management
- skill: Skill creation, execution, evaluation

Legacy aliases are still accepted:
- research -> researcher
- code -> worker
- general -> explorer

Best practices:
1. Use subagents only when isolation, parallelism, review, or permission boundaries help
2. Provide a self-contained, focused task
3. Include relevant context, constraints, expected output, and success criteria
4. For worker tasks, provide ownership boundaries
5. Keep fan-out small and use spawn_parallel only for truly independent tasks`,

  parameters: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['explorer', 'reviewer', 'researcher', 'triager', 'worker', 'verifier', 'memory', 'skill', 'research', 'code', 'general'],
        description: 'Subagent role. Prefer narrow roles; legacy aliases are accepted.',
      },
      task: {
        type: 'string',
        description: 'Clear description of the task to accomplish',
      },
      context: {
        type: 'string',
        description: 'Additional context or requirements',
      },
      expectedOutput: {
        type: 'string',
        description: 'Expected result shape or deliverable. Include evidence/verified/not_verified/next_action expectations when relevant.',
      },
      successCriteria: {
        type: 'array',
        items: { type: 'string' },
        description: 'Explicit acceptance criteria for this subtask.',
      },
      ownership: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files, directories, or modules the subagent owns. Required for worker-style implementation tasks.',
      },
      constraints: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional constraints, including what not to do.',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional subset of the role tool profile. Cannot grant tools outside the role permission envelope.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 180000, capped by role policy)',
      },
    },
    required: ['type', 'task'],
  },
};

export const spawnParallelToolDef = {
  name: 'spawn_parallel',
  description: `Spawn multiple subagents in parallel to handle independent tasks.

Use this tool when you have multiple independent tasks that can be executed simultaneously.
This is more efficient than spawning subagents one by one.

Best practices:
1. Only include truly independent tasks (no dependencies)
2. Keep the number reasonable (2-5 tasks; hard cap is 6 concurrent agents)
3. Use appropriate subagent types for each task
4. Do not parallelize tasks that write the same files or share unresolved design decisions
5. For worker tasks, provide disjoint ownership boundaries`,

  parameters: {
    type: 'object' as const,
    properties: {
      tasks: {
        type: 'array',
        description: 'List of subagent tasks to execute in parallel',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['explorer', 'reviewer', 'researcher', 'triager', 'worker', 'verifier', 'memory', 'skill', 'research', 'code', 'general'],
            },
            task: {
              type: 'string',
            },
            context: {
              type: 'string',
            },
            expectedOutput: {
              type: 'string',
            },
            successCriteria: {
              type: 'array',
              items: { type: 'string' },
            },
            ownership: {
              type: 'array',
              items: { type: 'string' },
            },
            constraints: {
              type: 'array',
              items: { type: 'string' },
            },
            tools: {
              type: 'array',
              items: { type: 'string' },
            },
            timeout: {
              type: 'number',
            },
          },
          required: ['type', 'task'],
        },
      },
      maxParallelism: {
        type: 'number',
        description: 'Maximum number of parallel executions (default: 3)',
      },
    },
    required: ['tasks'],
  },
};

export async function executeSpawnSubagentTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  return executeSpawnSubagent(params as unknown as SpawnSubagentParams);
}

export async function executeSpawnParallelTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  return executeSpawnParallel(params as unknown as SpawnParallelParams);
}

// ============================================================================
// State Management Tools (kept here — validation wrappers)
// ============================================================================

/**
 * Runtime validation schemas for state tool parameters.
 *
 * SECURITY FIX (P0): Replace unsafe `as` type assertions with Zod runtime
 * validation.
 */
const StateSetParamsSchema = z.object({
  key: z.string().min(1, 'key is required'),
  value: z.unknown(),
  ttl: z.number().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const StateGetParamsSchema = z.object({
  key: z.string().min(1, 'key is required'),
});

const StateDeleteParamsSchema = z.object({
  key: z.string().min(1, 'key is required'),
});

const StateUpdateParamsSchema = z.object({
  key: z.string().min(1, 'key is required'),
  operation: z.enum(['increment', 'decrement', 'append', 'prepend', 'merge', 'replace']),
  value: z.unknown().optional(),
  ttl: z.number().positive().optional(),
});

const StateExistsParamsSchema = z.object({
  key: z.string().min(1, 'key is required'),
});

const StateListParamsSchema = z.object({
  prefix: z.string().optional(),
});

const StateLockParamsSchema = z.object({
  key: z.string().min(1, 'key is required'),
  owner: z.string().optional(),
  timeout: z.number().positive().optional(),
});

const StateUnlockParamsSchema = z.object({
  key: z.string().min(1, 'key is required'),
});

const StateManageParamsSchema = z.object({
  action: z.enum(['set', 'get', 'update', 'delete']),
  key: z.string().min(1, 'key is required'),
  value: z.unknown().optional(),
  operation: z.enum(['increment', 'decrement', 'append', 'prepend', 'merge', 'replace']).optional(),
  ttl: z.number().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const StateQueryParamsSchema = z.object({
  action: z.enum(['list', 'exists', 'stats']),
  key: z.string().optional(),
  prefix: z.string().optional(),
});

const StateLockManageParamsSchema = z.object({
  action: z.enum(['acquire', 'release']),
  key: z.string().min(1, 'key is required'),
  owner: z.string().optional(),
  timeout: z.number().positive().optional(),
});

/** Helper: validate params with a Zod schema and return early on failure */
function validateStateParams<T>(schema: z.ZodType<T>, params: Record<string, unknown>): { success: true; data: T } | { success: false; result: BuiltinToolResult } {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    return { success: false, result: { success: false, error: `Invalid params: ${parsed.error.message}` } };
  }
  return { success: true, data: parsed.data };
}

export async function executeStateSetTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const v = validateStateParams(StateSetParamsSchema, params);
  if (!v.success) return v.result;
  return executeStateSet(v.data as StateSetParams);
}

export async function executeStateGetTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const v = validateStateParams(StateGetParamsSchema, params);
  if (!v.success) return v.result;
  return executeStateGet(v.data as StateGetParams);
}

export async function executeStateDeleteTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const v = validateStateParams(StateDeleteParamsSchema, params);
  if (!v.success) return v.result;
  return executeStateDelete(v.data as StateDeleteParams);
}

export async function executeStateUpdateTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const v = validateStateParams(StateUpdateParamsSchema, params);
  if (!v.success) return v.result;
  return executeStateUpdate(v.data as StateUpdateParams);
}

export async function executeStateExistsTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const v = validateStateParams(StateExistsParamsSchema, params);
  if (!v.success) return v.result;
  return executeStateExists(v.data as StateExistsParams);
}

export async function executeStateListTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const v = validateStateParams(StateListParamsSchema, params);
  if (!v.success) return v.result;
  return executeStateList(v.data as StateListParams);
}

export async function executeStateStatsTool(_params: Record<string, unknown>): Promise<BuiltinToolResult> {
  return executeStateStats();
}

export async function executeStateLockTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const v = validateStateParams(StateLockParamsSchema, params);
  if (!v.success) return v.result;
  return executeStateLock(v.data as StateLockParams);
}

export async function executeStateUnlockTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const v = validateStateParams(StateUnlockParamsSchema, params);
  if (!v.success) return v.result;
  return executeStateUnlock(v.data as StateUnlockParams);
}

// Consolidated state tool executors
export async function executeStateManageTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const v = validateStateParams(StateManageParamsSchema, params);
  if (!v.success) return v.result;
  return executeStateManage(v.data as StateManageParams);
}

export async function executeStateQueryTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const v = validateStateParams(StateQueryParamsSchema, params);
  if (!v.success) return v.result;
  return executeStateQuery(v.data as StateQueryParams);
}

export async function executeStateLockManageTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const v = validateStateParams(StateLockManageParamsSchema, params);
  if (!v.success) return v.result;
  return executeStateLockManage(v.data as StateLockManageParams);
}

// ============================================================================
// Chart Creation Tool (for Card V2)
// [DEPRECATED] Removed from LLM tool registry in v0.5.0.
// The createChartTool definition and executeCreateChart function are kept
// for internal use by the card renderer, but are no longer registered in
// builtinTools below.
// ============================================================================

const ChartTypeSchema = z.enum([
  'line',
  'area',
  'bar',
  'pie',
  'scatter',
  'radar',
  'funnel',
  'wordCloud',
  'linearProgress',
  'circularProgress',
  'common',
]);

/** @deprecated Since v0.5.0 — Removed from LLM tool registry. Kept for internal card rendering. */
export const createChartTool = {
  name: 'create_chart',
  description: `[DEPRECATED] Create a chart visualization for Feishu Card V2 messages. This tool has been removed from the LLM tool registry. Chart creation is now handled internally by the card renderer.`,

  parameters: {
    type: 'object' as const,
    properties: {
      chartType: {
        type: 'string' as const,
        enum: [
          'line',
          'area',
          'bar',
          'pie',
          'scatter',
          'radar',
          'funnel',
          'wordCloud',
          'linearProgress',
          'circularProgress',
          'common',
        ],
        description: 'Type of chart to create',
      },
      title: {
        type: 'string' as const,
        description: 'Chart title (optional)',
      },
      data: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
        },
        description: 'Chart data (see chart-best-practices skill)',
      },
      spec: {
        type: 'object' as const,
        description: 'Additional VChart spec options (optional). Allows customization of axes, legends, colors, etc.',
      },
      aspectRatio: {
        type: 'string' as const,
        enum: ['1:1', '2:1', '4:3', '16:9'],
        description: 'Chart aspect ratio (default: 2:1)',
      },
      colorTheme: {
        type: 'string' as const,
        enum: ['brand', 'rainbow', 'complementary', 'converse', 'primary'],
        description: 'Color theme (default: brand)',
      },
    },
    required: ['chartType', 'data'],
  },
};

/** @deprecated Since v0.5.0 — Kept for internal card rendering use only. */
export async function executeCreateChart(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  try {
    const chartType = ChartTypeSchema.parse(params.chartType);
    const data = params.data as Array<Record<string, unknown>>;

    if (!Array.isArray(data) || data.length === 0) {
      return {
        success: false,
        error: 'Data must be a non-empty array',
      };
    }

    // Build the chart content block
    const chartBlock = {
      type: 'chart_data' as const,
      chartType,
      data,
      ...(typeof params.title !== 'undefined' ? { title: String(params.title) } : {}),
      ...(typeof params.spec !== 'undefined' ? { spec: params.spec as Record<string, unknown> } : {}),
      ...(typeof params.aspectRatio !== 'undefined' ? { aspectRatio: params.aspectRatio as string } : {}),
      ...(typeof params.colorTheme !== 'undefined' ? { colorTheme: params.colorTheme as string } : {}),
    };

    logger.debug('[create_chart] Returning chart block:', {
      hasContentBlock: true,
      success: true,
      dataType: chartBlock.type,
      chartType: chartBlock.chartType,
    });

    return {
      success: true,
      data: chartBlock,
      // Special marker to indicate this should trigger onContentBlock
      _contentBlock: true,
    };
  } catch (error) {
    logger.error('[create_chart] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create chart',
    };
  }
}

// ============================================================================
// Tool Registry
// ============================================================================

// Import tool definitions from submodules for registry
import { webSearchTool, executeWebSearch } from './search-tools';
import { webFetchTool, executeWebFetch } from './search-tools';
import { timeTool, executeTime } from './time-tools';
import { weatherTool, executeWeather } from './time-tools';
import { holidayToolDef, executeHolidayTool } from './holiday';
import { beeclawInfoTool, executeBeeclawInfo } from './info-tools';
import { calcTool, executeCalc } from './calc-tools';
import { codeExecuteTool, executeCode } from './calc-tools';
import { claudeCodeTool, executeClaudeCode } from './calc-tools';
import { deepResearchTool, executeDeepResearch } from './deep-research-tools';
import {
  fileReadTool, executeFileRead,
  fileWriteTool, executeFileWrite,
  fileListTool, executeFileList,
  fileDeleteTool, executeFileDelete,
  shellTool, executeShell,
} from './file-system-tools';

// ---------------------------------------------------------------------------
// Removed tools (v0.5.0 migration):
//   - stock_quote, stock_history, stock_financial, stock_info
//     → migrated to beeclaw-hedge-fund-research skill
//   - datasource_health_check
//     → removed from LLM exposure; internal class still available
//   - create_chart
//     → removed from LLM exposure; internal function still available
// ---------------------------------------------------------------------------

// ============================================================================
// Phase 4: Layered Built-in Tool Loading
// ============================================================================

/** Core builtin tools — always registered */
export const coreBuiltinTools: Record<string, any> = {
  web_search: webSearchTool,
  web_fetch: webFetchTool,
  time_now: timeTool,
  beeclaw_info: beeclawInfoTool,
  calc: calcTool,
  code_execute: codeExecuteTool,
  weather: weatherTool,
  get_holiday_info: holidayToolDef,
  // stock_quote — REMOVED: migrated to beeclaw-hedge-fund-research skill (v0.5.0)
  // stock_history — REMOVED: migrated to beeclaw-hedge-fund-research skill (v0.5.0)
  // stock_financial — REMOVED: migrated to beeclaw-hedge-fund-research skill (v0.5.0)
  // stock_info — REMOVED: migrated to beeclaw-hedge-fund-research skill (v0.5.0)
  claude_code: claudeCodeTool,
  file_read: fileReadTool,
  file_write: fileWriteTool,
  file_list: fileListTool,
  file_delete: fileDeleteTool,
  shell: shellTool,
  spawn_subagent: spawnSubagentToolDef,
  spawn_parallel: spawnParallelToolDef,
  update_user_settings: updateUserSettingsTool,
  // Sandbox tools
  sandbox_exec: sandboxTools.sandbox_exec,
  sandbox_write_file: sandboxTools.sandbox_write_file,
  sandbox_read_file: sandboxTools.sandbox_read_file,
  sandbox_list_files: sandboxTools.sandbox_list_files,
  sandbox_status: sandboxTools.sandbox_status,
  // datasource_health_check — REMOVED: deprecated, internal only (v0.5.0)
  ask_user_question: askUserQuestionTool,
  // create_chart — REMOVED: deprecated, internal renderer only (v0.5.0)
};

/** Deep research/analysis tools — only when search provider is configured */
export const conditionalDeepResearchTools: Record<string, any> = {
  deep_research: deepResearchTool,
  request_deep_analysis: requestDeepAnalysisTool,
};

/** Subagent state tools — only when subagent orchestration is active */
export const conditionalSubagentStateTools: Record<string, any> = {
  state_manage: stateManageTool,
  state_query: stateQueryTool,
  state_lock_manage: stateLockManageTool,
};

/** Tool name arrays for conditional groups */
export const DEEP_RESEARCH_TOOL_NAMES = Object.keys(conditionalDeepResearchTools);
export const SUBAGENT_STATE_TOOL_NAMES = Object.keys(conditionalSubagentStateTools);

/**
 * Check if any search provider is configured.
 * Returns true if at least one search API key is present.
 */
export function isSearchProviderConfigured(): boolean {
  try {
    const searchConfig = getSearchConfig();
    return !!(
      searchConfig.bochaApiKey ||
      searchConfig.tavilyApiKey ||
      searchConfig.googleApiKey ||
      searchConfig.bingApiKey ||
      searchConfig.braveApiKey
    );
  } catch {
    // Config not available — default to including the tools for safety
    return true;
  }
}

/**
 * Get core builtin tools (always registered).
 */
export function getCoreBuiltinTools() {
  return Object.values(coreBuiltinTools);
}

/**
 * Get deep research tools (conditionally registered).
 * Only available when a search provider is configured.
 */
export function getDeepResearchTools() {
  return Object.values(conditionalDeepResearchTools);
}

/**
 * Get subagent state tools (conditionally registered).
 * Only needed during subagent orchestration.
 */
export function getSubagentStateTools() {
  return Object.values(conditionalSubagentStateTools);
}

/**
 * Get builtin tools with conditional loading applied.
 * This is the recommended function for production use.
 *
 * @param options.sandboxEnabled - Whether sandbox is active (hides superseded tools)
 * @param options.isSubagentContext - Whether subagent orchestration is active
 * @param options.forceAll - Force loading all tools (backward compat)
 */
export function getBuiltinToolsConditional(options: {
  sandboxEnabled?: boolean;
  isSubagentContext?: boolean;
  forceAll?: boolean;
} = {}): any[] {
  if (options.forceAll) {
    return Object.values(builtinTools);
  }

  let toolEntries = Object.entries(coreBuiltinTools);

  // Conditionally add deep research tools
  if (isSearchProviderConfigured()) {
    toolEntries = [...toolEntries, ...Object.entries(conditionalDeepResearchTools)];
  }

  // Conditionally add subagent state tools
  if (options.isSubagentContext) {
    toolEntries = [...toolEntries, ...Object.entries(conditionalSubagentStateTools)];
  }

  // Apply sandbox filtering if needed
  if (options.sandboxEnabled) {
    return toolEntries
      .filter(([name]) => !SANDBOX_SUPERSEDED_TOOLS.has(name))
      .map(([, tool]) => tool);
  }

  return toolEntries.map(([, tool]) => tool);
}

/**
 * Full builtinTools map — backward compatible, includes ALL tools.
 * Used by executeBuiltinTool and isBuiltinTool for dispatch.
 */
export const builtinTools: Record<string, any> = {
  ...coreBuiltinTools,
  ...conditionalDeepResearchTools,
  ...conditionalSubagentStateTools,
};

export const builtinToolNames = Object.keys(builtinTools);

/**
 * Tools that overlap with sandbox and should be hidden when sandbox is enabled.
 * Execution logic in executeBuiltinTool is preserved for backward compatibility
 * (in case the LLM still calls them), but they won't appear in the tool list.
 */
const SANDBOX_SUPERSEDED_TOOLS: ReadonlySet<string> = new Set([
  'file_read',
  'file_write',
  'file_list',
  'file_delete',
  'shell',
  'code_execute',
]);

/**
 * Get all builtin tools in OpenAI format (backward compatible — returns ALL).
 *
 * When `sandboxEnabled` is true, tools that are superseded by sandbox
 * equivalents (file_read/write/list/delete, shell, code_execute) are
 * excluded from the returned list to avoid wasting tool slots.
 *
 * NOTE: executeBuiltinTool() still handles these tools — this only
 * controls what the LLM *sees* as available options.
 *
 * For production use with conditional loading, prefer `getBuiltinToolsConditional()`.
 */
export function getBuiltinToolsForAI(options?: { sandboxEnabled?: boolean }) {
  const allTools = Object.entries(builtinTools);

  if (options?.sandboxEnabled) {
    return allTools
      .filter(([name]) => !SANDBOX_SUPERSEDED_TOOLS.has(name))
      .map(([, tool]) => tool);
  }

  return allTools.map(([, tool]) => tool);
}

// ---------------------------------------------------------------------------
// Deprecated / migrated tool names — used for fallback migration messages
// ---------------------------------------------------------------------------
const MIGRATED_FINANCE_TOOLS = new Set(['stock_quote', 'stock_history', 'stock_financial', 'stock_info']);
const DEPRECATED_TOOL_MESSAGES: Record<string, string> = {
  datasource_health_check: 'datasource_health_check has been deprecated. Health checks are now performed automatically by the system.',
  create_chart: 'create_chart has been removed from the tool registry. Chart rendering is now handled internally by the card renderer.',
};

// Execute a builtin tool
export async function executeBuiltinTool(name: string, params: Record<string, unknown>): Promise<BuiltinToolResult> {
  // --- Fallback for migrated/deprecated tools (v0.5.0) ---
  if (MIGRATED_FINANCE_TOOLS.has(name)) {
    return { success: false, error: FINANCE_MIGRATION_MESSAGE };
  }
  if (name in DEPRECATED_TOOL_MESSAGES) {
    // datasource_health_check: still execute internally for backward compat
    if (name === 'datasource_health_check') {
      if (!_healthChecker) {
        return { success: false, error: 'Health checker not initialized. Call setupHealthChecker() during app bootstrap.' };
      }
      try {
        const healthResult = await processDatasourceHealthCheck(params, _healthChecker, logger);
        return { success: true, data: healthResult };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Health check failed: ${msg}` };
      }
    }
    // create_chart: still execute internally for backward compat
    if (name === 'create_chart') {
      return executeCreateChart(params);
    }
    return { success: false, error: DEPRECATED_TOOL_MESSAGES[name] };
  }

  switch (name) {
    case 'web_search':
      return executeWebSearch(params);
    case 'web_fetch':
      return executeWebFetch(params);
    case 'time_now':
      return executeTime(params);
    case 'beeclaw_info':
      return executeBeeclawInfo();
    case 'calc':
      return executeCalc(params);
    case 'code_execute':
      return executeCode(params);
    case 'weather':
      return executeWeather(params);
    case 'get_holiday_info':
      return executeHolidayTool(params);
    case 'claude_code':
      return executeClaudeCode(params);
    case 'deep_research':
      return executeDeepResearch(params);
    case 'file_read':
      return executeFileRead(params);
    case 'file_write':
      return executeFileWrite(params);
    case 'file_list':
      return executeFileList(params);
    case 'file_delete':
      return executeFileDelete(params);
    case 'shell':
      return executeShell(params);
    case 'spawn_subagent':
      return executeSpawnSubagentTool(params);
    case 'spawn_parallel':
      return executeSpawnParallelTool(params);
    // Consolidated state tools
    case 'state_manage':
      return executeStateManageTool(params);
    case 'state_query':
      return executeStateQueryTool(params);
    case 'state_lock_manage':
      return executeStateLockManageTool(params);
    case 'request_deep_analysis':
      return executeRequestDeepAnalysis(params);
    case 'update_user_settings':
      return executeUpdateUserSettings(params);
    case 'ask_user_question':
      return executeAskUserQuestion(params as unknown as import('./user-interaction').AskUserQuestionParams) as Promise<BuiltinToolResult>;
    // Sandbox tools
    case 'sandbox_exec':
    case 'sandbox_write_file':
    case 'sandbox_read_file':
    case 'sandbox_list_files':
    case 'sandbox_status':
      return executeSandboxTool(name, params);
    default:
      return { success: false, error: `Unknown builtin tool: ${name}` };
  }
}

// Check if a tool is a builtin tool
export function isBuiltinTool(name: string): boolean {
  return builtinToolNames.includes(name);
}


// ============================================================================
// Phase 4: Category re-exports & aggregator
// ============================================================================

// Re-export consolidated state tools for backward compatibility
export { stateManageTool, stateQueryTool, stateLockManageTool } from '../subagent/state-tools-consolidated';

// Phase 4 summary:
// - Core builtin tools: always loaded (getCoreBuiltinTools)
// - Deep research tools (deep_research, request_deep_analysis): loaded when search provider configured — 2 tools
// - Subagent state tools (state_manage, state_query, state_lock_manage): loaded in subagent context — 3 tools
// - Use getBuiltinToolsConditional() for production, getBuiltinToolsForAI() for backward compat
