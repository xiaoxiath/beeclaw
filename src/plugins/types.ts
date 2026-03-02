// Plugin type definitions

export enum PluginType {
  Channel = 'channel',
  Tool = 'tool',
}

// Base plugin configuration
export interface PluginConfig {
  enabled: boolean;
  path?: string;
  config?: Record<string, unknown>;
}

// Channel types
export type ChannelType = 'whatsapp' | 'telegram' | 'slack' | 'discord' | 'webhook' | 'custom';

// Channel configuration
export interface ChannelConfig extends PluginConfig {
  type: ChannelType;
}

// Tool types
export type ToolType = 'http' | 'function' | 'mcp';

// Tool configuration
export interface ToolConfig extends PluginConfig {
  type: ToolType;
}

// Message from channel
export interface ChannelMessage {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// Message to send to channel
export interface OutgoingMessage {
  content: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

// Channel plugin interface
export interface ChannelPlugin {
  id: string;
  type: ChannelType;
  config: ChannelConfig;

  // Initialize the channel
  init(): Promise<void>;

  // Start listening for messages
  start(handler: (message: ChannelMessage) => Promise<void>): Promise<void>;

  // Stop the channel
  stop(): Promise<void>;

  // Send a message
  send(message: OutgoingMessage): Promise<void>;

  // Health check
  health(): Promise<{ healthy: boolean; message?: string }>;
}

// Tool execution context
export interface ToolContext {
  sessionId?: string;
  agentId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

// Tool result
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Tool plugin interface
export interface ToolPlugin {
  id: string;
  type: ToolType;
  config: ToolConfig;

  // Get tool schema (for AI function calling)
  getSchema(): {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };

  // Execute the tool
  execute(params: Record<string, unknown>, context?: ToolContext): Promise<ToolResult>;

  // Validate parameters
  validate(params: Record<string, unknown>): boolean;
}

// Plugin factory types
export type ChannelPluginFactory = (id: string, config: ChannelConfig) => ChannelPlugin;
export type ToolPluginFactory = (id: string, config: ToolConfig) => ToolPlugin;
