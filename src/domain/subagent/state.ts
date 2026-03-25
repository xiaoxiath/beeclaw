/**
 * Shared State Management
 *
 * Provides a state store for subagent collaboration.
 * **Note:** Not inherently thread-safe — callers must use `acquireLock()`
 * for concurrent access to shared keys.
 * Supports locking, expiration, and change notifications.
 */

/**
 * State entry with metadata
 */
export interface StateEntry<T = any> {
  /** The stored value */
  value: T;
  /** When this entry was created */
  createdAt: Date;
  /** When this entry was last updated */
  updatedAt: Date;
  /** When this entry expires (optional) */
  expiresAt?: Date;
  /** Time-to-live in milliseconds (optional) */
  ttl?: number;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Lock state for a key
 */
interface LockState {
  /** Promise that resolves when lock is released */
  promise: Promise<void>;
  /** Function to release the lock */
  release: () => void;
  /** When the lock was acquired */
  acquiredAt: Date;
  /** Who acquired the lock (optional) */
  owner?: string;
}

/**
 * Subscription callback type
 */
export type StateChangeCallback<T = any> = (
  newValue: T | undefined,
  oldValue: T | undefined,
  key: string
) => void;

/**
 * Subscription entry
 */
interface Subscription {
  /** Callback function */
  callback: StateChangeCallback;
  /** Whether this is a one-time subscription */
  once: boolean;
}

/**
 * Statistics about the state store
 */
export interface StateStats {
  /** Total number of entries */
  totalEntries: number;
  /** Number of locked keys */
  lockedKeys: number;
  /** Number of active subscriptions */
  activeSubscriptions: number;
  /** Number of expired entries */
  expiredEntries: number;
  /** Memory usage estimate (bytes) */
  estimatedMemoryUsage: number;
}

/**
 * Options for SharedState
 */
export interface SharedStateOptions {
  /** Enable automatic cleanup of expired entries (default: true) */
  enableAutoCleanup?: boolean;
  /** Cleanup interval in milliseconds (default: 60000) */
  cleanupInterval?: number;
  /** Default TTL for entries in milliseconds (optional) */
  defaultTtl?: number;
  /** Maximum number of entries (optional) */
  maxEntries?: number;
}

/**
 * Shared State Store
 *
 * **NOT thread-safe.** While this class provides an async locking mechanism
 * (`acquireLock`), the core `set`/`get`/`delete`/`update` methods do NOT
 * automatically acquire locks. Callers must explicitly use `acquireLock`
 * when concurrent access to the same key is possible.
 *
 * Supports locking, expiration, and change notifications.
 */
export class SharedState {
  private store: Map<string, StateEntry> = new Map();
  private locks: Map<string, LockState> = new Map();
  private subscriptions: Map<string, Subscription[]> = new Map();
  private cleanupTimer?: NodeJS.Timeout;
  private options: Required<SharedStateOptions>;

  constructor(options: SharedStateOptions = {}) {
    this.options = {
      enableAutoCleanup: options.enableAutoCleanup ?? true,
      cleanupInterval: options.cleanupInterval ?? 60000,
      defaultTtl: options.defaultTtl ?? 0,
      maxEntries: options.maxEntries ?? 0,
    };

    if (this.options.enableAutoCleanup) {
      this.startAutoCleanup();
    }
  }

  /**
   * Set a value in the state store
   *
   * @param key State key
   * @param value Value to store
   * @param ttl Time-to-live in milliseconds (optional)
   * @param metadata Additional metadata (optional)
   */
  async set<T = any>(
    key: string,
    value: T,
    ttl?: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    // Check max entries limit
    if (this.options.maxEntries > 0 && !this.store.has(key)) {
      if (this.store.size >= this.options.maxEntries) {
        throw new Error(`Maximum entries limit (${this.options.maxEntries}) reached`);
      }
    }

    const now = new Date();
    const effectiveTtl = ttl ?? this.options.defaultTtl;

    const entry: StateEntry<T> = {
      value,
      createdAt: this.store.has(key) ? this.store.get(key)!.createdAt : now,
      updatedAt: now,
      ttl: effectiveTtl > 0 ? effectiveTtl : undefined,
      expiresAt: effectiveTtl > 0 ? new Date(now.getTime() + effectiveTtl) : undefined,
      metadata,
    };

    const oldValue = this.store.has(key) ? this.store.get(key)!.value : undefined;

    this.store.set(key, entry);

    // Notify subscribers
    this.notifySubscribers(key, value, oldValue);
  }

  /**
   * Get a value from the state store
   *
   * @param key State key
   * @returns The stored value or undefined
   */
  async get<T = any>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);

    if (!entry) {
      return undefined;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Get the full entry (with metadata)
   *
   * @param key State key
   * @returns The state entry or undefined
   */
  async getEntry<T = any>(key: string): Promise<StateEntry<T> | undefined> {
    const entry = this.store.get(key);

    if (!entry) {
      return undefined;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.store.delete(key);
      return undefined;
    }

    return entry as StateEntry<T>;
  }

  /**
   * Check if a key exists
   *
   * @param key State key
   * @returns True if the key exists and hasn't expired
   */
  async exists(key: string): Promise<boolean> {
    const entry = this.store.get(key);

    if (!entry) {
      return false;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a value from the state store
   *
   * @param key State key
   * @returns True if the key existed
   */
  async delete(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    const existed = this.store.delete(key);

    if (existed && entry) {
      // Notify subscribers with undefined new value
      this.notifySubscribers(key, undefined, entry.value);
    }

    return existed;
  }

  /**
   * Update a value (NOT atomic — see `guardedUpdate` for lock-protected variant)
   *
   * @param key State key
   * @param updater Function that receives current value and returns new value
   * @param ttl Optional new TTL
   */
  async update<T = any>(
    key: string,
    updater: (current: T | undefined) => T,
    ttl?: number
  ): Promise<void> {
    const current = await this.get<T>(key);
    const newValue = updater(current);
    await this.set(key, newValue, ttl);
  }

  /**
   * Lock-protected update — acquires a lock before reading + writing.
   *
   * Use this instead of `update()` when multiple concurrent callers may
   * modify the same key.
   *
   * @param key State key
   * @param updater Function that receives current value and returns new value
   * @param ttl Optional new TTL
   */
  async guardedUpdate<T = any>(
    key: string,
    updater: (current: T | undefined) => T,
    ttl?: number
  ): Promise<void> {
    const release = await this.acquireLock(key);
    try {
      const current = await this.get<T>(key);
      const newValue = updater(current);
      await this.set(key, newValue, ttl);
    } finally {
      release();
    }
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    // Notify all subscribers
    for (const [key, entry] of this.store.entries()) {
      this.notifySubscribers(key, undefined, entry.value);
    }

    this.store.clear();
  }

  /**
   * Get all keys
   *
   * @returns Array of keys (excluding expired entries)
   */
  async keys(): Promise<string[]> {
    await this.cleanup();
    return Array.from(this.store.keys());
  }

  /**
   * Get all entries
   *
   * @returns Map of key to entries (excluding expired)
   */
  async entries(): Promise<Map<string, StateEntry>> {
    await this.cleanup();

    const result = new Map<string, StateEntry>();
    for (const [key, entry] of this.store.entries()) {
      result.set(key, entry);
    }

    return result;
  }

  /**
   * Acquire a lock on a key
   *
   * @param key State key
   * @param owner Lock owner identifier (optional)
   * @param timeout Lock timeout in milliseconds (default: 5000)
   * @returns Function to release the lock
   */
  async acquireLock(key: string, owner?: string, timeout = 5000): Promise<() => void> {
    const deadline = Date.now() + timeout;

    // Spin-wait until the key is unlocked or we time out.
    // A plain `if` would let multiple awaiters through simultaneously
    // after `Promise.race` resolves, causing them to overwrite each
    // other's locks. The `while` loop re-checks after every wakeup.
    while (this.locks.has(key)) {
      const existingLock = this.locks.get(key)!;
      const remainingTime = deadline - Date.now();
      if (remainingTime <= 0) {
        throw new Error(`Lock acquisition timeout for key: ${key}`);
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Lock acquisition timeout for key: ${key}`)),
          remainingTime,
        );
      });

      try {
        await Promise.race([existingLock.promise, timeoutPromise]);
      } catch (error) {
        // Timeout — propagate directly
        throw error;
      }
      // Loop back and re-check — another waiter may have grabbed the lock first.
    }

    // At this point no lock exists for `key`; safe to create one.
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.locks.set(key, {
      promise: lockPromise,
      release: releaseLock!,
      acquiredAt: new Date(),
      owner,
    });

    // Return release function
    return () => {
      this.releaseLock(key);
    };
  }

  /**
   * Release a lock on a key
   *
   * @param key State key
   */
  private releaseLock(key: string): void {
    const lock = this.locks.get(key);
    if (lock) {
      // Delete entry BEFORE resolving so that awoken waiters see the
      // lock as absent when their `while` loop re-checks `this.locks.has(key)`.
      this.locks.delete(key);
      lock.release();
    }
  }

  /**
   * Check if a key is locked
   *
   * @param key State key
   * @returns True if the key is locked
   */
  isLocked(key: string): boolean {
    return this.locks.has(key);
  }

  /**
   * Subscribe to changes on a key
   *
   * @param key State key (use '*' for all keys)
   * @param callback Function to call on change
   * @param once Whether to unsubscribe after first notification
   * @returns Unsubscribe function
   */
  subscribe(
    key: string,
    callback: StateChangeCallback,
    once = false
  ): () => void {
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, []);
    }

    const subscription: Subscription = { callback, once };
    this.subscriptions.get(key)!.push(subscription);

    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(key);
      if (subs) {
        const index = subs.indexOf(subscription);
        if (index >= 0) {
          subs.splice(index, 1);
        }
        if (subs.length === 0) {
          this.subscriptions.delete(key);
        }
      }
    };
  }

  /**
   * Subscribe to changes on a key (one-time)
   *
   * @param key State key
   * @param callback Function to call on change
   * @returns Unsubscribe function
   */
  once(key: string, callback: StateChangeCallback): () => void {
    return this.subscribe(key, callback, true);
  }

  /**
   * Notify subscribers of a change
   */
  private notifySubscribers(key: string, newValue: any, oldValue: any): void {
    // Notify specific key subscribers
    const keySubs = this.subscriptions.get(key);
    if (keySubs) {
      const toRemove: Subscription[] = [];

      for (const sub of keySubs) {
        try {
          sub.callback(newValue, oldValue, key);
          if (sub.once) {
            toRemove.push(sub);
          }
        } catch (error) {
          logger.error(`[SharedState] Error in subscription callback for ${key}:`, error);
        }
      }

      // Remove one-time subscriptions
      for (const sub of toRemove) {
        const index = keySubs.indexOf(sub);
        if (index >= 0) {
          keySubs.splice(index, 1);
        }
      }

      if (keySubs.length === 0) {
        this.subscriptions.delete(key);
      }
    }

    // Notify wildcard subscribers
    const wildcardSubs = this.subscriptions.get('*');
    if (wildcardSubs) {
      const toRemove: Subscription[] = [];

      for (const sub of wildcardSubs) {
        try {
          sub.callback(newValue, oldValue, key);
          if (sub.once) {
            toRemove.push(sub);
          }
        } catch (error) {
          logger.error(`[SharedState] Error in wildcard subscription callback:`, error);
        }
      }

      // Remove one-time subscriptions
      for (const sub of toRemove) {
        const index = wildcardSubs.indexOf(sub);
        if (index >= 0) {
          wildcardSubs.splice(index, 1);
        }
      }

      if (wildcardSubs.length === 0) {
        this.subscriptions.delete('*');
      }
    }
  }

  /**
   * Clean up expired entries
   *
   * @returns Number of entries removed
   */
  async cleanup(): Promise<number> {
    const now = new Date();
    let removed = 0;

    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.store.delete(key);
        this.notifySubscribers(key, undefined, entry.value);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Start automatic cleanup timer
   */
  private startAutoCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(error => {
        logger.error('[SharedState] Cleanup error:', error);
      });
    }, this.options.cleanupInterval);
  }

  /**
   * Stop automatic cleanup timer
   */
  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Get statistics about the state store
   */
  async getStats(): Promise<StateStats> {
    let expiredCount = 0;
    const now = new Date();

    for (const entry of this.store.values()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        expiredCount++;
      }
    }

    // Estimate memory usage (rough estimate)
    let estimatedMemoryUsage = 0;
    for (const [key, entry] of this.store.entries()) {
      estimatedMemoryUsage += key.length * 2; // UTF-16 characters
      estimatedMemoryUsage += JSON.stringify(entry.value).length * 2;
      estimatedMemoryUsage += 200; // Metadata overhead per entry
    }

    return {
      totalEntries: this.store.size,
      lockedKeys: this.locks.size,
      activeSubscriptions: Array.from(this.subscriptions.values())
        .reduce((sum, subs) => sum + subs.length, 0),
      expiredEntries: expiredCount,
      estimatedMemoryUsage,
    };
  }

  /**
   * Export state to JSON
   *
   * @returns JSON string of all entries
   */
  async export(): Promise<string> {
    await this.cleanup();

    const data: Record<string, any> = {};
    for (const [key, entry] of this.store.entries()) {
      data[key] = {
        value: entry.value,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
        expiresAt: entry.expiresAt?.toISOString(),
        ttl: entry.ttl,
        metadata: entry.metadata,
      };
    }

    return JSON.stringify(data, null, 2);
  }

  /**
   * Import state from JSON
   *
   * @param json JSON string to import
   * @param merge Whether to merge with existing data (default: false)
   */
  async import(json: string, merge = false): Promise<void> {
    const data = JSON.parse(json);

    if (!merge) {
      await this.clear();
    }

    for (const [key, entry] of Object.entries(data)) {
      const parsed = entry as any;
      await this.set(
        key,
        parsed.value,
        parsed.ttl,
        parsed.metadata
      );
    }
  }

  /**
   * Cleanup resources on shutdown
   */
  destroy(): void {
    this.stopAutoCleanup();
    this.store.clear();
    this.locks.clear();
    this.subscriptions.clear();
  }

  /**
   * Dispose resources (alias for destroy, implements Disposable pattern)
   */
  dispose(): void {
    this.destroy();
  }
}

// ============================================================================
// Singleton Management
// ============================================================================

let sharedStateInstance: SharedState | null = null;

/**
 * Initialize the global SharedState instance
 */
export function initSharedState(options?: SharedStateOptions): SharedState {
  if (sharedStateInstance) {
    logger.warn('[SharedState] Instance already initialized, destroying old instance');
    sharedStateInstance.destroy();
  }

  sharedStateInstance = new SharedState(options);
  logger.info('[SharedState] Initialized');

  return sharedStateInstance;
}

/**
 * Get the global SharedState instance
 */
export function getSharedState(): SharedState {
  if (!sharedStateInstance) {
    throw new Error('SharedState not initialized. Call initSharedState() first.');
  }

  return sharedStateInstance;
}

/**
 * Check if SharedState is initialized
 */
export function isSharedStateInitialized(): boolean {
  return sharedStateInstance !== null;
}

/**
 * Reset the global SharedState instance (for testing)
 */
export function resetSharedState(): void {
  if (sharedStateInstance) {
    sharedStateInstance.destroy();
    sharedStateInstance = null;
  }
}
