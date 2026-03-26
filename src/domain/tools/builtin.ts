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
 *   - finance-tools.ts  — StockQuote, StockHistory, StockFinancial, StockInfo
 *   - file-system-tools.ts — FileRead/Write/List/Delete, Shell
 *   - deep-research-tools.ts — DeepResearch
 *
 * Shared types and utilities remain here to avoid circular dependencies.
 */

import { z } from 'zod';
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
} from '../subagent/state-tools';
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
  datasourceHealthCheckTool,
  processDatasourceHealthCheck,
  DataSourceHealthChecker,
} from './datasource-health';

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

// Finance tools
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
- research: Information gathering, web search, reading documents
- memory: Memory operations, knowledge management
- skill: Skill creation, execution, evaluation
- code: Code generation, file operations
- general: General-purpose tasks with full tool access

Best practices:
1. Choose the appropriate subagent type
2. Provide a clear, focused task description
3. Include relevant context
4. Set reasonable timeout for complex tasks`,

  parameters: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['research', 'memory', 'skill', 'code', 'general'],
        description: 'Type of subagent (determines available tools)',
      },
      task: {
        type: 'string',
        description: 'Clear description of the task to accomplish',
      },
      context: {
        type: 'string',
        description: 'Additional context or requirements',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 60000)',
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
2. Keep the number reasonable (2-5 tasks)
3. Use appropriate subagent types for each task
4. Set maxParallelism based on task complexity`,

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
              enum: ['research', 'memory', 'skill', 'code', 'general'],
            },
            task: {
              type: 'string',
            },
            context: {
              type: 'string',
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
  return executeSpawnSubagent(params as SpawnSubagentParams);
}

export async function executeSpawnParallelTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  return executeSpawnParallel(params as SpawnParallelParams);
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

export const createChartTool = {
  name: 'create_chart',
  description: `Create a chart visualization for Feishu Card V2 messages. Use this tool to present data visually instead of plain text when:
- Showing trends over time (use line/area charts)
- Comparing quantities (use bar/pie charts)
- Displaying proportions (use pie charts)
- Showing relationships (use scatter charts)
- Tracking progress (use progress charts)

IMPORTANT: This tool returns a special content block that will be rendered as an interactive chart in Feishu. Always use this when presenting numerical data, comparisons, or trends.

Available chart types:
- line: Line chart for trends
- area: Area chart for cumulative trends
- bar: Bar chart for comparisons
- pie: Pie chart for proportions
- scatter: Scatter plot for correlations
- radar: Radar chart for multi-dimensional data
- funnel: Funnel chart for stages/flows
- wordCloud: Word cloud for text frequency
- linearProgress: Linear progress bar
- circularProgress: Circular progress indicator
- common: Generic chart (for custom VChart specs)`,

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
      ...(params.title && { title: String(params.title) }),
      ...(params.spec && { spec: params.spec as Record<string, unknown> }),
      ...(params.aspectRatio && { aspectRatio: params.aspectRatio as string }),
      ...(params.colorTheme && { colorTheme: params.colorTheme as string }),
    };

    logger.debug('[create_chart] 🎨 Returning chart block:', {
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
    logger.error('[create_chart] ❌ Error:', error);
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
import { stockQuoteTool, executeStockQuote } from './finance-tools';
import { stockHistoryTool, executeStockHistory } from './finance-tools';
import { stockFinancialTool, executeStockFinancial } from './finance-tools';
import { stockInfoTool, executeStockInfo } from './finance-tools';
import { deepResearchTool, executeDeepResearch } from './deep-research-tools';
import {
  fileReadTool, executeFileRead,
  fileWriteTool, executeFileWrite,
  fileListTool, executeFileList,
  fileDeleteTool, executeFileDelete,
  shellTool, executeShell,
} from './file-system-tools';

export const builtinTools = {
  web_search: webSearchTool,
  web_fetch: webFetchTool,
  time_now: timeTool,
  beeclaw_info: beeclawInfoTool,
  calc: calcTool,
  code_execute: codeExecuteTool,
  weather: weatherTool,
  get_holiday_info: holidayToolDef,
  stock_quote: stockQuoteTool,
  stock_history: stockHistoryTool,
  stock_financial: stockFinancialTool,
  stock_info: stockInfoTool,
  claude_code: claudeCodeTool,
  deep_research: deepResearchTool,
  file_read: fileReadTool,
  file_write: fileWriteTool,
  file_list: fileListTool,
  file_delete: fileDeleteTool,
  shell: shellTool,
  spawn_subagent: spawnSubagentToolDef,
  spawn_parallel: spawnParallelToolDef,
  // Consolidated state tools (recommended)
  state_manage: stateManageTool,
  state_query: stateQueryTool,
  state_lock_manage: stateLockManageTool,
  request_deep_analysis: requestDeepAnalysisTool,
  update_user_settings: updateUserSettingsTool,
  // Sandbox tools
  sandbox_exec: sandboxTools.sandbox_exec,
  sandbox_write_file: sandboxTools.sandbox_write_file,
  sandbox_read_file: sandboxTools.sandbox_read_file,
  sandbox_list_files: sandboxTools.sandbox_list_files,
  sandbox_status: sandboxTools.sandbox_status,
  datasource_health_check: datasourceHealthCheckTool,
  ask_user_question: askUserQuestionTool,
  create_chart: createChartTool,
};

export const builtinToolNames = Object.keys(builtinTools);

// Get all builtin tools in OpenAI format
export function getBuiltinToolsForAI() {
  return Object.values(builtinTools);
}

// Execute a builtin tool
export async function executeBuiltinTool(name: string, params: Record<string, unknown>): Promise<BuiltinToolResult> {
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
    case 'stock_quote':
      return executeStockQuote(params);
    case 'stock_history':
      return executeStockHistory(params);
    case 'stock_financial':
      return executeStockFinancial(params);
    case 'stock_info':
      return executeStockInfo(params);
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
      return executeAskUserQuestion(params);
    // Sandbox tools
    case 'sandbox_exec':
    case 'sandbox_write_file':
    case 'sandbox_read_file':
    case 'sandbox_list_files':
    case 'sandbox_status':
      return executeSandboxTool(name, params);
    case 'datasource_health_check':
      if (!_healthChecker) {
        return { success: false, error: 'Health checker not initialized. Call setupHealthChecker() during app bootstrap.' };
      }
      try {
        const result = await processDatasourceHealthCheck(params, _healthChecker, logger);
        return { success: true, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Health check failed: ${msg}` };
      }
    case 'create_chart':
      return executeCreateChart(params);
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
export { researchTools } from './categories/research-tools';
export { fileTools } from './categories/file-tools';
export { codeTools } from './categories/code-tools';

// Re-export consolidated state tools for backward compatibility
export { stateManageTool, stateQueryTool, stateLockManageTool } from '../subagent/state-tools-consolidated';

/**
 * Aggregated tool list from all categories.
 */
export function getAllCategoryTools() {
  const { researchTools } = require('./categories/research-tools');
  const { fileTools } = require('./categories/file-tools');
  const { codeTools } = require('./categories/code-tools');
  return [...researchTools, ...fileTools, ...codeTools];
}
