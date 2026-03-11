/**
 * Docker Sandbox Provider — Container-based Isolation
 *
 * Provides strong isolation using Docker containers with:
 * - Full filesystem isolation (bind mount workspace only)
 * - Resource limits (memory, CPU)
 * - Network isolation (disabled by default)
 * - Container lifecycle management
 *
 * Requires Docker daemon running and `dockerode` npm package.
 * Falls back to local provider if Docker is unavailable.
 */

import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
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

// Lazy-import dockerode to avoid hard dependency
let Docker: any = null;

async function getDockerModule(): Promise<any> {
  if (Docker) return Docker;
  try {
    const mod = await import('dockerode');
    Docker = mod.default || mod;
    return Docker;
  } catch (error) {
    throw new Error('Docker provider requires "dockerode" package. Install with: bun add dockerode');
  }
}

export class DockerSandboxProvider implements SandboxProvider {
  readonly type: SandboxProviderType = 'docker';
  private config: SandboxConfig;
  private docker: any = null;
  private sandboxes = new Map<string, DockerSandbox>();

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  async create(options?: SandboxCreateOptions): Promise<Sandbox> {
    if (!this.docker) {
      const DockerCtor = await getDockerModule();
      this.docker = new DockerCtor({
        socketPath: this.config.docker.socketPath || '/var/run/docker.sock',
      });
    }

    const id = `docker_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const workspacePath = options?.workspacePath || join(resolve(this.config.workspaceBase), id);

    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }

    // Create container
    const memoryLimit = (options?.memoryLimitMb || this.config.docker.memoryLimitMb) * 1024 * 1024;
    const cpuLimit = options?.cpuLimit || this.config.docker.cpuLimit;
    const networkEnabled = options?.networkEnabled ?? this.config.docker.networkEnabled;

    const container = await this.docker.createContainer({
      Image: this.config.docker.image,
      Cmd: ['sleep', 'infinity'], // Keep container running
      WorkingDir: '/workspace',
      Env: [
        'SANDBOX=true',
        `SANDBOX_ID=${id}`,
        ...(options?.env ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`) : []),
      ],
      HostConfig: {
        Binds: [`${workspacePath}:/workspace:rw`],
        Memory: memoryLimit,
        NanoCpus: Math.floor(cpuLimit * 1e9), // CPU limit in nano CPUs
        NetworkMode: networkEnabled ? 'bridge' : 'none',
        PidsLimit: 256, // Prevent fork bombs
        ReadonlyRootfs: false,
        SecurityOpt: ['no-new-privileges'],
        // Drop all capabilities, add back only what's needed
        CapDrop: ['ALL'],
        CapAdd: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID'],
      },
      // Don't auto-remove — we manage lifecycle
      Labels: {
        'beeclaw.sandbox': 'true',
        'beeclaw.sandbox.id': id,
        'beeclaw.session.id': options?.sessionId || '',
      },
    });

    await container.start();

    const sandbox = new DockerSandbox(
      id,
      container,
      workspacePath,
      this.config,
      this.docker,
      options?.sessionId,
    );
    this.sandboxes.set(id, sandbox);

    logger.debug(`[DockerProvider] Created sandbox ${id} (container: ${container.id?.slice(0, 12)})`);
    return sandbox;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const DockerCtor = await getDockerModule();
      const docker = new DockerCtor({
        socketPath: this.config.docker.socketPath || '/var/run/docker.sock',
      });
      await docker.ping();
      this.docker = docker;
      return true;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    const destroyPromises = Array.from(this.sandboxes.values()).map(sb =>
      sb.destroy().catch(e => logger.error(`[DockerProvider] Error destroying ${sb.id}:`, e))
    );
    await Promise.allSettled(destroyPromises);
    this.sandboxes.clear();
  }
}

class DockerSandbox implements Sandbox {
  readonly id: string;
  readonly provider: SandboxProviderType = 'docker';
  private _alive = true;
  private container: any;
  private readonly workspacePath: string;
  private readonly config: SandboxConfig;
  private readonly docker: any;
  private readonly sessionId?: string;
  private readonly createdAt: string;
  private execCount = 0;
  private totalDurationMs = 0;
  private lastExecAt?: string;

  constructor(
    id: string,
    container: any,
    workspacePath: string,
    config: SandboxConfig,
    docker: any,
    sessionId?: string,
  ) {
    this.id = id;
    this.container = container;
    this.workspacePath = workspacePath;
    this.config = config;
    this.docker = docker;
    this.sessionId = sessionId;
    this.createdAt = new Date().toISOString();
  }

  get alive(): boolean {
    return this._alive;
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecutionResult> {
    this.assertAlive();

    const timeout = options?.timeout || this.config.docker.defaultTimeout;
    const maxOutput = options?.maxOutput || this.config.docker.maxOutputSize;
    const cwd = options?.cwd ? `/workspace/${options.cwd}` : '/workspace';

    const startTime = Date.now();
    let timedOut = false;

    try {
      // Create exec instance
      const exec = await this.container.exec({
        Cmd: ['bash', '-c', `cd ${cwd} && ${command}`],
        AttachStdout: true,
        AttachStderr: true,
        Env: options?.env ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`) : undefined,
      });

      // Start exec with timeout
      const stream = await exec.start({ hijack: true, stdin: false });

      // Collect output
      const output = await this.collectOutput(stream, maxOutput, timeout);
      timedOut = output.timedOut;

      // Get exit code
      const inspectResult = await exec.inspect();
      const exitCode = inspectResult.ExitCode ?? (timedOut ? 137 : 1);
      const durationMs = Date.now() - startTime;

      // Check for OOM kill
      let oomKilled = false;
      try {
        const containerInfo = await this.container.inspect();
        oomKilled = containerInfo.State?.OOMKilled ?? false;
      } catch {}

      // Update stats
      this.execCount++;
      this.totalDurationMs += durationMs;
      this.lastExecAt = new Date().toISOString();

      return {
        exitCode,
        stdout: output.stdout,
        stderr: timedOut ? output.stderr + '\n[Sandbox] Process killed: execution timeout' : output.stderr,
        timedOut,
        durationMs,
        oomKilled,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      return {
        exitCode: 1,
        stdout: '',
        stderr: `[Sandbox] Docker exec error: ${error instanceof Error ? error.message : String(error)}`,
        timedOut: false,
        durationMs,
      };
    }
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    this.assertAlive();
    // Write directly to host-mounted workspace
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
    if (!this._alive) return;
    this._alive = false;

    try {
      // Stop and remove container
      try {
        await this.container.stop({ t: 5 });
      } catch {
        // Container might already be stopped
      }
      await this.container.remove({ force: true });
      logger.debug(`[DockerSandbox] Destroyed container for sandbox ${this.id}`);
    } catch (error) {
      logger.error(`[DockerSandbox] Error destroying container for ${this.id}:`, error);
    }
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

  private resolveSafePath(inputPath: string): string {
    const resolved = resolve(this.workspacePath, inputPath.replace(/^\/+/, ''));
    if (!resolved.startsWith(this.workspacePath)) {
      throw new Error(`Path traversal detected: "${inputPath}" escapes sandbox workspace`);
    }
    return resolved;
  }

  /**
   * Collect output from Docker exec stream with size limits and timeout.
   */
  private collectOutput(
    stream: any,
    maxOutput: number,
    timeout: number,
  ): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        try {
          stream.destroy();
        } catch {}
        resolve({ stdout, stderr, timedOut });
      }, timeout);

      // Docker multiplexed stream: header (8 bytes) + payload
      const chunks: Buffer[] = [];

      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      stream.on('end', () => {
        clearTimeout(timeoutId);
        if (timedOut) return;

        const combined = Buffer.concat(chunks);
        // Demultiplex Docker stream
        let offset = 0;
        while (offset < combined.length) {
          if (offset + 8 > combined.length) break;

          const streamType = combined[offset]; // 1=stdout, 2=stderr
          const size = combined.readUInt32BE(offset + 4);
          offset += 8;

          if (offset + size > combined.length) break;

          const payload = combined.slice(offset, offset + size).toString('utf-8');
          offset += size;

          if (streamType === 1) {
            stdout += payload;
          } else if (streamType === 2) {
            stderr += payload;
          }
        }

        // Truncate if necessary
        if (stdout.length > maxOutput) {
          stdout = stdout.slice(0, maxOutput) + `\n... [output truncated at ${maxOutput} bytes]`;
        }
        if (stderr.length > maxOutput) {
          stderr = stderr.slice(0, maxOutput) + `\n... [output truncated at ${maxOutput} bytes]`;
        }

        resolve({ stdout, stderr, timedOut: false });
      });

      stream.on('error', () => {
        clearTimeout(timeoutId);
        resolve({ stdout, stderr, timedOut: false });
      });
    });
  }

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
          entries.push({ name: item.name, path: itemVirtualPath, type });
        }

        if (recursive && type === 'directory' && currentDepth < maxDepth) {
          entries.push(...this.listDir(itemFullPath, itemVirtualPath, hidden, recursive, maxDepth, currentDepth + 1));
        }
      }
    } catch (error) {
      logger.debug(`[DockerSandbox] Error listing ${fullPath}:`, error);
    }

    return entries;
  }
}
