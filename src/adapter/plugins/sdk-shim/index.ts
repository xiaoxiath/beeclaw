/**
 * Plugin SDK Shim
 *
 * 这个模块重新导出所有兼容类型， * 使得 OpenClaw 插件能够正常运行
 */

import type {
  PluginLogger,
} from "../types";

export type {
  OpenClawPluginApi,
  PluginHookName,
  PluginHookHandlerMap,
  PluginLogger,
} from "../types";

export interface PluginRuntime {
  config: {
    loadConfig(): Record<string, any>;
    writeConfigFile(patch: Record<string, any>): void;
  };
  system: {
    enqueueSystemEvent(event: any): void;
    requestHeartbeatNow(): void;
    runCommandWithTimeout(cmd: string, timeout: number): Promise<string>;
  };
  media: {
    loadWebMedia(url: string): Promise<Buffer>;
    detectMime(buffer: Buffer): string;
  };
  tools: {
    createMemoryGetTool(): any;
    createMemorySearchTool(): any;
  };
  events: any;
  logging: PluginLogger;
  state: {
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T): void;
    delete(key: string): boolean;
    clear(): void;
  };
  channel: any;  // Channel Runtime (Proxy stub)
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
  execute: (params: any, context?: any) => Promise<any>;
}

export interface HookDefinition {
  name: string;
  description?: string;
  handler: (event: any) => Promise<any> | any;
}

export interface CommandDefinition {
  name: string;
  description: string;
  handler: (ctx: any) => Promise<any>;
}

export interface HttpRouteDefinition {
  method: string;
  path: string;
  handler: (req: any, res: any) => Promise<void> | void;
}

export interface ProviderPlugin {
  id: string;
  name: string;
  description?: string;
  configSchema?: any;
}

export interface CliRegistrar {
  (program: any): void;
}

export interface OpenClawPluginService {
  id: string;
  start: (ctx: any) => Promise<void> | void;
  stop?: (ctx: any) => Promise<void> | void;
}

export interface GatewayMethodDefinition {
  name: string;
  handler: (params: any) => Promise<any>;
}

export interface ToolOptions {
  name?: string;
  names?: string[];
  optional?: boolean;
}

export interface HookOptions {
  entry?: string;
  name?: string;
  description?: string;
  register?: boolean;
}
