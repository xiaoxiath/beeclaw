/**
 * Sandbox Manager — Singleton orchestrator
 *
 * Central entry point for sandbox lifecycle management.
 * Handles provider selection, sandbox creation/destruction, and event dispatch.
 *
 * Usage:
 *   const manager = SandboxManager.getInstance();
 *   await manager.initialize(config);
 *   const sandbox = await manager.acquire({ sessionId: 'xxx' });
 *   const result = await sandbox.exec('echo hello');
 *   await manager.release(sandbox.id);
 */

import { mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { logger } from '../../infra/observability/logger';
import { VirtualPathMapper } from './path-mapper';
import { LocalSandboxProvider } from './providers/local';
import { DockerSandboxProvider } from './providers/docker';
import type {
  Sandbox,
  SandboxProvider,
  SandboxProviderType,
  SandboxConfig,
  SandboxCreateOptions,
  SandboxEvent,
  SandboxEventHandler,
} from './types';

export class SandboxManager {
  private static instance: SandboxManager | null = null;

  private providers = new Map<SandboxProviderType, SandboxProvider>();
  private activeSandboxes = new Map<string, Sandbox>();
  private sessionSandboxMap = new Map<string, string>(); // sessionId → sandboxId
  private pathMappers = new Map<string, VirtualPathMapper>(); // sandboxId → mapper
  private eventHandlers: SandboxEventHandler[] = [];
  private config: SandboxConfig | null = null;
  private initialized = false;

  private constructor() {}

  static getInstance(): SandboxManager {
    if (!SandboxManager.instance) {
      SandboxManager.instance = new SandboxManager();
    }
    return SandboxManager.instance;
  }

  static resetInstance(): void {
    SandboxManager.instance = null;
  }

  /**
   * Initialize the sandbox manager with configuration.
   */
  async initialize(config: SandboxConfig): Promise<void> {
    if (this.initialized) {
      logger.warn('[SandboxManager] Already initialized, skipping');
      return;
    }

    this.config = config;

    // Ensure workspace base directory exists
    const workspaceBase = resolve(config.workspaceBase);
    if (!existsSync(workspaceBase)) {
      mkdirSync(workspaceBase, { recursive: true });
    }

    // Initialize local provider (always available)
    if (config.local.enabled) {
      try {
        const localProvider = new LocalSandboxProvider(config);
        const available = await localProvider.isAvailable();
        if (available) {
          this.providers.set('local', localProvider);
          logger.info('[SandboxManager] Local provider registered');
        }
      } catch (error) {
        logger.warn('[SandboxManager] Failed to initialize local provider:', error);
      }
    }

    // Initialize Docker provider (optional)
    if (config.docker.enabled) {
      try {
        const dockerProvider = new DockerSandboxProvider(config);
        const available = await dockerProvider.isAvailable();
        if (available) {
          this.providers.set('docker', dockerProvider);
          logger.info('[SandboxManager] Docker provider registered');
        } else {
          logger.info('[SandboxManager] Docker not available, skipping');
        }
      } catch (error) {
        logger.warn('[SandboxManager] Failed to initialize Docker provider:', error);
      }
    }

    if (this.providers.size === 0) {
      logger.warn('[SandboxManager] No providers available! Sandbox features will be limited.');
    }

    this.initialized = true;
    logger.info(`[SandboxManager] Initialized with ${this.providers.size} provider(s)`);
  }

  /**
   * Resolve the best available provider based on config preference.
   */
  private resolveProvider(preference?: SandboxProviderType | 'auto'): SandboxProvider {
    const pref = preference || this.config?.provider || 'auto';

    if (pref !== 'auto') {
      const provider = this.providers.get(pref);
      if (provider) return provider;
      logger.warn(`[SandboxManager] Preferred provider "${pref}" not available, falling back`);
    }

    // Auto selection: Docker > Local
    if (this.providers.has('docker')) return this.providers.get('docker')!;
    if (this.providers.has('local')) return this.providers.get('local')!;

    throw new Error('[SandboxManager] No sandbox providers available');
  }

  /**
   * Acquire a sandbox for a session.
   * If the session already has a sandbox, return it.
   */
  async acquire(options?: SandboxCreateOptions): Promise<{ sandbox: Sandbox; pathMapper: VirtualPathMapper }> {
    if (!this.initialized || !this.config) {
      throw new Error('[SandboxManager] Not initialized. Call initialize() first.');
    }

    const sessionId = options?.sessionId;

    // Reuse existing sandbox for the same session
    if (sessionId) {
      const existingId = this.sessionSandboxMap.get(sessionId);
      if (existingId) {
        const existing = this.activeSandboxes.get(existingId);
        const mapper = this.pathMappers.get(existingId);
        if (existing?.alive && mapper) {
          logger.debug(`[SandboxManager] Reusing sandbox ${existingId} for session ${sessionId}`);
          return { sandbox: existing, pathMapper: mapper };
        }
        // Clean up stale reference
        this.sessionSandboxMap.delete(sessionId);
        this.activeSandboxes.delete(existingId);
        this.pathMappers.delete(existingId);
      }
    }

    const provider = this.resolveProvider();

    // Prepare workspace directory for this sandbox
    const sandboxId = `sb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const workspaceDir = options?.workspacePath || join(resolve(this.config.workspaceBase), sandboxId);

    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true });
    }

    const sandbox = await provider.create({
      ...options,
      workspacePath: workspaceDir,
    });

    // Create path mapper for this sandbox
    const pathMapper = new VirtualPathMapper(workspaceDir);

    // Track
    this.activeSandboxes.set(sandbox.id, sandbox);
    this.pathMappers.set(sandbox.id, pathMapper);
    if (sessionId) {
      this.sessionSandboxMap.set(sessionId, sandbox.id);
    }

    this.emit({
      type: 'sandbox:created',
      sandboxId: sandbox.id,
      provider: sandbox.provider,
    });

    logger.info(`[SandboxManager] Created sandbox ${sandbox.id} (provider: ${sandbox.provider})`);
    return { sandbox, pathMapper };
  }

  /**
   * Release (destroy) a sandbox by ID.
   */
  async release(sandboxId: string): Promise<void> {
    const sandbox = this.activeSandboxes.get(sandboxId);
    if (!sandbox) {
      logger.warn(`[SandboxManager] Sandbox ${sandboxId} not found`);
      return;
    }

    try {
      await sandbox.destroy();
    } catch (error) {
      logger.error(`[SandboxManager] Error destroying sandbox ${sandboxId}:`, error);
    }

    // Clean up mappings
    this.activeSandboxes.delete(sandboxId);
    this.pathMappers.delete(sandboxId);

    // Remove from session map
    for (const [sessionId, sbId] of this.sessionSandboxMap.entries()) {
      if (sbId === sandboxId) {
        this.sessionSandboxMap.delete(sessionId);
        break;
      }
    }

    this.emit({
      type: 'sandbox:destroyed',
      sandboxId,
      provider: sandbox.provider,
    });

    logger.info(`[SandboxManager] Released sandbox ${sandboxId}`);
  }

  /**
   * Release sandbox by session ID.
   */
  async releaseBySession(sessionId: string): Promise<void> {
    const sandboxId = this.sessionSandboxMap.get(sessionId);
    if (sandboxId) {
      await this.release(sandboxId);
    }
  }

  /**
   * Get sandbox and mapper for a session.
   */
  getBySession(sessionId: string): { sandbox: Sandbox; pathMapper: VirtualPathMapper } | null {
    const sandboxId = this.sessionSandboxMap.get(sessionId);
    if (!sandboxId) return null;

    const sandbox = this.activeSandboxes.get(sandboxId);
    const pathMapper = this.pathMappers.get(sandboxId);
    if (!sandbox?.alive || !pathMapper) return null;

    return { sandbox, pathMapper };
  }

  /**
   * Get path mapper for a sandbox.
   */
  getPathMapper(sandboxId: string): VirtualPathMapper | null {
    return this.pathMappers.get(sandboxId) || null;
  }

  /**
   * Shutdown all sandboxes and providers.
   */
  async shutdown(): Promise<void> {
    logger.info('[SandboxManager] Shutting down...');

    // Destroy all active sandboxes
    const destroyPromises = Array.from(this.activeSandboxes.values()).map(async (sb) => {
      try {
        await sb.destroy();
      } catch (error) {
        logger.error(`[SandboxManager] Error destroying sandbox ${sb.id}:`, error);
      }
    });
    await Promise.allSettled(destroyPromises);

    // Shutdown providers
    for (const [type, provider] of this.providers.entries()) {
      try {
        await provider.shutdown();
        logger.info(`[SandboxManager] Provider "${type}" shut down`);
      } catch (error) {
        logger.error(`[SandboxManager] Error shutting down provider "${type}":`, error);
      }
    }

    this.activeSandboxes.clear();
    this.sessionSandboxMap.clear();
    this.pathMappers.clear();
    this.providers.clear();
    this.initialized = false;

    logger.info('[SandboxManager] Shutdown complete');
  }

  /**
   * Get active sandbox count and stats.
   */
  getStats(): {
    providers: string[];
    activeSandboxes: number;
    activeSessions: number;
  } {
    return {
      providers: Array.from(this.providers.keys()),
      activeSandboxes: this.activeSandboxes.size,
      activeSessions: this.sessionSandboxMap.size,
    };
  }

  /**
   * Subscribe to sandbox events.
   */
  on(handler: SandboxEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  private emit(event: SandboxEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        logger.error('[SandboxManager] Event handler error:', error);
      }
    }
  }
}
