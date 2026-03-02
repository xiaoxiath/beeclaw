import { z } from 'zod';

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
  origins: z.array(z.string()).default(['*']),
  methods: z.array(z.string()).default(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']),
  allowHeaders: z.array(z.string()).default(['Content-Type', 'Authorization']),
  exposeHeaders: z.array(z.string()).default([]),
  maxAge: z.number().default(86400),
  credentials: z.boolean().default(true),
});

// AI Provider schema
export const AIProviderSchema = z.object({
  name: z.string(),
  type: z.enum(['openai', 'anthropic', 'zhipu', 'minimax', 'custom']).default('openai'),
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  models: z.array(z.string()).default([]),
  default: z.boolean().default(false),
  // Provider-specific options
  options: z.record(z.unknown()).optional(),
});

// Agent schema
export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  provider: z.string(),
  model: z.string(),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  tools: z.array(z.string()).default([]),
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
});

// Skills configuration schema
export const SkillsConfigSchema = z.object({
  userPath: z.string().default('./data/memory/skills'),
  builtinPath: z.string().default('./skills'),
  autoLoad: z.boolean().default(true),
});

// Plugin schema
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
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  encryptKey: z.string().optional(),
  verificationToken: z.string().optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('error'),
});

// User configuration schema
export const UserConfigSchema = z.object({
  timezone: z.string().default('Asia/Shanghai'),
  locale: z.string().default('zh-CN'),
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

// Context compression configuration schema
export const CompressionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  model: z.string().default('glm-4.7-flash'),  // LLM for compression
  threshold: z.number().min(0.5).max(0.95).default(0.8),  // Trigger at 80% context
  keepRecent: z.number().min(2).max(20).default(8),  // Keep recent messages
  maxSummaryTokens: z.number().min(200).max(2000).default(1000),
  strategy: z.enum(['llm', 'rule', 'hybrid']).default('hybrid'),
});

// Main configuration schema
export const AppConfigSchema = z.object({
  server: ServerConfigSchema.default({}),
  auth: AuthConfigSchema.default({}),
  cors: CorsConfigSchema.default({}),
  providers: z.array(AIProviderSchema).default([]),
  agents: z.array(AgentConfigSchema).default([]),
  sessionStorage: SessionStorageConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  skills: SkillsConfigSchema.default({}),
  channels: z.record(ChannelPluginConfigSchema).default({}),
  tools: z.record(ToolPluginConfigSchema).default({}),
  logging: LoggingConfigSchema.default({}),
  feishu: FeishuConfigSchema.default({}),
  user: UserConfigSchema.default({}),
  weather: WeatherConfigSchema.default({}),
  search: SearchConfigSchema.default({}),
  finance: FinanceConfigSchema.default({}),
  agentDisplay: AgentDisplayConfigSchema.default({}),
  compression: CompressionConfigSchema.default({}),
});

// Type exports
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type CorsConfig = z.infer<typeof CorsConfigSchema>;
export type AIProvider = z.infer<typeof AIProviderSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type SessionStorageConfig = z.infer<typeof SessionStorageConfigSchema>;
export type MemoryConfigSchemaType = z.infer<typeof MemoryConfigSchema>;
export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;
export type ChannelPluginConfig = z.infer<typeof ChannelPluginConfigSchema>;
export type ToolPluginConfig = z.infer<typeof ToolPluginConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type FeishuConfig = z.infer<typeof FeishuConfigSchema>;
export type WeatherConfig = z.infer<typeof WeatherConfigSchema>;
export type SearchConfig = z.infer<typeof SearchConfigSchema>;
export type FinanceConfig = z.infer<typeof FinanceConfigSchema>;
export type AgentDisplayConfig = z.infer<typeof AgentDisplayConfigSchema>;
export type CompressionConfig = z.infer<typeof CompressionConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
