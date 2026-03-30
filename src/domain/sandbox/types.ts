/**
 * Sandbox System — Type Definitions
 *
 * Core interfaces for the sandbox abstraction layer.
 * Supports multiple isolation levels: local (Bun subprocess) → Docker → Remote (future).
 */

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
// Re-exported from shared types to avoid layering violations (infra ↛ domain).
// Canonical definition lives in src/types/sandbox-config.ts.
export { SandboxConfigSchema, type SandboxConfig } from '../../types/sandbox-config';

// ─── Events ──────────────────────────────────────────────────────────────────

export type SandboxEvent =
  | { type: 'sandbox:created'; sandboxId: string; provider: SandboxProviderType }
  | { type: 'sandbox:destroyed'; sandboxId: string; provider: SandboxProviderType }
  | { type: 'sandbox:exec'; sandboxId: string; command: string; durationMs: number; exitCode: number }
  | { type: 'sandbox:timeout'; sandboxId: string; command: string }
  | { type: 'sandbox:error'; sandboxId: string; error: string }
  | { type: 'pool:scaled'; provider: SandboxProviderType; idle: number; total: number };

export type SandboxEventHandler = (event: SandboxEvent) => void;
