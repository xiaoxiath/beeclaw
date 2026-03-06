/**
 * Unified Plugin System
 *
 * 统一的插件系统，参考 OpenClaw 的插件架构
 * 支持工具、钩子、命令、通道、服务的统一注册
 */

import { z } from 'zod';
import type { OpenAITool } from '../agent/types';
import type { HookName, HookHandler } from '../hooks/types';
import { getHookRunner } from '../hooks/runner';

// ============================================================================
// 插件类型定义
// ============================================================================

export interface PluginMeta {
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  license?: string;
}

export interface PluginConfigSchema {
  [key: string]: z.ZodTypeAny;
}

export interface PluginDefinition<TConfig = Record<string, unknown>> {
  // 元信息
  id: string;
  name: string;
  version?: string;
  description?: string;

  // 配置 schema
  configSchema?: z.ZodSchema<TConfig>;

  // 生命周期
  init?: (api: PluginApi<TConfig>) => void | Promise<void>;
  register?: (api: PluginApi<TConfig>) => void | Promise<void>;
  activate?: (api: PluginApi<TConfig>) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
  destroy?: () => void | Promise<void>;
}

export interface PluginApi<TConfig = Record<string, unknown>> {
  // 元信息
  readonly id: string;
  readonly name: string;
  readonly version?: string;

  // 配置
  readonly config: TConfig;

  // 日志
  readonly logger: PluginLogger;

  // 注册方法
  registerTool(tool: PluginToolDefinition): void;
  registerTools(tools: PluginToolDefinition[]): void;
  registerHook(event: HookName, handler: HookHandler, options?: HookRegistrationOptions): void;
  registerCommand(command: PluginCommandDefinition): void;
  registerChannel(channel: PluginChannelDefinition): void;
  registerService(service: PluginServiceDefinition): void;
  registerProvider(provider: PluginProviderDefinition): void;
  registerRoute(route: PluginRouteDefinition): void;

  // 便捷方法
  on<K extends HookName>(event: K, handler: HookHandler, options?: HookRegistrationOptions): void;

  // 工具方法
  getTool(name: string): OpenAITool | undefined;
  hasTool(name: string): boolean;

  // 存储
  getState<T = unknown>(key: string): T | undefined;
  setState<T>(key: string, value: T): void;
  deleteState(key: string): void;
}

export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

// ============================================================================
// 注册类型定义
// ============================================================================

export type PluginToolDefinition =
  | OpenAITool
  | PluginToolFactory;

export type PluginToolFactory = (ctx: PluginToolContext) => OpenAITool | OpenAITool[] | null;

export interface PluginToolContext {
  pluginId: string;
  sessionKey?: string;
  agentId?: string;
  config: Record<string, unknown>;
}

export interface HookRegistrationOptions {
  priority?: number;
  once?: boolean;
}

export interface PluginCommandDefinition {
  name: string;
  description: string;
  usage?: string;
  examples?: string[];
  handler: PluginCommandHandler;
  requiresAuth?: boolean;
  adminOnly?: boolean;
}

export type PluginCommandHandler = (
  ctx: PluginCommandContext,
) => PluginCommandResult | Promise<PluginCommandResult>;

export interface PluginCommandContext {
  pluginId: string;
  args: string[];
  rawInput: string;
  userId?: string;
  sessionId?: string;
  channel?: string;
}

export interface PluginCommandResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: unknown;
}

export interface PluginChannelDefinition {
  id: string;
  type: string;
  name: string;
  description?: string;
  handler: PluginChannelHandler;
}

export type PluginChannelHandler = (
  event: PluginChannelEvent,
) => void | Promise<void>;

export interface PluginChannelEvent {
  type: 'message' | 'reaction' | 'join' | 'leave' | 'command';
  channelId: string;
  userId?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginServiceDefinition {
  id: string;
  name: string;
  description?: string;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
  healthCheck?: () => Promise<{ healthy: boolean; message?: string }>;
}

export interface PluginProviderDefinition {
  id: string;
  type: 'ai' | 'embedding' | 'search' | 'finance' | 'storage';
  name: string;
  description?: string;
  factory: (config: Record<string, unknown>) => unknown;
}

export interface PluginRouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handler: PluginRouteHandler;
  schema?: {
    body?: z.ZodSchema;
    query?: z.ZodSchema;
    params?: z.ZodSchema;
  };
}

export type PluginRouteHandler = (
  request: PluginRouteRequest,
) => PluginRouteResponse | Promise<PluginRouteResponse>;

export interface PluginRouteRequest {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface PluginRouteResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

// ============================================================================
// 插件记录
// ============================================================================

export interface PluginRecord {
  definition: PluginDefinition;
  config: Record<string, unknown>;
  state: 'registered' | 'active' | 'inactive' | 'error';
  error?: string;
  activatedAt?: string;
  deactivatedAt?: string;
}

// ============================================================================
// 插件注册表
// ============================================================================

export class PluginRegistry {
  private plugins: Map<string, PluginRecord> = new Map();
  private tools: Map<string, PluginToolRegistration> = new Map();
  private commands: Map<string, PluginCommandRegistration> = new Map();
  private channels: Map<string, PluginChannelRegistration> = new Map();
  private services: Map<string, PluginServiceRegistration> = new Map();
  private providers: Map<string, PluginProviderRegistration> = new Map();
  private routes: PluginRouteRegistration[] = [];
  private pluginState: Map<string, Map<string, unknown>> = new Map();

  /**
   * 注册插件
   */
  async register(
    definition: PluginDefinition,
    config: Record<string, unknown> = {},
  ): Promise<void> {
    const { id } = definition;

    // 检查是否已注册
    if (this.plugins.has(id)) {
      throw new Error(`Plugin ${id} is already registered`);
    }

    // 验证配置
    if (definition.configSchema) {
      const result = definition.configSchema.safeParse(config);
      if (!result.success) {
        throw new Error(`Plugin ${id} config validation failed: ${result.error.message}`);
      }
    }

    // 创建插件记录
    const record: PluginRecord = {
      definition,
      config,
      state: 'registered',
    };

    this.plugins.set(id, record);
    this.pluginState.set(id, new Map());

    // 创建 API
    const api = this.createPluginApi(definition, config);

    // 调用 init
    if (definition.init) {
      try {
        await definition.init(api);
      } catch (error) {
        record.state = 'error';
        record.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    }

    // 调用 register
    if (definition.register) {
      try {
        await definition.register(api);
      } catch (error) {
        record.state = 'error';
        record.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    }

    console.log(`[PluginRegistry] Registered: ${definition.name} (${id})`);
  }

  /**
   * 激活插件
   */
  async activate(id: string): Promise<void> {
    const record = this.plugins.get(id);
    if (!record) {
      throw new Error(`Plugin ${id} not found`);
    }

    if (record.state === 'active') {
      return;
    }

    const api = this.createPluginApi(record.definition, record.config);

    if (record.definition.activate) {
      try {
        await record.definition.activate(api);
      } catch (error) {
        record.state = 'error';
        record.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    }

    record.state = 'active';
    record.activatedAt = new Date().toISOString();
    record.error = undefined;

    console.log(`[PluginRegistry] Activated: ${record.definition.name} (${id})`);
  }

  /**
   * 停用插件
   */
  async deactivate(id: string): Promise<void> {
    const record = this.plugins.get(id);
    if (!record) {
      throw new Error(`Plugin ${id} not found`);
    }

    if (record.definition.deactivate) {
      try {
        await record.definition.deactivate();
      } catch (error) {
        console.error(`[PluginRegistry] Deactivate error for ${id}:`, error);
      }
    }

    record.state = 'inactive';
    record.deactivatedAt = new Date().toISOString();

    console.log(`[PluginRegistry] Deactivated: ${record.definition.name} (${id})`);
  }

  /**
   * 卸载插件
   */
  async unload(id: string): Promise<void> {
    const record = this.plugins.get(id);
    if (!record) {
      return;
    }

    // 停用
    if (record.state === 'active') {
      await this.deactivate(id);
    }

    // 销毁
    if (record.definition.destroy) {
      try {
        await record.definition.destroy();
      } catch (error) {
        console.error(`[PluginRegistry] Destroy error for ${id}:`, error);
      }
    }

    // 清理注册
    this.cleanupPluginRegistrations(id);

    // 移除记录
    this.plugins.delete(id);
    this.pluginState.delete(id);

    console.log(`[PluginRegistry] Unloaded: ${record.definition.name} (${id})`);
  }

  /**
   * 获取所有工具
   */
  getTools(): OpenAITool[] {
    const tools: OpenAITool[] = [];

    for (const reg of this.tools.values()) {
      if (typeof reg.tool === 'function') {
        const result = reg.tool({
          pluginId: reg.pluginId,
          config: reg.config,
        });
        if (result) {
          tools.push(...(Array.isArray(result) ? result : [result]));
        }
      } else {
        tools.push(reg.tool);
      }
    }

    return tools;
  }

  /**
   * 获取命令
   */
  getCommand(name: string): PluginCommandRegistration | undefined {
    return this.commands.get(name);
  }

  /**
   * 获取所有命令
   */
  getCommands(): PluginCommandRegistration[] {
    return Array.from(this.commands.values());
  }

  /**
   * 获取服务
   */
  getService(id: string): PluginServiceRegistration | undefined {
    return this.services.get(id);
  }

  /**
   * 获取路由
   */
  getRoutes(): PluginRouteRegistration[] {
    return [...this.routes];
  }

  /**
   * 获取插件状态
   */
  getPluginStatus(): Array<{
    id: string;
    name: string;
    state: string;
    error?: string;
  }> {
    return Array.from(this.plugins.entries()).map(([id, record]) => ({
      id,
      name: record.definition.name,
      state: record.state,
      error: record.error,
    }));
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  private createPluginApi(
    definition: PluginDefinition,
    config: Record<string, unknown>,
  ): PluginApi {
    const self = this;
    const pluginId = definition.id;
    const logger = this.createPluginLogger(definition.name);

    return {
      id: pluginId,
      name: definition.name,
      version: definition.version,
      config,
      logger,

      registerTool(tool) {
        self.registerTool(pluginId, tool, config);
      },

      registerTools(tools) {
        for (const tool of tools) {
          self.registerTool(pluginId, tool, config);
        }
      },

      registerHook(event, handler, options) {
        self.registerHook(pluginId, event, handler, options);
      },

      registerCommand(command) {
        self.registerCommand(pluginId, command);
      },

      registerChannel(channel) {
        self.registerChannel(pluginId, channel);
      },

      registerService(service) {
        self.registerService(pluginId, service);
      },

      registerProvider(provider) {
        self.registerProvider(pluginId, provider);
      },

      registerRoute(route) {
        self.registerRoute(pluginId, route);
      },

      on(event, handler, options) {
        self.registerHook(pluginId, event, handler, options);
      },

      getTool(name) {
        return self.tools.get(name)?.tool as OpenAITool | undefined;
      },

      hasTool(name) {
        return self.tools.has(name);
      },

      getState<T = unknown>(key: string): T | undefined {
        return self.pluginState.get(pluginId)?.get(key) as T | undefined;
      },

      setState(key, value) {
        self.pluginState.get(pluginId)?.set(key, value);
      },

      deleteState(key) {
        self.pluginState.get(pluginId)?.delete(key);
      },
    };
  }

  private createPluginLogger(name: string): PluginLogger {
    const prefix = `[${name}]`;
    return {
      debug: (msg, ...args) => console.debug(prefix, msg, ...args),
      info: (msg, ...args) => console.info(prefix, msg, ...args),
      warn: (msg, ...args) => console.warn(prefix, msg, ...args),
      error: (msg, ...args) => console.error(prefix, msg, ...args),
    };
  }

  private registerTool(
    pluginId: string,
    tool: PluginToolDefinition,
    config: Record<string, unknown>,
  ): void {
    const name = typeof tool === 'function' ? `dynamic-${pluginId}` : tool.function.name;
    this.tools.set(name, { pluginId, tool, config });
  }

  private registerHook(
    pluginId: string,
    event: HookName,
    handler: HookHandler,
    options?: HookRegistrationOptions,
  ): void {
    const hookRunner = getHookRunner();
    hookRunner.register({
      id: `${pluginId}:${event}`,
      hookName: event,
      handler,
      priority: options?.priority ?? 0,
      source: 'plugin',
    });
  }

  private registerCommand(
    pluginId: string,
    command: PluginCommandDefinition,
  ): void {
    this.commands.set(command.name, { pluginId, command });
  }

  private registerChannel(
    pluginId: string,
    channel: PluginChannelDefinition,
  ): void {
    this.channels.set(channel.id, { pluginId, channel });
  }

  private registerService(
    pluginId: string,
    service: PluginServiceDefinition,
  ): void {
    this.services.set(service.id, { pluginId, service });
  }

  private registerProvider(
    pluginId: string,
    provider: PluginProviderDefinition,
  ): void {
    this.providers.set(provider.id, { pluginId, provider });
  }

  private registerRoute(
    pluginId: string,
    route: PluginRouteDefinition,
  ): void {
    this.routes.push({ pluginId, route });
  }

  private cleanupPluginRegistrations(pluginId: string): void {
    // 清理工具
    for (const [name, reg] of this.tools.entries()) {
      if (reg.pluginId === pluginId) {
        this.tools.delete(name);
      }
    }

    // 清理命令
    for (const [name, reg] of this.commands.entries()) {
      if (reg.pluginId === pluginId) {
        this.commands.delete(name);
      }
    }

    // 清理通道
    for (const [id, reg] of this.channels.entries()) {
      if (reg.pluginId === pluginId) {
        this.channels.delete(id);
      }
    }

    // 清理服务
    for (const [id, reg] of this.services.entries()) {
      if (reg.pluginId === pluginId) {
        this.services.delete(id);
      }
    }

    // 清理路由
    this.routes = this.routes.filter(r => r.pluginId !== pluginId);
  }
}

// ============================================================================
// 注册类型
// ============================================================================

interface PluginToolRegistration {
  pluginId: string;
  tool: PluginToolDefinition;
  config: Record<string, unknown>;
}

interface PluginCommandRegistration {
  pluginId: string;
  command: PluginCommandDefinition;
}

interface PluginChannelRegistration {
  pluginId: string;
  channel: PluginChannelDefinition;
}

interface PluginServiceRegistration {
  pluginId: string;
  service: PluginServiceDefinition;
}

interface PluginProviderRegistration {
  pluginId: string;
  provider: PluginProviderDefinition;
}

interface PluginRouteRegistration {
  pluginId: string;
  route: PluginRouteDefinition;
}

// ============================================================================
// 单例
// ============================================================================

let pluginRegistry: PluginRegistry | null = null;

export function getPluginRegistry(): PluginRegistry {
  if (!pluginRegistry) {
    pluginRegistry = new PluginRegistry();
  }
  return pluginRegistry;
}

export function resetPluginRegistry(): void {
  pluginRegistry = null;
}
