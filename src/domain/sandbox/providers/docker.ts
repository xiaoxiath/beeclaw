/**
 * Docker Sandbox Provider
 *
 * Provides container-based sandboxing using Docker.
 * Offers strong isolation with resource limits and network policies.
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
 * Docker Container Sandbox
 */
class DockerSandbox implements Sandbox {
  readonly id: string;
  readonly provider = 'docker' as const;
  readonly workspacePath: string;
  readonly sessionId?: string;

  private alive: boolean = false;
  private containerId?: string;
  private createdAt: Date;
  private execCount: number = 0;
  private totalDurationMs: number = 0;
  private lastExecAt?: Date;
  private config: SandboxConfig['docker'];
  private workspaceBase: string;

  constructor(
    id: string,
    workspacePath: string,
    config: SandboxConfig['docker'],
    workspaceBase: string,
    options?: SandboxCreateOptions
  ) {
    this.id = id;
    this.workspacePath = workspacePath;
    this.config = config;
    this.workspaceBase = workspaceBase;
    this.sessionId = options?.sessionId;
    this.createdAt = new Date();
  }

  get alive(): boolean {
    return this.alive;
  }

  async start(options?: SandboxCreateOptions): Promise<void> {
    if (this.alive) {
      return;
    }

    // Ensure workspace exists
    if (!fs.existsSync(this.workspacePath)) {
      fs.mkdirSync(this.workspacePath, { recursive: true });
    }

    // Build docker run command
    const args = this.buildDockerRunArgs(options);

    try {
      logger.info('[DockerSandbox] Creating container', {
        sandboxId: this.id,
        image: this.config.image,
      });

      const result = await this.execDockerCommand(args);

      if (result.exitCode !== 0) {
        throw new Error(`Failed to create container: ${result.stderr}`);
      }

      // Extract container ID from output
      this.containerId = result.stdout.trim();
      this.alive = true;

      logger.info('[DockerSandbox] Container created', {
        sandboxId: this.id,
        containerId: this.containerId,
      });
    } catch (error) {
      logger.error('[DockerSandbox] Failed to create container', {
        sandboxId: this.id,
        error: String(error),
      });
      throw error;
    }
  }

  private buildDockerRunArgs(options?: SandboxCreateOptions): string[] {
    const args = [
      'run',
      '--detach',
      '--rm', // Auto-remove on stop
      '--name', this.id,
    ];

    // Resource limits
    const memoryMb = options?.memoryLimitMb || this.config.memoryLimitMb;
    const cpuLimit = options?.cpuLimit || this.config.cpuLimit;

    args.push('--memory', `${memoryMb}m`);
    args.push('--cpus', cpuLimit.toString());

    // Network isolation
    if (!this.config.networkEnabled) {
      args.push('--network', 'none');
    }

    // Mount workspace
    args.push('--volume', `${this.workspacePath}:/workspace`);
    args.push('--workdir', '/workspace');

    // Environment variables
    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push('--env', `${key}=${value}`);
      }
    }

    // Security options
    args.push('--security-opt', 'no-new-privileges');
    args.push('--cap-drop', 'ALL'); // Drop all capabilities

    // Use the specified image
    args.push(this.config.image);

    // Keep container running
    args.push('tail', '-f', '/dev/null');

    return args;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecutionResult> {
    if (!this.alive || !this.containerId) {
      throw new Error('Sandbox has been destroyed or not started');
    }

    const timeout = options?.timeout || this.config.defaultTimeout;
    const maxOutput = options?.maxOutput || this.config.maxOutputSize;

    const startTime = Date.now();

    try {
      // Build docker exec command
      const execArgs = [
        'exec',
        '--tty',
        '--interactive',
      ];

      // Set working directory if specified
      if (options?.cwd) {
        execArgs.push('--workdir', `/workspace/${options.cwd}`);
      }

      // Set environment variables
      if (options?.env) {
        for (const [key, value] of Object.entries(options.env)) {
          execArgs.push('--env', `${key}=${value}`);
        }
      }

      execArgs.push(this.containerId);
      execArgs.push(options?.shell || 'sh', '-c', command);

      const result = await this.execDockerCommand(execArgs, {
        timeout,
        maxOutput,
      });

      const durationMs = Date.now() - startTime;

      // Update stats
      this.execCount++;
      this.totalDurationMs += durationMs;
      this.lastExecAt = new Date();

      logger.info('[DockerSandbox] Command executed', {
        sandboxId: this.id,
        containerId: this.containerId,
        command: command.substring(0, 100),
        exitCode: result.exitCode,
        durationMs,
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logger.error('[DockerSandbox] Command execution failed', {
        sandboxId: this.id,
        command: command.substring(0, 100),
        error: String(error),
        durationMs,
      });

      throw error;
    }
  }

  private async execDockerCommand(
    args: string[],
    options?: { timeout?: number; maxOutput?: number }
  ): Promise<ExecutionResult> {
    const timeout = options?.timeout || 30000;
    const maxOutput = options?.maxOutput || 1048576; // 1MB

    const startTime = Date.now();

    const proc = Bun.spawn(['docker', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Set up timeout
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);

    try {
      const stdout = await this.readStream(proc.stdout, maxOutput);
      const stderr = await this.readStream(proc.stderr, maxOutput);

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

    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return new TextDecoder().decode(combined);
  }

  async writeFile(filePath: string, content: string | Buffer): Promise<void> {
    if (!this.alive || !this.containerId) {
      throw new Error('Sandbox has been destroyed or not started');
    }

    // Write to host workspace (which is mounted in container)
    const fullPath = path.join(this.workspacePath, filePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await fs.promises.writeFile(fullPath, content);
  }

  async readFile(filePath: string): Promise<string> {
    if (!this.alive || !this.containerId) {
      throw new Error('Sandbox has been destroyed or not started');
    }

    // Read from host workspace (which is mounted in container)
    const fullPath = path.join(this.workspacePath, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return await fs.promises.readFile(fullPath, 'utf-8');
  }

  async listFiles(dirPath: string, options?: ListFilesOptions): Promise<FileEntry[]> {
    if (!this.alive || !this.containerId) {
      throw new Error('Sandbox has been destroyed or not started');
    }

    // List from host workspace
    const fullPath = path.join(this.workspacePath, dirPath);

    if (!fs.existsSync(fullPath)) {
      return [];
    }

    const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });

    const result: FileEntry[] = [];

    for (const entry of entries) {
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
    if (!this.alive || !this.containerId) {
      return;
    }

    try {
      // Stop and remove container
      const result = await this.execDockerCommand(['stop', this.containerId], {
        timeout: 10000,
      });

      if (result.exitCode !== 0) {
        logger.warn('[DockerSandbox] Failed to stop container gracefully', {
          sandboxId: this.id,
          containerId: this.containerId,
          stderr: result.stderr,
        });
      }

      this.alive = false;

      logger.info('[DockerSandbox] Container stopped', {
        sandboxId: this.id,
        containerId: this.containerId,
        execCount: this.execCount,
        totalDurationMs: this.totalDurationMs,
      });

      // Clean up workspace
      if (fs.existsSync(this.workspacePath)) {
        await fs.promises.rm(this.workspacePath, { recursive: true, force: true });
      }
    } catch (error) {
      logger.error('[DockerSandbox] Failed to destroy container', {
        sandboxId: this.id,
        containerId: this.containerId,
        error: String(error),
      });

      // Force remove if stop failed
      try {
        await this.execDockerCommand(['rm', '-f', this.containerId], { timeout: 5000 });
      } catch {
        // Ignore errors in force removal
      }

      this.alive = false;
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
 * Docker Sandbox Provider
 */
export class DockerSandboxProvider implements SandboxProvider {
  readonly type = 'docker' as const;
  private config: SandboxConfig;
  private sandboxes: Map<string, DockerSandbox> = new Map();
  private available: boolean | null = null;

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) {
      return this.available;
    }

    if (!this.config.docker.enabled) {
      this.available = false;
      return false;
    }

    try {
      // Check if docker command is available
      const result = await this.execDockerCommand(['--version'], { timeout: 5000 });

      if (result.exitCode === 0) {
        logger.info('[DockerSandboxProvider] Docker is available', {
          version: result.stdout.trim(),
        });
        this.available = true;
        return true;
      }

      this.available = false;
      return false;
    } catch (error) {
      logger.warn('[DockerSandboxProvider] Docker is not available', {
        error: String(error),
      });
      this.available = false;
      return false;
    }
  }

  async create(options?: SandboxCreateOptions): Promise<Sandbox> {
    if (!await this.isAvailable()) {
      throw new Error('Docker is not available. Please install Docker and ensure it is running.');
    }

    const id = `docker_${randomUUID()}`;
    const workspaceBase = path.resolve(this.config.workspaceBase);
    const workspacePath = path.join(workspaceBase, id);

    logger.info('[DockerSandboxProvider] Creating sandbox', {
      sandboxId: id,
      workspacePath,
      image: this.config.docker.image,
    });

    const sandbox = new DockerSandbox(
      id,
      workspacePath,
      this.config.docker,
      workspaceBase,
      options
    );

    // Start the container
    await sandbox.start(options);

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
    logger.info('[DockerSandboxProvider] Shutting down, destroying all sandboxes');

    const destroyPromises = Array.from(this.sandboxes.values()).map(sandbox =>
      sandbox.destroy().catch(error => {
        logger.error('[DockerSandboxProvider] Failed to destroy sandbox', {
          sandboxId: sandbox.id,
          error: String(error),
        });
      })
    );

    await Promise.all(destroyPromises);
    this.sandboxes.clear();
  }

  private async execDockerCommand(
    args: string[],
    options?: { timeout?: number; maxOutput?: number }
  ): Promise<ExecutionResult> {
    const timeout = options?.timeout || 30000;
    const maxOutput = options?.maxOutput || 1048576;

    const startTime = Date.now();

    const proc = Bun.spawn(['docker', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);

    try {
      const stdout = await this.readStream(proc.stdout, maxOutput);
      const stderr = await this.readStream(proc.stderr, maxOutput);

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

    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return new TextDecoder().decode(combined);
  }
}
