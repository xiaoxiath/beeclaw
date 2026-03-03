/**
 * Configuration Hot Reload
 *
 * 配置文件监听和热更新功能
 */

import { watch, type FSWatcher } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { AppConfigSchema, type AppConfig } from './schema';
import { logger } from '../utils/logger';
import { getHookRunner } from '../hooks';

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

export type ConfigChangeListener = (change: ConfigChange) => void;

// ============================================================================
// 配置观察器
// ============================================================================

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

      // 通知监听器
      for (const change of changes) {
        logger.info(`[ConfigWatcher] Config changed: ${change.key}`);

        // 调用监听器
        for (const listener of this.listeners) {
          try {
            listener(change);
          } catch (error) {
            logger.error('[ConfigWatcher] Listener error:', error);
          }
        }

        // 触发钩子
        if (this.options.notifyHooks) {
          await this.notifyHooks(change);
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
      } else if (oldValue !== newValue) {
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
  private async notifyHooks(change: ConfigChange): Promise<void> {
    try {
      const hookRunner = getHookRunner();
      await hookRunner.runParallel('config_changed' as any, change, {
        timestamp: change.timestamp,
      });
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
        const { existsSync } = await import('fs');
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
