/**
 * Plugin Runtime Shim - 运行时垫片
 *
 * 职责：
 * - 提供兼容的 PluginRuntime 实现
 * - 使用 Proxy 延迟初始化
 * - 为未实现的功能提供友好警告
 */

import { EventEmitter } from "events";

export interface RuntimeShimOptions {
  configLoader?: () => Record<string, any>;
  configWriter?: (patch: Record<string, any>) => void;
  logger?: {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    debug(...args: any[]): void;
  };
  commandRunner?: (cmd: string, timeout: number) => Promise<string>;
  mediaLoader?: (url: string) => Promise<Buffer>;
}

/**
 * 创建 PluginRuntime Core
 */
export function createPluginRuntimeCore(options: RuntimeShimOptions = {}) {
  const events = new EventEmitter();
  const stateStore = new Map<string, any>();

  const logger = options.logger || {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  return {
    config: {
      loadConfig: options.configLoader || (() => ({})),
      writeConfigFile: options.configWriter || (() => {}),
    },

    system: {
      enqueueSystemEvent(event: any) {
        events.emit("system-event", event);
      },
      requestHeartbeatNow() {
        events.emit("heartbeat-request");
      },
      runCommandWithTimeout:
        options.commandRunner ??
        (async () => {
          throw new Error("[RuntimeShim] Command execution not supported");
        }),
    },

    media: {
      loadWebMedia:
        options.mediaLoader ??
        (async () => {
          throw new Error("[RuntimeShim] Media loading not supported");
        }),
      detectMime(buffer: Buffer): string {
        // 基础 magic bytes 检测
        if (buffer.length < 2) return "application/octet-stream";
        if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
        if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
        if (buffer[0] === 0x47 && buffer[1] === 0x49) return "image/gif";
        if (buffer[0] === 0x52 && buffer[1] === 0x49) return "audio/wav";
        if (buffer[0] === 0x25 && buffer[1] === 0x50) return "application/pdf";
        return "application/octet-stream";
      },
    },

    tts: createStubProxy("tts", logger),
    stt: createStubProxy("stt", logger),

    tools: {
      createMemoryGetTool() {
        return {
          name: "memory_get",
          description: "Retrieve a memory entry by key",
          parameters: {
            type: "object",
            properties: { key: { type: "string" } },
            required: ["key"],
          },
          execute: async () => ({ result: null }),
        } as any;
      },
      createMemorySearchTool() {
        return {
          name: "memory_search",
          description: "Search memory entries",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
          execute: async () => ({ results: [] }),
        } as any;
      },
    },

    events,
    logging: logger,

    state: {
      get<T>(key: string): T | undefined {
        return stateStore.get(key);
      },
      set<T>(key: string, value: T): void {
        stateStore.set(key, value);
      },
      delete(key: string): boolean {
        return stateStore.delete(key);
      },
      clear(): void {
        stateStore.clear();
      },
    },
  };
}

/**
 * Channel Runtime 全部使用 Proxy stub
 */
export function createChannelRuntimeStub(logger: any): any {
  const adapters = [
    "text", "reply", "routing", "pairing", "media",
    "activity", "session", "mentions", "reactions", "groups",
    "debounce", "commands", "discord", "slack", "telegram",
    "signal", "imessage", "whatsapp", "line",
  ];

  const stub: any = {};

  for (const adapter of adapters) {
    stub[adapter] = new Proxy(
      {},
      {
        get(_target, prop) {
          return (...args: any[]) => {
            logger.warn(
              `[RuntimeShim] channel.${adapter}.${String(prop)}() called but not implemented`
            );
            return undefined;
          };
        },
      }
    );
  }

  return stub;
}

/**
 * 为未实现的子模块创建 Proxy stub
 */
function createStubProxy(moduleName: string, logger: any): any {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        return (...args: any[]) => {
          logger.warn(
            `[RuntimeShim] ${moduleName}.${String(prop)}() called but not implemented`
          );
          return undefined;
        };
      },
    }
  );
}

/**
 * 创建完整的 Plugin Runtime Shim
 */
export function createPluginRuntimeShim(options: RuntimeShimOptions = {}) {
  const core = createPluginRuntimeCore(options);
  const channel = createChannelRuntimeStub(options.logger || console);

  return {
    ...core,
    channel,
  };
}
