/**
 * Local Sandbox Provider
 *
 * Provides process-based sandboxing using Bun subprocess API.
 * Offers lightweight isolation with command filtering and resource limits.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  Sandbox,
  SandboxProvider,
  SandboxCreateOptions,
  SandboxInfo,
  ExecOptions,
  ExecutionResult,
  FileEntry,
  ListFilesOptions,
  SandboxConfig,
} from '../types';
import { logger } from '../../../infra/observability/logger';

/**
 * Local Sandbox Instance
 */
class LocalSandbox implements Sandbox {
  readonly id: string;
  readonly provider = 'local' as const;
  readonly workspacePath: string;
  readonly sessionId?: string;

  private _alive: boolean = true;
  private createdAt: Date;
  private execCount: number = 0;
  private totalDurationMs: number = 0;
  private lastExecAt?: Date;
  private config: SandboxConfig['local'];

  constructor(
    id: string,
    workspacePath: string,
    config: SandboxConfig['local'],
    options?: SandboxCreateOptions
  ) {
    this.id = id;
    this.workspacePath = workspacePath;
    this.config = config;
    this.sessionId = options?.sessionId;
    this.createdAt = new Date();

    // Ensure workspace exists
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }
  }

  get alive(): boolean {
    return this._alive;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecutionResult> {
    if (!this.alive) {
      throw new Error('Sandbox has been destroyed');
    }

    // Check blocked commands
    if (this.isBlockedCommand(command)) {
      throw new Error(`Command blocked by security policy: ${command}`);
    }

    const timeout = options?.timeout || this.config.defaultTimeout;
    const maxOutput = options?.maxOutput || this.config.maxOutputSize;
    const cwd = options?.cwd
      ? path.join(this.workspacePath, options.cwd)
      : this.workspacePath;

    const startTime = Date.now();

    try {
      // Execute command using Bun's subprocess
      const result = await this.executeCommand(command, {
        cwd,
        timeout,
        env: options?.env,
        maxOutput,
        shell: options?.shell,
      });

      const durationMs = Date.now() - startTime;

      // Update stats
      this.execCount++;
      this.totalDurationMs += durationMs;
      this.lastExecAt = new Date();

      logger.info('[LocalSandbox] Command executed', {
        sandboxId: this.id,
        command: command.substring(0, 100),
        exitCode: result.exitCode,
        durationMs,
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error('[LocalSandbox] Command execution failed', {
        sandboxId: this.id,
        command: command.substring(0, 100),
        error: String(error),
        durationMs,
      });

      throw error;
    }
  }

  private async executeCommand(
    command: string,
    options: {
      cwd: string;
      timeout: number;
      env?: Record<string, string>;
      maxOutput: number;
      shell?: string;
    }
  ): Promise<ExecutionResult> {
    const shell = options.shell || 'bash';
    const startTime = Date.now();

    // Use Bun's subprocess API
    const proc = Bun.spawn([shell, '-c', command], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Set up timeout
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, options.timeout);

    try {
      // Read output with size limit
      const stdout = await this.readStream(proc.stdout, options.maxOutput);
      const stderr = await this.readStream(proc.stderr, options.maxOutput);

      // Wait for process to complete
      const exitCode = await proc.exited;

      clearTimeout(timeoutId);

      const durationMs = Date.now() - startTime;

      return {
        exitCode: timedOut ? 137 : exitCode,
        stdout,
        stderr,
        timedOut,
        durationMs,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private async readStream(stream: ReadableStream<Uint8Array>, maxSize: number): Promise<string> {
    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        if (totalSize + value.length > maxSize) {
          // Truncate to max size
          const remaining = maxSize - totalSize;
          if (remaining > 0) {
            chunks.push(value.slice(0, remaining));
            totalSize += remaining;
          }
          break;
        }

        chunks.push(value);
        totalSize += value.length;
      }
    } finally {
      reader.releaseLock();
    }

    // Combine chunks
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return new TextDecoder().decode(combined);
  }

  private isBlockedCommand(command: string): boolean {
    // Check blocked commands
    for (const pattern of this.config.blockedCommands) {
      try {
        const regex = new RegExp(pattern, 'gi');
        if (regex.test(command)) {
          return true;
        }
      } catch {
        logger.warn('[LocalSandbox] Invalid blocked command pattern', { pattern });
      }
    }

    // If allowedCommands is set, only allow those
    if (this.config.allowedCommands && this.config.allowedCommands.length > 0) {
      const isAllowed = this.config.allowedCommands.some(pattern => {
        try {
          const regex = new RegExp(pattern, 'gi');
          return regex.test(command);
        } catch {
          return false;
        }
      });

      return !isAllowed;
    }

    return false;
  }

  async writeFile(filePath: string, content: string | Buffer): Promise<void> {
    if (!this.alive) {
      throw new Error('Sandbox has been destroyed');
    }

    const fullPath = path.join(this.workspacePath, filePath);
    const dir = path.dirname(fullPath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await fs.promises.writeFile(fullPath, content);
  }

  async readFile(filePath: string): Promise<string> {
    if (!this.alive) {
      throw new Error('Sandbox has been destroyed');
    }

    const fullPath = path.join(this.workspacePath, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return await fs.promises.readFile(fullPath, 'utf-8');
  }

  async listFiles(dirPath: string, options?: ListFilesOptions): Promise<FileEntry[]> {
    if (!this.alive) {
      throw new Error('Sandbox has been destroyed');
    }

    const fullPath = path.join(this.workspacePath, dirPath);

    if (!fs.existsSync(fullPath)) {
      return [];
    }

    const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });

    const result: FileEntry[] = [];

    for (const entry of entries) {
      // Skip hidden files unless requested
      if (!options?.hidden && entry.name.startsWith('.')) {
        continue;
      }

      const entryPath = path.join(dirPath, entry.name);
      const stat = await fs.promises.stat(path.join(fullPath, entry.name));

      result.push({
        name: entry.name,
        path: entryPath,
        type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });

      // Recursive listing
      if (options?.recursive && entry.isDirectory()) {
        if (!options.maxDepth || options.maxDepth > 1) {
          const subEntries = await this.listFiles(entryPath, {
            ...options,
            maxDepth: options.maxDepth ? options.maxDepth - 1 : undefined,
          });
          result.push(...subEntries);
        }
      }
    }

    return result;
  }

  async destroy(): Promise<void> {
    if (!this.alive) {
      return;
    }

    this._alive = false;

    // Clean up workspace directory
    try {
      if (fs.existsSync(this.workspacePath)) {
        await fs.promises.rm(this.workspacePath, { recursive: true, force: true });
      }

      logger.info('[LocalSandbox] Sandbox destroyed', {
        sandboxId: this.id,
        execCount: this.execCount,
        totalDurationMs: this.totalDurationMs,
      });
    } catch (error) {
      logger.error('[LocalSandbox] Failed to cleanup workspace', {
        sandboxId: this.id,
        error: String(error),
      });
    }
  }

  getInfo(): SandboxInfo {
    return {
      id: this.id,
      provider: this.provider,
      alive: this.alive,
      createdAt: this.createdAt.toISOString(),
      workspacePath: this.workspacePath,
      sessionId: this.sessionId,
      stats: {
        execCount: this.execCount,
        totalDurationMs: this.totalDurationMs,
        lastExecAt: this.lastExecAt?.toISOString(),
      },
    };
  }
}

/**
 * Local Sandbox Provider
 */
export class LocalSandboxProvider implements SandboxProvider {
  readonly type = 'local' as const;
  private config: SandboxConfig;
  private sandboxes: Map<string, LocalSandbox> = new Map();

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    // Local provider is always available
    return this.config.local.enabled;
  }

  async create(options?: SandboxCreateOptions): Promise<Sandbox> {
    const id = `local_${randomUUID()}`;
    const workspaceBase = path.resolve(this.config.workspaceBase);

    // Create workspace directory for this sandbox
    const workspacePath = path.join(workspaceBase, id);

    logger.info('[LocalSandboxProvider] Creating sandbox', {
      sandboxId: id,
      workspacePath,
    });

    const sandbox = new LocalSandbox(
      id,
      workspacePath,
      this.config.local,
      options
    );

    this.sandboxes.set(id, sandbox);

    return sandbox;
  }

  async destroy(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);

    if (sandbox) {
      await sandbox.destroy();
      this.sandboxes.delete(sandboxId);
    }
  }

  async list(): Promise<Sandbox[]> {
    return Array.from(this.sandboxes.values());
  }

  async shutdown(): Promise<void> {
    logger.info('[LocalSandboxProvider] Shutting down, destroying all sandboxes');

    const destroyPromises = Array.from(this.sandboxes.values()).map(sandbox =>
      sandbox.destroy().catch(error => {
        logger.error('[LocalSandboxProvider] Failed to destroy sandbox', {
          sandboxId: sandbox.id,
          error: String(error),
        });
      })
    );

    await Promise.all(destroyPromises);
    this.sandboxes.clear();
  }
}
