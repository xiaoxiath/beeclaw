/**
 * Sandbox Agent Tools
 *
 * Tool definitions and executors for the AI agent to interact with sandboxes.
 * Follows the same pattern as existing builtin tools in src/tools/builtin.ts.
 *
 * Tools:
 * - sandbox_exec:      Execute shell commands in sandbox
 * - sandbox_write_file: Write files to sandbox workspace
 * - sandbox_read_file:  Read files from sandbox workspace
 * - sandbox_list_files: List files in sandbox workspace
 * - sandbox_status:     Get sandbox status and stats
 */

import { z } from 'zod';
import { SandboxManager } from './manager';
// ─── Tool Result Type (matches BuiltinToolResult) ────────────────────────────

interface SandboxToolResult {
  success: boolean;
  data?: string;
  error?: string;
}

// ─── Default Session ID ──────────────────────────────────────────────────────

let currentSessionId = 'default';

/**
 * Set the current session ID for sandbox tools.
 * Called by the session/conversation system before tool execution.
 */
export function setCurrentSandboxSession(sessionId: string): void {
  currentSessionId = sessionId;
}

export function getCurrentSandboxSession(): string {
  return currentSessionId;
}

// ─── Tool Schemas ────────────────────────────────────────────────────────────

export const SandboxExecSchema = z.object({
  command: z.string().describe('The shell command to execute in the sandbox'),
  cwd: z.string().optional().describe('Working directory relative to sandbox workspace'),
  timeout: z.number().optional().describe('Execution timeout in milliseconds (default: 30000)'),
});

export const SandboxWriteFileSchema = z.object({
  path: z.string().describe('File path relative to sandbox workspace'),
  content: z.string().describe('File content to write'),
});

export const SandboxReadFileSchema = z.object({
  path: z.string().describe('File path relative to sandbox workspace'),
  maxLines: z.number().optional().describe('Maximum number of lines to read (default: all)'),
  startLine: z.number().optional().describe('Start reading from this line number (1-based)'),
});

export const SandboxListFilesSchema = z.object({
  path: z.string().default('.').describe('Directory path relative to sandbox workspace'),
  recursive: z.boolean().optional().describe('List files recursively (default: false)'),
  hidden: z.boolean().optional().describe('Include hidden files (default: false)'),
});

export const SandboxStatusSchema = z.object({});

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const sandboxExecTool = {
  name: 'sandbox_exec',
  description: 'Execute a shell command in an isolated sandbox environment. Use this for running code, installing packages, building projects, running tests, or any shell operation. The sandbox provides a safe workspace with file persistence across calls.',
  parameters: {
    type: 'object' as const,
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      cwd: { type: 'string', description: 'Working directory relative to workspace (optional)' },
      timeout: { type: 'number', description: 'Timeout in ms, default 30000 (optional)' },
    },
    required: ['command'],
  },
};

export const sandboxWriteFileTool = {
  name: 'sandbox_write_file',
  description: 'Write content to a file in the sandbox workspace. Creates parent directories automatically. Use this to create scripts, configuration files, or save generated code before execution.',
  parameters: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'File path relative to sandbox workspace' },
      content: { type: 'string', description: 'File content to write' },
    },
    required: ['path', 'content'],
  },
};

export const sandboxReadFileTool = {
  name: 'sandbox_read_file',
  description: 'Read the contents of a file from the sandbox workspace. Supports reading specific line ranges for large files.',
  parameters: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'File path relative to sandbox workspace' },
      maxLines: { type: 'number', description: 'Maximum lines to read (optional, default: all)' },
      startLine: { type: 'number', description: 'Start from line N, 1-based (optional)' },
    },
    required: ['path'],
  },
};

export const sandboxListFilesTool = {
  name: 'sandbox_list_files',
  description: 'List files and directories in the sandbox workspace. Useful for exploring project structure.',
  parameters: {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Directory path relative to workspace (default: ".")' },
      recursive: { type: 'boolean', description: 'List recursively (default: false)' },
      hidden: { type: 'boolean', description: 'Include hidden files (default: false)' },
    },
    required: [],
  },
};

export const sandboxStatusTool = {
  name: 'sandbox_status',
  description: 'Get the current sandbox status including provider type, execution stats, and workspace information.',
  parameters: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

// ─── Tool Executors ──────────────────────────────────────────────────────────

async function ensureSandbox() {
  const manager = SandboxManager.getInstance();
  return manager.acquire({ sessionId: currentSessionId });
}

export async function executeSandboxExec(params: Record<string, unknown>): Promise<SandboxToolResult> {
  try {
    const parsed = SandboxExecSchema.parse(params);
    const { sandbox, pathMapper } = await ensureSandbox();

    // Rewrite virtual paths in command to real host paths
    const rewrittenCommand = pathMapper.rewriteCommand(parsed.command);

    const result = await sandbox.exec(rewrittenCommand, {
      cwd: parsed.cwd,
      timeout: parsed.timeout,
    });

    // Sanitize output (replace real paths with virtual paths)
    const sanitizedStdout = pathMapper.sanitizeOutput(result.stdout);
    const sanitizedStderr = pathMapper.sanitizeOutput(result.stderr);

    let output = '';
    if (sanitizedStdout) output += sanitizedStdout;
    if (sanitizedStderr) output += (output ? '\n' : '') + `[stderr] ${sanitizedStderr}`;

    if (result.timedOut) {
      output += '\n⚠️ Command timed out and was killed';
    }

    if (result.oomKilled) {
      output += '\n⚠️ Command was killed due to memory limit';
    }

    output += `\n[exit code: ${result.exitCode}] [${result.durationMs}ms]`;

    return {
      success: result.exitCode === 0,
      data: output || '(no output)',
      error: result.exitCode !== 0 ? `Command exited with code ${result.exitCode}` : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: `Sandbox exec error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function executeSandboxWriteFile(params: Record<string, unknown>): Promise<SandboxToolResult> {
  try {
    const parsed = SandboxWriteFileSchema.parse(params);
    const { sandbox, pathMapper } = await ensureSandbox();

    await sandbox.writeFile(parsed.path, parsed.content);

    const virtualPath = `${pathMapper.getVirtualWorkspace()}/${parsed.path}`;
    const bytes = Buffer.byteLength(parsed.content, 'utf-8');

    return {
      success: true,
      data: `File written: ${virtualPath} (${bytes} bytes)`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Write file error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function executeSandboxReadFile(params: Record<string, unknown>): Promise<SandboxToolResult> {
  try {
    const parsed = SandboxReadFileSchema.parse(params);
    const { sandbox, _pathMapper } = await ensureSandbox();

    let content = await sandbox.readFile(parsed.path);

    // Handle line range
    if (parsed.startLine || parsed.maxLines) {
      const lines = content.split('\n');
      const start = Math.max(0, (parsed.startLine || 1) - 1);
      const end = parsed.maxLines ? start + parsed.maxLines : lines.length;
      const selectedLines = lines.slice(start, end);

      content = selectedLines.join('\n');

      if (end < lines.length) {
        content += `\n... (${lines.length - end} more lines)`;
      }

      if (start > 0) {
        content = `[starting from line ${start + 1}]\n` + content;
      }
    }

    return {
      success: true,
      data: content,
    };
  } catch (error) {
    return {
      success: false,
      error: `Read file error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function executeSandboxListFiles(params: Record<string, unknown>): Promise<SandboxToolResult> {
  try {
    const parsed = SandboxListFilesSchema.parse(params);
    const { sandbox, _pathMapper } = await ensureSandbox();

    const entries = await sandbox.listFiles(parsed.path || '.', {
      recursive: parsed.recursive,
      hidden: parsed.hidden,
    });

    if (entries.length === 0) {
      return {
        success: true,
        data: '(empty directory)',
      };
    }

    // Format as tree-like output
    const lines = entries.map(entry => {
      const icon = entry.type === 'directory' ? '📁' : '📄';
      const size = entry.size !== undefined ? ` (${formatSize(entry.size)})` : '';
      return `${icon} ${entry.path}${size}`;
    });

    return {
      success: true,
      data: lines.join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      error: `List files error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function executeSandboxStatus(_params: Record<string, unknown>): Promise<SandboxToolResult> {
  try {
    const manager = SandboxManager.getInstance();
    const stats = manager.getStats();
    const session = manager.getBySession(currentSessionId);

    const info: string[] = [
      `Sandbox System Status:`,
      `  Providers: ${stats.providers.join(', ') || 'none'}`,
      `  Active sandboxes: ${stats.activeSandboxes}`,
      `  Active sessions: ${stats.activeSessions}`,
    ];

    if (session) {
      const sbInfo = session.sandbox.getInfo();
      info.push('');
      info.push(`Current Sandbox:`);
      info.push(`  ID: ${sbInfo.id}`);
      info.push(`  Provider: ${sbInfo.provider}`);
      info.push(`  Alive: ${sbInfo.alive}`);
      info.push(`  Workspace: ${session.pathMapper.getVirtualWorkspace()}`);
      if (sbInfo.stats) {
        info.push(`  Exec count: ${sbInfo.stats.execCount}`);
        info.push(`  Total exec time: ${sbInfo.stats.totalDurationMs}ms`);
      }
    } else {
      info.push('');
      info.push('No sandbox assigned to current session (will be created on first use)');
    }

    return {
      success: true,
      data: info.join('\n'),
    };
  } catch (error) {
    return {
      success: false,
      error: `Status error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ─── Tool Registration (for integration with builtin tools system) ───────────

/**
 * All sandbox tool definitions, keyed by tool name.
 */
export const sandboxTools: Record<string, { name: string; description: string; parameters: any }> = {
  sandbox_exec: sandboxExecTool,
  sandbox_write_file: sandboxWriteFileTool,
  sandbox_read_file: sandboxReadFileTool,
  sandbox_list_files: sandboxListFilesTool,
  sandbox_status: sandboxStatusTool,
};

/**
 * Execute a sandbox tool by name.
 */
export async function executeSandboxTool(
  toolName: string,
  params: Record<string, unknown>,
): Promise<SandboxToolResult> {
  switch (toolName) {
    case 'sandbox_exec':
      return executeSandboxExec(params);
    case 'sandbox_write_file':
      return executeSandboxWriteFile(params);
    case 'sandbox_read_file':
      return executeSandboxReadFile(params);
    case 'sandbox_list_files':
      return executeSandboxListFiles(params);
    case 'sandbox_status':
      return executeSandboxStatus(params);
    default:
      return { success: false, error: `Unknown sandbox tool: ${toolName}` };
  }
}

/**
 * Get all sandbox tools in OpenAI function calling format.
 */
export function getSandboxToolsForAI(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: any };
}> {
  return Object.values(sandboxTools).map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * All sandbox tool names.
 */
export const sandboxToolNames = Object.keys(sandboxTools);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}
