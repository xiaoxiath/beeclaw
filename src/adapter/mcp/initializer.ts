/**
 * MCP Initializer
 *
 * 在应用启动时初始化 MCP 连接
 */

import { logger } from '../../infra/observability/logger';
import { getMCPManager, type MCPServerConfig } from './client';
import type { MCPConfig } from '../../infra/config/schema';

/**
 * 初始化 MCP 连接
 */
export async function initializeMCP(config: MCPConfig): Promise<{
  success: number;
  failed: number;
  errors: Array<{ serverId: string; error: string }>;
}> {
  const result = {
    success: 0,
    failed: 0,
    errors: [] as Array<{ serverId: string; error: string }>,
  };

  if (!config.enabled) {
    logger.debug('[MCP] MCP is disabled');
    return result;
  }

  if (!config.servers || config.servers.length === 0) {
    logger.debug('[MCP] No MCP servers configured');
    return result;
  }

  const manager = getMCPManager();

  logger.debug(`[MCP] Initializing ${config.servers.length} MCP server(s)...`);

  for (const serverConfig of config.servers) {
    if (serverConfig.enabled === false) {
      logger.debug(`[MCP] Skipping disabled server: ${serverConfig.name}`);
      continue;
    }

    try {
      await manager.connect(serverConfig as MCPServerConfig);
      result.success++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed++;
      result.errors.push({
        serverId: serverConfig.id,
        error: message,
      });
      logger.error(`[MCP] Failed to connect to ${serverConfig.name} (${serverConfig.id}):`, message);
    }
  }

  logger.info(`[MCP] Initialized: ${result.success} connected, ${result.failed} failed`);

  return result;
}

/**
 * 关闭所有 MCP 连接
 */
export async function shutdownMCP(): Promise<void> {
  const manager = getMCPManager();
  await manager.disconnectAll();
  logger.debug('[MCP] All MCP connections closed');
}

/**
 * 获取 MCP 状态摘要
 */
export function getMCPStatusSummary(): string {
  const manager = getMCPManager();
  const statuses = manager.getStatus();

  if (statuses.length === 0) {
    return 'No MCP servers configured';
  }

  const lines = statuses.map((s) => {
    const status = s.connected ? '✅' : '❌';
    const tools = s.connected ? `${s.tools} tools` : '';
    return `${status} ${s.name}: ${tools || s.lastError || 'disconnected'}`;
  });

  return lines.join('\n');
}
