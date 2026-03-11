/**
 * Local Sandbox Provider — Bun Subprocess Isolation
 *
 * Provides lightweight sandbox using Bun.spawn() with:
 * - Process-level isolation (separate child process)
 * - Command safety checks (blocklist/allowlist)
 * - Output size limits and timeout enforcement
 * - Virtual path mapping (no real paths exposed to AI)
 *
 * This is the default/fallback provider — always available on Bun runtime.
 */

import { spawn } from 'bun';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { rm } from 'fs/promises';
import { join, resolve, relative } from 'path';
import { logger } from '../../utils/logger';
import type {
  Sandbox,
  SandboxProvider,
  SandboxProviderType,
  SandboxConfig,
  SandboxCreateOptions,
  ExecutionResult,
  ExecOptions,
  ListFilesOptions,
  FileEntry,
  SandboxInfo,
} from '../types';

export class LocalSandboxProvider implements SandboxProvider {
  readonly type: SandboxProviderType = 'local';
  private config: SandboxConfig;
  private sandboxes = new Map<string, LocalSandbox>();

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  async create(options?: SandboxCreateOptions): Promise<Sandbox> {
    const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const workspacePath = options?.workspacePath || join(resolve(this.config.workspaceBase), id);

    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }

    const sandbox = new LocalSandbox(id, workspacePath, this.config, options?.sessionId);
    this.sandboxes.set(id, sandbox);

    logger.debug(`[LocalProvider] Created sandbox ${id} at ${workspacePath}`);
    return sandbox;
  }

  async isAvailable(): Promise<boolean> {
    // Local provider is always available on Bun
    return typeof Bun !== 'undefined';
  }

  async shutdown(): Promise<void> {
    const destroyPromises = Array.from(this.sandboxes.values()).map(sb =>
      sb.destroy().catch(e => logger.error(`[LocalProvider] Error destroying ${sb.id}:`, e))
    );
    await Promise.allSettled(destroyPromises);
    this.sandboxes.clear();
  }
}

class LocalSandbox implements Sandbox {
  readonly id: string;
  readonly provider: SandboxProviderType = 'local';
  private _alive = true;
  private readonly workspacePath: string;
  private readonly config: SandboxConfig;
  private readonly sessionId?: string;
  private readonly createdAt: string;
  private execCount = 0;
  private totalDurationMs = 0;
  private lastExecAt?: string;

  // Compiled blocklist patterns
  private readonly blockedPatterns: RegExp[];

  constructor(id: string, workspacePath: string, config: SandboxConfig, sessionId?: string) {
    this.id = id;
    this.workspacePath = workspacePath;
    this.config = config;
    this.sessionId = sessionId;
    this.createdAt = new Date().toISOString();

    // Compile blocked command patterns
    this.blockedPatterns = (config.local.blockedCommands || []).map(pattern => {
      try {
        return new RegExp(pattern, 'i');
      } catch {
        logger.warn(`[LocalSandbox] Invalid blocked pattern: ${pattern}`);
        return null;
      }
    }).filter((p): p is RegExp => p !== null);
  }

  get alive(): boolean {
    return this._alive;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecutionResult> {
    this.assertAlive();

    const timeout = options?.timeout || this.config.local.defaultTimeout;
    const maxOutput = options?.maxOutput || this.config.local.maxOutputSize;
    const cwd = options?.cwd ? join(this.workspacePath, options.cwd) : this.workspacePath;

    // Safety check
    if (!this.isCommandSafe(command)) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `[Sandbox] Command blocked by security policy: ${command.slice(0, 100)}`,
        timedOut: false,
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    let timedOut = false;

    try {
      const proc = spawn({
        cmd: ['bash', '-c', command],
        cwd,
        env: {
          ...process.env,
          HOME: this.workspacePath,
          SANDBOX: 'true',
          SANDBOX_ID: this.id,
          ...(options?.env || {}),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill('SIGKILL');
        } catch {}
      }, timeout);

      // Collect output with size limits
      let stdout = '';
      let stderr = '';

      try {
        const stdoutText = await new Response(proc.stdout).text();
        stdout = stdoutText.length > maxOutput
          ? stdoutText.slice(0, maxOutput) + `\n... [output truncated at ${maxOutput} bytes]`
          : stdoutText;
      } catch {}

      try {
        const stderrText = await new Response(proc.stderr).text();
        stderr = stderrText.length > maxOutput
          ? stderrText.slice(0, maxOutput) + `\n... [output truncated at ${maxOutput} bytes]`
          : stderrText;
      } catch {}

      const exitCode = await proc.exited;
      clearTimeout(timeoutId);

      const durationMs = Date.now() - startTime;

      // Update stats
      this.execCount++;
      this.totalDurationMs += durationMs;
      this.lastExecAt = new Date().toISOString();

      return {
        exitCode: timedOut ? 137 : exitCode,
        stdout,
        stderr: timedOut ? stderr + '\n[Sandbox] Process killed: execution timeout' : stderr,
        timedOut,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      return {
        exitCode: 1,
        stdout: '',
        stderr: `[Sandbox] Execution error: ${error instanceof Error ? error.message : String(error)}`,
        timedOut,
        durationMs,
      };
    }
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    this.assertAlive();

    const fullPath = this.resolveSafePath(path);
    const dir = join(fullPath, '..');

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, content);
  }

  async readFile(path: string): Promise<string> {
    this.assertAlive();

    const fullPath = this.resolveSafePath(path);

    if (!existsSync(fullPath)) {
      throw new Error(`File not found: ${path}`);
    }

    return readFileSync(fullPath, 'utf-8');
  }

  async listFiles(path: string, options?: ListFilesOptions): Promise<FileEntry[]> {
    this.assertAlive();

    const fullPath = this.resolveSafePath(path);

    if (!existsSync(fullPath)) {
      throw new Error(`Directory not found: ${path}`);
    }

    return this.listDir(fullPath, path, options?.hidden ?? false, options?.recursive ?? false, options?.maxDepth ?? 3, 0);
  }

  async destroy(): Promise<void> {
    this._alive = false;

    // Optionally clean up workspace (not removing by default for data preservation)
    logger.debug(`[LocalSandbox] Destroyed sandbox ${this.id}`);
  }

  getInfo(): SandboxInfo {
    return {
      id: this.id,
      provider: this.provider,
      alive: this._alive,
      createdAt: this.createdAt,
      workspacePath: this.workspacePath,
      sessionId: this.sessionId,
      stats: {
        execCount: this.execCount,
        totalDurationMs: this.totalDurationMs,
        lastExecAt: this.lastExecAt,
      },
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private assertAlive(): void {
    if (!this._alive) {
      throw new Error(`Sandbox ${this.id} has been destroyed`);
    }
  }

  /**
   * Resolve a relative path safely within the workspace.
   */
  private resolveSafePath(inputPath: string): string {
    const resolved = resolve(this.workspacePath, inputPath.replace(/^\/+/, ''));

    if (!resolved.startsWith(this.workspacePath)) {
      throw new Error(`Path traversal detected: "${inputPath}" escapes sandbox workspace`);
    }

    return resolved;
  }

  /**
   * Check if a command is safe to execute.
   */
  private isCommandSafe(command: string): boolean {
    // Check against blocked patterns
    for (const pattern of this.blockedPatterns) {
      if (pattern.test(command)) {
        logger.warn(`[LocalSandbox] Blocked command: ${command.slice(0, 100)}`);
        return false;
      }
    }

    // If allowlist is configured, check against it
    const allowed = this.config.local.allowedCommands;
    if (allowed && allowed.length > 0) {
      const isAllowed = allowed.some(pattern => {
        try {
          return new RegExp(pattern, 'i').test(command);
        } catch {
          return false;
        }
      });
      if (!isAllowed) {
        logger.warn(`[LocalSandbox] Command not in allowlist: ${command.slice(0, 100)}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Recursively list directory contents.
   */
  private listDir(
    fullPath: string,
    virtualPath: string,
    hidden: boolean,
    recursive: boolean,
    maxDepth: number,
    currentDepth: number,
  ): FileEntry[] {
    const entries: FileEntry[] = [];

    try {
      const items = readdirSync(fullPath, { withFileTypes: true });

      for (const item of items) {
        // Skip hidden files unless requested
        if (!hidden && item.name.startsWith('.')) continue;

        const itemFullPath = join(fullPath, item.name);
        const itemVirtualPath = join(virtualPath, item.name).replace(/\\/g, '/');

        let type: 'file' | 'directory' | 'symlink' = 'file';
        if (item.isDirectory()) type = 'directory';
        else if (item.isSymbolicLink()) type = 'symlink';

        try {
          const stat = statSync(itemFullPath);
          entries.push({
            name: item.name,
            path: itemVirtualPath,
            type,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        } catch {
          entries.push({
            name: item.name,
            path: itemVirtualPath,
            type,
          });
        }

        // Recurse into directories
        if (recursive && type === 'directory' && currentDepth < maxDepth) {
          entries.push(...this.listDir(itemFullPath, itemVirtualPath, hidden, recursive, maxDepth, currentDepth + 1));
        }
      }
    } catch (error) {
      logger.debug(`[LocalSandbox] Error listing ${fullPath}:`, error);
    }

    return entries;
  }
}
