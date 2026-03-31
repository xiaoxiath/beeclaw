/**
 * Beeclaw Configuration Schema (Zod) — Single Source of Truth
 *
 * This file is the canonical definition for all configuration options.
 * - beeclaw.schema.json: generated/manual JSON Schema for editor autocompletion (may lag behind)
 * - beeclaw.example.json: example config referencing this schema
 *
 * When adding new config fields, update this file FIRST, then sync beeclaw.schema.json.
 */
import { z } from 'zod';
import { SandboxConfigSchema } from '../../types/sandbox-config';

// Server configuration schema
export const ServerConfigSchema = z.object({
  port: z.number().default(3000),
  host: z.string().default('0.0.0.0'),
});

// Auth configuration schema
export const AuthConfigSchema = z.object({
  enabled: z.boolean().default(false),
  tokens: z.array(z.string()).default([]),
  password: z.string().optional(),
});

// CORS configuration schema
export const CorsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  origins: z.array(z.string()).default(['localhost']), // Changed from ["*"] to ["localhost"]
  methods: z.array(z.string()).default(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']),
  allowHeaders: z.array(z.string()).default(['Content-Type', 'Authorization']),
  exposeHeaders: z.array(z.string()).default([]),
  maxAge: z.number().default(86400),
  credentials: z.boolean().default(true),
});

// Embedding Provider schema
export const EmbeddingProviderSchema = z.object({
  provider: z.enum(['openai', 'zhipu', 'minimax', 'local', 'auto']).default('auto'),
  role: z.string().optional(),  // New: role reference
  apiKey: z.string().optional(),
  groupId: z.string().optional(), // MiniMax group ID
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  dims: z.number().optional(),
});

// Model parameters schema
export const ModelParamsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().min(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().min(0).optional(),
  do_sample: z.boolean().optional(),
  stream: z.boolean().optional(),
  thinking: z.object({
    type: z.enum(['enabled', 'disabled'])
  }).optional(),
}).passthrough(); // Allow additional parameters

// Model definition schema (Layer 1: Model metadata and default params)
export const ModelDefinitionSchema = z.object({
  displayName: z.string().optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
  capabilities: z.array(z.string()).optional(),
  defaultParams: ModelParamsSchema.optional(),
});

// Role definition schema (v6: roles are global, explicitly specify provider)
export const RoleDefinitionSchema = z.object({
  provider: z.string(),  // v6: explicit provider reference
  model: z.string(),
  params: ModelParamsSchema.optional(),
});

// AI Provider schema (v6: roles moved to top level)
export const AIProviderSchema = z.object({
  name: z.string(),
  type: z.enum(['openai', 'anthropic', 'zhipu', 'minimax', 'custom']).default('openai'),
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  default: z.boolean().default(false),

  // Model definitions
  models: z.record(z.string(), ModelDefinitionSchema),

  // Provider-specific options
  options: z.record(z.unknown()).optional(),
});

// Vision (multimodal) configuration schema
export const VisionConfigSchema = z.object({
  /** Vision model for image recognition (default: 'glm-4.6v') */
  visionModel: z.string().default('glm-4.6v'),
  /**
   * Text model for processing vision results
   * Default: Uses agent's model from agent.role configuration
   * This schema default ('glm-5') is only used if agent config is missing
   */
  textModel: z.string().default('glm-5'),
  /** System prompt for vision recognition */
  visionSystemPrompt: z.string().default(
    '请识别并详细描述这张图片的内容。包括：主要物体、文字、场景、颜色等关键信息。' +
    '如果是食物，列出所有可见的食材和菜品名称。' +
    '如果是代码截图或文档，提取其中的文字内容。' +
    '如果是其他内容（风景、人物、图表等），也请详细描述。'
  ),
  /** Behavior when vision model fails */
  fallbackOnError: z.enum(['description', 'placeholder', 'retry']).default('placeholder'),
  /** Max retries for vision model */
  maxRetries: z.number().min(0).max(3).default(1),
});

// Selector configuration schema (P0 Context Engineering)
const SelectorConfigSchema = z.object({
  /** RRI weights for context selection */
  weights: z.object({
    relevance: z.number().min(0).max(1).default(0.5),
    recency: z.number().min(0).max(1).default(0.3),
    importance: z.number().min(0).max(1).default(0.2),
  }).default({}),
  /** Maximum items to select */
  maxItems: z.number().min(1).max(100).default(20),
  /** Deduplication threshold (cosine similarity) */
  dedupThreshold: z.number().min(0.5).max(1.0).default(0.92),
  /** Enable Lost-in-the-Middle reordering */
  enableReorder: z.boolean().default(true),
}).default({});

// SimHash configuration schema (P0 Context Engineering)
const SimHashConfigSchema = z.object({
  /** Hamming distance threshold for duplicate detection */
  threshold: z.number().min(1).max(10).default(3),
  /** Hash bits (64 for production, 32 for testing) */
  hashBits: z.number().min(32).max(128).default(64),
}).default({});

// Health check thresholds schema (P0 Context Engineering)
const HealthThresholdsSchema = z.object({
  tokenUtilization: z.object({
    warning: z.number().min(0).max(1).default(0.80),
    critical: z.number().min(0).max(1).default(0.95),
  }).default({}),
  redundancyRate: z.object({
    warning: z.number().min(0).max(1).default(0.30),
    critical: z.number().min(0).max(1).default(0.50),
  }).default({}),
  freshnessScore: z.object({
    warning: z.number().min(0).max(1).default(0.40),
    critical: z.number().min(0).max(1).default(0.20),
  }).default({}),
  coherenceScore: z.object({
    warning: z.number().min(0).max(1).default(0.50),
    critical: z.number().min(0).max(1).default(0.30),
  }).default({}),
}).default({});

// Health check configuration schema (P0 Context Engineering)
const HealthCheckConfigSchema = z.object({
  /** Enable context health monitoring */
  enabled: z.boolean().default(true),
  /** Check interval (in conversation turns) */
  interval: z.number().min(1).max(20).default(5),
  /** Alert thresholds */
  thresholds: HealthThresholdsSchema,
}).default({});

// Context configuration schema
export const ContextConfigSchema = z.object({
  /** Maximum tokens for context window (default: 120000) */
  maxTokens: z.number().min(1000).max(500000).default(120000),
  /** Minimum recent messages to always keep (default: 6) */
  keepRecent: z.number().min(0).max(20).default(6),
  /** Always keep system messages (default: true) */
  keepSystem: z.boolean().default(true),
  /** Token threshold to start compression (default: 0.8 = 80%) */
  compressionThreshold: z.number().min(0.5).max(1.0).default(0.8),
  /** Enable/disable compression (default: true) */
  compressionEnabled: z.boolean().default(true),
  /** Compression level: "L1", "L1+L2", "L1+L2+L3", or "auto" (default: "auto") */
  compressionLevel: z.enum(['L1', 'L1+L2', 'L1+L2+L3', 'auto']).default('auto'),
  /** Context selector configuration (P0) */
  selector: SelectorConfigSchema,
  /** SimHash deduplication configuration (P0) */
  simhash: SimHashConfigSchema,
  /** Health monitoring configuration (P0) */
  healthCheck: HealthCheckConfigSchema,
});

// Agent schema (v6: single agent instead of array)
export const AgentConfigSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  role: z.string(),              // Reference to global roles
  /**
   * Vision role reference (optional)
   * If provided, uses the model from roles[visionRole] for image recognition
   * Priority: visionConfig > visionRole > role
   */
  visionRole: z.string().optional(),
  params: ModelParamsSchema.optional(), // Agent-level params override
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).default([]),
  blockedTools: z.array(z.string()).optional(),
  contextConfig: ContextConfigSchema.optional(), // Context compression configuration
  /**
   * Vision configuration (optional, overrides visionRole)
   * If not provided, defaults to using visionRole or agent's model
   */
  visionConfig: VisionConfigSchema.optional(),
});

// Session storage schema
export const SessionStorageConfigSchema = z.object({
  type: z.enum(['jsonl', 'memory', 'sqlite']).default('jsonl'),
  path: z.string().default('./data/sessions'),
});

// Memory configuration schema
export const MemoryConfigSchema = z.object({
  type: z.literal('filesystem').default('filesystem'),
  path: z.string().default('./data/memory'),
  tools: z.object({
    enabled: z.array(z.string()).default(['memory_ls', 'memory_grep', 'memory_read', 'memory_write', 'memory_record']),
    autoRecord: z.boolean().default(true),
  }).default({}),
  retention: z.object({
    conversations: z.string().default('90d'),
    facts: z.string().default('forever'),
    decisions: z.string().default('forever'),
  }).default({}),
  // 混合搜索配置
  search: z.object({
    vector: z.object({
      enabled: z.boolean().default(true),
      provider: z.enum(['openai', 'zhipu', 'local', 'auto']).default('auto'),
      apiKey: z.string().optional(),
      baseUrl: z.string().optional(),
      model: z.string().optional(),
      dims: z.number().optional(),
    }).default({}),
    fts: z.object({
      enabled: z.boolean().default(true),
    }).default({}),
    hybrid: z.object({
      vectorWeight: z.number().min(0).max(1).default(0.7),
      textWeight: z.number().min(0).max(1).default(0.3),
      mmr: z.object({
        enabled: z.boolean().default(false),
        lambda: z.number().min(0).max(1).default(0.5),
      }).optional(),
      temporalDecay: z.object({
        enabled: z.boolean().default(false),
        halfLifeDays: z.number().min(1).default(30),
      }).optional(),
    }).default({}),
  }).default({}),
});

// Skills configuration schema
export const SkillsConfigSchema = z.object({
  userPath: z.string().default('./data/memory/skills'),
  builtinPath: z.string().default('./skills'),
  autoLoad: z.boolean().default(true),
});

// Plugin discovery configuration schema
export const PluginDiscoveryConfigSchema = z.object({
  bundledDir: z.string().optional(),
  globalDir: z.string().optional(),
  workspaceDir: z.string().optional(),
  configPaths: z.array(z.string()).optional(),
});

// Plugins configuration schema (OpenClaw-compatible)
export const PluginsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  discovery: PluginDiscoveryConfigSchema.optional(),
  disabledPlugins: z.array(z.string()).default([]),
  pluginConfigs: z.record(z.unknown()).optional(),
});

// Plugin schema (legacy, for backward compatibility)
export const PluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  path: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

// Channel plugin schema
export const ChannelPluginConfigSchema = PluginConfigSchema.extend({
  type: z.enum(['lark', 'webhook', 'custom']),
});

// Tool plugin schema
export const ToolPluginConfigSchema = PluginConfigSchema.extend({
  type: z.enum(['http', 'function', 'mcp']).default('http'),
});

// Logging schema
export const LoggingConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  format: z.enum(['json', 'pretty']).default('pretty'),
  file: z.string().optional(),
});

// Feishu configuration schema
export const FeishuConfigSchema = z.object({
  enabled: z.boolean().default(false),

  // SDK Configuration (for backward compatibility)
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  encryptKey: z.string().optional(),
  verificationToken: z.string().optional(),

  // CLI Configuration (new)
  mode: z.enum(['sdk', 'cli', 'hybrid']).default('sdk'),
  cliPath: z.string().default('feishu'),  // Default to PATH lookup
  cliTimeout: z.number().default(30000),   // 30 seconds
  cliRetries: z.number().default(2),

  // Per-tool mode override
  toolMode: z.record(z.enum(['sdk', 'cli'])).optional(),

  // Existing fields
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('error'),
  /**
   * Enable Card Schema 2.0 for streaming messages
   * When true, uses interactive cards with collapsible panels and streaming updates
   */
  useCardV2: z.boolean().default(true),
});

// User configuration schema
export const UserConfigSchema = z.object({
  location: z.string().optional().describe('User\'s location (city name, e.g., "北京", "上海", "New York")'),
  timezone: z.string().optional(),  // Optional - auto-derived from location
  locale: z.string().default('zh-CN'),
});

// Default push target schema
export const DefaultPushTargetSchema = z.object({
  channel: z.enum(['cli', 'feishu', 'webhook']).default('feishu'),
  chatId: z.string().optional(),
  userId: z.string().optional(),
});

// Weather configuration schema (和风天气)
export const WeatherConfigSchema = z.object({
  apiHost: z.string().default('devapi.qweather.com'),
  apiKey: z.string().optional(),
  token: z.string().optional(),
  defaultLocation: z.string().default('北京'),
});

// Search configuration schema
export const SearchConfigSchema = z.object({
  bochaApiKey: z.string().optional(),      // 博查AI
  tavilyApiKey: z.string().optional(),     // Tavily
  googleApiKey: z.string().optional(),
  googleCx: z.string().optional(),
  bingApiKey: z.string().optional(),
  braveApiKey: z.string().optional(),
});

// Finance configuration schema
export const FinanceConfigSchema = z.object({
  tushareToken: z.string().optional(),
  defaultSource: z.enum(['tushare', 'sina', 'eastmoney', 'auto']).default('auto'),
  cacheEnabled: z.boolean().default(true),
});

// Agent display configuration schema
export const AgentDisplayConfigSchema = z.object({
  showTokenStats: z.boolean().default(false),
  tokenStatsFormat: z.enum(['inline', 'block']).default('inline'),
});

// Context compression configuration schema (v6)
export const CompressionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  role: z.string().default('fast'),  // v6: role reference with default
  params: ModelParamsSchema.optional(), // Params override
  threshold: z.number().min(0.5).max(0.95).default(0.8),
  keepRecent: z.number().min(2).max(20).default(8),
  maxSummaryTokens: z.number().min(200).max(2000).default(1000),
  strategy: z.enum(['llm', 'rule', 'hybrid']).default('hybrid'),
});

// Auto knowledge extraction configuration schema
export const ExtractionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  triggerPhrases: z.array(z.string()).default([]),  // 留空则让 LLM 自己判断
  periodicInterval: z.number().min(1).max(50).default(10),  // Every N messages
  confidenceThreshold: z.number().min(0.5).max(1).default(0.9),  // High confidence
  lowConfidenceThreshold: z.number().min(0.3).max(0.8).default(0.7),  // Low confidence
  maxExtractionsPerRun: z.number().min(1).max(50).default(20),
  notifyOnHighConfidence: z.boolean().default(true),
  sensitivePatterns: z.array(z.string()).default([
    'password', 'passwd', 'pwd',
    'secret', 'api_key', 'apikey', 'api-key',
    'token', 'access_token', 'accessToken',
    'private_key', 'privatekey', 'private-key',
    '密钥', '密码', '口令', '私钥',
  ]),
});

// Tool Selector configuration schema
export const ToolSelectorConfigSchema = z.object({
  strategy: z.enum(['all', 'layered', 'hybrid', 'semantic']).default('hybrid'),
  maxTools: z.number().min(10).max(100).default(30),
  embedding: EmbeddingProviderSchema.optional(),
  cache: z.object({
    enabled: z.boolean().default(true),
    maxSize: z.number().default(1000),
    ttl: z.number().default(3600000),
  }).optional(),
  rules: z.object({
    enabled: z.boolean().default(true),
  }).optional(),
  semantic: z.object({
    enabled: z.boolean().default(true),
    fallbackToCore: z.boolean().default(true),
  }).optional(),
});

// MCP Server configuration schema
export const MCPServerConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.enum(['stdio', 'http', 'sse']),
  // stdio 配置
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  // http 配置
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  // 通用配置
  enabled: z.boolean().default(true),
  timeout: z.number().optional(),
  // 工具过滤
  tools: z.object({
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
  }).optional(),
});

// MCP configuration schema
export const MCPConfigSchema = z.object({
  enabled: z.boolean().default(true),
  servers: z.array(MCPServerConfigSchema).default([]),
});

// Hooks configuration schema
export const HooksConfigSchema = z.object({
  enabled: z.boolean().default(true),
  directories: z.array(z.string()).default([]),
  handlers: z.array(z.object({
    event: z.string(),
    module: z.string(),
    export: z.string().optional(),
  })).optional(),
});

// Session recovery configuration schema
export const RecoveryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxAge: z.number().default(300000),  // 5 minutes in milliseconds
  minAge: z.number().default(10000),   // 10 seconds in milliseconds
  channels: z.array(z.string()).default(['feishu']),
  batchSize: z.number().default(5),
  delayMs: z.number().default(2000),
  startupDelay: z.number().default(10000),
});

// LLM Tier Configuration Schema (v4)
export const LLMTierConfigSchema = z.object({
  role: z.string(),              // Reference to provider.roles
  params: ModelParamsSchema.optional(), // Layer 3 params override
  timeout: z.number().optional(),
  retries: z.number().optional(),
});

// LLM Tiers Configuration Schema (v4) - record of tier name to config
export const LLMTiersConfigSchema = z.record(z.string(), LLMTierConfigSchema);

// LLM Concurrency Configuration Schema
export const LLMConcurrencyConfigSchema = z.object({
  /** Maximum concurrent LLM API requests (default: 2) */
  maxConcurrent: z.number().min(1).max(100).default(2),
  /** Maximum queue depth before rejecting (default: 50) */
  maxQueueSize: z.number().min(1).max(500).default(50),
  /** Queue wait timeout in milliseconds (default: 100000) */
  queueTimeoutMs: z.number().min(1000).max(120000).default(100000),
  /** Enable priority-based scheduling (default: true) */
  enablePriority: z.boolean().default(true),
});

// LLM Router Configuration Schema (v4)
export const LLMRouterConfigSchema = z.object({
  enabled: z.boolean().default(true),
  tiers: z.record(z.string(), LLMTierConfigSchema),
  fallbackEnabled: z.boolean().default(true),
  costTracking: z.boolean().default(true),
  /** Concurrency control for LLM API calls */
  concurrency: LLMConcurrencyConfigSchema.default({}),
});

// Web UI configuration schema
export const WebConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.coerce.number().default(3000),
  host: z.string().default('0.0.0.0'),
  auth: z.object({
    level: z.enum(['none', 'token', 'basic']).default('none'),
    token: z.string().optional(),
    basicUsers: z.array(z.object({
      username: z.string(),
      password: z.string(),
    })).optional(),
  }).default({}),
});

// Main configuration schema (v6)
export const AppConfigSchema = z.object({
  server: ServerConfigSchema.default({}),
  auth: AuthConfigSchema.default({}),
  cors: CorsConfigSchema.default({}),

  // v6: Provider definitions
  providers: z.array(AIProviderSchema).default([]),

  // v6: Global roles (flat structure)
  roles: z.record(z.string(), RoleDefinitionSchema).default({}),

  // v6: Single agent instead of array
  agent: AgentConfigSchema.optional(),

  // Legacy support: agents array (deprecated in v6)
  agents: z.array(AgentConfigSchema).default([]),

  sessionStorage: SessionStorageConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  skills: SkillsConfigSchema.default({}),
  plugins: PluginsConfigSchema.default({}),
  channels: z.record(ChannelPluginConfigSchema).default({}),
  tools: z.record(ToolPluginConfigSchema).default({}),
  logging: LoggingConfigSchema.default({}),
  feishu: FeishuConfigSchema.default({}),
  user: UserConfigSchema.default({}),
  defaultPushTarget: DefaultPushTargetSchema.optional(),
  weather: WeatherConfigSchema.default({}),
  search: SearchConfigSchema.default({}),
  finance: FinanceConfigSchema.default({}),
  agentDisplay: AgentDisplayConfigSchema.default({}),
  compression: CompressionConfigSchema.default({}),
  extraction: ExtractionConfigSchema.default({}),
  toolSelector: ToolSelectorConfigSchema.optional(),
  mcp: MCPConfigSchema.default({}),
  hooks: HooksConfigSchema.default({}),
  sandbox: SandboxConfigSchema.default({}),
  recovery: RecoveryConfigSchema.optional(),
  web: WebConfigSchema.default({}),
  llmRouter: LLMRouterConfigSchema.optional(),
});

// Type exports
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type CorsConfig = z.infer<typeof CorsConfigSchema>;
export type EmbeddingProviderConfigType = z.infer<typeof EmbeddingProviderSchema>;
export type ModelParams = z.infer<typeof ModelParamsSchema>;
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;
export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;
export type AIProvider = z.infer<typeof AIProviderSchema>;
export type ContextConfig = z.infer<typeof ContextConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type SessionStorageConfig = z.infer<typeof SessionStorageConfigSchema>;
export type MemoryConfigSchemaType = z.infer<typeof MemoryConfigSchema>;
export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;
export type PluginDiscoveryConfig = z.infer<typeof PluginDiscoveryConfigSchema>;
export type PluginsConfig = z.infer<typeof PluginsConfigSchema>;
export type ChannelPluginConfig = z.infer<typeof ChannelPluginConfigSchema>;
export type ToolPluginConfig = z.infer<typeof ToolPluginConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type FeishuConfig = z.infer<typeof FeishuConfigSchema>;
export type UserConfig = z.infer<typeof UserConfigSchema>;
export type DefaultPushTarget = z.infer<typeof DefaultPushTargetSchema>;
export type WeatherConfig = z.infer<typeof WeatherConfigSchema>;
export type SearchConfig = z.infer<typeof SearchConfigSchema>;
export type FinanceConfig = z.infer<typeof FinanceConfigSchema>;
export type AgentDisplayConfig = z.infer<typeof AgentDisplayConfigSchema>;
export type CompressionConfig = z.infer<typeof CompressionConfigSchema>;
export type ExtractionConfigSchemaType = z.infer<typeof ExtractionConfigSchema>;
export type ToolSelectorConfig = z.infer<typeof ToolSelectorConfigSchema>;
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;
export type HooksConfig = z.infer<typeof HooksConfigSchema>;
export type RecoveryConfig = z.infer<typeof RecoveryConfigSchema>;
export type WebConfig = z.infer<typeof WebConfigSchema>;
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
export type LLMTierConfig = z.infer<typeof LLMTierConfigSchema>;
export type LLMTiersConfig = z.infer<typeof LLMTiersConfigSchema>;
export type LLMConcurrencyConfig = z.infer<typeof LLMConcurrencyConfigSchema>;
export type LLMRouterConfig = z.infer<typeof LLMRouterConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
