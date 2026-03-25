/**
 * Plugin Loader - 插件加载器
 *
 * 职责：
 * - 编排插件加载全流程
 * - 使用 Jiti 动态加载 TypeScript 模块
 * - 处理双导出模式（对象 vs 函数）
 * - 管理 memory 插件独占槽位
 */

import { logger } from '../../../infra/observability/logger';
import { join } from "path";
import { createJiti } from "jiti";
import { fileURLToPath } from "url";
import { discoverPlugins } from "../discovery";
import { loadPluginManifest, validatePluginConfig } from "../manifest";
import { getOrCreatePluginRegistry } from "../registry";
import { createPluginRuntimeShim } from "../runtime-shim";
import { createHookRunner } from "../hook-runner";

export interface LoadPluginsOptions {
  discovery?: {
    bundledDir?: string;
    globalDir?: string;
    workspaceDir?: string;
    configPaths?: string[];
  };
  runtimeOptions?: any;
  pluginConfigs?: Record<string, any>;
  disabledPlugins?: string[];
}

export interface LoadPluginsResult {
  registry: any;
  hookRunner: any;
  loaded: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * 创建配置好的 Jiti 实例
 */
function createConfiguredJiti() {
  // Ensure import.meta.url is a string
  const importMetaURL = typeof import.meta.url === 'string'
    ? import.meta.url
    : `file:/${process.cwd()}/src/plugins/loader/index.ts`;

  const modulePath = fileURLToPath(importMetaURL);
  const baseDir = join(modulePath, "..", "..", "..");

  // Create jiti with minimal options first to test
  return createJiti(importMetaURL, {
    interopDefault: true,  // ✅ 关键：正确处理 default export

    // SDK 别名映射
    alias: {
      "openclaw/plugin-sdk": join(baseDir, "adapter", "plugins", "sdk-shim", "index.ts"),
      "openclaw/plugin-sdk/types": join(baseDir, "adapter", "plugins", "types.ts"),
      "openclaw/plugin-sdk/runtime": join(baseDir, "adapter", "plugins", "runtime-shim", "index.ts"),
      "openclaw/plugin-sdk/hooks": join(baseDir, "adapter", "plugins", "hooks", "index.ts"),
    },
  });
}

/**
 * 加载所有插件（主入口）
 */
export async function loadPlugins(options: LoadPluginsOptions = {}): Promise<LoadPluginsResult> {
  const { registry, createApi } = getOrCreatePluginRegistry();
  const jiti = createConfiguredJiti();
  const runtime = createPluginRuntimeShim(options.runtimeOptions || {});

  const loaded: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  let memorySlotOccupied: string | null = null;

  // 1. ─── 发现插件 ───
  const candidates = discoverPlugins(options.discovery || {});
  logger.debug(`[Loader] Discovered ${candidates.length} plugins`);

  // 2. ─── 过滤禁用的插件 ───
  const filtered = candidates.filter(
    (c) => !options.disabledPlugins?.includes(c.id)
  );

  // 3. ─── 逐一加载 ───
  for (const candidate of filtered) {
    try {
      // 3a. 解析清单
      const manifestResult = loadPluginManifest(candidate.rootDir);
      if (!manifestResult.ok) {
        throw new Error(manifestResult.error);
      }
      const manifest = manifestResult.manifest;

      // 3b. 独占槽位检查（memory 类型）
      if (manifest.kind === "memory") {
        if (memorySlotOccupied) {
          logger.warn(
            `[Loader] Skipping memory plugin "${manifest.id}" — ` +
              `slot occupied by "${memorySlotOccupied}"`
          );
          failed.push({
            id: manifest.id,
            error: `Memory slot occupied by "${memorySlotOccupied}"`,
          });
          continue;
        }
        memorySlotOccupied = manifest.id;
      }

      // 3c. 配置校验
      const pluginConfig = options.pluginConfigs?.[manifest.id] ?? {};
      const validation = validatePluginConfig(manifest, pluginConfig);
      if (!validation.valid) {
        throw new Error(`Config validation failed: ${validation.errors}`);
      }

      // 3d. 通过 Jiti 导入 TypeScript 模块
      const entryPath = join(candidate.rootDir, "src", "index.ts");
      const mod = (await jiti.import(entryPath)) as any;
      const pluginDef = mod.default ?? mod;

      // 3e. 注册插件根目录并创建 API
      registry.pluginRootDirs.set(manifest.id, candidate.rootDir);
      const api = createApi(manifest.id);

      if (typeof pluginDef === "function") {
        // 模式 B：函数导出
        await pluginDef(api, runtime);
      } else if (pluginDef && typeof pluginDef.register === "function") {
        // 模式 A：对象导出
        registry.plugins.set(manifest.id, pluginDef);
        await pluginDef.register(api, runtime);
      } else {
        throw new Error("No valid export (expected default object with register() or function)");
      }

      // 3f. 激活（可选）
      if (typeof pluginDef.activate === "function") {
        await pluginDef.activate();
      }

      loaded.push(manifest.id);
      logger.info(`[Loader] ✅ Loaded: ${manifest.id} (${manifest.kind ?? "general"})`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[Loader] ❌ Failed: "${candidate.id}" — ${errMsg}`);
      failed.push({ id: candidate.id, error: errMsg });
      registry.diagnostics.push({
        pluginId: candidate.id,
        level: "error",
        message: errMsg,
      });
    }
  }

  // 4. ─── 创建 Hook Runner ───
  const hookRunner = createHookRunner(registry);

  logger.info(`[Loader] Done. Loaded: ${loaded.length}, Failed: ${failed.length}`);

  return { registry, hookRunner, loaded, failed };
}
