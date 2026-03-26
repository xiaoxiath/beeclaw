/**
 * File System & Shell Tools — File Read/Write/List/Delete + Shell
 *
 * Extracted from builtin.ts for modular organization.
 */

import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname, basename, sep } from 'path';
import { parse as parseShell } from 'shell-quote';
import { logger } from '../../infra/observability/logger';
import type { BuiltinToolResult } from './builtin';

// ============================================================================
// File System Helpers
// ============================================================================

// Allowed base directories for file operations (security restriction)
const ALLOWED_BASE_DIRS = [
  process.cwd(),
  join(process.cwd(), 'data'),
  join(process.cwd(), 'output'),
  join(process.cwd(), 'reports'),
  join(process.cwd(), 'temp'),
];

// Ensure output directories exist
export function ensureOutputDirs(): void {
  for (const dir of ['output', 'reports', 'temp']) {
    const fullPath = join(process.cwd(), dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
    }
  }
}

// Check if path is within allowed directories
export function isPathAllowed(filePath: string): boolean {
  const resolved = resolve(filePath);
  return ALLOWED_BASE_DIRS.some(base => {
    const resolvedBase = resolve(base);
    return resolved === resolvedBase || resolved.startsWith(resolvedBase + sep);
  });
}

// ============================================================================
// File Read Tool
// ============================================================================

export const FileReadSchema = z.object({
  path: z.string().describe('File path to read (relative to project root or absolute)'),
  encoding: z.enum(['utf-8', 'base64', 'json']).optional().default('utf-8').describe('File encoding'),
  max_length: z.number().min(100).max(100000).optional().default(50000).describe('Maximum content length'),
});

export const fileReadTool = {
  name: 'file_read',
  description: 'Read content from a local file. Supports text files, JSON, and base64 encoding for binary files. Restricted to project directory and output folders.',
  parameters: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File path to read (relative to project root)',
      },
      encoding: {
        type: 'string',
        enum: ['utf-8', 'base64', 'json'],
        description: 'File encoding (default: utf-8)',
      },
      max_length: {
        type: 'number',
        description: 'Maximum content length (default: 50000)',
      },
    },
    required: ['path'],
  },
};

export async function executeFileRead(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = FileReadSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { path: filePath, encoding, max_length } = parsed.data;

  try {
    const resolvedPath = resolve(filePath);

    // Security check
    if (!isPathAllowed(resolvedPath)) {
      return {
        success: false,
        error: `Access denied: path outside allowed directories. Allowed: project root, data/, output/, reports/, temp/`
      };
    }

    if (!existsSync(resolvedPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const stats = statSync(resolvedPath);
    if (stats.isDirectory()) {
      // List directory contents
      const files = readdirSync(resolvedPath);
      const fileList = files.map(f => {
        const fp = join(resolvedPath, f);
        const s = statSync(fp);
        return `${s.isDirectory() ? 'd' : 'f'} ${f}`;
      }).join('\n');
      return { success: true, data: `Directory: ${filePath}\n${fileList}` };
    }

    // Read file
    if (encoding === 'json') {
      const content = readFileSync(resolvedPath, 'utf-8');
      const json = JSON.parse(content);
      const formatted = JSON.stringify(json, null, 2);
      return {
        success: true,
        data: formatted.slice(0, max_length) + (formatted.length > max_length ? '\n... (truncated)' : '')
      };
    } else if (encoding === 'base64') {
      const buffer = readFileSync(resolvedPath);
      const base64 = buffer.toString('base64');
      return {
        success: true,
        data: base64.slice(0, max_length) + (base64.length > max_length ? '... (truncated)' : '')
      };
    } else {
      const content = readFileSync(resolvedPath, 'utf-8');
      return {
        success: true,
        data: content.slice(0, max_length) + (content.length > max_length ? '\n... (truncated)' : '')
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `File read error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// File Write Tool
// ============================================================================

export const FileWriteSchema = z.object({
  path: z.string().describe('File path to write (relative to project root)'),
  content: z.string().describe('Content to write to the file'),
  mode: z.enum(['write', 'append']).optional().default('write').describe('Write mode: write (overwrite) or append'),
  create_dirs: z.boolean().optional().default(true).describe('Create parent directories if they don\'t exist'),
});

export const fileWriteTool = {
  name: 'file_write',
  description: 'Write content to a local file. Can create new files or append to existing ones. Best for generating reports, saving research results, creating HTML/Markdown files. Restricted to output/, reports/, temp/, and data/ directories.',
  parameters: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File path to write (will be saved to output/ if not in allowed dir)',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
      mode: {
        type: 'string',
        enum: ['write', 'append'],
        description: 'Write mode (default: write)',
      },
      create_dirs: {
        type: 'boolean',
        description: 'Create parent directories (default: true)',
      },
    },
    required: ['path', 'content'],
  },
};

export async function executeFileWrite(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = FileWriteSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { path: filePath, content, mode, create_dirs } = parsed.data;

  try {
    // Ensure output directories exist
    ensureOutputDirs();

    let resolvedPath = resolve(filePath);

    // If path is not in allowed directories, redirect to output/
    if (!isPathAllowed(resolvedPath)) {
      // Extract just the filename and put in output/
      const filename = basename(filePath);
      resolvedPath = resolve(join('output', filename));
    }

    // Create parent directories if needed
    if (create_dirs) {
      const parentDir = dirname(resolvedPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
    }

    // Write or append
    const writeContent = mode === 'append' && existsSync(resolvedPath)
      ? readFileSync(resolvedPath, 'utf-8') + '\n' + content
      : content;

    writeFileSync(resolvedPath, writeContent, 'utf-8');

    const relativePath = resolvedPath.replace(resolve('.'), '.');
    const size = writeContent.length;

    return {
      success: true,
      data: `File saved successfully:\n  Path: ${relativePath}\n  Size: ${size} bytes\n  Mode: ${mode}`
    };
  } catch (error) {
    return {
      success: false,
      error: `File write error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// File List Tool
// ============================================================================

export const FileListSchema = z.object({
  path: z.string().optional().default('.').describe('Directory path to list'),
  recursive: z.boolean().optional().default(false).describe('List recursively'),
  pattern: z.string().optional().describe('File pattern to filter (e.g., "*.md", "*.html")'),
});

export const fileListTool = {
  name: 'file_list',
  description: 'List files in a directory. Useful for finding generated reports or exploring project structure.',
  parameters: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list (default: current directory)',
      },
      recursive: {
        type: 'boolean',
        description: 'List recursively (default: false)',
      },
      pattern: {
        type: 'string',
        description: 'File pattern to filter (e.g., "*.md")',
      },
    },
    required: [],
  },
};

function listDirectory(dirPath: string, recursive: boolean, pattern?: string, prefix: string = ''): string[] {
  const results: string[] = [];

  if (!existsSync(dirPath)) {
    return [`Directory not found: ${dirPath}`];
  }

  const files = readdirSync(dirPath);

  for (const file of files) {
    // Skip hidden files and node_modules
    if (file.startsWith('.') || file === 'node_modules') continue;

    const fullPath = join(dirPath, file);
    const stats = statSync(fullPath);
    const relativePath = prefix + file;

    if (stats.isDirectory()) {
      results.push(`📁 ${relativePath}/`);
      if (recursive) {
        results.push(...listDirectory(fullPath, true, pattern, relativePath + '/'));
      }
    } else {
      // Apply pattern filter
      if (pattern) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        if (!regex.test(file)) continue;
      }
      const size = stats.size;
      const sizeStr = size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` :
                      size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
      results.push(`📄 ${relativePath} (${sizeStr})`);
    }
  }

  return results;
}

export async function executeFileList(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = FileListSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { path: dirPath, recursive, pattern } = parsed.data;

  try {
    const resolvedPath = resolve(dirPath);

    // Security check
    if (!isPathAllowed(resolvedPath)) {
      return {
        success: false,
        error: `Access denied: path outside allowed directories`
      };
    }

    const results = listDirectory(resolvedPath, recursive, pattern);

    if (results.length === 0) {
      return { success: true, data: `No files found in ${dirPath}${pattern ? ` matching ${pattern}` : ''}` };
    }

    return {
      success: true,
      data: `Files in ${dirPath}:\n\n${results.join('\n')}`
    };
  } catch (error) {
    return {
      success: false,
      error: `File list error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// File Delete Tool
// ============================================================================

export const FileDeleteSchema = z.object({
  path: z.string().describe('File path to delete'),
});

export const fileDeleteTool = {
  name: 'file_delete',
  description: 'Delete a file. For safety, only works in output/, reports/, and temp/ directories.',
  parameters: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File path to delete',
      },
    },
    required: ['path'],
  },
};

export async function executeFileDelete(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = FileDeleteSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { path: filePath } = parsed.data;

  try {
    const resolvedPath = resolve(filePath);

    // Only allow deletion in safe directories
    const safeDirs = ['output', 'reports', 'temp'];
    const isInSafeDir = safeDirs.some(dir => resolvedPath.startsWith(resolve(dir)));

    if (!isInSafeDir) {
      return {
        success: false,
        error: `For safety, file_delete only works in: ${safeDirs.join(', ')}`
      };
    }

    if (!existsSync(resolvedPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    unlinkSync(resolvedPath);

    return {
      success: true,
      data: `File deleted: ${filePath}`
    };
  } catch (error) {
    return {
      success: false,
      error: `File delete error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Safe Shell Tool
// ============================================================================

// Dangerous commands that should never be allowed
const BLOCKED_COMMANDS = [
  // System destruction
  'rm -rf /', 'mkfs', 'dd if=', 'fdisk', 'format',
  // Privilege escalation
  'sudo', 'su ', 'chmod 777', 'chown root',
  // Network attacks
  'nmap', 'nc -l', 'netcat', 'ssh', 'scp', 'rsync',
  // Process manipulation
  'kill -9 1', 'pkill -9', 'killall',
  // System modification
  'apt', 'yum', 'brew', 'npm install -g', 'pip install',
  // Credential access
  'cat /etc/passwd', 'cat /etc/shadow', '.ssh/',
  // Fork bomb
  ':(){:|:&};:',
  // Download and execute
  'curl | sh', 'curl | bash', 'wget | sh', 'wget | bash',
];

// Allowed commands whitelist (pattern matching)
const ALLOWED_PATTERNS = [
  // Directory navigation (harmless, commonly chained with other commands)
  /^cd(\s|$)/,
  // File operations (in allowed dirs)
  /^ls(\s|$)/,
  /^ls -la(\s|$)/,
  /^cat\s+/,
  /^head\s+/,
  /^tail\s+/,
  /^wc\s+/,
  /^find\s+/,
  /^grep\s+/,
  /^mkdir\s+/,
  /^touch\s+/,
  /^cp\s+/,
  /^mv\s+/,
  /^rm\s+(?!-rf\s+\/)/,  // Allow rm but not rm -rf /
  // Git operations
  /^git\s+/,
  // Package managers (read-only)
  /^npm\s+list/,
  /^npm\s+outdated/,
  /^bun\s+--version/,
  // Development tools
  /^node\s+/,
  /^bun\s+/,
  /^npx\s+/,
  /^tsc\s+/,
  /^eslint\s+/,
  /^prettier\s+/,
  // Programming language runtimes
  /^python3?\s+/,
  // Process management
  /^pm2\s+/,
  // Process info
  /^ps\s*/,
  /^top\s*$/,
  /^htop\s*$/,
  // Disk usage
  /^df\s*/,
  /^du\s+/,
  // Network info (safe)
  /^ping\s+/,
  /^curl\s+/,
  /^wget\s+/,
  // Text processing
  /^echo\s+/,
  /^printf\s+/,
  /^sed\s+/,
  /^awk\s+/,
  /^sort\s+/,
  /^uniq\s+/,
  /^cut\s+/,
  /^tr\s+/,
  // Misc
  /^which\s+/,
  /^whereis\s+/,
  /^date\s*/,
  /^whoami\s*$/,
  /^pwd\s*$/,
  /^env\s*$/,
  /^uptime\s*$/,
  /^uname\s+/,
  // CLI tools
  /^feishu-cli(\s|$)/,  // Feishu/Lark CLI tool
];

// Check if command is safe to execute
// [FIX] Use shell-quote for robust parsing that respects quotes and escaping
export function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  const fullCmd = command.trim();

  // --- Phase 0: Try to parse with shell-quote ---
  let tokens: any[];
  try {
    tokens = parseShell(fullCmd);
  } catch (error) {
    return {
      safe: false,
      reason: `Failed to parse command: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }

  // --- Phase 1: Check for dangerous operations in parsed tokens ---
  // Command substitution: $(...) is parsed as: "$", {op: "("}, ..., {op: ")"}
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];

    // Check for $( pattern
    if (token === '$' && typeof nextToken === 'object' && nextToken?.op === '(') {
      return { safe: false, reason: 'Dangerous pattern detected: Command substitution' };
    }

    // Check for backtick command substitution (appears as string like "`pwd`")
    if (typeof token === 'string' && /^`.*`$/.test(token)) {
      return { safe: false, reason: 'Dangerous pattern detected: Backtick command substitution' };
    }
  }

  // --- Phase 2: Split into command segments by &&, ||, ;, | ---
  const segments: string[][] = [];
  let currentSegment: string[] = [];

  for (const token of tokens) {
    if (typeof token === 'string') {
      currentSegment.push(token);
    } else if (typeof token === 'object' && token !== null && 'op' in token) {
      const op = token.op;

      // Segment separators
      if (op === '&&' || op === '||' || op === ';' || op === '|') {
        if (currentSegment.length > 0) {
          segments.push(currentSegment);
          currentSegment = [];
        }
      }
    }
  }

  // Don't forget the last segment
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  // --- Phase 3: Check for dangerous patterns BEFORE whitelist validation ---
  // This provides better error messages for known dangerous patterns
  const globalDangerousPatterns: [RegExp, string][] = [
    [/\|\s*sh\b/, 'Pipe to sh'],
    [/\|\s*bash\b/, 'Pipe to bash'],
    [/>\s*\/dev\//, 'Device file access'],
  ];

  for (const [pattern, label] of globalDangerousPatterns) {
    if (pattern.test(fullCmd)) {
      return { safe: false, reason: `Dangerous pattern detected: ${label}` };
    }
  }

  // --- Phase 4: Validate each segment against whitelist and blocklist ---
  for (const segment of segments) {
    const cmdStr = segment.join(' ');

    // Check against blocklist
    const cmdLower = cmdStr.toLowerCase();
    for (const blocked of BLOCKED_COMMANDS) {
      if (cmdLower.includes(blocked.toLowerCase())) {
        return { safe: false, reason: `Blocked command pattern: ${blocked}` };
      }
    }

    // Check against whitelist
    const isAllowed = ALLOWED_PATTERNS.some(pattern => pattern.test(cmdStr));
    if (!isAllowed) {
      return {
        safe: false,
        reason: `Command not in allowed whitelist: "${cmdStr}"`,
      };
    }
  }

  return { safe: true };
}

export const ShellSchema = z.object({
  command: z.string().describe('Shell command to execute'),
  timeout: z.number().min(1000).max(30000).optional().default(10000).describe('Timeout in ms (default: 10000, max: 30000)'),
  cwd: z.string().optional().describe('Working directory (default: project root)'),
});

export const shellTool = {
  name: 'shell',
  description: `Execute safe shell commands in a controlled environment.

SUPPORTED COMMANDS (all are allowed):
- Git: ALL git commands (git status, git commit, git push, git pull, git branch, git log, git diff, etc.)
- File ops: ls, cat, head, tail, grep, find, mkdir, touch, cp, mv, rm
- Development: node, bun, npx, tsc, eslint, prettier, python3
- Process: pm2, ps, top, htop
- Network: ping, curl, wget
- Text: sed, awk, sort, uniq, echo
- System: pwd, whoami, date, env, df, du
- CLI tools: feishu-cli (Feishu/Lark command-line tool)

BLOCKED: sudo, rm -rf /, ssh, system modifications, package installations

IMPORTANT: Git commands are FULLY SUPPORTED. Use git freely for version control operations.`,
  parameters: {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute. Git commands are fully supported.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in ms (default: 10000, max: 30000)',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (default: project root)',
      },
    },
    required: ['command'],
  },
};

export async function executeShell(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = ShellSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { command, timeout, cwd } = parsed.data;

  // Security check
  const safetyCheck = isCommandSafe(command);
  if (!safetyCheck.safe) {
    return {
      success: false,
      error: `Command rejected: ${safetyCheck.reason}. Only safe, whitelisted commands are allowed.`
    };
  }

  try {
    const proc = Bun.spawn(['bash', '-c', command], {
      cwd: cwd ? resolve(cwd) : process.cwd(),
      env: {
        ...process.env,
        // Remove sensitive env vars
        OPENAI_API_KEY: undefined,
        ANTHROPIC_API_KEY: undefined,
        ZHIPU_API_KEY: undefined,
        MINIMAX_API_KEY: undefined,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      proc.kill();
    }, timeout);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    clearTimeout(timeoutId);

    // Truncate output if too long
    const maxLength = 5000;
    const truncated = stdout.length > maxLength;
    const output = stdout.slice(0, maxLength) + (truncated ? '\n... (output truncated)' : '');

    if (exitCode !== 0) {
      return {
        success: false,
        error: `Command exited with code ${exitCode}: ${stderr || output}`
      };
    }

    if (stderr && !stdout) {
      return { success: true, data: stderr };
    }

    return { success: true, data: output || 'Command completed successfully' };
  } catch (error) {
    return {
      success: false,
      error: `Shell error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
