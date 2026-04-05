/**
 * bee — MCP client types.
 *
 * Defines the MCP client manager interface for external tool integration.
 * Implementations are provided by consumers.
 */

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  /** For stdio transport */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** For http/sse transport */
  url?: string;
  headers?: Record<string, string>;
  /** Common */
  enabled?: boolean;
  timeout?: number;
  /** Tool filtering */
  tools?: {
    include?: string[];
    exclude?: string[];
  };
}

export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface MCPServerStatus {
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
  lastError?: string;
}

/**
 * MCP client manager interface.
 *
 * Bee defines the interface; consumers provide the implementation
 * (e.g., beeclaw's MCPClientManager based on @modelcontextprotocol/sdk).
 */
export interface IMCPManager {
  connect?(config: MCPServerConfig): Promise<void>;
  disconnect?(id: string): Promise<void>;
  disconnectAll?(): Promise<void>;
  getStatus(): MCPServerStatus[];
  getAllToolsAsOpenAI(): unknown[];
  executeTool(serverId: string, toolName: string, params: Record<string, unknown>): Promise<MCPToolResult>;
}

/**
 * Utility: check if a tool name follows the MCP naming convention (mcp_<serverId>_<toolName>).
 */
export function isMCPToolName(name: string): boolean {
  return name.startsWith('mcp_') && name.split('_').length >= 3;
}

/**
 * Utility: parse an MCP tool name into server ID and tool name.
 */
export function parseMCPToolName(name: string): { serverId: string; toolName: string } | null {
  if (!name.startsWith('mcp_')) return null;
  const parts = name.slice(4).split('_');
  if (parts.length < 2) return null;
  return {
    serverId: parts[0],
    toolName: parts.slice(1).join('_'),
  };
}
