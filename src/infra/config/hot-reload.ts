/**
 * Configuration Hot Reload
 *
 * 配置文件监听和热更新功能
 */

import { watch, existsSync, type FSWatcher } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { AppConfigSchema, type AppConfig } from './schema';
import { logger } from '../observability/logger';

// Dependency-inversion: hook notifier injected at app startup to avoid
// infra -> adapter layer reverse dependency.
type HookNotifier = (event: string, data: unknown, context?: unknown) => Promise<void>;
let hookNotifier: HookNotifier | null = null;

export function setHookNotifier(notifier: HookNotifier): void {
  hookNotifier = notifier;
}


// ============================================================================
// 类型定义
// ============================================================================

export interface ConfigChange {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: string;
}

export interface ConfigWatcherOptions {
  debounceMs?: number;
  validateBeforeApply?: boolean;
  notifyHooks?: boolean;
}

/**
 * [P2 FIX 4.4] Structured diff for config hot reload.
 * Provides a comprehensive view of all changes in a single reload event.
 */
export interface ConfigDiff {
  /** Keys that were added (not present in old config) */
  added: ConfigChange[];
  /** Keys that were removed (not present in new config) */
  removed: ConfigChange[];
  /** Keys whose values changed */
  modified: ConfigChange[];
  /** Total number of changes */
  totalChanges: number;
  /** Timestamp of the reload event */
  reloadedAt: string;
  /** Old config snapshot (for rollback reference) */
  previousConfig: AppConfig | null;
}

/**
 * [P2 FIX 4.4] Enhanced listener receives both individual change and full diff context.
 */
export type ConfigChangeListener = (change: ConfigChange, diff?: ConfigDiff) => void;

// ============================================================================
// 配置观察器
// ============================================================================

/**
 * Deep equality comparison for config values (handles arrays, objects, primitives).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;

  // Handle arrays
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx]));
  }

  // Handle plain objects
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
}

export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private configPath: string | null = null;
  private currentConfig: AppConfig | null = null;
  private listeners: Set<ConfigChangeListener> = new Set();
  private debounceTimer: Timer | null = null;
  private options: Required<ConfigWatcherOptions>;

  constructor(options: ConfigWatcherOptions = {}) {
    this.options = {
      debounceMs: options.debounceMs ?? 500,
      validateBeforeApply: options.validateBeforeApply ?? true,
      notifyHooks: options.notifyHooks ?? true,
    };
  }

  /**
   * 开始监听配置文件
   */
  start(configPath: string, initialConfig: AppConfig): void {
    this.configPath = configPath;
    this.currentConfig = initialConfig;

    // 创建文件监听器
    this.watcher = watch(
      configPath,
      { persistent: false },
      (eventType) => {
        if (eventType === 'change') {
          this.handleFileChange();
        }
      },
    );

    this.watcher.on('error', (error) => {
      logger.error(`[ConfigWatcher] Error watching ${configPath}:`, error);
    });

    logger.info(`[ConfigWatcher] Watching ${configPath}`);
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.configPath = null;
    logger.info('[ConfigWatcher] Stopped');
  }

  /**
   * 添加变更监听器
   */
  onChange(listener: ConfigChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 获取当前配置
   */
  getCurrentConfig(): AppConfig | null {
    return this.currentConfig;
  }

  /**
   * 处理文件变更
   */
  private handleFileChange(): void {
    // 防抖处理
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.reloadConfig();
    }, this.options.debounceMs);
  }

  /**
   * 重新加载配置
   */
  private async reloadConfig(): Promise<void> {
    if (!this.configPath) return;

    try {
      let content = await readFile(this.configPath, 'utf-8');

      // 替换环境变量
      content = content.replace(/\$\{(\w+)\}/g, (_, varName) => {
        const value = process.env[varName];
        return value ?? '';
      });

      const rawConfig = JSON.parse(content);

      // 验证配置
      if (this.options.validateBeforeApply) {
        const result = AppConfigSchema.safeParse(rawConfig);
        if (!result.success) {
          logger.error('[ConfigWatcher] Config validation failed:', result.error.flatten());
          return;
        }
      }

      const newConfig = rawConfig as AppConfig;
      const oldConfig = this.currentConfig;

      // 检测变更
      const changes = this.detectChanges(oldConfig, newConfig);

      if (changes.length === 0) {
        logger.debug('[ConfigWatcher] No changes detected');
        return;
      }

      // 更新配置
      this.currentConfig = newConfig;

      // [P2 FIX 4.4] Build structured diff
      const diff = this.buildDiff(oldConfig, newConfig, changes);

      logger.info(
        `[ConfigWatcher] Config reloaded: ${diff.totalChanges} change(s) ` +
        `(+${diff.added.length} ~${diff.modified.length} -${diff.removed.length})`
      );

      // 通知监听器 (with diff context)
      for (const change of changes) {
        logger.info(`[ConfigWatcher] Config changed: ${change.key}`);

        // [P2 FIX 4.4] Pass diff as second argument to listeners
        for (const listener of this.listeners) {
          try {
            listener(change, diff);
          } catch (error) {
            logger.error('[ConfigWatcher] Listener error:', error);
          }
        }

        // 触发钩子 (pass diff as part of hook context)
        if (this.options.notifyHooks) {
          await this.notifyHooks(change, diff);
        }
      }
    } catch (error) {
      logger.error('[ConfigWatcher] Failed to reload config:', error);
    }
  }

  /**
   * 检测配置变更
   */
  private detectChanges(
    oldConfig: AppConfig | null,
    newConfig: AppConfig,
  ): ConfigChange[] {
    const changes: ConfigChange[] = [];
    const timestamp = new Date().toISOString();

    if (!oldConfig) {
      // 首次加载，所有配置都是新的
      changes.push({
        key: '*',
        oldValue: null,
        newValue: newConfig,
        timestamp,
      });
      return changes;
    }

    // 递归比较配置
    this.compareObjects('', oldConfig, newConfig, changes, timestamp);

    return changes;
  }

  /**
   * [P2 FIX 4.4] Build structured diff from changes
   */
  private buildDiff(
    oldConfig: AppConfig | null,
    _newConfig: AppConfig,
    changes: ConfigChange[],
  ): ConfigDiff {
    const added: ConfigChange[] = [];
    const removed: ConfigChange[] = [];
    const modified: ConfigChange[] = [];

    for (const change of changes) {
      if (change.key === '*') {
        // Full reload (first load)
        added.push(change);
      } else if (change.oldValue === undefined) {
        added.push(change);
      } else if (change.newValue === undefined) {
        removed.push(change);
      } else {
        modified.push(change);
      }
    }

    return {
      added,
      removed,
      modified,
      totalChanges: changes.length,
      reloadedAt: new Date().toISOString(),
      previousConfig: oldConfig,
    };
  }

  /**
   * 递归比较对象
   */
  private compareObjects(
    prefix: string,
    oldObj: Record<string, unknown>,
    newObj: Record<string, unknown>,
    changes: ConfigChange[],
    timestamp: string,
  ): void {
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

    for (const key of allKeys) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const oldValue = oldObj[key];
      const newValue = newObj[key];

      // 检查是否是嵌套对象
      if (
        typeof oldValue === 'object' &&
        oldValue !== null &&
        !Array.isArray(oldValue) &&
        typeof newValue === 'object' &&
        newValue !== null &&
        !Array.isArray(newValue)
      ) {
        this.compareObjects(
          fullKey,
          oldValue as Record<string, unknown>,
          newValue as Record<string, unknown>,
          changes,
          timestamp,
        );
      } else if (!deepEqual(oldValue, newValue)) {
        changes.push({
          key: fullKey,
          oldValue,
          newValue,
          timestamp,
        });
      }
    }
  }

  /**
   * 通知钩子系统
   */
  private async notifyHooks(change: ConfigChange, diff?: ConfigDiff): Promise<void> {
    try {
      if (hookNotifier) {
        await hookNotifier('config_changed', change, {
          timestamp: change.timestamp,
          diff,  // [P2 FIX 4.4] Include full diff in hook context
        });
      } else {
        logger.debug('[ConfigWatcher] No hook notifier registered, skipping config_changed notification');
      }
    } catch (error) {
      logger.warn('[ConfigWatcher] Failed to notify hooks:', error);
    }
  }
}

// ============================================================================
// 配置管理器（带热更新）
// ============================================================================

export class ConfigManager {
  private config: AppConfig | null = null;
  private watcher: ConfigWatcher;
  private configPath: string | null = null;

  constructor() {
    this.watcher = new ConfigWatcher();
  }

  /**
   * 加载配置
   */
  async load(basePath: string = process.cwd()): Promise<AppConfig> {
    // 查找配置文件
    const configFiles = ['beeclaw.json', 'beeclaw.yaml'];
    let foundPath: string | null = null;

    for (const file of configFiles) {
      const path = join(basePath, file);
      try {
        if (existsSync(path)) {
          foundPath = path;
          break;
        }
      } catch {
        // Ignore
      }
    }

    if (!foundPath) {
      // 使用默认配置
      const result = AppConfigSchema.safeParse({});
      this.config = result.success ? result.data : AppConfigSchema.parse({});
      return this.config;
    }

    // 读取并解析配置
    let content = await readFile(foundPath, 'utf-8');
    content = content.replace(/\$\{(\w+)\}/g, (_, varName) => {
      return process.env[varName] ?? '';
    });

    const rawConfig = JSON.parse(content);
    const result = AppConfigSchema.safeParse(rawConfig);

    if (!result.success) {
      logger.warn('[ConfigManager] Config validation failed, using defaults');
      this.config = AppConfigSchema.parse({});
    } else {
      this.config = result.data;
    }

    this.configPath = foundPath;

    // 开始监听
    this.watcher.start(foundPath, this.config);

    return this.config;
  }

  /**
   * 获取当前配置
   */
  get(): AppConfig {
    if (!this.config) {
      throw new Error('Config not loaded. Call load() first.');
    }

    // 优先从 watcher 获取最新配置
    const watchedConfig = this.watcher.getCurrentConfig();
    return watchedConfig || this.config;
  }

  /**
   * 监听配置变更
   */
  onChange(listener: ConfigChangeListener): () => void {
    return this.watcher.onChange(listener);
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.watcher.stop();
    this.config = null;
    this.configPath = null;
  }
}

// ============================================================================
// 单例
// ============================================================================

let configManager: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
  if (!configManager) {
    configManager = new ConfigManager();
  }
  return configManager;
}

export function resetConfigManager(): void {
  if (configManager) {
    configManager.destroy();
  }
  configManager = null;
}
