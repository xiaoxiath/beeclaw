/**
 * Plugin Registry - 插件注册表
 *
 * 职责：
 * - 存储所有已注册的插件贡献（工具、钩子、渠道等）
 * - 为每个插件创建隔离的 API 实例
 * - 提供全局单例访问（避免跨模块冲突）
 */

import { resolve, relative, isAbsolute } from "path";
import type { PluginHookName, PluginHookHandlerMap } from "../types";

// ============================================================================
// Typed global singleton — safer than Symbol.for + (globalThis as any)
// ============================================================================

declare global {
  // eslint-disable-next-line no-var
  var __beeclaw_pluginRegistry: RegistryFactory | undefined;
}

const REGISTRY_KEY = '__beeclaw_pluginRegistry';

export interface PluginHookRegistration<K extends PluginHookName = PluginHookName> {
  pluginId: string;
  hookName: K;
  handler: PluginHookHandlerMap[K];
  priority: number;
}

export interface PluginRegistry {
  // 插件定义
  plugins: Map<string, any>;

  // 插件根目录（用于路径解析）
  pluginRootDirs: Map<string, string>;

  // 扩展注册表
  tools: Map<string, any>;
  hooks: Map<string, any>;
  typedHooks: Map<PluginHookName, PluginHookRegistration[]>;
  channels: Map<string, any>;
  providers: Map<string, any>;
  gatewayHandlers: Map<string, any>;
  httpRoutes: Map<string, any>;
  cliRegistrars: any[];
  services: Map<string, any>;
  commands: Map<string, any>;

  // 诊断信息
  diagnostics: Array<{
    pluginId?: string;
    level: "warn" | "error";
    message: string;
  }>;
}

export interface RegistryFactory {
  registry: PluginRegistry;
  createApi: (pluginId: string) => any;  // OpenClawPluginApi
}

/**
 * 获取或创建全局 Plugin Registry
 */
export function getOrCreatePluginRegistry(): RegistryFactory {
  // 检查全局单例是否已存在
  if (globalThis[REGISTRY_KEY]) {
    return globalThis[REGISTRY_KEY];
  }

  // 创建新的 Registry
  const registry: PluginRegistry = {
    plugins: new Map(),
    pluginRootDirs: new Map(),  // 存储插件根目录
    tools: new Map(),
    hooks: new Map(),
    typedHooks: new Map(),
    channels: new Map(),
    providers: new Map(),
    gatewayHandlers: new Map(),
    httpRoutes: new Map(),
    cliRegistrars: [],
    services: new Map(),
    commands: new Map(),
    diagnostics: [],
  };

  // 创建 API Factory
  const createApi = (pluginId: string) => createPluginApi(pluginId, registry);

  const factory: RegistryFactory = { registry, createApi };

  // 存储到全局
  globalThis[REGISTRY_KEY] = factory;

  return factory;
}

/**
 * 获取当前 Registry（必须已初始化）
 */
export function getPluginRegistry(): PluginRegistry {
  const factory = globalThis[REGISTRY_KEY];
  if (!factory) {
    throw new Error("Plugin registry not initialized. Call getOrCreatePluginRegistry() first.");
  }
  return factory.registry;
}

/**
 * 重置 Registry（仅用于测试）
 */
export function resetPluginRegistry(): void {
  globalThis[REGISTRY_KEY] = undefined;
}

/**
 * 为每个插件创建隔离的 API 实例
 */
function createPluginApi(
  pluginId: string,
  registry: PluginRegistry
): any {
  return {
    // 基础信息
    id: pluginId,
    name: pluginId,
    source: pluginId,
    config: {} as any,  // TODO: 从 Beeclaw 配置传入
    pluginConfig: {},
    runtime: {} as any,  // TODO: 从外部传入
    logger: createPluginLogger(pluginId),

    // ═══════════════════════════════════════════
    //  10 种扩展注册方法
    // ═══════════════════════════════════════════

    registerTool(tool: any) {
      if (registry.tools.has(tool.name)) {
        console.warn(
          `[Registry] Tool "${tool.name}" already registered, overwriting (plugin: ${pluginId})`
        );
      }
      registry.tools.set(tool.name, { ...tool, pluginId });
    },

    registerHook(hook: any) {
      const key = `${pluginId}:${hook.name}`;
      registry.hooks.set(key, { ...hook, pluginId });
    },

    registerChannel(channel: any) {
      if (registry.channels.has(channel.id)) {
        console.warn(
          `[Registry] Channel "${channel.id}" already registered, overwriting (plugin: ${pluginId})`
        );
      }
      registry.channels.set(channel.id, channel);
    },

    registerCommand(command: any) {
      if (registry.commands.has(command.name)) {
        console.warn(
          `[Registry] Command "${command.name}" already registered, overwriting (plugin: ${pluginId})`
        );
      }
      registry.commands.set(command.name, { ...command, pluginId });
    },

    registerHttpRoute(route: any) {
      const key = `${route.method.toUpperCase()}:${route.path}`;
      if (registry.httpRoutes.has(key)) {
        console.warn(`[Registry] HTTP route "${key}" replaced by plugin: ${pluginId}`);
      }
      registry.httpRoutes.set(key, { ...route, pluginId });
    },

    registerProvider(provider: any) {
      if (registry.providers.has(provider.id)) {
        console.warn(
          `[Registry] Provider "${provider.id}" already registered, overwriting (plugin: ${pluginId})`
        );
      }
      registry.providers.set(provider.id, provider);
    },

    registerCli(registrar: any) {
      registry.cliRegistrars.push(registrar);
    },

    registerService(service: any) {
      if (registry.services.has(service.id)) {
        console.warn(
          `[Registry] Service "${service.id}" already registered, overwriting (plugin: ${pluginId})`
        );
      }
      registry.services.set(service.id, service);
    },

    registerGatewayMethod(method: any) {
      registry.gatewayHandlers.set(method.name, { ...method, pluginId });
    },

    // ═══════════════════════════════════════════
    //  类型安全的生命周期钩子注册
    // ═══════════════════════════════════════════

    on<K extends PluginHookName>(
      hookName: K,
      handler: PluginHookHandlerMap[K],
      options?: { priority?: number }
    ): void {
      if (!registry.typedHooks.has(hookName)) {
        registry.typedHooks.set(hookName, []);
      }
      const list = registry.typedHooks.get(hookName)!;
      list.push({
        pluginId,
        hookName,
        handler,
        priority: options?.priority ?? 0,
      });
      // 按优先级降序排列（高优先级先执行）
      list.sort((a, b) => b.priority - a.priority);
    },

    resolvePath(inputPath: string): string {
      // 获取插件根目录
      const rootDir = registry.pluginRootDirs.get(pluginId);

      if (!rootDir) {
        // 如果没有注册根目录，返回原始路径
        return inputPath;
      }

      // 如果已经是绝对路径，直接返回
      if (isAbsolute(inputPath)) {
        return inputPath;
      }

      // 解析相对路径
      const resolvedPath = resolve(rootDir, inputPath);

      // 安全检查：确保解析后的路径仍在插件目录内（防止路径遍历攻击）
      const relativePath = relative(rootDir, resolvedPath);
      if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        console.warn(
          `[Registry] Plugin "${pluginId}" attempted to access path outside its directory: ${inputPath}`
        );
        return inputPath; // 返回原始路径，拒绝访问
      }

      return resolvedPath;
    },
  };
}

function createPluginLogger(pluginId: string) {
  return {
    info: (...args: any[]) => console.log(`[${pluginId}]`, ...args),
    warn: (...args: any[]) => console.warn(`[${pluginId}]`, ...args),
    error: (...args: any[]) => console.error(`[${pluginId}]`, ...args),
    debug: (...args: any[]) => console.debug(`[${pluginId}]`, ...args),
  };
}
