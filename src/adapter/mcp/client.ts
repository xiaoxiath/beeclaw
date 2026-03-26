/**
 * MCP Client Manager
 *
 * 参考 OpenClaw 的 MCP 集成设计
 * 支持连接外部 MCP 服务器，并将其工具转换为 Agent 可用的工具
 */

import { logger } from '../../infra/observability/logger';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';
import type { OpenAITool } from '../../domain/agent/types';

// ============================================================================
// 类型定义
// ============================================================================

export type MCPTransportType = 'stdio' | 'http' | 'sse';

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransportType;

  // stdio 配置
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;

  // http 配置
  url?: string;
  headers?: Record<string, string>;

  // 通用配置
  enabled?: boolean;
  timeout?: number;

  // 工具过滤
  tools?: {
    include?: string[];
    exclude?: string[];
  };
}

export interface MCPConnection {
  id: string;
  name: string;
  client: Client;
  config: MCPServerConfig;
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
  connected: boolean;
  lastError?: string;
}

export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  isError?: boolean;
}

export interface MCPServerStatus {
  id: string;
  name: string;
  connected: boolean;
  tools: number;
  resources: number;
  prompts: number;
  lastError?: string;
}

// ============================================================================
// MCP Client Manager
// ============================================================================

export class MCPClientManager {
  private connections: Map<string, MCPConnection> = new Map();
  private defaultTimeout: number = 30000;

  // B-P2-07: Reconnection state
  private reconnectAttempts = new Map<string, number>();
  private static MAX_RECONNECT = 5;
  private static BASE_DELAY = 1000;

  /**
   * B-P2-07: Attempt to reconnect to a disconnected MCP server
   * with exponential backoff.
   */
  private async reconnect(serverId: string): Promise<boolean> {
    const attempts = this.reconnectAttempts.get(serverId) ?? 0;
    if (attempts >= MCPClientManager.MAX_RECONNECT) {
      logger.error(`[MCP] Max reconnect attempts (${MCPClientManager.MAX_RECONNECT}) reached for ${serverId}`);
      return false;
    }
    this.reconnectAttempts.set(serverId, attempts + 1);
    const delay = Math.min(MCPClientManager.BASE_DELAY * Math.pow(2, attempts), 30000);
    logger.info(`[MCP] Reconnecting to ${serverId} (attempt ${attempts + 1}/${MCPClientManager.MAX_RECONNECT}, delay ${delay}ms)`);
    await new Promise(r => setTimeout(r, delay));
    try {
      const connection = this.connections.get(serverId);
      if (!connection) return false;
      await this.connect(connection.config);
      this.reconnectAttempts.delete(serverId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 连接到 MCP 服务器
   */
  async connect(config: MCPServerConfig): Promise<MCPConnection> {
    // 检查是否已连接
    const existing = this.connections.get(config.id);
    if (existing?.connected) {
      return existing;
    }

    // 创建客户端
    const client = new Client(
      {
        name: 'beeclaw',
        version: '0.2.0',
      },
      {
        capabilities: {},
      },
    );

    // 创建传输层
    let transport: any;
    try {
      transport = await this.createTransport(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[MCP] Failed to create transport for ${config.name}:`, message);
      throw new Error(`Failed to create transport: ${message}`);
    }

    // 连接
    try {
      await client.connect(transport);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[MCP] Failed to connect to ${config.name}:`, message);
      throw new Error(`Failed to connect: ${message}`);
    }

    // 获取能力
    let tools: Tool[] = [];
    let resources: Resource[] = [];
    let prompts: Prompt[] = [];

    try {
      const toolsResult = await client.listTools();
      tools = toolsResult.tools || [];
    } catch (error) {
      logger.warn(`[MCP] Failed to list tools from ${config.name}:`, error);
    }

    try {
      const resourcesResult = await client.listResources();
      resources = resourcesResult.resources || [];
    } catch (error) {
      logger.warn(`[MCP] Failed to list resources from ${config.name}:`, error);
    }

    try {
      const promptsResult = await client.listPrompts();
      prompts = promptsResult.prompts || [];
    } catch (error) {
      logger.warn(`[MCP] Failed to list prompts from ${config.name}:`, error);
    }

    const connection: MCPConnection = {
      id: config.id,
      name: config.name,
      client,
      config,
      tools,
      resources,
      prompts,
      connected: true,
    };

    this.connections.set(config.id, connection);

    logger.debug(
      `[MCP] Connected to ${config.name} (${config.id}): ` +
        `${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts`,
    );

    return connection;
  }

  /**
   * 创建传输层
   */
  private async createTransport(config: MCPServerConfig): Promise<any> {
    switch (config.transport) {
      case 'stdio': {
        if (!config.command) {
          throw new Error('stdio transport requires command');
        }
        return new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: {
            ...process.env,
            ...config.env,
          } as Record<string, string>,
        });
      }

      case 'http':
      case 'sse': {
        // HTTP 传输需要 @modelcontextprotocol/sdk 的 HTTP 客户端
        if (!config.url) {
          throw new Error('http transport requires url');
        }
        try {
          const { StreamableHTTPClientTransport } = await import(
            '@modelcontextprotocol/sdk/client/streamableHttp.js'
          );
          return new StreamableHTTPClientTransport(
            new URL(config.url),
            config.headers,
          );
        } catch {
          // 回退到 SSE 传输
          const { SSEClientTransport } = await import(
            '@modelcontextprotocol/sdk/client/sse.js'
          );
          return new SSEClientTransport(
            new URL(config.url),
            config.headers,
          );
        }
      }

      default:
        throw new Error(`Unknown transport type: ${config.transport}`);
    }
  }

  /**
   * 断开连接
   */
  async disconnect(id: string): Promise<void> {
    const connection = this.connections.get(id);
    if (!connection) {
      return;
    }

    try {
      await connection.client.close();
    } catch (error) {
      logger.warn(`[MCP] Error closing connection ${id}:`, error);
    }

    this.connections.delete(id);
    logger.info(`[MCP] Disconnected from ${connection.name} (${id})`);
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys());
    await Promise.all(ids.map((id) => this.disconnect(id)));
  }

  /**
   * 获取连接
   */
  getConnection(id: string): MCPConnection | undefined {
    return this.connections.get(id);
  }

  /**
   * 获取所有连接状态
   */
  getStatus(): MCPServerStatus[] {
    return Array.from(this.connections.values()).map((c) => ({
      id: c.id,
      name: c.name,
      connected: c.connected,
      tools: c.tools.length,
      resources: c.resources.length,
      prompts: c.prompts.length,
      lastError: c.lastError,
    }));
  }

  /**
   * 获取所有工具（转换为 OpenAI 格式）
   */
  getAllToolsAsOpenAI(): OpenAITool[] {
    const tools: OpenAITool[] = [];

    for (const connection of this.connections.values()) {
      if (connection.config.enabled === false) {
        continue;
      }

      for (const tool of connection.tools) {
        // 应用工具过滤
        if (connection.config.tools?.exclude?.includes(tool.name)) {
          continue;
        }
        if (
          connection.config.tools?.include &&
          !connection.config.tools.include.includes(tool.name)
        ) {
          continue;
        }

        tools.push(this.convertToOpenAITool(connection.id, tool));
      }
    }

    return tools;
  }

  /**
   * 转换 MCP 工具为 OpenAI 格式
   */
  private convertToOpenAITool(serverId: string, tool: Tool): OpenAITool {
    // 工具名称格式：mcp_{serverId}__{toolName} (double underscore separator)
    const openaiName = `mcp_${serverId}__${tool.name}`;

    const inputSchema = tool.inputSchema as {
      type: 'object';
      properties?: Record<string, unknown>;
      required?: string[];
    };

    return {
      type: 'function',
      function: {
        name: openaiName,
        description: tool.description || `MCP tool: ${tool.name}`,
        parameters: {
          type: 'object',
          properties: inputSchema?.properties || {},
          required: inputSchema?.required || [],
        },
      },
    };
  }

  /**
   * 执行 MCP 工具
   */
  async executeTool(
    serverId: string,
    toolName: string,
    params: Record<string, unknown>,
    timeout?: number,
  ): Promise<MCPToolResult> {
    const connection = this.connections.get(serverId);

    if (!connection) {
      return {
        success: false,
        error: `MCP server ${serverId} not found`,
      };
    }

    if (!connection.connected) {
      return {
        success: false,
        error: `MCP server ${serverId} not connected`,
      };
    }

    try {
      const result = await connection.client.callTool(
        {
          name: toolName,
          arguments: params,
        },
        undefined,
        {
          timeout: timeout || connection.config.timeout || this.defaultTimeout,
        },
      );

      // 提取文本内容
      const content = result.content as Array<{ type: string; text?: string }>;
      const textContent = content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n');

      const isError = result.isError === true;

      return {
        success: !isError,
        data: textContent || result.content,
        error: isError ? textContent : undefined,
        isError,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      connection.lastError = message;

      // B-P2-07: If the error looks like a connection issue, try reconnecting
      const isConnectionError = /ECONNREFUSED|EPIPE|ENOTCONN|connection|closed|disconnect/i.test(message);
      if (isConnectionError) {
        connection.connected = false;
        const reconnected = await this.reconnect(serverId);
        if (reconnected) {
          // Retry the tool call once after successful reconnection
          try {
            const retryResult = await connection.client.callTool(
              { name: toolName, arguments: params },
              undefined,
              { timeout: timeout || connection.config.timeout || this.defaultTimeout },
            );
            const retryContent = retryResult.content as Array<{ type: string; text?: string }>;
            const retryText = retryContent
              .filter((c) => c.type === 'text' && c.text)
              .map((c) => c.text)
              .join('\n');
            return {
              success: !retryResult.isError,
              data: retryText || retryResult.content,
              error: retryResult.isError ? retryText : undefined,
              isError: retryResult.isError === true,
            };
          } catch (retryError) {
            const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
            return { success: false, error: `Retry after reconnect failed: ${retryMsg}` };
          }
        }
      }

      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * 读取资源
   */
  async readResource(serverId: string, uri: string): Promise<string> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.connected) {
      throw new Error(`MCP server ${serverId} not connected`);
    }

    const result = await connection.client.readResource({ uri });
    const contents = result.contents as Array<{ text?: string }>;

    return contents
      .filter((c) => c.text)
      .map((c) => c.text)
      .join('\n');
  }

  /**
   * 获取提示模板
   */
  async getPrompt(
    serverId: string,
    name: string,
    args?: Record<string, string>,
  ): Promise<string> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.connected) {
      throw new Error(`MCP server ${serverId} not connected`);
    }

    const result = await connection.client.getPrompt({
      name,
      arguments: args,
    });

    return result.messages
      .map((m) => {
        const content = m.content as { type: string; text?: string };
        if (content.type === 'text' && content.text) {
          return `${m.role}: ${content.text}`;
        }
        return null;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * 刷新连接的工具列表
   */
  async refreshTools(serverId: string): Promise<Tool[]> {
    const connection = this.connections.get(serverId);
    if (!connection || !connection.connected) {
      throw new Error(`MCP server ${serverId} not connected`);
    }

    const result = await connection.client.listTools();
    connection.tools = result.tools || [];
    return connection.tools;
  }

  /**
   * 检查是否是 MCP 工具名称
   */
  static isMCPToolName(name: string): boolean {
    return name.startsWith('mcp_');
  }

  /**
   * 解析 MCP 工具名称
   * @returns { serverId, toolName } 或 null
   */
  static parseMCPToolName(name: string): { serverId: string; toolName: string } | null {
    if (!name.startsWith('mcp_')) {
      return null;
    }
    const withoutPrefix = name.slice(4);
    const separatorIndex = withoutPrefix.indexOf('__');
    if (separatorIndex === -1) {
      return null;
    }
    return {
      serverId: withoutPrefix.substring(0, separatorIndex),
      toolName: withoutPrefix.substring(separatorIndex + 2),
    };
  }

  /**
   * [V2 FIX] Ping a specific MCP server to check if it's responsive.
   * Attempts to call listTools() which is a lightweight operation.
   *
   * @param serverId - The MCP server ID to ping
   * @param timeoutMs - Maximum time to wait for response (default: 5000ms)
   * @returns Ping result with latency and tool count
   */
  async pingServer(
    serverId: string,
    timeoutMs: number = 5000,
  ): Promise<{ ok: boolean; latencyMs: number; toolCount: number; error?: string }> {
    const entry = this.connections.get(serverId);
    if (!entry) {
      return { ok: false, latencyMs: 0, toolCount: 0, error: `Server "${serverId}" not found` };
    }
    if (!entry.connected) {
      return { ok: false, latencyMs: 0, toolCount: 0, error: `Server "${serverId}" is not connected` };
    }

    const startTime = Date.now();

    try {
      // Use a timeout wrapper
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Ping timeout after ${timeoutMs}ms`)), timeoutMs)
      );

      const pingPromise = entry.client.listTools();
      const result = await Promise.race([pingPromise, timeoutPromise]);

      const latencyMs = Date.now() - startTime;
      const toolCount = (result as any)?.tools?.length ?? entry.tools.length;

      return { ok: true, latencyMs, toolCount };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);
      return { ok: false, latencyMs, toolCount: 0, error: msg };
    }
  }

  /**
   * [V2 FIX] Ping all connected MCP servers.
   */
  async pingAllServers(
    timeoutMs: number = 5000,
  ): Promise<Record<string, { ok: boolean; latencyMs: number; toolCount: number; error?: string }>> {
    const results: Record<string, { ok: boolean; latencyMs: number; toolCount: number; error?: string }> = {};
    const ids = Array.from(this.connections.keys());

    const pingResults = await Promise.allSettled(
      ids.map(id => this.pingServer(id, timeoutMs))
    );

    for (let i = 0; i < ids.length; i++) {
      const result = pingResults[i];
      if (result.status === 'fulfilled') {
        results[ids[i]] = result.value;
      } else {
        results[ids[i]] = {
          ok: false,
          latencyMs: 0,
          toolCount: 0,
          error: result.reason?.message || 'Unknown error',
        };
      }
    }

    return results;
  }

  /**
   * [V2 FIX] Get comprehensive health status for all servers.
   * Combines connection status, circuit breaker state, and ping results.
   */
  async getHealthStatus(
    pingTimeoutMs: number = 5000,
  ): Promise<Record<string, {
    connected: boolean;
    toolCount: number;
    circuitState: string;
    pingOk: boolean;
    pingLatencyMs: number;
    error?: string;
  }>> {
    const status = this.getStatus(); // existing method
    const pingResults = await this.pingAllServers(pingTimeoutMs);

    const combined: Record<string, any> = {};
    for (const s of status) {
      combined[s.id] = {
        connected: s.connected,
        toolCount: s.tools,
        circuitState: 'UNKNOWN', // Will be populated by health checker
        pingOk: pingResults[s.id]?.ok ?? false,
        pingLatencyMs: pingResults[s.id]?.latencyMs ?? 0,
        error: pingResults[s.id]?.error,
      };
    }

    return combined;
  }
}

// ============================================================================
// 单例
// ============================================================================

let mcpManager: MCPClientManager | null = null;

export function getMCPManager(): MCPClientManager {
  if (!mcpManager) {
    mcpManager = new MCPClientManager();
  }
  return mcpManager;
}

export function resetMCPManager(): void {
  if (mcpManager) {
    mcpManager.disconnectAll().catch(() => {});
  }
  mcpManager = null;
}
