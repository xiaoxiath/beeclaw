/**
 * Plugin Discovery Engine - 插件发现引擎
 *
 * 职责：
 * - 扫描 4 层来源目录（按优先级）
 * - 执行安全校验（路径逃逸、权限、所有权）
 * - 去重和覆盖规则处理
 */

import { readdirSync, existsSync, statSync, realpathSync, readFileSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";

export type PluginOrigin = "bundled" | "global" | "workspace" | "config";

export interface DiscoveryOptions {
  bundledDir?: string;      // 内置插件目录
  globalDir?: string;       // 全局插件目录
  workspaceDir?: string;    // 工作区目录
  configPaths?: string[];   // 配置指定的路径
}

export interface DiscoveredPlugin {
  id: string;
  rootDir: string;
  origin: PluginOrigin;
  manifestPath: string;
  priority: number;  // 越大优先级越高
}

export interface DiscoveryResult {
  plugins: DiscoveredPlugin[];
  skipped: Array<{ path: string; reason: string }>;
  errors: Array<{ path: string; error: Error }>;
}

const MANIFEST_FILENAME = "openclaw.plugin.json";

/**
 * 插件安全校验（3 项检查）
 */
export interface SecurityCheckResult {
  valid: boolean;
  reason?: string;
}

export function validatePluginSecurity(rootDir: string): SecurityCheckResult {
  try {
    // 1. 路径逃逸检测：确保真实路径在预期的父目录内
    const realPath = realpathSync(rootDir);
    const expectedParent = resolve(rootDir, "..");
    if (!realPath.startsWith(realpathSync(expectedParent))) {
      return {
        valid: false,
        reason: "Symlink escape detected",
      };
    }

    // 2. 目录可写性检测：world-writable 目录可能被恶意写入
    const stat = statSync(rootDir);
    if (stat.mode & 0o002) {
      // world-writable
      return {
        valid: false,
        reason: "World-writable directory (security risk)",
      };
    }

    // 3. 文件所有权验证：确保插件文件属于当前用户
    if (process.getuid && stat.uid !== process.getuid()) {
      return {
        valid: false,
        reason: "File ownership mismatch",
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: `Security check failed: ${error}`,
    };
  }
}

/**
 * 按优先级从低到高扫描插件目录
 */
export function discoverPlugins(options: DiscoveryOptions): DiscoveredPlugin[] {
  const seen = new Map<string, DiscoveredPlugin>();

  // 定义 4 层来源及其优先级
  const origins: Array<{
    dirs: string[];
    origin: PluginOrigin;
    priority: number;
  }> = [
    {
      dirs: options.bundledDir ? [options.bundledDir] : [],
      origin: "bundled",
      priority: 0,
    },
    {
      dirs: options.globalDir
        ? [options.globalDir]
        : [join(homedir(), ".config", "openclaw", "extensions")],
      origin: "global",
      priority: 1,
    },
    {
      dirs: options.workspaceDir
        ? [join(options.workspaceDir, ".openclaw", "extensions")]
        : [],
      origin: "workspace",
      priority: 2,
    },
    {
      dirs: options.configPaths ?? [],
      origin: "config",
      priority: 3,
    },
  ];

  // 按优先级从低到高扫描，高优先级覆盖低优先级
  for (const { dirs, origin, priority } of origins) {
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      scanDirectory(dir, origin, priority, seen);
    }
  }

  return Array.from(seen.values());
}

/**
 * 扫描单个目录
 */
function scanDirectory(
  dir: string,
  origin: PluginOrigin,
  priority: number,
  seen: Map<string, DiscoveredPlugin>
): void {
  const manifestPath = join(dir, MANIFEST_FILENAME);

  // Case 1: 当前目录就是插件根目录
  if (existsSync(manifestPath)) {
    registerCandidate(dir, manifestPath, origin, priority, seen);
    return;
  }

  // Case 2: 扫描子目录
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const childDir = join(dir, entry.name);
      const childManifest = join(childDir, MANIFEST_FILENAME);
      if (existsSync(childManifest)) {
        registerCandidate(childDir, childManifest, origin, priority, seen);
      }
    }
  } catch (error) {
    console.warn(`[Discovery] Failed to scan directory ${dir}:`, error);
  }
}

/**
 * 注册候选插件（包含安全校验）
 */
function registerCandidate(
  rootDir: string,
  manifestPath: string,
  origin: PluginOrigin,
  priority: number,
  seen: Map<string, DiscoveredPlugin>
): void {
  // 安全校验
  const securityCheck = validatePluginSecurity(rootDir);
  if (!securityCheck.valid) {
    console.warn(`[Security] Skipping ${rootDir}: ${securityCheck.reason}`);
    return;
  }

  // 解析清单获取 ID
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (!manifest.id || typeof manifest.id !== "string") {
      console.warn(`[Discovery] Missing or invalid 'id' in ${manifestPath}`);
      return;
    }

    // 高优先级覆盖低优先级
    const existing = seen.get(manifest.id);
    if (!existing || priority > existing.priority) {
      seen.set(manifest.id, {
        id: manifest.id,
        rootDir,
        origin,
        manifestPath,
        priority,
      });
    }
  } catch (error) {
    console.warn(`[Discovery] Failed to parse ${manifestPath}:`, error);
  }
}
