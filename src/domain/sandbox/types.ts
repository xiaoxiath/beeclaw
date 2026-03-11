/**
 * Sandbox System — Type Definitions
 *
 * Core interfaces for the sandbox abstraction layer.
 * Supports multiple isolation levels: local (Bun subprocess) → Docker → Remote (future).
 */

import { z } from 'zod';

// ─── Execution Result ────────────────────────────────────────────────────────

export interface ExecutionResult {
  /** Exit code (0 = success) */
  exitCode: number;
  /** Combined stdout output */
  stdout: string;
  /** Combined stderr output */
  stderr: string;
  /** Whether the execution was killed due to timeout */
  timedOut: boolean;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Whether the execution was killed due to OOM */
  oomKilled?: boolean;
}

// ─── Sandbox Interface ───────────────────────────────────────────────────────

export interface Sandbox {
  /** Unique sandbox identifier */
  readonly id: string;
  /** Sandbox provider type */
  readonly provider: SandboxProviderType;
  /** Whether the sandbox is currently active */
  readonly alive: boolean;

  /**
   * Execute a command inside the sandbox.
   * @param command - Shell command to execute
   * @param options - Execution options
   * @returns Execution result with stdout, stderr, exit code
   */
  exec(command: string, options?: ExecOptions): Promise<ExecutionResult>;

  /**
   * Write a file inside the sandbox.
   * @param path - Virtual path (relative to sandbox workspace)
   * @param content - File content (string or Buffer)
   */
  writeFile(path: string, content: string | Buffer): Promise<void>;

  /**
   * Read a file from the sandbox.
   * @param path - Virtual path (relative to sandbox workspace)
   * @returns File content as string
   */
  readFile(path: string): Promise<string>;

  /**
   * List files in a directory inside the sandbox.
   * @param path - Virtual path (relative to sandbox workspace)
   * @param options - List options
   * @returns Array of file/directory entries
   */
  listFiles(path: string, options?: ListFilesOptions): Promise<FileEntry[]>;

  /**
   * Destroy the sandbox, releasing all resources.
   */
  destroy(): Promise<void>;

  /**
   * Get sandbox metadata/stats.
   */
  getInfo(): SandboxInfo;
}

// ─── Sandbox Provider ────────────────────────────────────────────────────────

export type SandboxProviderType = 'local' | 'docker' | 'remote';

export interface SandboxProvider {
  /** Provider type identifier */
  readonly type: SandboxProviderType;

  /**
   * Create a new sandbox instance.
   * @param options - Sandbox creation options
   */
  create(options?: SandboxCreateOptions): Promise<Sandbox>;

  /**
   * Check if the provider is available and properly configured.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Shutdown the provider, cleaning up all resources.
   */
  shutdown(): Promise<void>;
}

// ─── Options & Config ────────────────────────────────────────────────────────

export interface ExecOptions {
  /** Working directory inside the sandbox (relative to workspace root) */
  cwd?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Environment variables to set */
  env?: Record<string, string>;
  /** Maximum output size in bytes (default: 1MB) */
  maxOutput?: number;
  /** Shell to use (default: 'bash') */
  shell?: string;
}

export interface ListFilesOptions {
  /** Include hidden files (dotfiles) */
  hidden?: boolean;
  /** Recursive listing */
  recursive?: boolean;
  /** Maximum depth for recursive listing */
  maxDepth?: number;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
  modifiedAt?: string;
}

export interface SandboxCreateOptions {
  /** Session ID for tracking */
  sessionId?: string;
  /** Custom workspace path to mount */
  workspacePath?: string;
  /** Memory limit in MB (Docker only) */
  memoryLimitMb?: number;
  /** CPU limit as fraction (Docker only, e.g., 0.5 = 50%) */
  cpuLimit?: number;
  /** Network access enabled (Docker only, default: false) */
  networkEnabled?: boolean;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Timeout for sandbox creation in ms */
  creationTimeout?: number;
}

export interface SandboxInfo {
  id: string;
  provider: SandboxProviderType;
  alive: boolean;
  createdAt: string;
  workspacePath: string;
  sessionId?: string;
  stats?: {
    execCount: number;
    totalDurationMs: number;
    lastExecAt?: string;
  };
}

// ─── Sandbox Configuration Schema ────────────────────────────────────────────

export const SandboxConfigSchema = z.object({
  /** Enable sandbox system */
  enabled: z.boolean().default(true),
  /** Default provider to use */
  provider: z.enum(['local', 'docker', 'auto']).default('auto'),
  /** Workspace base directory */
  workspaceBase: z.string().default('./data/sandbox'),

  /** Local provider config */
  local: z.object({
    /** Enable local provider */
    enabled: z.boolean().default(true),
    /** Default execution timeout (ms) */
    defaultTimeout: z.number().min(1000).max(300000).default(30000),
    /** Maximum output size (bytes) */
    maxOutputSize: z.number().min(1024).max(10485760).default(1048576), // 1MB
    /** Blocked commands (regex patterns) */
    blockedCommands: z.array(z.string()).default([
      'rm\\s+-rf\\s+/',
      'mkfs',
      'dd\\s+if=',
      ':(){ :|:& };:',   // fork bomb
      'chmod\\s+-R\\s+777\\s+/',
      'shutdown',
      'reboot',
      'halt',
      'init\\s+0',
    ]),
    /** Allowed commands (if set, only these are allowed) */
    allowedCommands: z.array(z.string()).optional(),
  }).default({}),

  /** Docker provider config */
  docker: z.object({
    /** Enable Docker provider */
    enabled: z.boolean().default(false),
    /** Docker image to use */
    image: z.string().default('beeclaw-sandbox:latest'),
    /** Memory limit in MB */
    memoryLimitMb: z.number().min(64).max(8192).default(512),
    /** CPU limit (fraction, e.g., 1.0 = 1 core) */
    cpuLimit: z.number().min(0.1).max(4).default(1),
    /** Enable network in containers */
    networkEnabled: z.boolean().default(false),
    /** Default execution timeout (ms) */
    defaultTimeout: z.number().min(1000).max(600000).default(60000),
    /** Maximum output size (bytes) */
    maxOutputSize: z.number().min(1024).max(10485760).default(2097152), // 2MB
    /** Container idle timeout before recycling (ms) */
    idleTimeout: z.number().min(30000).max(3600000).default(300000), // 5min
    /** Docker socket path */
    socketPath: z.string().optional(),
  }).default({}),

  /** Container pool config */
  pool: z.object({
    /** Enable container pool (pre-warm) */
    enabled: z.boolean().default(false),
    /** Minimum idle containers to keep warm */
    minIdle: z.number().min(0).max(10).default(1),
    /** Maximum total containers */
    maxTotal: z.number().min(1).max(20).default(5),
    /** How often to check pool health (ms) */
    healthCheckInterval: z.number().min(10000).max(300000).default(60000),
  }).default({}),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

// ─── Events ──────────────────────────────────────────────────────────────────

export type SandboxEvent =
  | { type: 'sandbox:created'; sandboxId: string; provider: SandboxProviderType }
  | { type: 'sandbox:destroyed'; sandboxId: string; provider: SandboxProviderType }
  | { type: 'sandbox:exec'; sandboxId: string; command: string; durationMs: number; exitCode: number }
  | { type: 'sandbox:timeout'; sandboxId: string; command: string }
  | { type: 'sandbox:error'; sandboxId: string; error: string }
  | { type: 'pool:scaled'; provider: SandboxProviderType; idle: number; total: number };

export type SandboxEventHandler = (event: SandboxEvent) => void;
