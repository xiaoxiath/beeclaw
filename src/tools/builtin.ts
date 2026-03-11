/**
 * Built-in Tools for Beeclaw
 *
 * These tools provide essential capabilities like web search, file operations, etc.
 */

import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname, basename, extname } from 'path';
import { create, all } from 'mathjs';
import { parse as parseShell } from 'shell-quote';
import { logger } from '../utils/logger';
import { getConfig } from '../config';
import type { MemoryToolResult } from '../memory/types';
import {
  getSearchOrchestrator,
  getContentExtractor,
  SearchRegion,
  type SearchConfig,
} from '../search';
import {
  getFinanceOrchestrator,
} from '../finance';
import {
  spawnSubagentTool,
  spawnParallelTool,
} from '../subagent/tools';
import {
  executeSpawnSubagent,
  executeSpawnParallel,
} from '../subagent/executor';
import {
  stateSetTool,
  stateGetTool,
  stateDeleteTool,
  stateUpdateTool,
  stateExistsTool,
  stateListTool,
  stateStatsTool,
  stateLockTool,
  stateUnlockTool,
} from '../subagent/state-tools';
import {
  requestDeepAnalysisTool,
  executeRequestDeepAnalysis,
  isDeepAnalysisTool,
} from './deep-analysis';
import {
  updateUserSettingsTool,
  executeUpdateUserSettings,
} from './user-settings';
import { createDeepResearchHandler, type ResearchDepth } from '../research/deep-research-v2';
import { callAI } from '../agent/api';
import { getProvider, getModel } from '../app';

// Tool result type
import {
  sandboxTools,
  sandboxToolNames,
  executeSandboxTool,
} from '../sandbox/tools';
export type BuiltinToolResult = MemoryToolResult;

/**
 * Clean up text to save tokens - remove excessive whitespace and newlines
 */
function cleanText(text: string): string {
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
// Web Search Tool (using multi-provider search system)
// ============================================================================

export const WebSearchSchema = z.object({
  query: z.string().describe('Search query'),
  num_results: z.number().min(1).max(20).optional().default(10).describe('Number of results to return'),
  region: z.enum(['global', 'cn', 'us', 'auto']).optional().default('auto').describe('Search region'),
  time_range: z.enum(['day', 'week', 'month', 'year']).optional().describe('Time range filter'),
});

export const webSearchTool = {
  name: 'web_search',
  description: `Search the web for information using multiple search engines. Supports Chinese and English queries with automatic region detection.

IMPORTANT — Time-sensitive queries:
When the user asks for "latest", "recent", "current", "newest", "今年", "最新", "最近", or any time-sensitive information, you MUST set time_range to "week" or "month" to ensure results are fresh. Also consider appending the current year to the query string for time-sensitive topics.`,
  parameters: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query string',
      },
      num_results: {
        type: 'number',
        description: 'Number of results to return (1-20, default 10)',
      },
      region: {
        type: 'string',
        enum: ['global', 'cn', 'us', 'auto'],
        description: 'Search region (default: auto-detect from query)',
      },
      time_range: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: 'Filter results by time range',
      },
    },
    required: ['query'],
  },
};

export async function executeWebSearch(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = WebSearchSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { query, num_results, region, time_range } = parsed.data;

  try {
    const orchestrator = getSearchOrchestrator();

    const regionMap: Record<string, SearchRegion> = {
      global: SearchRegion.GLOBAL,
      cn: SearchRegion.CN,
      us: SearchRegion.US,
      auto: SearchRegion.AUTO,
    };

    const results = await orchestrator.search({
      query,
      numResults: num_results,
      region: regionMap[region || 'auto'],
      timeRange: time_range,
    });

    if (results.length === 0) {
      return { success: true, data: `No results found for: ${query}` };
    }

    const formatted = results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${cleanText(r.snippet)}${r.source ? ` [${r.source}]` : ''}`
    ).join('\n\n');

    return { success: true, data: formatted };
  } catch (error) {
    return {
      success: false,
      error: `Search error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Web Fetch Tool (using content extractor)
// ============================================================================

export const WebFetchSchema = z.object({
  url: z.string().url().describe('URL to fetch'),
  format: z.enum(['text', 'markdown', 'json']).optional().default('markdown').describe('Output format'),
  max_length: z.number().min(100).max(50000).optional().default(10000).describe('Maximum content length'),
});

export const webFetchTool = {
  name: 'web_fetch',
  description: 'Fetch and read content from a URL. Extracts main content and converts to readable format.',
  parameters: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch content from',
      },
      format: {
        type: 'string',
        enum: ['text', 'markdown', 'json'],
        description: 'Output format (default: markdown)',
      },
      max_length: {
        type: 'number',
        description: 'Maximum content length in characters (default: 10000)',
      },
    },
    required: ['url'],
  },
};

export async function executeWebFetch(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = WebFetchSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { url, format, max_length } = parsed.data;

  try {
    const extractor = getContentExtractor();

    // Use the content extractor which handles HTML to markdown conversion
    let content = await extractor.extract(url, {
      maxLength: max_length,
      includeImages: false,
    });

    // Apply final cleanup
    content = cleanText(content);

    if (format === 'text') {
      // Strip markdown formatting for plain text
      const text = content
        .replace(/[#*`_\[\]]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/```[\s\S]*?```/g, match => match.replace(/```\n?/g, ''));
      return { success: true, data: cleanText(text) };
    }

    return { success: true, data: content };
  } catch (error) {
    return {
      success: false,
      error: `Fetch error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Time Tool
// ============================================================================

export const TimeSchema = z.object({
  timezone: z.string().optional().describe('Timezone (e.g., "Asia/Shanghai", "America/New_York")'),
  format: z.string().optional().default('YYYY-MM-DD HH:mm:ss').describe('Time format'),
});

export const timeTool = {
  name: 'time_now',
  description: 'Get the current date and time. Uses user timezone from config (default: Asia/Shanghai).',
  parameters: {
    type: 'object' as const,
    properties: {
      timezone: {
        type: 'string',
        description: 'Override timezone (e.g., "America/New_York"). Default: user configured timezone',
      },
      format: {
        type: 'string',
        description: 'Custom format string (default: YYYY-MM-DD HH:mm:ss)',
      },
    },
    required: [],
  },
};

export async function executeTime(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = TimeSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { timezone: paramTimezone } = parsed.data;
  const now = new Date();

  // Get user timezone from config, fallback to Asia/Shanghai
  let defaultTimezone = 'Asia/Shanghai';
  try {
    const config = getConfig();
    if (config?.user?.timezone) {
      defaultTimezone = config.user.timezone;
    }
  } catch (error) {
    logger.debug('Failed to get timezone from config:', error);
  }

  const timezone = paramTimezone || defaultTimezone;

  try {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'long',
      timeZoneName: 'long',
    };

    options.timeZone = timezone;

    const formatted = now.toLocaleString('zh-CN', options);

    // Additional info
    const iso = now.toISOString();
    const unix = Math.floor(now.getTime() / 1000);

    const result = `当前时间: ${formatted}
ISO 格式: ${iso}
Unix 时间戳: ${unix}
时区: ${timezone}`;

    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: `Time error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Beeclaw System Info Tool
// ============================================================================

export const beeclawInfoTool = {
  name: 'beeclaw_info',
  description: 'Get Beeclaw system information including version, runtime environment, and capabilities. Use this to understand what version of Beeclaw is running and its current configuration.',
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

export async function executeBeeclawInfo(): Promise<BuiltinToolResult> {
  try {
    // Read version from package.json
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const packageJsonPath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

    // Get runtime info
    const runtime = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
    };

    // Get config info (if available)
    let configInfo = 'Not loaded';
    try {
      const config = getConfig();
      if (config) {
        configInfo = {
          provider: config.provider?.type || 'unknown',
          model: config.model || 'unknown',
          timezone: config.user?.timezone || 'Asia/Shanghai',
          daemonEnabled: config.proactive?.daemon?.enabled || false,
        };
      }
    } catch (error) {
      logger.debug('Failed to get config info:', error);
    }

    const result = `# Beeclaw System Information

## Version
**Beeclaw**: v${packageJson.version}
**Description**: ${packageJson.description}

## Runtime Environment
**Node Version**: ${runtime.nodeVersion}
**Platform**: ${runtime.platform}
**Architecture**: ${runtime.arch}
**Process ID**: ${runtime.pid}
**Uptime**: ${runtime.uptime} seconds

## Configuration
\`\`\`json
${JSON.stringify(configInfo, null, 2)}
\`\`\`

## Capabilities
- ✅ Multi-provider AI support (OpenAI, Anthropic, Zhipu, MiniMax)
- ✅ Persistent memory system with compression
- ✅ Skill management with testing and evaluation
- ✅ Proactive task scheduling
- ✅ Feishu/Lark bot integration
- ✅ MCP (Model Context Protocol) support
- ✅ Multi-channel support (CLI, Feishu, Webhook)

---
*Running Beeclaw v${packageJson.version}*`;

    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: `Failed to get Beeclaw info: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Calculator Tool
// ============================================================================

export const CalcSchema = z.object({
  expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "sin(pi/4)")'),
});

export const calcTool = {
  name: 'calc',
  description: 'Evaluate mathematical expressions. Supports basic math, trigonometry, logarithms, etc.',
  parameters: {
    type: 'object' as const,
    properties: {
      expression: {
        type: 'string',
        description: 'Mathematical expression (e.g., "2 + 2", "sqrt(16)", "sin(pi/4)")',
      },
    },
    required: ['expression'],
  },
};

export async function executeCalc(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = CalcSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { expression } = parsed.data;

  try {
    // Create a safe math.js instance with limited scope
    const math = create(all, {
      number: 'number',
    });

    // Create a safe scope with only mathematical constants and functions
    const safeScope = {
      pi: Math.PI,
      e: Math.E,
    };

    // Evaluate expression using math.js (safe, no code execution)
    const result = math.evaluate(expression, safeScope);

    if (typeof result !== 'number' || !isFinite(result)) {
      return { success: false, error: `Invalid result: ${result}` };
    }

    return {
      success: true,
      data: `${expression} = ${result}`
    };
  } catch (error) {
    return {
      success: false,
      error: `Calculation error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Code Execute Tool (safe sandboxed execution)
// ============================================================================

export const CodeExecuteSchema = z.object({
  code: z.string().describe('JavaScript/TypeScript code to execute'),
  language: z.enum(['javascript', 'typescript']).optional().default('javascript').describe('Programming language'),
  timeout: z.number().min(100).max(10000).optional().default(5000).describe('Execution timeout in ms'),
});

export const codeExecuteTool = {
  name: 'code_execute',
  description: 'Execute JavaScript code in a sandbox. Useful for data processing, calculations, and quick scripts.',
  parameters: {
    type: 'object' as const,
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute',
      },
      language: {
        type: 'string',
        enum: ['javascript', 'typescript'],
        description: 'Programming language (default: javascript)',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in ms (default: 5000, max: 10000)',
      },
    },
    required: ['code'],
  },
};

export async function executeCode(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = CodeExecuteSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { code, timeout } = parsed.data;

  /**
   * ⚠️ SECURITY WARNING:
   *
   * This tool uses `new Function()` to execute user-provided code in a sandboxed environment.
   * While we have multiple security layers:
   * 1. Dangerous pattern detection (eval, require, import, etc.)
   * 2. Sandboxed global scope (limited to safe objects like Math, Date, JSON)
   * 3. Execution timeout to prevent infinite loops
   * 4. No access to Node.js APIs (fs, process, child_process)
   *
   * However, sophisticated attackers may still find ways to escape the sandbox.
   *
   * FUTURE IMPROVEMENT: Consider using Bun subprocess for complete isolation:
   *   const proc = Bun.spawn(['bun', 'run', '-'], { stdin: code, ... })
   *
   * For now, this is acceptable for a personal AI assistant, but should be
   * reconsidered if exposing to untrusted users or production environments.
   */

  try {
    // Check for dangerous patterns
    const dangerousPatterns = [
      /require\s*\(/,
      /import\s+/,
      /eval\s*\(/,
      /Function\s*\(/,
      /process\s*\./,
      /child_process/,
      /fs\s*\.\s*(?!readFileSync|writeFileSync)/,
      /exec\s*\(/,
      /spawn\s*\(/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return { success: false, error: `Code contains restricted pattern: ${pattern}` };
      }
    }

    // Output array must be defined before sandbox
    const output: string[] = [];

    // Create a safe sandbox with limited globals
    const sandbox = {
      console: {
        log: (...args: unknown[]) => {
          output.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
        },
        error: (...args: unknown[]) => {
          output.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
        },
        warn: (...args: unknown[]) => {
          output.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
        },
      },
      Math: Math,
      Date: Date,
      JSON: JSON,
      Array: Array,
      Object: Object,
      String: String,
      Number: Number,
      Boolean: Boolean,
      Map: Map,
      Set: Set,
      Promise: Promise,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
    };

    const sandboxKeys = Object.keys(sandbox);
    const sandboxValues = Object.values(sandbox);

    // Wrap code in async function for timeout support
    const wrappedCode = `(async () => { ${code} })()`;

    // Execute with timeout
    const result = await Promise.race([
      (async () => {
        const fn = new Function(...sandboxKeys, `return ${wrappedCode}`);
        return await fn(...sandboxValues);
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Execution timeout')), timeout)
      ),
    ]);

    // Format output
    let response = '';
    if (output.length > 0) {
      response += 'Output:\n' + output.join('\n') + '\n';
    }
    if (result !== undefined) {
      response += 'Result: ' + (typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result));
    }
    if (!response) {
      response = 'Code executed successfully (no output)';
    }

    return { success: true, data: response };
  } catch (error) {
    return {
      success: false,
      error: `Execution error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Weather Tool (using QWeather API)
// ============================================================================

export const WeatherSchema = z.object({
  location: z.string().describe('City name or location (e.g., "Beijing", "New York")'),
  format: z.enum(['current', 'forecast', 'detailed']).optional().default('current').describe('Weather format'),
  days: z.enum(['3d', '7d', '10d', '15d', '30d']).optional().default('3d').describe('Forecast days (only for forecast format)'),
});

export const weatherTool = {
  name: 'weather',
  description: 'Get current weather information and forecast for a location using QWeather (和风天气) API. Supports Chinese cities with detailed weather data.',
  parameters: {
    type: 'object' as const,
    properties: {
      location: {
        type: 'string',
        description: 'City name or location in Chinese or English (e.g., "北京", "Beijing", "上海")',
      },
      format: {
        type: 'string',
        enum: ['current', 'forecast', 'detailed'],
        description: 'Weather format: current (simple), detailed (full info), forecast (multi-day forecast)',
      },
      days: {
        type: 'string',
        enum: ['3d', '7d', '10d', '15d', '30d'],
        description: 'Number of days for forecast (only used when format=forecast, default: 3d)',
      },
    },
    required: ['location'],
  },
};

export async function executeWeather(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = WeatherSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { location, format, days } = parsed.data;

  try {
    // Import weather utilities
    const {
      fetchWeatherInfo,
      formatWeatherDescription,
      fetchDailyWeatherInfo,
      formatDailyWeatherDescription
    } = await import('../utils/weather.js');

    // Handle different formats
    if (format === 'forecast') {
      // Fetch multi-day forecast
      const dailyWeatherInfo = await fetchDailyWeatherInfo(location, days);

      if (!dailyWeatherInfo) {
        return {
          success: false,
          error: `无法获取 ${location} 的天气预报。请检查 QWEATHER_KEY 或 QWEATHER_TOKEN 配置。`
        };
      }

      const result = formatDailyWeatherDescription(dailyWeatherInfo);
      return { success: true, data: result };
    } else {
      // Fetch current weather for 'current' and 'detailed' formats
      const weatherInfo = await fetchWeatherInfo(location);

      if (!weatherInfo) {
        return {
          success: false,
          error: `无法获取 ${location} 的天气信息。请检查 QWEATHER_KEY 或 QWEATHER_TOKEN 配置。`
        };
      }

      let result: string;

      if (format === 'current') {
        // Simple current weather
        result = formatWeatherDescription(weatherInfo);
      } else {
        // Detailed format
        result = `📍 ${weatherInfo.location} (ID: ${weatherInfo.locationId})

🌡️ 温度: ${weatherInfo.temp}°C
☁️ 天气: ${weatherInfo.text}
💨 风向风力: ${weatherInfo.windDir} ${weatherInfo.windScale}级
💧 湿度: ${weatherInfo.humidity}%
🕐 更新时间: ${weatherInfo.updateTime}

📊 数据来源: 和风天气`;
      }

      return { success: true, data: result };
    }
  } catch (error) {
    return {
      success: false,
      error: `天气查询失败: ${error instanceof Error ? error.message : '未知错误'}`
    };
  }
}

// ============================================================================
// Stock Quote Tool (Finance Data)
// ============================================================================

export const StockQuoteSchema = z.object({
  symbol: z.string().describe('股票代码，如 600000, sh600000, sh.600000'),
  symbols: z.array(z.string()).optional().describe('批量查询股票代码列表'),
});

export const stockQuoteTool = {
  name: 'stock_quote',
  description: '获取A股实时行情。支持单个或批量查询，返回价格、涨跌幅、成交量等信息。',
  parameters: {
    type: 'object' as const,
    properties: {
      symbol: {
        type: 'string',
        description: '股票代码，如 600000, sh600000, sh.600000',
      },
      symbols: {
        type: 'array',
        items: { type: 'string' },
        description: '批量查询股票代码列表',
      },
    },
    required: ['symbol'],
  },
};

export async function executeStockQuote(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = StockQuoteSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { symbol, symbols } = parsed.data;

  try {
    const orchestrator = getFinanceOrchestrator();
    const quotes = await orchestrator.getQuote({ symbol, symbols });

    if (quotes.length === 0) {
      return { success: false, error: `未找到股票: ${symbol}` };
    }

    const formatted = quotes.map(q => {
      const changeIcon = q.change >= 0 ? '📈' : '📉';
      return `${changeIcon} **${q.symbol}** ${q.name}
   当前: ¥${q.price.toFixed(2)} ${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)} (${q.change >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%)
   今开: ¥${q.open.toFixed(2)} 昨收: ¥${q.preClose.toFixed(2)}
   最高: ¥${q.high.toFixed(2)} 最低: ¥${q.low.toFixed(2)}
   成交量: ${(q.volume / 10000).toFixed(2)}万手 成交额: ${(q.amount / 100000000).toFixed(2)}亿
   ${q.peRatio ? `市盈率: ${q.peRatio.toFixed(2)}` : ''} ${q.pbRatio ? `市净率: ${q.pbRatio.toFixed(2)}` : ''}
   ${q.totalMarketValue ? `总市值: ${(q.totalMarketValue / 100000000).toFixed(2)}亿` : ''}
   数据来源: ${q.source}`;
    }).join('\n\n');

    return { success: true, data: formatted };
  } catch (error) {
    return {
      success: false,
      error: `股票行情获取失败: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Stock History Tool (Finance Data)
// ============================================================================

export const StockHistorySchema = z.object({
  symbol: z.string().describe('股票代码'),
  start_date: z.string().optional().describe('开始日期 YYYY-MM-DD'),
  end_date: z.string().optional().describe('结束日期 YYYY-MM-DD'),
  period: z.enum(['daily', 'weekly', 'monthly']).optional().default('daily').describe('K线周期'),
  adjust: z.enum(['none', 'hfq', 'qfq']).optional().default('none').describe('复权方式: none=不复权, hfq=后复权, qfq=前复权'),
  limit: z.number().min(1).max(365).optional().default(30).describe('返回数据条数'),
});

export const stockHistoryTool = {
  name: 'stock_history',
  description: '获取股票历史K线数据。支持日K、周K、月K，以及前复权、后复权。',
  parameters: {
    type: 'object' as const,
    properties: {
      symbol: {
        type: 'string',
        description: '股票代码',
      },
      start_date: {
        type: 'string',
        description: '开始日期 YYYY-MM-DD',
      },
      end_date: {
        type: 'string',
        description: '结束日期 YYYY-MM-DD',
      },
      period: {
        type: 'string',
        enum: ['daily', 'weekly', 'monthly'],
        description: 'K线周期 (默认: daily)',
      },
      adjust: {
        type: 'string',
        enum: ['none', 'hfq', 'qfq'],
        description: '复权方式: none=不复权, hfq=后复权, qfq=前复权',
      },
      limit: {
        type: 'number',
        description: '返回数据条数 (默认: 30, 最大: 365)',
      },
    },
    required: ['symbol'],
  },
};

export async function executeStockHistory(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = StockHistorySchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { symbol, start_date, end_date, period, adjust, limit } = parsed.data;

  try {
    const orchestrator = getFinanceOrchestrator();
    const history = await orchestrator.getHistory({
      symbol,
      start_date,
      end_date,
      period,
      adjust,
      limit,
    });

    if (history.items.length === 0) {
      return { success: false, error: `未找到股票历史数据: ${symbol}` };
    }

    const adjustLabel = adjust === 'qfq' ? '前复权' : adjust === 'hfq' ? '后复权' : '不复权';
    const periodLabel = period === 'daily' ? '日K' : period === 'weekly' ? '周K' : '月K';

    const header = `📊 **${symbol}** ${history.name || ''} ${periodLabel} ${adjustLabel}\n`;
    const table = '| 日期 | 开盘 | 最高 | 最低 | 收盘 | 成交量(万手) | 成交额(亿) |\n|------|------|------|------|------|-------------|-------------|\n';

    const rows = history.items.map(item => {
      return `| ${item.date} | ${item.open.toFixed(2)} | ${item.high.toFixed(2)} | ${item.low.toFixed(2)} | ${item.close.toFixed(2)} | ${(item.volume / 10000).toFixed(2)} | ${(item.amount / 100000000).toFixed(2)} |`;
    }).join('\n');

    return {
      success: true,
      data: header + table + rows + `\n\n数据来源: ${history.source}`
    };
  } catch (error) {
    return {
      success: false,
      error: `股票历史数据获取失败: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Stock Financial Tool (Finance Data)
// ============================================================================

export const StockFinancialSchema = z.object({
  symbol: z.string().describe('股票代码'),
  report_type: z.enum(['income', 'balance', 'cashflow']).describe('报表类型: income=利润表, balance=资产负债表, cashflow=现金流量表'),
  period: z.enum(['annual', 'quarterly']).optional().default('annual').describe('报告周期: annual=年报, quarterly=季报'),
  limit: z.number().min(1).max(8).optional().default(4).describe('返回报告期数'),
});

export const stockFinancialTool = {
  name: 'stock_financial',
  description: '获取上市公司财务报表数据。支持利润表、资产负债表、现金流量表。',
  parameters: {
    type: 'object' as const,
    properties: {
      symbol: {
        type: 'string',
        description: '股票代码',
      },
      report_type: {
        type: 'string',
        enum: ['income', 'balance', 'cashflow'],
        description: '报表类型: income=利润表, balance=资产负债表, cashflow=现金流量表',
      },
      period: {
        type: 'string',
        enum: ['annual', 'quarterly'],
        description: '报告周期: annual=年报, quarterly=季报 (默认: annual)',
      },
      limit: {
        type: 'number',
        description: '返回报告期数 (默认: 4, 最大: 8)',
      },
    },
    required: ['symbol', 'report_type'],
  },
};

export async function executeStockFinancial(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = StockFinancialSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { symbol, report_type, period, limit } = parsed.data;

  try {
    const orchestrator = getFinanceOrchestrator();
    const financial = await orchestrator.getFinancial({
      symbol,
      report_type,
      period,
      limit,
    });

    if (financial.items.length === 0) {
      return { success: false, error: `未找到财务数据: ${symbol}。注意：财务数据需要Tushare Token。` };
    }

    const reportLabel = report_type === 'income' ? '利润表' :
                        report_type === 'balance' ? '资产负债表' : '现金流量表';
    const periodLabel = period === 'annual' ? '年报' : '季报';

    let content = `📈 **${symbol}** ${financial.name || ''} ${reportLabel} (${periodLabel})\n\n`;

    for (const item of financial.items) {
      content += `**报告期: ${item.endDate}**\n`;

      if (report_type === 'income') {
        content += `- 营业收入: ${item.revenue ? (item.revenue / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        content += `- 净利润: ${item.netProfit ? (item.netProfit / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        content += `- 归母净利润: ${item.netProfitAttrib ? (item.netProfitAttrib / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        if (item.roe) content += `- ROE: ${item.roe.toFixed(2)}%\n`;
      } else if (report_type === 'balance') {
        content += `- 总资产: ${item.totalAssets ? (item.totalAssets / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        content += `- 总负债: ${item.totalLiabilities ? (item.totalLiabilities / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        content += `- 股东权益: ${item.totalEquity ? (item.totalEquity / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
      } else {
        content += `- 经营现金流: ${item.operatingCashFlow ? (item.operatingCashFlow / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        content += `- 投资现金流: ${item.investingCashFlow ? (item.investingCashFlow / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        content += `- 筹资现金流: ${item.financingCashFlow ? (item.financingCashFlow / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
      }
      content += '\n';
    }

    return { success: true, data: content + `数据来源: ${financial.source}` };
  } catch (error) {
    return {
      success: false,
      error: `财务数据获取失败: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Stock Info Tool (Finance Data)
// ============================================================================

export const StockInfoSchema = z.object({
  symbol: z.string().describe('股票代码'),
});

export const stockInfoTool = {
  name: 'stock_info',
  description: '获取上市公司基本信息。包括行业、上市日期、主营业务等。',
  parameters: {
    type: 'object' as const,
    properties: {
      symbol: {
        type: 'string',
        description: '股票代码',
      },
    },
    required: ['symbol'],
  },
};

export async function executeStockInfo(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = StockInfoSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { symbol } = parsed.data;

  try {
    const orchestrator = getFinanceOrchestrator();
    const info = await orchestrator.getInfo({ symbol });

    const content = `🏢 **${info.symbol}** ${info.name}
${info.fullName && info.fullName !== info.name ? `全称: ${info.fullName}\n` : ''}${info.industry ? `行业: ${info.industry}\n` : ''}${info.sector ? `板块: ${info.sector}\n` : ''}${info.market ? `市场: ${info.market}\n` : ''}${info.listDate ? `上市日期: ${info.listDate}\n` : ''}${info.chairman ? `董事长: ${info.chairman}\n` : ''}${info.employees ? `员工数: ${info.employees.toLocaleString()}\n` : ''}${info.province || info.city ? `地区: ${[info.province, info.city].filter(Boolean).join(' ')}\n` : ''}${info.website ? `网站: ${info.website}\n` : ''}
${info.mainBusiness ? `主营业务:\n${info.mainBusiness}` : ''}
数据来源: ${info.source}`;

    return { success: true, data: content };
  } catch (error) {
    return {
      success: false,
      error: `公司信息获取失败: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// URL Shorten Tool
// ============================================================================

export const UrlShortenSchema = z.object({
  url: z.string().url().describe('URL to shorten'),
});

export const urlShortenTool = {
  name: 'url_shorten',
  description: 'Shorten a long URL using is.gd service.',
  parameters: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'The URL to shorten',
      },
    },
    required: ['url'],
  },
};

export async function executeUrlShorten(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = UrlShortenSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { url } = parsed.data;

  try {
    const response = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);

    if (!response.ok) {
      return { success: false, error: `URL shortening failed: ${response.status}` };
    }

    const shortUrl = await response.text();
    return {
      success: true,
      data: `Original: ${url}\nShortened: ${shortUrl}`
    };
  } catch (error) {
    return {
      success: false,
      error: `URL shortening error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// QR Code Tool
// ============================================================================

export const QrCodeSchema = z.object({
  text: z.string().describe('Text or URL to encode as QR code'),
  size: z.number().min(100).max(500).optional().default(200).describe('QR code size in pixels'),
});

export const qrCodeTool = {
  name: 'qrcode',
  description: 'Generate a QR code image URL for text or URL.',
  parameters: {
    type: 'object' as const,
    properties: {
      text: {
        type: 'string',
        description: 'Text or URL to encode',
      },
      size: {
        type: 'number',
        description: 'QR code size in pixels (default: 200)',
      },
    },
    required: ['text'],
  },
};

export async function executeQrCode(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = QrCodeSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { text, size } = parsed.data;

  try {
    // Use QR code API
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;

    return {
      success: true,
      data: `QR Code generated:\nURL: ${qrUrl}\n\nScan this QR code to access: ${text}`
    };
  } catch (error) {
    return {
      success: false,
      error: `QR code error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Claude Code Tool
// ============================================================================

import { $ } from 'bun';

export const ClaudeCodeSchema = z.object({
  prompt: z.string().describe('The task or prompt to send to Claude Code'),
  working_dir: z.string().optional().describe('Working directory for the task (default: current directory)'),
  timeout: z.number().min(10000).max(900000).optional().default(120000).describe('Timeout in ms (default: 120000, max: 900000)'),
  model: z.string().optional().describe('Model to use (e.g., "claude-sonnet-4-20250514", "claude-opus-4-6")'),
});

export const claudeCodeTool = {
  name: 'claude_code',
  description: `Execute a task using Claude Code SDK. Use this for complex tasks that require file operations, code analysis, or multi-step reasoning. Claude Code has access to file system, bash commands, and can work autonomously on tasks.

**Recommended Usage:**
For most tasks, use spawn_subagent with type="code" instead. It runs in background and won't block our conversation.

**Timeout guidance:**
- Simple tasks (file read/write): default 120s is sufficient
- Medium tasks (code generation, analysis): 120-180s
- Complex tasks (multi-file projects, extensive reasoning): 180-300s
- Very complex tasks (large projects, deep analysis): 300-600s
- Extremely complex tasks (comprehensive research): 600-900s
- For tasks expected to take longer, explicitly set timeout parameter

**Note:** This tool is synchronous and will block until completion. For background execution, use spawn_subagent instead.`,
  parameters: {
    type: 'object' as const,
    properties: {
      prompt: {
        type: 'string',
        description: 'The task or question to send to Claude Code',
      },
      working_dir: {
        type: 'string',
        description: 'Working directory (default: current directory)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in ms (default: 120000, max: 900000)',
      },
      model: {
        type: 'string',
        description: 'Model to use (optional)',
      },
    },
    required: ['prompt'],
  },
};

export async function executeClaudeCode(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = ClaudeCodeSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { prompt, working_dir, timeout, model } = parsed.data;

  try {
    // Build command
    let cmd = 'claude -p';
    if (model) {
      cmd += ` --model ${model}`;
    }
    // Escape the prompt for shell
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    cmd += ` '${escapedPrompt}'`;

    // Execute using Bun's shell
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(async (resolve) => {
      const timer = setTimeout(() => {
        resolve({ stdout: '', stderr: 'Timeout reached', exitCode: 124 });
      }, timeout);

      try {
        const proc = Bun.spawn(['bash', '-c', cmd], {
          cwd: working_dir || process.cwd(),
          env: { ...process.env, CLAUDECODE: undefined },
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode });
      } catch (err) {
        clearTimeout(timer);
        resolve({ stdout: '', stderr: err instanceof Error ? err.message : 'Unknown error', exitCode: 1 });
      }
    });

    if (result.exitCode === 124) {
      return { success: false, error: 'Timeout reached' };
    }

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `Claude Code exited with code ${result.exitCode}: ${result.stderr || result.stdout.slice(0, 500)}`,
      };
    }

    // Format the output
    const output = result.stdout.trim();

    if (!output) {
      return { success: true, data: 'Claude Code completed successfully (no output)' };
    }

    // Truncate if too long
    const maxLength = 10000;
    const truncated = output.length > maxLength
      ? output.slice(0, maxLength) + '\n\n... (output truncated)'
      : output;

    return { success: true, data: truncated };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('ENOENT')) {
        return { success: false, error: 'Claude CLI not found. Please install Claude Code CLI first.' };
      }
      return { success: false, error: `Claude Code error: ${error.message}` };
    }
    return { success: false, error: 'Unknown error executing Claude Code' };
  }
}

// ============================================================================
// Tool Registry
// ============================================================================

// ============================================================================
// Deep Research Tool
// ============================================================================

export const DeepResearchSchema = z.object({
  topic: z.string().describe('The main topic or question to research'),
  aspects: z.array(z.string()).optional().describe('Specific aspects or angles to investigate (optional, will auto-discover if not provided)'),
  depth: z.enum(['quick', 'standard', 'comprehensive']).optional().default('standard').describe('Research depth: quick (3 searches), standard (5 searches), comprehensive (8+ searches)'),
  time_range: z.enum(['day', 'week', 'month', 'year']).optional().describe('Time range filter for results'),
});

export const deepResearchTool = {
  name: 'deep_research',
  description: 'Conduct systematic multi-angle research on a topic. Performs parallel searches, fetches key sources, and synthesizes findings into a comprehensive report. Use this when you need thorough research beyond a simple web search.',
  parameters: {
    type: 'object' as const,
    properties: {
      topic: {
        type: 'string',
        description: 'The main topic or question to research',
      },
      aspects: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific aspects to investigate (optional)',
      },
      depth: {
        type: 'string',
        enum: ['quick', 'standard', 'comprehensive'],
        description: 'Research depth (default: standard)',
      },
      time_range: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: 'Time range filter for results',
      },
    },
    required: ['topic'],
  },
};

interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  source?: string;
}

interface ResearchFinding {
  aspect: string;
  keyFacts: string[];
  sources: ResearchSource[];
}

export async function executeDeepResearch(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = DeepResearchSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { topic, aspects, depth, time_range } = parsed.data;

  try {
    const orchestrator = getSearchOrchestrator();
    const extractor = getContentExtractor();

    // Create Deep Research V2 handler with dependencies
    const deepResearchHandler = createDeepResearchHandler({
      searchFn: async (query, opts) => {
        const results = await orchestrator.search({
          query,
          numResults: opts?.maxResults || 5,
          timeRange: time_range,
        });
        return results.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          source: r.source,
        }));
      },
      fetchFn: async (url, opts) => {
        const content = await extractor.extract(url, {
          maxLength: opts?.maxLength || 15000,
          includeImages: false,
        });
        return { content: cleanText(content) };
      },
      llmCall: async (messages, opts) => {
        // Get provider and model from app context
        const provider = getProvider();
        const model = opts?.model || getModel();

        // Convert CoreMessage to the format expected by callAI
        const apiMessages = messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        }));

        const response = await callAI({
          provider,
          model,
          messages: apiMessages,
          temperature: opts?.temperature,
          maxTokens: opts?.maxTokens,
        });

        return response.choices[0].message?.content || '';
      },
    });

    // Execute Deep Research V2
    const result = await deepResearchHandler({
      topic,
      depth: depth as ResearchDepth,
      aspects,
    });

    return {
      success: true,
      data: result.report,
    };
  } catch (error) {
    return {
      success: false,
      error: `Deep research error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// File Read Tool
// ============================================================================

// Allowed base directories for file operations (security restriction)
const ALLOWED_BASE_DIRS = [
  process.cwd(),
  join(process.cwd(), 'data'),
  join(process.cwd(), 'output'),
  join(process.cwd(), 'reports'),
  join(process.cwd(), 'temp'),
];

// Ensure output directories exist
function ensureOutputDirs(): void {
  for (const dir of ['output', 'reports', 'temp']) {
    const fullPath = join(process.cwd(), dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
    }
  }
}

// Check if path is within allowed directories
function isPathAllowed(filePath: string): boolean {
  const resolved = resolve(filePath);
  return ALLOWED_BASE_DIRS.some(base => resolved.startsWith(resolve(base)));
}

export const FileReadSchema = z.object({
  path: z.string().describe('File path to read (relative to project root or absolute)'),
  encoding: z.enum(['utf-8', 'base64', 'json']).optional().default('utf-8').describe('File encoding'),
  max_length: z.number().min(100).max(100000).optional().default(50000).describe('Maximum content length'),
});

export const fileReadTool = {
  name: 'file_read',
  description: 'Read content from a local file. Supports text files, JSON, and base64 encoding for binary files. Restricted to project directory and output folders.',
  parameters: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File path to read (relative to project root)',
      },
      encoding: {
        type: 'string',
        enum: ['utf-8', 'base64', 'json'],
        description: 'File encoding (default: utf-8)',
      },
      max_length: {
        type: 'number',
        description: 'Maximum content length (default: 50000)',
      },
    },
    required: ['path'],
  },
};

export async function executeFileRead(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = FileReadSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { path: filePath, encoding, max_length } = parsed.data;

  try {
    const resolvedPath = resolve(filePath);

    // Security check
    if (!isPathAllowed(resolvedPath)) {
      return {
        success: false,
        error: `Access denied: path outside allowed directories. Allowed: project root, data/, output/, reports/, temp/`
      };
    }

    if (!existsSync(resolvedPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const stats = statSync(resolvedPath);
    if (stats.isDirectory()) {
      // List directory contents
      const files = readdirSync(resolvedPath);
      const fileList = files.map(f => {
        const fp = join(resolvedPath, f);
        const s = statSync(fp);
        return `${s.isDirectory() ? 'd' : 'f'} ${f}`;
      }).join('\n');
      return { success: true, data: `Directory: ${filePath}\n${fileList}` };
    }

    // Read file
    if (encoding === 'json') {
      const content = readFileSync(resolvedPath, 'utf-8');
      const json = JSON.parse(content);
      const formatted = JSON.stringify(json, null, 2);
      return {
        success: true,
        data: formatted.slice(0, max_length) + (formatted.length > max_length ? '\n... (truncated)' : '')
      };
    } else if (encoding === 'base64') {
      const buffer = readFileSync(resolvedPath);
      const base64 = buffer.toString('base64');
      return {
        success: true,
        data: base64.slice(0, max_length) + (base64.length > max_length ? '... (truncated)' : '')
      };
    } else {
      const content = readFileSync(resolvedPath, 'utf-8');
      return {
        success: true,
        data: content.slice(0, max_length) + (content.length > max_length ? '\n... (truncated)' : '')
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `File read error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// File Write Tool
// ============================================================================

export const FileWriteSchema = z.object({
  path: z.string().describe('File path to write (relative to project root)'),
  content: z.string().describe('Content to write to the file'),
  mode: z.enum(['write', 'append']).optional().default('write').describe('Write mode: write (overwrite) or append'),
  create_dirs: z.boolean().optional().default(true).describe('Create parent directories if they don\'t exist'),
});

export const fileWriteTool = {
  name: 'file_write',
  description: 'Write content to a local file. Can create new files or append to existing ones. Best for generating reports, saving research results, creating HTML/Markdown files. Restricted to output/, reports/, temp/, and data/ directories.',
  parameters: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File path to write (will be saved to output/ if not in allowed dir)',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
      mode: {
        type: 'string',
        enum: ['write', 'append'],
        description: 'Write mode (default: write)',
      },
      create_dirs: {
        type: 'boolean',
        description: 'Create parent directories (default: true)',
      },
    },
    required: ['path', 'content'],
  },
};

export async function executeFileWrite(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = FileWriteSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { path: filePath, content, mode, create_dirs } = parsed.data;

  try {
    // Ensure output directories exist
    ensureOutputDirs();

    let resolvedPath = resolve(filePath);

    // If path is not in allowed directories, redirect to output/
    if (!isPathAllowed(resolvedPath)) {
      // Extract just the filename and put in output/
      const filename = basename(filePath);
      resolvedPath = resolve(join('output', filename));
    }

    // Create parent directories if needed
    if (create_dirs) {
      const parentDir = dirname(resolvedPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
    }

    // Write or append
    const writeContent = mode === 'append' && existsSync(resolvedPath)
      ? readFileSync(resolvedPath, 'utf-8') + '\n' + content
      : content;

    writeFileSync(resolvedPath, writeContent, 'utf-8');

    const relativePath = resolvedPath.replace(resolve('.'), '.');
    const size = writeContent.length;

    return {
      success: true,
      data: `File saved successfully:\n  Path: ${relativePath}\n  Size: ${size} bytes\n  Mode: ${mode}`
    };
  } catch (error) {
    return {
      success: false,
      error: `File write error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// File List Tool
// ============================================================================

export const FileListSchema = z.object({
  path: z.string().optional().default('.').describe('Directory path to list'),
  recursive: z.boolean().optional().default(false).describe('List recursively'),
  pattern: z.string().optional().describe('File pattern to filter (e.g., "*.md", "*.html")'),
});

export const fileListTool = {
  name: 'file_list',
  description: 'List files in a directory. Useful for finding generated reports or exploring project structure.',
  parameters: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list (default: current directory)',
      },
      recursive: {
        type: 'boolean',
        description: 'List recursively (default: false)',
      },
      pattern: {
        type: 'string',
        description: 'File pattern to filter (e.g., "*.md")',
      },
    },
    required: [],
  },
};

function listDirectory(dirPath: string, recursive: boolean, pattern?: string, prefix: string = ''): string[] {
  const results: string[] = [];

  if (!existsSync(dirPath)) {
    return [`Directory not found: ${dirPath}`];
  }

  const files = readdirSync(dirPath);

  for (const file of files) {
    // Skip hidden files and node_modules
    if (file.startsWith('.') || file === 'node_modules') continue;

    const fullPath = join(dirPath, file);
    const stats = statSync(fullPath);
    const relativePath = prefix + file;

    if (stats.isDirectory()) {
      results.push(`📁 ${relativePath}/`);
      if (recursive) {
        results.push(...listDirectory(fullPath, true, pattern, relativePath + '/'));
      }
    } else {
      // Apply pattern filter
      if (pattern) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        if (!regex.test(file)) continue;
      }
      const size = stats.size;
      const sizeStr = size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` :
                      size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
      results.push(`📄 ${relativePath} (${sizeStr})`);
    }
  }

  return results;
}

export async function executeFileList(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = FileListSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { path: dirPath, recursive, pattern } = parsed.data;

  try {
    const resolvedPath = resolve(dirPath);

    // Security check
    if (!isPathAllowed(resolvedPath)) {
      return {
        success: false,
        error: `Access denied: path outside allowed directories`
      };
    }

    const results = listDirectory(resolvedPath, recursive, pattern);

    if (results.length === 0) {
      return { success: true, data: `No files found in ${dirPath}${pattern ? ` matching ${pattern}` : ''}` };
    }

    return {
      success: true,
      data: `Files in ${dirPath}:\n\n${results.join('\n')}`
    };
  } catch (error) {
    return {
      success: false,
      error: `File list error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// File Delete Tool
// ============================================================================

export const FileDeleteSchema = z.object({
  path: z.string().describe('File path to delete'),
});

export const fileDeleteTool = {
  name: 'file_delete',
  description: 'Delete a file. For safety, only works in output/, reports/, and temp/ directories.',
  parameters: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File path to delete',
      },
    },
    required: ['path'],
  },
};

export async function executeFileDelete(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = FileDeleteSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { path: filePath } = parsed.data;

  try {
    const resolvedPath = resolve(filePath);

    // Only allow deletion in safe directories
    const safeDirs = ['output', 'reports', 'temp'];
    const isInSafeDir = safeDirs.some(dir => resolvedPath.startsWith(resolve(dir)));

    if (!isInSafeDir) {
      return {
        success: false,
        error: `For safety, file_delete only works in: ${safeDirs.join(', ')}`
      };
    }

    if (!existsSync(resolvedPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    unlinkSync(resolvedPath);

    return {
      success: true,
      data: `File deleted: ${filePath}`
    };
  } catch (error) {
    return {
      success: false,
      error: `File delete error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Safe Shell Tool
// ============================================================================

// Dangerous commands that should never be allowed
const BLOCKED_COMMANDS = [
  // System destruction
  'rm -rf /', 'mkfs', 'dd if=', 'fdisk', 'format',
  // Privilege escalation
  'sudo', 'su ', 'chmod 777', 'chown root',
  // Network attacks
  'nmap', 'nc -l', 'netcat', 'ssh', 'scp', 'rsync',
  // Process manipulation
  'kill -9 1', 'pkill -9', 'killall',
  // System modification
  'apt', 'yum', 'brew', 'npm install -g', 'pip install',
  // Credential access
  'cat /etc/passwd', 'cat /etc/shadow', '.ssh/',
  // Fork bomb
  ':(){:|:&};:',
  // Download and execute
  'curl | sh', 'curl | bash', 'wget | sh', 'wget | bash',
];

// Allowed commands whitelist (pattern matching)
const ALLOWED_PATTERNS = [
  // Directory navigation (harmless, commonly chained with other commands)
  /^cd(\s|$)/,
  // File operations (in allowed dirs)
  /^ls(\s|$)/,
  /^ls -la(\s|$)/,
  /^cat\s+/,
  /^head\s+/,
  /^tail\s+/,
  /^wc\s+/,
  /^find\s+/,
  /^grep\s+/,
  /^mkdir\s+/,
  /^touch\s+/,
  /^cp\s+/,
  /^mv\s+/,
  /^rm\s+(?!-rf\s+\/)/,  // Allow rm but not rm -rf /
  // Git operations
  /^git\s+/,
  // Package managers (read-only)
  /^npm\s+list/,
  /^npm\s+outdated/,
  /^bun\s+--version/,
  // Development tools
  /^node\s+/,
  /^bun\s+/,
  /^npx\s+/,
  /^tsc\s+/,
  /^eslint\s+/,
  /^prettier\s+/,
  // Process management
  /^pm2\s+/,
  // Process info
  /^ps\s*/,
  /^top\s*$/,
  /^htop\s*$/,
  // Disk usage
  /^df\s*/,
  /^du\s+/,
  // Network info (safe)
  /^ping\s+/,
  /^curl\s+/,
  /^wget\s+/,
  // Text processing
  /^echo\s+/,
  /^printf\s+/,
  /^sed\s+/,
  /^awk\s+/,
  /^sort\s+/,
  /^uniq\s+/,
  /^cut\s+/,
  /^tr\s+/,
  // Misc
  /^which\s+/,
  /^whereis\s+/,
  /^date\s*/,
  /^whoami\s*$/,
  /^pwd\s*$/,
  /^env\s*$/,
  /^uptime\s*$/,
  /^uname\s+/,
];

// Check if command is safe to execute
// [FIX] Use shell-quote for robust parsing that respects quotes and escaping
export function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  const fullCmd = command.trim();

  // --- Phase 0: Try to parse with shell-quote ---
  let tokens: any[];
  try {
    tokens = parseShell(fullCmd);
  } catch (error) {
    return {
      safe: false,
      reason: `Failed to parse command: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }

  // --- Phase 1: Check for dangerous operations in parsed tokens ---
  // Command substitution: $(...) is parsed as: "$", {op: "("}, ..., {op: ")"}
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];

    // Check for $( pattern
    if (token === '$' && typeof nextToken === 'object' && nextToken?.op === '(') {
      return { safe: false, reason: 'Dangerous pattern detected: Command substitution' };
    }

    // Check for backtick command substitution (appears as string like "`pwd`")
    if (typeof token === 'string' && /^`.*`$/.test(token)) {
      return { safe: false, reason: 'Dangerous pattern detected: Backtick command substitution' };
    }
  }

  // --- Phase 2: Split into command segments by &&, ||, ;, | ---
  const segments: string[][] = [];
  let currentSegment: string[] = [];

  for (const token of tokens) {
    if (typeof token === 'string') {
      currentSegment.push(token);
    } else if (typeof token === 'object' && token !== null && 'op' in token) {
      const op = token.op;

      // Segment separators
      if (op === '&&' || op === '||' || op === ';' || op === '|') {
        if (currentSegment.length > 0) {
          segments.push(currentSegment);
          currentSegment = [];
        }
      }
    }
  }

  // Don't forget the last segment
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  // --- Phase 3: Check for dangerous patterns BEFORE whitelist validation ---
  // This provides better error messages for known dangerous patterns
  const globalDangerousPatterns: [RegExp, string][] = [
    [/\|\s*sh\b/, 'Pipe to sh'],
    [/\|\s*bash\b/, 'Pipe to bash'],
    [/>\s*\/dev\//, 'Device file access'],
  ];

  for (const [pattern, label] of globalDangerousPatterns) {
    if (pattern.test(fullCmd)) {
      return { safe: false, reason: `Dangerous pattern detected: ${label}` };
    }
  }

  // --- Phase 4: Validate each segment against whitelist and blocklist ---
  for (const segment of segments) {
    const cmdStr = segment.join(' ');

    // Check against blocklist
    const cmdLower = cmdStr.toLowerCase();
    for (const blocked of BLOCKED_COMMANDS) {
      if (cmdLower.includes(blocked.toLowerCase())) {
        return { safe: false, reason: `Blocked command pattern: ${blocked}` };
      }
    }

    // Check against whitelist
    const isAllowed = ALLOWED_PATTERNS.some(pattern => pattern.test(cmdStr));
    if (!isAllowed) {
      return {
        safe: false,
        reason: `Command not in allowed whitelist: "${cmdStr}"`,
      };
    }
  }

  return { safe: true };
}

export const ShellSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  timeout: z.number().min(1000).max(30000).optional().default(10000).describe('Timeout in ms (default: 10000, max: 30000)'),
  cwd: z.string().optional().describe('Working directory (default: project root)'),
});

export const shellTool = {
  name: 'shell',
  description: `Execute safe shell commands in a controlled environment.

SUPPORTED COMMANDS (all are allowed):
- Git: ALL git commands (git status, git commit, git push, git pull, git branch, git log, git diff, etc.)
- File ops: ls, cat, head, tail, grep, find, mkdir, touch, cp, mv, rm
- Development: node, bun, npx, tsc, eslint, prettier
- Process: pm2, ps, top, htop
- Network: ping, curl, wget
- Text: sed, awk, sort, uniq, echo
- System: pwd, whoami, date, env, df, du

BLOCKED: sudo, rm -rf /, ssh, system modifications, package installations

IMPORTANT: Git commands are FULLY SUPPORTED. Use git freely for version control operations.`,
  parameters: {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute. Git commands are fully supported.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in ms (default: 10000, max: 30000)',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (default: project root)',
      },
    },
    required: ['command'],
  },
};

export async function executeShell(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = ShellSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { command, timeout, cwd } = parsed.data;

  // Security check
  const safetyCheck = isCommandSafe(command);
  if (!safetyCheck.safe) {
    return {
      success: false,
      error: `Command rejected: ${safetyCheck.reason}. Only safe, whitelisted commands are allowed.`
    };
  }

  try {
    const proc = Bun.spawn(['bash', '-c', command], {
      cwd: cwd ? resolve(cwd) : process.cwd(),
      env: {
        ...process.env,
        // Remove sensitive env vars
        OPENAI_API_KEY: undefined,
        ANTHROPIC_API_KEY: undefined,
        ZHIPU_API_KEY: undefined,
        MINIMAX_API_KEY: undefined,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      proc.kill();
    }, timeout);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    clearTimeout(timeoutId);

    // Truncate output if too long
    const maxLength = 5000;
    const truncated = stdout.length > maxLength;
    const output = stdout.slice(0, maxLength) + (truncated ? '\n... (output truncated)' : '');

    if (exitCode !== 0) {
      return {
        success: false,
        error: `Command exited with code ${exitCode}: ${stderr || output}`
      };
    }

    if (stderr && !stdout) {
      return { success: true, data: stderr };
    }

    return { success: true, data: output || 'Command completed successfully' };
  } catch (error) {
    return {
      success: false,
      error: `Shell error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Subagent Tools
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
  const { executeSpawnSubagent } = await import('../subagent/executor');
  return executeSpawnSubagent(params as import('../subagent/tools').SpawnSubagentParams);
}

export async function executeSpawnParallelTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const { executeSpawnParallel } = await import('../subagent/executor');
  return executeSpawnParallel(params as import('../subagent/tools').SpawnParallelParams);
}

// ============================================================================
// State Management Tools
// ============================================================================

export async function executeStateSetTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const { executeStateSet } = await import('../subagent/state-executor');
  return executeStateSet(params as import('../subagent/state-tools').StateSetParams);
}

 export async function executeStateGetTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const { executeStateGet } = await import('../subagent/state-executor');
  return executeStateGet(params as import('../subagent/state-tools').StateGetParams);
}

 export async function executeStateDeleteTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const { executeStateDelete } = await import('../subagent/state-executor');
  return executeStateDelete(params as import('../subagent/state-tools').StateDeleteParams);
 }

 export async function executeStateUpdateTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const { executeStateUpdate } = await import('../subagent/state-executor');
  return executeStateUpdate(params as import('../subagent/state-tools').StateUpdateParams);
 }

 export async function executeStateExistsTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const { executeStateExists } = await import('../subagent/state-executor');
  return executeStateExists(params as import('../subagent/state-tools').StateExistsParams);
 }

 export async function executeStateListTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const { executeStateList } = await import('../subagent/state-executor');
  return executeStateList(params as import('../subagent/state-tools').StateListParams);
 }

 export async function executeStateStatsTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const { executeStateStats } = await import('../subagent/state-executor');
  return executeStateStats();
 }

 export async function executeStateLockTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const { executeStateLock } = await import('../subagent/state-executor');
  return executeStateLock(params as import('../subagent/state-tools').StateLockParams);
 }

 export async function executeStateUnlockTool(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const { executeStateUnlock } = await import('../subagent/state-executor');
  return executeStateUnlock(params as import('../subagent/state-tools').StateUnlockParams);
 }

// ============================================================================
// Tool Registry
// ============================================================================

export const builtinTools = {
  web_search: webSearchTool,
  web_fetch: webFetchTool,
  time_now: timeTool,
  beeclaw_info: beeclawInfoTool,
  calc: calcTool,
  code_execute: codeExecuteTool,
  weather: weatherTool,
  stock_quote: stockQuoteTool,
  stock_history: stockHistoryTool,
  stock_financial: stockFinancialTool,
  stock_info: stockInfoTool,
  url_shorten: urlShortenTool,
  qrcode: qrCodeTool,
  claude_code: claudeCodeTool,
  deep_research: deepResearchTool,
  file_read: fileReadTool,
  file_write: fileWriteTool,
  file_list: fileListTool,
  file_delete: fileDeleteTool,
  shell: shellTool,
  spawn_subagent: spawnSubagentToolDef,
  spawn_parallel: spawnParallelToolDef,
  state_set: stateSetTool,
  state_get: stateGetTool,
  state_delete: stateDeleteTool,
  state_update: stateUpdateTool,
  state_exists: stateExistsTool,
  state_list: stateListTool,
  state_stats: stateStatsTool,
  state_lock: stateLockTool,
  state_unlock: stateUnlockTool,
  request_deep_analysis: requestDeepAnalysisTool,
  update_user_settings: updateUserSettingsTool,
  // Sandbox tools
  sandbox_exec: sandboxTools.sandbox_exec,
  sandbox_write_file: sandboxTools.sandbox_write_file,
  sandbox_read_file: sandboxTools.sandbox_read_file,
  sandbox_list_files: sandboxTools.sandbox_list_files,
  sandbox_status: sandboxTools.sandbox_status,
};

export const builtinToolNames = Object.keys(builtinTools);

// Get all builtin tools in OpenAI format
export function getBuiltinToolsForAI() {
  return Object.values(builtinTools).map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
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
    case 'stock_quote':
      return executeStockQuote(params);
    case 'stock_history':
      return executeStockHistory(params);
    case 'stock_financial':
      return executeStockFinancial(params);
    case 'stock_info':
      return executeStockInfo(params);
    case 'url_shorten':
      return executeUrlShorten(params);
    case 'qrcode':
      return executeQrCode(params);
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
    case 'state_set':
      return executeStateSetTool(params);
    case 'state_get':
      return executeStateGetTool(params);
    case 'state_delete':
      return executeStateDeleteTool(params);
    case 'state_update':
      return executeStateUpdateTool(params);
    case 'state_exists':
      return executeStateExistsTool(params);
    case 'state_list':
      return executeStateListTool(params);
    case 'state_stats':
      return executeStateStatsTool(params);
    case 'state_lock':
      return executeStateLockTool(params);
    case 'state_unlock':
      return executeStateUnlockTool(params);
    case 'request_deep_analysis':
      return executeRequestDeepAnalysis(params);
    case 'update_user_settings':
      return executeUpdateUserSettings(params);
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
