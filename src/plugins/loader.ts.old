import type { ChannelPlugin, ChannelConfig, ToolPlugin, ToolConfig, ChannelMessage, OutgoingMessage, ToolResult, ToolContext } from './types';

// Dynamic plugin loader

export async function loadChannelPlugin(id: string, config: ChannelConfig): Promise<ChannelPlugin> {
  // Built-in channel implementations
  switch (config.type) {
    case 'webhook':
      return new WebhookChannelPlugin(id, config);

    case 'whatsapp':
    case 'telegram':
    case 'slack':
    case 'discord':
      // Try to load external plugin
      if (config.path) {
        return loadExternalChannelPlugin(id, config);
      }
      throw new Error(`Channel type ${config.type} requires a plugin path`);

    case 'custom':
      if (config.path) {
        return loadExternalChannelPlugin(id, config);
      }
      throw new Error('Custom channel requires a plugin path');

    default:
      throw new Error(`Unknown channel type: ${config.type}`);
  }
}

export async function loadToolPlugin(id: string, config: ToolConfig): Promise<ToolPlugin> {
  // Built-in tool implementations
  switch (config.type) {
    case 'http':
      return new HttpToolPlugin(id, config);

    case 'function':
    case 'mcp':
      // Try to load external plugin
      if (config.path) {
        return loadExternalToolPlugin(id, config);
      }
      throw new Error(`Tool type ${config.type} requires a plugin path`);

    default:
      throw new Error(`Unknown tool type: ${config.type}`);
  }
}

// External plugin loader
async function loadExternalChannelPlugin(id: string, config: ChannelConfig): Promise<ChannelPlugin> {
  if (!config.path) {
    throw new Error('Plugin path is required');
  }

  try {
    const module = await import(config.path);
    const factory = module.default || module.createChannelPlugin;

    if (typeof factory !== 'function') {
      throw new Error('Plugin module must export a default factory function');
    }

    return factory(id, config);
  } catch (error) {
    throw new Error(`Failed to load channel plugin from ${config.path}: ${error}`);
  }
}

async function loadExternalToolPlugin(id: string, config: ToolConfig): Promise<ToolPlugin> {
  if (!config.path) {
    throw new Error('Plugin path is required');
  }

  try {
    const module = await import(config.path);
    const factory = module.default || module.createToolPlugin;

    if (typeof factory !== 'function') {
      throw new Error('Plugin module must export a default factory function');
    }

    return factory(id, config);
  } catch (error) {
    throw new Error(`Failed to load tool plugin from ${config.path}: ${error}`);
  }
}

// Built-in Webhook Channel Plugin
class WebhookChannelPlugin implements ChannelPlugin {
  id: string;
  type = 'webhook' as const;
  config: ChannelConfig;
  private handler?: (message: ChannelMessage) => Promise<void>;

  constructor(id: string, config: ChannelConfig) {
    this.id = id;
    this.config = config;
  }

  async init(): Promise<void> {
    // Webhook doesn't need initialization
  }

  async start(handler: (message: ChannelMessage) => Promise<void>): Promise<void> {
    this.handler = handler;
  }

  async stop(): Promise<void> {
    this.handler = undefined;
  }

  async send(_message: OutgoingMessage): Promise<void> {
    // Webhook is receive-only
    throw new Error('Webhook channel does not support sending messages');
  }

  async health(): Promise<{ healthy: boolean; message?: string }> {
    return { healthy: true, message: 'Webhook channel is ready' };
  }

  // Method to be called when webhook receives a message
  async receiveMessage(payload: { userId: string; content: string; metadata?: Record<string, unknown> }): Promise<void> {
    if (!this.handler) {
      throw new Error('Channel not started');
    }

    const message: ChannelMessage = {
      id: `wh-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      channelId: this.id,
      userId: payload.userId,
      content: payload.content,
      timestamp: new Date().toISOString(),
      metadata: payload.metadata,
    };

    await this.handler(message);
  }
}

// Built-in HTTP Tool Plugin
class HttpToolPlugin implements ToolPlugin {
  id: string;
  type = 'http' as const;
  config: ToolConfig;

  constructor(id: string, config: ToolConfig) {
    this.id = id;
    this.config = config;
  }

  getSchema() {
    return {
      name: this.id,
      description: (this.config.config?.description as string) || `HTTP tool: ${this.id}`,
      parameters: (this.config.config?.parameters as Record<string, unknown>) || {
        type: 'object',
        properties: {},
      },
    };
  }

  async execute(params: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const url = this.config.config?.url as string;
    const method = (this.config.config?.method as string) || 'POST';
    const headers = (this.config.config?.headers as Record<string, string>) || {};

    if (!url) {
      return { success: false, error: 'Tool URL not configured' };
    }

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: method !== 'GET' ? JSON.stringify(params) : undefined,
      });

      const data = await response.json();

      return {
        success: response.ok,
        data,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  validate(_params: Record<string, unknown>): boolean {
    // Basic validation - could be enhanced with JSON schema validation
    return true;
  }
}

// Export built-in plugins
export { WebhookChannelPlugin, HttpToolPlugin };
