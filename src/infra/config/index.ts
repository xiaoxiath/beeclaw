import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { AppConfigSchema, type AppConfig, type WeatherConfig, type SearchConfig, type FinanceConfig, type AgentDisplayConfig, type LLMTiersConfig } from './schema';
import { DEFAULT_CONFIG } from './defaults';
import { ProviderResolver } from './provider-resolver';
import { ParamsMerger } from './params-merger';
import { logger } from '../observability/logger';
import { deepMerge } from '../utils';

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
  // LLM Concurrency
  BEECLAW_LLM_MAX_CONCURRENCY: 'llmRouter.concurrency.maxConcurrent',
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

        // Replace environment variables ${VAR_NAME} and ${VAR_NAME:-default}
        content = content.replace(/\$\{(\w+)(?::-(.*?))?\}/g, (_, varName, defaultValue) => {
          const value = process.env[varName];
          if (value !== undefined) {
            return value;
          }
          if (defaultValue !== undefined) {
            return defaultValue;
          }
          logger.warn(`Environment variable ${varName} is not set`);
          return '';
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
let cachedConfig: AppConfig | null = null;

export async function loadConfig(basePath: string = process.cwd()): Promise<AppConfig> {
  // Load from different sources
  const fileConfig = await loadFileConfig(basePath);
  const envConfig = loadEnvConfig();

  // Start with default configuration
  let rawConfig: Record<string, unknown> = { ...DEFAULT_CONFIG };

  // Merge file config (user config overrides defaults)
  if (fileConfig) {
    rawConfig = deepMerge(rawConfig, fileConfig);
  }

  // Merge env config (env has highest priority)
  if (Object.keys(envConfig).length > 0) {
    rawConfig = deepMerge(rawConfig, envConfig);
  }

  // Validate and parse with Zod
  const result = AppConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    logger.warn('Config validation warnings:', result.error.flatten());
    // Use default values for missing/invalid fields
  }

  const config = result.success ? result.data : AppConfigSchema.parse({});

  // Resolve all role references and params
  const resolvedConfig = resolveConfig(config);

  cachedConfig = resolvedConfig;

  // Log configuration summary
  const configSources: string[] = [];
  if (fileConfig) configSources.push('file');
  if (Object.keys(envConfig).length > 0) configSources.push('env');
  configSources.push('defaults');

  logger.info(`Configuration loaded (sources: ${configSources.join(' > ')})`);

  return resolvedConfig;
}

/**
 * Resolve all role references in configuration
 * Transform Layer 1-2-3 configuration into final resolved config
 */
function resolveConfig(rawConfig: AppConfig): AppConfig {
  // Skip if no providers configured
  if (!rawConfig.providers || rawConfig.providers.length === 0) {
    return rawConfig;
  }

  // Create resolver with global roles (v6)
  logger.info(`[Config] Creating resolver with ${Object.keys(rawConfig.roles || {}).length} roles:`, Object.keys(rawConfig.roles || {}));
  const resolver = new ProviderResolver(rawConfig.providers, rawConfig.roles);

  // Resolve agent (v6: single agent, not array)
  const resolvedAgent = rawConfig.agent;
  if (resolvedAgent?.role) {
    try {
      const roleDef = resolver.getRole(resolvedAgent.role);
      if (!roleDef) {
        throw new Error(`Role "${resolvedAgent.role}" not found`);
      }

      const provider = resolver.getProvider(roleDef.provider);
      if (!provider) {
        throw new Error(`Provider "${roleDef.provider}" not found`);
      }

      // Merge role params with agent params
      const resolvedParams = ParamsMerger.mergeParams(
        roleDef.params,
        resolvedAgent.params
      );

      (resolvedAgent as any).provider = provider.name;
      (resolvedAgent as any).model = roleDef.model;
      (resolvedAgent as any)._resolvedParams = resolvedParams;
    } catch (error) {
      logger.error(`Failed to resolve agent role "${resolvedAgent.role}":`, error);
      if (error instanceof Error) {
        logger.error(`  Error details: ${error.message}`);
        logger.error(`  Stack:`, error.stack);
      }
    }
  }

  // Legacy: Resolve agents array (backward compatibility)
  const resolvedAgents = rawConfig.agents.map(agent => {
    try {
      // New way: use role
      if (agent.role) {
        const roleDef = resolver.getRole(agent.role);
        if (!roleDef) {
          throw new Error(`Role "${agent.role}" not found`);
        }

        const provider = resolver.getProvider(roleDef.provider);
        if (!provider) {
          throw new Error(`Provider "${roleDef.provider}" not found`);
        }

        const resolvedParams = ParamsMerger.mergeParams(
          roleDef.params,
          agent.params
        );

        return {
          ...agent,
          provider: provider.name,
          model: roleDef.model,
          _resolvedParams: resolvedParams,
        } as any;
      }

      // Backward compatibility: use model directly
      return agent;
    } catch (error) {
      logger.error(`Failed to resolve agent "${(agent as any).id || (agent as any).role}":`, error);
      return agent;
    }
  });

  // Resolve LLM Router tiers (v6)
  let resolvedLLMRouter = rawConfig.llmRouter;
  if (rawConfig.llmRouter?.enabled && rawConfig.llmRouter.tiers) {
    const resolvedTiers: LLMTiersConfig = {};

    for (const [tierName, tier] of Object.entries(rawConfig.llmRouter.tiers)) {
      try {
        if (tier.role) {
          const roleDef = resolver.getRole(tier.role);
          if (!roleDef) {
            throw new Error(`Role "${tier.role}" not found`);
          }

          const provider = resolver.getProvider(roleDef.provider);
          if (!provider) {
            throw new Error(`Provider "${roleDef.provider}" not found`);
          }

          // Merge role params with tier params
          const resolvedParams = ParamsMerger.mergeParams(
            roleDef.params,
            tier.params
          );

          resolvedTiers[tierName as keyof LLMTiersConfig] = {
            ...tier,
            provider: provider.name,
            models: [roleDef.model],
            maxTokens: resolvedParams.max_tokens,
            temperature: resolvedParams.temperature,
            _resolvedParams: resolvedParams,
          } as any;
        }
      } catch (error) {
        logger.error(`Failed to resolve LLM tier "${tierName}":`, error);
        if (error instanceof Error) {
          logger.error(`  Error details: ${error.message}`);
        }
        resolvedTiers[tierName as keyof LLMTiersConfig] = tier;
      }
    }

    resolvedLLMRouter = {
      ...rawConfig.llmRouter,
      tiers: resolvedTiers,
    };
  }

  // Resolve compression (v6)
  let resolvedCompression = rawConfig.compression;
  if (rawConfig.compression?.enabled && rawConfig.compression.role) {
    try {
      const roleDef = resolver.getRole(rawConfig.compression.role);
      if (!roleDef) {
        throw new Error(`Role "${rawConfig.compression.role}" not found`);
      }

      const provider = resolver.getProvider(roleDef.provider);
      if (!provider) {
        throw new Error(`Provider "${roleDef.provider}" not found`);
      }

      // Merge role params with compression params
      const resolvedParams = ParamsMerger.mergeParams(
        roleDef.params,
        rawConfig.compression.params
      );

      resolvedCompression = {
        ...rawConfig.compression,
        provider: provider.name,
        model: roleDef.model,
        _resolvedParams: resolvedParams,
      } as any;
    } catch (error) {
      logger.error('Failed to resolve compression config:', error);
    }
  }

  return {
    ...rawConfig,
    agents: resolvedAgents,
    llmRouter: resolvedLLMRouter,
    compression: resolvedCompression,
  };
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
