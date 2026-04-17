import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DangerLevel = 'safe' | 'warning' | 'dangerous' | 'critical';

export interface DangerPattern {
  pattern: RegExp;
  level: DangerLevel;
  category: string;
  description: string;
}

export interface ApprovalAssessment {
  level: DangerLevel;
  matchedPatterns: DangerPattern[];
  requiresApproval: boolean;
  directReject: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Set of tool names that represent command-execution tools.
 * The ToolDispatcher uses this to decide whether a call should be
 * routed through the CommandApproval gate.
 */
export const COMMAND_TOOLS: Set<string> = new Set([
  'code_execute',
  'execute_command',
  'bash',
  'shell',
]);

// ---------------------------------------------------------------------------
// Self-termination patterns — always direct-reject
// ---------------------------------------------------------------------------

const SELF_TERMINATION_PATTERNS: DangerPattern[] = [
  {
    pattern: /kill\s+\$\$/,
    level: 'critical',
    category: 'self-termination',
    description: 'Attempt to kill the current process via $$',
  },
  {
    pattern: /kill\s+.*getppid/,
    level: 'critical',
    category: 'self-termination',
    description: 'Attempt to kill the parent process via getppid',
  },
  {
    pattern: /pkill\s+(-\w+\s+)*node/,
    level: 'critical',
    category: 'self-termination',
    description: 'Attempt to kill node processes',
  },
  {
    pattern: /pkill\s+(-\w+\s+)*bun/,
    level: 'critical',
    category: 'self-termination',
    description: 'Attempt to kill bun processes',
  },
  {
    pattern: /pkill\s+(-\w+\s+)*beeclaw/,
    level: 'critical',
    category: 'self-termination',
    description: 'Attempt to kill beeclaw processes',
  },
];

// ---------------------------------------------------------------------------
// Danger patterns (30+)
// ---------------------------------------------------------------------------

export const DANGER_PATTERNS: DangerPattern[] = [
  // ── Critical (irreversible) ──────────────────────────────────────────
  {
    pattern: /rm\s+(-\w*)*\s*-rf\b/,
    level: 'critical',
    category: 'filesystem',
    description: 'Recursive force-delete (rm -rf)',
  },
  {
    pattern: /rm\s+(-\w*)*\s*-fr\b/,
    level: 'critical',
    category: 'filesystem',
    description: 'Recursive force-delete (rm -fr)',
  },
  {
    pattern: /\bdd\s+.*of=\//,
    level: 'critical',
    category: 'filesystem',
    description: 'Raw disk write via dd to absolute path',
  },
  {
    pattern: /\bmkfs\b/,
    level: 'critical',
    category: 'filesystem',
    description: 'Create filesystem (mkfs) — destroys existing data',
  },
  {
    pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/,
    level: 'critical',
    category: 'resource-abuse',
    description: 'Fork bomb detected',
  },
  {
    pattern: /\bDROP\s+TABLE\b/i,
    level: 'critical',
    category: 'database',
    description: 'DROP TABLE — irreversible data loss',
  },
  {
    pattern: /\bDROP\s+DATABASE\b/i,
    level: 'critical',
    category: 'database',
    description: 'DROP DATABASE — irreversible data loss',
  },
  {
    pattern: /\bTRUNCATE\s+TABLE\b/i,
    level: 'critical',
    category: 'database',
    description: 'TRUNCATE TABLE — irreversible data loss',
  },
  {
    pattern: /\bTRUNCATE\s+DATABASE\b/i,
    level: 'critical',
    category: 'database',
    description: 'TRUNCATE DATABASE — irreversible data loss',
  },
  {
    pattern: /\b>\s*\/dev\/sda\b/,
    level: 'critical',
    category: 'filesystem',
    description: 'Write directly to /dev/sda — destroys disk',
  },

  // ── Dangerous (high risk) ────────────────────────────────────────────
  {
    pattern: /\bchmod\s+/,
    level: 'dangerous',
    category: 'permissions',
    description: 'Changing file permissions (chmod)',
  },
  {
    pattern: /\bchown\s+/,
    level: 'dangerous',
    category: 'permissions',
    description: 'Changing file ownership (chown)',
  },
  {
    pattern: /\bcurl\b.*\|\s*(sh|bash)\b/,
    level: 'dangerous',
    category: 'remote-code-execution',
    description: 'Piping curl output to shell',
  },
  {
    pattern: /\bwget\b.*\|\s*(sh|bash)\b/,
    level: 'dangerous',
    category: 'remote-code-execution',
    description: 'Piping wget output to shell',
  },
  {
    pattern: /\bcurl\b.*\|\s*sudo\b/,
    level: 'dangerous',
    category: 'remote-code-execution',
    description: 'Piping curl output to sudo',
  },
  {
    pattern: /\bwget\b.*\|\s*sudo\b/,
    level: 'dangerous',
    category: 'remote-code-execution',
    description: 'Piping wget output to sudo',
  },
  {
    pattern: /\bgit\s+push\s+.*--force\b/,
    level: 'dangerous',
    category: 'version-control',
    description: 'Force-pushing to git remote',
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/,
    level: 'dangerous',
    category: 'version-control',
    description: 'Hard reset — discards uncommitted changes',
  },
  {
    pattern: /\bDELETE\s+FROM\s+\w+\s*(?!.*\bWHERE\b)/i,
    level: 'dangerous',
    category: 'database',
    description: 'DELETE without WHERE clause',
  },
  {
    pattern: /\bUPDATE\s+\w+\s+SET\s+.*(?!\bWHERE\b)/i,
    level: 'dangerous',
    category: 'database',
    description: 'UPDATE without WHERE clause',
  },
  {
    pattern: /\bkill\s+-9\s+-1\b/,
    level: 'dangerous',
    category: 'process-management',
    description: 'kill -9 -1 — kills all user processes',
  },
  {
    pattern: /\bkillall\b/,
    level: 'dangerous',
    category: 'process-management',
    description: 'killall — bulk process termination',
  },
  {
    pattern: /\bshutdown\b/,
    level: 'dangerous',
    category: 'system',
    description: 'System shutdown command',
  },
  {
    pattern: /\breboot\b/,
    level: 'dangerous',
    category: 'system',
    description: 'System reboot command',
  },
  {
    pattern: /\biptables\s+.*-F\b/,
    level: 'dangerous',
    category: 'network',
    description: 'Flush iptables rules — may lock out access',
  },
  {
    pattern: /\biptables\s+.*-X\b/,
    level: 'dangerous',
    category: 'network',
    description: 'Delete iptables chains',
  },
  {
    pattern: />\s*\/dev\/sda/,
    level: 'dangerous',
    category: 'filesystem',
    description: 'Redirect output to raw disk device',
  },

  // ── Warning (caution) ────────────────────────────────────────────────
  {
    pattern: /\bsudo\b/,
    level: 'warning',
    category: 'privilege-escalation',
    description: 'Using sudo — elevated privileges',
  },
  {
    pattern: /\beval\b/,
    level: 'warning',
    category: 'code-execution',
    description: 'eval — dynamic code execution',
  },
  {
    pattern: /\bnohup\b.*&/,
    level: 'warning',
    category: 'background-process',
    description: 'nohup with background — long-lived process',
  },
  {
    pattern: /\bexport\s+(TOKEN|SECRET|KEY|PASSWORD)\b/i,
    level: 'warning',
    category: 'secrets',
    description: 'Exporting sensitive environment variable',
  },
  {
    pattern: /\bnc\s+.*-l\b/,
    level: 'warning',
    category: 'network',
    description: 'netcat listener — potential backdoor',
  },
  {
    pattern: />\s*\/etc\//,
    level: 'warning',
    category: 'filesystem',
    description: 'Writing to /etc/ — system configuration change',
  },
  {
    pattern: /\bgit\s+clean\s+-fd\b/,
    level: 'warning',
    category: 'version-control',
    description: 'git clean -fd — removes untracked files and directories',
  },
];

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CommandApprovalOptions {
  /** Additional patterns to evaluate on top of the built-in set. */
  extraPatterns?: DangerPattern[];
  /** Path to a JSON allowlist file (array of fingerprints). */
  allowlistPath?: string;
  /** Optional LLM-based assessment fallback for unmatched commands. */
  llmAssess?: (command: string, context: string) => Promise<DangerLevel>;
}

// ---------------------------------------------------------------------------
// Danger-level ordering helper
// ---------------------------------------------------------------------------

const LEVEL_SEVERITY: Record<DangerLevel, number> = {
  safe: 0,
  warning: 1,
  dangerous: 2,
  critical: 3,
};

function maxLevel(a: DangerLevel, b: DangerLevel): DangerLevel {
  return LEVEL_SEVERITY[a] >= LEVEL_SEVERITY[b] ? a : b;
}

// ---------------------------------------------------------------------------
// CommandApproval
// ---------------------------------------------------------------------------

export class CommandApproval {
  private patterns: DangerPattern[];
  private allowlist: Set<string>;
  private sessionApproved: Set<string>;
  private llmAssess?: (command: string, context: string) => Promise<DangerLevel>;

  constructor(options?: CommandApprovalOptions) {
    this.patterns = [...DANGER_PATTERNS, ...(options?.extraPatterns ?? [])];
    this.allowlist = new Set<string>();
    this.sessionApproved = new Set<string>();
    this.llmAssess = options?.llmAssess;

    if (options?.allowlistPath) {
      this.loadAllowlist(options.allowlistPath);
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Assess the danger level of a command string and determine whether it
   * requires explicit human approval before execution.
   */
  async assess(command: string, toolName: string): Promise<ApprovalAssessment> {
    // 1. Self-termination — always direct-reject
    const selfTermMatch = this.matchPatterns(command, SELF_TERMINATION_PATTERNS);
    if (selfTermMatch.length > 0) {
      return {
        level: 'critical',
        matchedPatterns: selfTermMatch,
        requiresApproval: false,
        directReject: true,
      };
    }

    // 2. Allowlist / session-approved — if fingerprint matches, treat as safe
    const fp = this.fingerprint(command);
    if (this.allowlist.has(fp) || this.sessionApproved.has(fp)) {
      return {
        level: 'safe',
        matchedPatterns: [],
        requiresApproval: false,
        directReject: false,
      };
    }

    // 3. Match against all registered danger patterns
    const matched = this.matchPatterns(command, this.patterns);

    if (matched.length > 0) {
      const highestLevel = matched.reduce<DangerLevel>(
        (acc, p) => maxLevel(acc, p.level),
        'safe',
      );

      return {
        level: highestLevel,
        matchedPatterns: matched,
        requiresApproval: highestLevel !== 'safe',
        directReject: false,
      };
    }

    // 4. Optional LLM-based fallback for unmatched commands
    if (this.llmAssess) {
      try {
        const llmLevel = await this.llmAssess(command, toolName);
        return {
          level: llmLevel,
          matchedPatterns: [],
          requiresApproval: llmLevel !== 'safe',
          directReject: false,
        };
      } catch {
        // If LLM assessment fails, fall through to safe
      }
    }

    // 5. No patterns matched & no LLM override → safe
    return {
      level: 'safe',
      matchedPatterns: [],
      requiresApproval: false,
      directReject: false,
    };
  }

  /**
   * Record that a user approved a command.
   * When `permanent` is true the fingerprint is added to the persistent
   * allowlist; otherwise it is only valid for the current session.
   */
  recordApproval(command: string, permanent: boolean): void {
    const fp = this.fingerprint(command);
    this.sessionApproved.add(fp);
    if (permanent) {
      this.allowlist.add(fp);
    }
  }

  /**
   * Generate a stable fingerprint for a command.
   * Normalises whitespace and masks literal values so that semantically
   * equivalent commands produce the same hash.
   *
   * Returns the first 16 hex characters of the SHA-256 digest.
   */
  fingerprint(command: string): string {
    const normalised = command
      // Collapse all runs of whitespace to a single space
      .replace(/\s+/g, ' ')
      .trim()
      // Mask quoted string values
      .replace(/"[^"]*"/g, '"__MASKED__"')
      .replace(/'[^']*'/g, "'__MASKED__'")
      // Mask numeric literal values (standalone numbers)
      .replace(/\b\d+\b/g, '__NUM__');

    const hash = createHash('sha256').update(normalised).digest('hex');
    return hash.slice(0, 16);
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private matchPatterns(command: string, patterns: DangerPattern[]): DangerPattern[] {
    const matched: DangerPattern[] = [];
    for (const dp of patterns) {
      if (dp.pattern.test(command)) {
        matched.push(dp);
      }
    }
    return matched;
  }

  private loadAllowlist(filePath: string): void {
    try {
      // Dynamic require — keeps the module synchronous at construction time.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      const raw = fs.readFileSync(filePath, 'utf-8');
      const entries: string[] = JSON.parse(raw);
      for (const entry of entries) {
        this.allowlist.add(entry);
      }
    } catch {
      // If the file doesn't exist or is malformed we silently start with
      // an empty allowlist — the system is safe-by-default.
    }
  }
}
