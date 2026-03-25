/**
 * Unified Initialization Module
 *
 * 统一初始化模块，包含钩子、MCP、子代理注册表等
 */

import { logger } from '../infra/observability/logger';
import { getHookRunner, resetHookRunner, type HookName, type HookHandler } from '../adapter/plugins/hooks';
import { getMCPManager, resetMCPManager, type MCPServerConfig } from '../adapter/mcp';
import { getSubagentRegistry, resetSubagentRegistry, type SubagentRegistryConfig } from '../domain/subagent/registry';
import { getHybridSearchManager, resetHybridSearchManager, type HybridSearchConfig } from '../domain/memory/hybrid-search';

// ============================================================================
// 配置类型
// ============================================================================

export interface UnifiedInitConfig {
  hooks?: {
    enabled?: boolean;
    handlers?: Array<{
      event: HookName;
      handler: HookHandler;
      priority?: number;
    }>;
  };
  mcp?: {
    enabled?: boolean;
    servers?: MCPServerConfig[];
  };
  subagent?: {
    enabled?: boolean;
    config?: Partial<SubagentRegistryConfig>;
  };
  hybridSearch?: {
    enabled?: boolean;
    config?: Partial<HybridSearchConfig>;
  };
}

export interface UnifiedInitResult {
  hooks: {
    enabled: boolean;
    registered: number;
  };
  mcp: {
    enabled: boolean;
    connected: number;
    failed: number;
    errors: Array<{ serverId: string; error: string }>;
  };
  subagent: {
    enabled: boolean;
    restored: number;
  };
  hybridSearch: {
    enabled: boolean;
    vectorAvailable: boolean;
  };
}

// ============================================================================
// 初始化函数
// ============================================================================

export async function initializeUnified(config: UnifiedInitConfig = {}): Promise<UnifiedInitResult> {
  const result: UnifiedInitResult = {
    hooks: { enabled: false, registered: 0 },
    mcp: { enabled: false, connected: 0, failed: 0, errors: [] },
    subagent: { enabled: false, restored: 0 },
    hybridSearch: { enabled: false, vectorAvailable: false },
  };

  // 1. 初始化钩子系统
  if (config.hooks?.enabled !== false) {
    const hookRunner = getHookRunner();

    // 注册配置的钩子
    if (config.hooks?.handlers) {
      for (const h of config.hooks.handlers) {
        hookRunner.register({
          id: `init-${h.event}-${Date.now()}`,
          hookName: h.event,
          handler: h.handler,
          priority: h.priority ?? 0,
          source: 'builtin',
        });
        result.hooks.registered++;
      }
    }

    result.hooks.enabled = true;
    logger.info(`[Init] Hooks initialized: ${result.hooks.registered} handlers`);
  }

  // 2. 初始化 MCP
  if (config.mcp?.enabled !== false && config.mcp?.servers?.length) {
    const manager = getMCPManager();

    for (const serverConfig of config.mcp.servers) {
      if (serverConfig.enabled === false) continue;

      try {
        await manager.connect(serverConfig);
        result.mcp.connected++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.mcp.failed++;
        result.mcp.errors.push({
          serverId: serverConfig.id,
          error: message,
        });
        logger.error(`[Init] MCP ${serverConfig.id} failed:`, message);
      }
    }

    result.mcp.enabled = true;
    logger.info(`[Init] MCP initialized: ${result.mcp.connected} connected, ${result.mcp.failed} failed`);
  }

  // 3. 初始化子代理注册表
  if (config.subagent?.enabled !== false) {
    const registry = getSubagentRegistry(config.subagent?.config);
    result.subagent.enabled = true;
    result.subagent.restored = registry.getStats().totalRuns;
    logger.info(`[Init] Subagent registry initialized: ${result.subagent.restored} records`);
  }

  // 4. 初始化混合搜索
  if (config.hybridSearch?.enabled !== false) {
    const manager = getHybridSearchManager(config.hybridSearch?.config);
    await manager.init();
    const status = manager.getStatus();
    result.hybridSearch.enabled = true;
    result.hybridSearch.vectorAvailable = status.vector.available;
    logger.info(`[Init] Hybrid search initialized: vector=${status.vector.available}, fts=${status.fts.available}`);
  }

  return result;
}

// ============================================================================
// 重置函数
// ============================================================================

export async function resetUnified(): Promise<void> {
  // 关闭 MCP 连接
  try {
    await resetMCPManager();
  } catch {
    // Ignore errors
  }

  // 重置钩子
  resetHookRunner();

  // 重置子代理注册表
  resetSubagentRegistry();

  // 重置混合搜索
  resetHybridSearchManager();

  logger.debug('[Init] Unified modules reset');
}

// ============================================================================
// 状态查询
// ============================================================================

export interface UnifiedStatus {
  hooks: {
    registeredEvents: string[];
    totalHandlers: number;
  };
  mcp: {
    servers: Array<{
      id: string;
      name: string;
      connected: boolean;
      tools: number;
    }>;
  };
  subagent: {
    stats: ReturnType<typeof getSubagentRegistry>['getStats'] extends () => infer R ? R : never;
  };
  hybridSearch: {
    status: ReturnType<typeof getHybridSearchManager>['getStatus'] extends () => infer R ? R : never;
  };
}

export function getUnifiedStatus(): UnifiedStatus {
  const hookRunner = getHookRunner();
  const mcpManager = getMCPManager();
  const subagentRegistry = getSubagentRegistry();
  const hybridSearch = getHybridSearchManager();

  return {
    hooks: {
      registeredEvents: hookRunner.getRegisteredHookNames(),
      totalHandlers: hookRunner.getRegistrationCount('message_received' as any) +
        hookRunner.getRegistrationCount('before_tool_call' as any) +
        hookRunner.getRegistrationCount('after_tool_call' as any),
    },
    mcp: {
      servers: mcpManager.getStatus().map((s) => ({
        id: s.id,
        name: s.name,
        connected: s.connected,
        tools: s.tools,
      })),
    },
    subagent: {
      stats: subagentRegistry.getStats(),
    },
    hybridSearch: {
      status: hybridSearch.getStatus(),
    },
  };
}
