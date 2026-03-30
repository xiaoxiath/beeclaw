/**
 * Beeclaw Default Configuration
 *
 * This file contains all default configuration values.
 * User configuration in beeclaw.json will override these defaults.
 *
 * Priority: User Config (beeclaw.json) > Default Config > Hardcoded
 */

import type { AppConfig } from './schema';
import { deepMerge } from '../utils';

export const DEFAULT_CONFIG: AppConfig = {
  // Server configuration
  server: {
    port: 3000,
    host: '0.0.0.0',
  },

  // Authentication (disabled by default)
  auth: {
    enabled: false,
    tokens: [],
  },

  // CORS (localhost only by default)
  cors: {
    enabled: true,
    origins: ['localhost'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: [],
    credentials: true,
    maxAge: 86400,
  },

  // AI Providers (empty by default, user must configure)
  providers: [],

  // Global roles (v6)
  roles: {},

  // Default agent configuration (v6: single agent)
  agent: {
    name: 'Default Assistant',
    description: 'A helpful AI assistant with memory capabilities',
    role: 'chat',  // Reference to global roles
    visionRole: 'vision',  // Vision role reference
    systemPrompt: 'You are a helpful AI assistant. You have access to memory tools to remember information about the user and recall past conversations.',
    tools: ['memory_ls', 'memory_grep', 'memory_read', 'memory_write', 'memory_record'],
  },

  // Legacy: agents array (deprecated in v6, kept for backward compatibility)
  agents: [],

  // Session storage
  sessionStorage: {
    type: 'jsonl',
    path: './data/sessions',
  },

  // Memory configuration
  memory: {
    type: 'filesystem',
    path: './data/memory',
    tools: {
      enabled: ['memory_ls', 'memory_grep', 'memory_read', 'memory_write', 'memory_record'],
      autoRecord: true,
    },
    retention: {
      conversations: '90d',
      facts: 'forever',
      decisions: 'forever',
    },
    search: {
      vector: {
        enabled: true,
        provider: 'auto',
      },
      fts: {
        enabled: true,
      },
      hybrid: {
        vectorWeight: 0.7,
        textWeight: 0.3,
      },
    },
  },

  // Skills configuration
  skills: {
    userPath: './data/memory/skills',
    builtinPath: './skills',
    autoLoad: true,
  },

  // Plugins (enabled by default)
  plugins: {
    enabled: true,
    disabledPlugins: [],
  },

  // Channel plugins (empty by default)
  channels: {},

  // Tool plugins (empty by default)
  tools: {},

  // Logging
  logging: {
    level: 'info',
    format: 'pretty',
  },

  // Feishu (disabled by default, requires credentials)
  feishu: {
    enabled: false,
    mode: 'sdk',
    cliPath: 'feishu',
    cliTimeout: 30000,
    cliRetries: 2,
    logLevel: 'error',
    useCardV2: true,
  },

  // User configuration
  user: {
    location: 'Beijing',
    locale: 'zh-CN',
  },

  // Weather (requires API key)
  weather: {
    apiHost: 'devapi.qweather.com',
    defaultLocation: 'Beijing',
  },

  // Search (empty by default, requires API keys)
  search: {},

  // Finance (requires token)
  finance: {
    defaultSource: 'auto',
    cacheEnabled: true,
  },

  // Agent display
  agentDisplay: {
    showTokenStats: false,
    tokenStatsFormat: 'inline',
  },

  // Compression
  compression: {
    enabled: true,
    role: 'fast',  // v6: role reference instead of model
    threshold: 0.8,
    keepRecent: 8,
    maxSummaryTokens: 1000,
    strategy: 'hybrid',
  },

  // Extraction
  extraction: {
    enabled: true,
    triggerPhrases: [],
    periodicInterval: 10,
    confidenceThreshold: 0.9,
    lowConfidenceThreshold: 0.7,
    maxExtractionsPerRun: 20,
    notifyOnHighConfidence: true,
    sensitivePatterns: [
      'password', 'passwd', 'pwd',
      'secret', 'api_key', 'apikey', 'api-key',
      'token', 'access_token', 'accessToken',
      'private_key', 'privatekey', 'private-key',
      '密钥', '密码', '口令', '私钥',
    ],
  },

  // Tool selector
  toolSelector: {
    strategy: 'hybrid',
    maxTools: 30,
    cache: {
      enabled: true,
      maxSize: 1000,
      ttl: 3600000,
    },
    rules: {
      enabled: true,
    },
    semantic: {
      enabled: true,
      fallbackToCore: true,
    },
  },

  // MCP (enabled by default)
  mcp: {
    enabled: true,
    servers: [],
  },

  // Hooks
  hooks: {
    enabled: true,
    directories: ['./hooks'],
  },

  // Sandbox (disabled by default)
  sandbox: {
    enabled: false,
    provider: 'auto',
    workspaceBase: './data/sandbox',
    local: {
      enabled: true,
      defaultTimeout: 30000,
      maxOutputSize: 1048576,
      blockedCommands: [
        'rm\\s+-rf\\s+/',
        'mkfs',
        'dd\\s+if=',
        ':(){ :|:& };:',
        'chmod\\s+-R\\s+777\\s+/',
        'shutdown',
        'reboot',
        'halt',
        'init\\s+0',
      ],
    },
    docker: {
      enabled: false,
      image: 'beeclaw-sandbox:latest',
      memoryLimitMb: 512,
      cpuLimit: 1,
      networkEnabled: false,
      defaultTimeout: 60000,
      maxOutputSize: 2097152,
      idleTimeout: 300000,
    },
    pool: {
      enabled: false,
      minIdle: 1,
      maxTotal: 5,
      healthCheckInterval: 10000,
    },
  },

  // Web UI (disabled by default)
  web: {
    enabled: false,
    port: 3000,
    host: '0.0.0.0',
    auth: {
      level: 'none',
    },
  },

  // LLM Router (tiered system, enabled by default)
  llmRouter: {
    enabled: true,
    tiers: {},
    fallbackEnabled: true,
    costTracking: true,
    concurrency: {
      maxConcurrent: 2,
      maxQueueSize: 50,
      queueTimeoutMs: 100000,
      enablePriority: true,
    },
  },
};

/**
 * Deep merge user config with default config
 * User config values override default config values
 */
export function mergeWithDefaults(userConfig: Partial<AppConfig>): AppConfig {
  return deepMerge(DEFAULT_CONFIG, userConfig);
}
/**
 * Get default value for a specific config path
 */
export function getDefault<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return DEFAULT_CONFIG[key];
}

/**
 * Check if a value is the default value
 */
export function isDefaultValue<K extends keyof AppConfig>(key: K, value: AppConfig[K]): boolean {
  return JSON.stringify(value) === JSON.stringify(DEFAULT_CONFIG[key]);
}
