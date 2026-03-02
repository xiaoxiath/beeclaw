import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { AppConfigSchema, type AppConfig, type WeatherConfig, type SearchConfig, type FinanceConfig, type AgentDisplayConfig } from './schema';
import { logger } from '../utils/logger';

const CONFIG_FILES = ['beeclaw.json', 'beeclaw.yaml', 'beeclaw.yml'];

// Environment variable mapping - 统一管理所有环境变量
const ENV_MAPPING: Record<string, string> = {
  // Server
  BEECLAW_PORT: 'server.port',
  BEECLAW_HOST: 'server.host',
  // Auth
  BEECLAW_AUTH_ENABLED: 'auth.enabled',
  BEECLAW_AUTH_PASSWORD: 'auth.password',
  // Logging
  BEECLAW_LOG_LEVEL: 'logging.level',
  // Feishu/Lark
  LARK_BEECLAW_APPID: 'feishu.appId',
  LARK_BEECLAW_AS: 'feishu.appSecret',
  // Weather (和风天气)
  QWEATHER_APIHOST: 'weather.apiHost',
  QWEATHER_KEY: 'weather.apiKey',
  QWEATHER_TOKEN: 'weather.token',
  QWEATHER_LOCATION: 'weather.defaultLocation',
  // Search APIs
  BOCHA_API_KEY: 'search.bochaApiKey',
  TAVILY_API_KEY: 'search.tavilyApiKey',
  GOOGLE_SEARCH_API_KEY: 'search.googleApiKey',
  GOOGLE_SEARCH_CX: 'search.googleCx',
  BING_SEARCH_API_KEY: 'search.bingApiKey',
  BRAVE_SEARCH_API_KEY: 'search.braveApiKey',
  // Finance
  TUSHARE_TOKEN: 'finance.tushareToken',
  // Agent display
  BEECLAW_SHOW_TOKEN_STATS: 'agentDisplay.showTokenStats',
};

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
}

function parseEnvValue(value: string): string | number | boolean {
  // Boolean parsing
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // Number parsing
  const num = Number(value);
  if (!isNaN(num)) return num;

  return value;
}

function loadEnvConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  for (const [envKey, configPath] of Object.entries(ENV_MAPPING)) {
    const value = process.env[envKey];
    if (value !== undefined) {
      setNestedValue(config, configPath, parseEnvValue(value));
    }
  }

  return config;
}

async function loadFileConfig(basePath: string): Promise<Record<string, unknown> | null> {
  for (const file of CONFIG_FILES) {
    const filePath = join(basePath, file);
    if (existsSync(filePath)) {
      try {
        let content = await readFile(filePath, 'utf-8');

        // Replace environment variables ${VAR_NAME}
        content = content.replace(/\$\{(\w+)\}/g, (_, varName) => {
          const value = process.env[varName];
          if (value === undefined) {
            logger.warn(`Environment variable ${varName} is not set`);
            return '';
          }
          return value;
        });

        if (file.endsWith('.json')) {
          return JSON.parse(content);
        }
        // YAML support would require a YAML parser
        // For now, we only support JSON
        logger.warn(`YAML config files require a YAML parser. Please use JSON format: ${file}`);
      } catch (error) {
        logger.error(`Failed to load config file: ${filePath}`, error);
      }
    }
  }
  return null;
}

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>
): T {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (
      key in source &&
      typeof source[key] === 'object' &&
      source[key] !== null &&
      !Array.isArray(source[key]) &&
      key in target &&
      typeof (target as Record<string, unknown>)[key] === 'object'
    ) {
      result[key] = deepMerge(
        (target as Record<string, unknown>)[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>
      );
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

let cachedConfig: AppConfig | null = null;

export async function loadConfig(basePath: string = process.cwd()): Promise<AppConfig> {
  // Load from different sources with priority: env > file > defaults
  const fileConfig = await loadFileConfig(basePath);
  const envConfig = loadEnvConfig();

  // Merge configs
  let rawConfig: Record<string, unknown> = {};
  if (fileConfig) {
    rawConfig = deepMerge(rawConfig, fileConfig);
  }
  rawConfig = deepMerge(rawConfig, envConfig);

  // Validate and parse with Zod
  const result = AppConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    logger.warn('Config validation warnings:', result.error.flatten());
    // Use default values for missing/invalid fields
  }

  const config = result.success ? result.data : AppConfigSchema.parse({});

  cachedConfig = config;
  logger.info('Configuration loaded successfully');

  return config;
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return cachedConfig;
}

/**
 * Get weather configuration
 */
export function getWeatherConfig(): WeatherConfig {
  return getConfig().weather;
}

/**
 * Get search configuration
 */
export function getSearchConfig(): SearchConfig {
  return getConfig().search;
}

/**
 * Get finance configuration
 */
export function getFinanceConfig(): FinanceConfig {
  return getConfig().finance;
}

/**
 * Get agent display configuration
 */
export function getAgentDisplayConfig(): AgentDisplayConfig {
  return getConfig().agentDisplay;
}

/**
 * Check if token stats should be shown
 */
export function shouldShowTokenStats(): boolean {
  return getConfig().agentDisplay.showTokenStats;
}

export function reloadConfig(basePath: string = process.cwd()): Promise<AppConfig> {
  cachedConfig = null;
  return loadConfig(basePath);
}

/**
 * Reset cached config - useful for testing
 */
export function resetConfig(): void {
  cachedConfig = null;
}
