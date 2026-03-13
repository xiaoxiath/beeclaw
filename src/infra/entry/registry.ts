/**
 * Adapter Registry
 *
 * 管理所有已注册的 Entry Adapter
 */

import type { EntryAdapter } from './types';
import { logger } from '../observability/logger';

/**
 * Adapter 注册表（单例）
 */
class AdapterRegistry {
  private adapters: Map<string, EntryAdapter> = new Map();
  private initialized: boolean = false;

  /**
   * 注册适配器
   */
  register(adapter: EntryAdapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`Adapter "${adapter.name}" already registered`);
    }
    this.adapters.set(adapter.name, adapter);
    logger.debug(`[AdapterRegistry] Registered adapter: ${adapter.name}`);
  }

  /**
   * 获取适配器
   */
  get(name: string): EntryAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * 获取所有适配器
   */
  getAll(): EntryAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * 根据类型获取适配器
   */
  getByType(type: string): EntryAdapter[] {
    return this.getAll().filter(a => a.type === type);
  }

  /**
   * 启动所有适配器
   */
  async startAll(): Promise<void> {
    if (this.initialized) {
      logger.warn('[AdapterRegistry] Adapters already started');
      return;
    }

    const adapters = this.getAll();
    logger.info(`[AdapterRegistry] Starting ${adapters.length} adapter(s)...`);

    for (const adapter of adapters) {
      try {
        await adapter.start();
        logger.info(`[AdapterRegistry] ✓ Adapter "${adapter.name}" started`);
      } catch (error) {
        logger.error(`[AdapterRegistry] ✗ Failed to start adapter "${adapter.name}":`, error);
        throw error;
      }
    }

    this.initialized = true;
    logger.info('[AdapterRegistry] All adapters started successfully');
  }

  /**
   * 停止所有适配器
   */
  async stopAll(): Promise<void> {
    const adapters = this.getAll();

    logger.info(`[AdapterRegistry] Stopping ${adapters.length} adapter(s)...`);

    for (const adapter of adapters) {
      try {
        await adapter.stop();
        logger.info(`[AdapterRegistry] ✓ Adapter "${adapter.name}" stopped`);
      } catch (error) {
        logger.error(`[AdapterRegistry] ✗ Failed to stop adapter "${adapter.name}":`, error);
      }
    }

    this.initialized = false;
    logger.info('[AdapterRegistry] All adapters stopped');
  }

  /**
   * 获取所有适配器的状态
   */
  getAllStatuses(): Record<string, ReturnType<EntryAdapter['getStatus']>> {
    const statuses: Record<string, ReturnType<EntryAdapter['getStatus']>> = {};
    for (const [name, adapter] of this.adapters) {
      statuses[name] = adapter.getStatus();
    }
    return statuses;
  }

  /**
   * 清空注册表（用于测试）
   */
  clear(): void {
    this.adapters.clear();
    this.initialized = false;
  }
}

/**
 * 全局 Adapter 注册表实例
 */
export const adapterRegistry = new AdapterRegistry();
