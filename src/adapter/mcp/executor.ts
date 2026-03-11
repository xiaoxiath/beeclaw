/**
 * MCP Tool Executor
 *
 * 将 MCP 工具调用集成到 Agent 的工具执行流程中
 */

import { getMCPManager, MCPClientManager } from './client';

/**
 * 判断工具名称是否属于 MCP 工具
 */
export function isMCPTool(name: string): boolean {
  return MCPClientManager.isMCPToolName(name);
}

/**
 * 从 MCP 工具名称解析服务器 ID 和工具名
 */
export function parseMCPToolName(
  name: string,
): { serverId: string; toolName: string } | null {
  return MCPClientManager.parseMCPToolName(name);
}

/**
 * 执行 MCP 工具
 */
export async function executeMCPTool(
  name: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  // 检查是否是 MCP 工具
  const parsed = MCPClientManager.parseMCPToolName(name);
  if (!parsed) {
    return {
      success: false,
      error: `Not an MCP tool: ${name}`,
    };
  }

  const { serverId, toolName } = parsed;
  const manager = getMCPManager();

  // 执行工具
  const result = await manager.executeTool(serverId, toolName, params);

  return {
    success: result.success,
    data: result.data,
    error: result.error,
  };
}
