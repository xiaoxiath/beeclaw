/**
 * Plugin System - 主入口
 *
 * 这个模块导出插件系统的核心功能
 */

// Discovery Engine
export { discoverPlugins, validatePluginSecurity } from "./discovery";
export type { DiscoveredPlugin, DiscoveryOptions, PluginOrigin } from "./discovery";

// Manifest Parser
export {
  loadPluginManifest,
  validatePluginConfig,
} from "./manifest";
export type { PluginManifest, PluginKind, ManifestLoadOutcome } from "./manifest";

// Plugin Registry
export {
  getOrCreatePluginRegistry,
  getPluginRegistry,
  resetPluginRegistry,
} from "./registry";
export type { PluginRegistry, RegistryFactory } from "./registry";

// Hook Runner
export { createHookRunner } from "./hook-runner";
export type { HookRunner, HookRunnerOptions } from "./hook-runner";

// Plugin Loader
export { loadPlugins } from "./loader";
export type { LoadPluginsOptions, LoadPluginsResult } from "./loader";

// Runtime Shim
export { createPluginRuntimeShim } from "./runtime-shim";
export type { RuntimeShimOptions } from "./runtime-shim";

// Types
export type {
  PluginHookName,
  PluginHookHandlerMap,
  OpenClawPluginApi,
  PluginLogger,
} from "./types";
