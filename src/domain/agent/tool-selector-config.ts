/**
 * Tool Selector Configuration
 *
 * 控制混合工具选择器的行为
 */

export interface ToolSelectorConfig {
  /**
   * 选择器策略
   * - 'all': 加载所有工具（不推荐）
   * - 'layered': 按层级加载（推荐用于简单场景）
   * - 'hybrid': 混合策略（推荐用于生产）
   * - 'semantic': 纯语义匹配（推荐用于开发）
   */
  strategy: 'all' | 'layered' | 'hybrid' | 'semantic';

  /**
   * 最大工具数量
   * - 默认: 30
   * - 范围: 10-100
   */
  maxTools: number;

  /**
   * 缓存配置
   */
  cache: {
    enabled: boolean;
    maxSize: number;      // 最大缓存条目数
    ttl: number;          // 缓存过期时间（毫秒）
  };

  /**
   * 规则匹配配置
   */
  rules: {
    enabled: boolean;
    confidenceThreshold: number; // 置信度阈值 (0-1)
  };

  /**
   * 语义匹配配置
   */
  semantic: {
    enabled: boolean;
    model: string;        // Embedding model
    fallbackToCore: boolean; // 失败时是否回退到核心工具
  };

  /**
   * 调试选项
   */
  debug: {
    logSelection: boolean;     // 记录工具选择日志
    logPerformance: boolean;   // 记录性能指标
    logCacheHits: boolean;     // 记录缓存命中
  };
}

export const DEFAULT_TOOL_SELECTOR_CONFIG: ToolSelectorConfig = {
  strategy: 'hybrid',
  maxTools: 30,

  cache: {
    enabled: true,
    maxSize: 1000,
    ttl: 60 * 60 * 1000, // 1 hour
  },

  rules: {
    enabled: true,
    confidenceThreshold: 0.8,
  },

  semantic: {
    enabled: true,
    model: 'text-embedding-3-small',
    fallbackToCore: true,
  },

  debug: {
    logSelection: true,
    logPerformance: true,
    logCacheHits: false,
  },
};

/**
 * 从 beeclaw.json 加载配置
 */
export function loadToolSelectorConfig(
  appConfig?: Record<string, any>
): ToolSelectorConfig {
  if (!appConfig?.toolSelector) {
    return DEFAULT_TOOL_SELECTOR_CONFIG;
  }

  const userConfig = appConfig.toolSelector;

  return {
    ...DEFAULT_TOOL_SELECTOR_CONFIG,
    ...userConfig,
    cache: {
      ...DEFAULT_TOOL_SELECTOR_CONFIG.cache,
      ...userConfig.cache,
    },
    rules: {
      ...DEFAULT_TOOL_SELECTOR_CONFIG.rules,
      ...userConfig.rules,
    },
    semantic: {
      ...DEFAULT_TOOL_SELECTOR_CONFIG.semantic,
      ...userConfig.semantic,
    },
    debug: {
      ...DEFAULT_TOOL_SELECTOR_CONFIG.debug,
      ...userConfig.debug,
    },
  };
}
