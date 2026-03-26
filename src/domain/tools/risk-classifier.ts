/**
 * Tool Risk Classifier for HITL (Human-in-the-Loop) System
 *
 * Classifies tools by risk level to determine which operations require user confirmation.
 *
 * [G-P2-06] Added parameter-aware dynamic risk escalation: the classify() method
 * now inspects tool parameters (not just the tool name) to promote risk level
 * when dangerous patterns are detected (e.g., glob deletes, production URLs,
 * large batch sizes).
 */

export enum ToolRiskLevel {
  LOW = 'low',           // Read-only, no side effects
  MEDIUM = 'medium',     // Limited write operations
  HIGH = 'high',         // External actions, file modifications
  CRITICAL = 'critical', // Irreversible operations
}

export interface ToolRiskConfig {
  level: ToolRiskLevel;
  requiresConfirmation: boolean;
  timeoutMs?: number;  // Auto-cancel timeout (undefined = wait forever)
  justification?: string;
}

export interface HITLConfig {
  enabled: boolean;
  defaultStrategy: 'selective' | 'always' | 'never';
  toolRiskOverrides?: Record<string, 'low' | 'medium' | 'high' | 'critical'>;
  timeoutDefaults?: {
    medium?: number;
    high?: number;
    critical?: number | null;
  };
}

/**
 * Default risk classifications for common tools
 */
const DEFAULT_TOOL_RISKS: Record<string, ToolRiskConfig> = {
  // LOW - Read-only operations
  web_search: { level: ToolRiskLevel.MEDIUM, requiresConfirmation: true, timeoutMs: 300000 },
  memory_read: { level: ToolRiskLevel.LOW, requiresConfirmation: false },
  memory_ls: { level: ToolRiskLevel.LOW, requiresConfirmation: false },
  skill_get: { level: ToolRiskLevel.LOW, requiresConfirmation: false },
  skill_list: { level: ToolRiskLevel.LOW, requiresConfirmation: false },
  goal_list: { level: ToolRiskLevel.LOW, requiresConfirmation: false },

  // MEDIUM - Limited write operations
  memory_write: {
    level: ToolRiskLevel.MEDIUM,
    requiresConfirmation: true,
    timeoutMs: 300000, // 5 minutes
  },
  skill_create: {
    level: ToolRiskLevel.MEDIUM,
    requiresConfirmation: true,
    timeoutMs: 300000,
  },
  skill_update: {
    level: ToolRiskLevel.MEDIUM,
    requiresConfirmation: true,
    timeoutMs: 300000,
  },
  state_set: {
    level: ToolRiskLevel.MEDIUM,
    requiresConfirmation: true,
    timeoutMs: 300000,
  },

  // HIGH - External actions, file modifications
  shell: {
    level: ToolRiskLevel.HIGH,
    requiresConfirmation: true,
    timeoutMs: 600000, // 10 minutes
  },
  feishu_send_message: {
    level: ToolRiskLevel.HIGH,
    requiresConfirmation: true,
    timeoutMs: 600000,
  },
  feishu_send_card: {
    level: ToolRiskLevel.HIGH,
    requiresConfirmation: true,
    timeoutMs: 600000,
  },

  // CRITICAL - Irreversible operations (examples, should be determined dynamically)
  file_delete: {
    level: ToolRiskLevel.CRITICAL,
    requiresConfirmation: true,
    // No timeout for critical operations
  },
};

// ---------------------------------------------------------------------------
// [G-P2-06] Parameter-aware risk escalation patterns
// ---------------------------------------------------------------------------

/** Risk level ordering for comparison */
const RISK_ORDER: Record<ToolRiskLevel, number> = {
  [ToolRiskLevel.LOW]: 0,
  [ToolRiskLevel.MEDIUM]: 1,
  [ToolRiskLevel.HIGH]: 2,
  [ToolRiskLevel.CRITICAL]: 3,
};

/**
 * Promote a risk level to at least the given minimum.
 */
function promoteRisk(current: ToolRiskLevel, minimum: ToolRiskLevel): ToolRiskLevel {
  return RISK_ORDER[current] >= RISK_ORDER[minimum] ? current : minimum;
}

interface ParamEscalationRule {
  /** Tool name patterns this rule applies to (empty = all tools) */
  toolPatterns?: RegExp[];
  /** Parameter keys to inspect */
  paramKeys: string[];
  /** Value patterns that trigger escalation */
  valuePatterns: RegExp[];
  /** Minimum risk level to promote to */
  targetLevel: ToolRiskLevel;
  /** Human-readable reason */
  justification: string;
}

const PARAM_ESCALATION_RULES: ParamEscalationRule[] = [
  // Glob/wildcard deletion patterns
  {
    toolPatterns: [/file_delete/, /file_write/, /shell/],
    paramKeys: ['path', 'command', 'cmd', 'target'],
    valuePatterns: [/\*\*/, /\*\./, /rm\s+-rf\s+[^.]/, /rmdir/i],
    targetLevel: ToolRiskLevel.CRITICAL,
    justification: 'Glob/wildcard deletion detected in parameters',
  },
  // Production URLs or sensitive hosts
  {
    paramKeys: ['url', 'endpoint', 'host', 'target', 'webhook'],
    valuePatterns: [
      /prod(uction)?[\.\-_\/]/i,
      /\.internal\./i,
      /master\.(feishu|lark|bytedance)/i,
    ],
    targetLevel: ToolRiskLevel.HIGH,
    justification: 'Production/internal URL detected in parameters',
  },
  // Large batch sizes (>100 items)
  {
    paramKeys: ['count', 'limit', 'batch_size', 'batchSize', 'size'],
    valuePatterns: [/^[1-9]\d{2,}$/], // 100+
    targetLevel: ToolRiskLevel.HIGH,
    justification: 'Large batch size detected',
  },
  // SQL-like operations
  {
    paramKeys: ['query', 'sql', 'command'],
    valuePatterns: [
      /\bDROP\b/i,
      /\bTRUNCATE\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bALTER\s+TABLE\b/i,
    ],
    targetLevel: ToolRiskLevel.CRITICAL,
    justification: 'Destructive SQL operation detected',
  },
  // Sending to multiple recipients
  {
    paramKeys: ['recipients', 'to', 'chat_ids'],
    valuePatterns: [/,.*,.*,/], // 3+ comma-separated values
    targetLevel: ToolRiskLevel.HIGH,
    justification: 'Broadcast to multiple recipients detected',
  },
];

/**
 * Tool Risk Classifier
 *
 * Determines risk level of tool operations and whether user confirmation is required.
 * [G-P2-06] Now performs parameter-aware dynamic risk escalation.
 */
export class ToolRiskClassifier {
  private toolRegistry: Map<string, ToolRiskConfig>;
  private config: HITLConfig;

  constructor(config?: HITLConfig) {
    this.config = config || {
      enabled: true,
      defaultStrategy: 'selective',
    };

    // Initialize with default risks
    this.toolRegistry = new Map(Object.entries(DEFAULT_TOOL_RISKS));

    // Apply user-configured overrides
    if (this.config.toolRiskOverrides) {
      Object.entries(this.config.toolRiskOverrides).forEach(([tool, level]) => {
        this.registerTool(tool, this.createRiskConfig(level as ToolRiskLevel));
      });
    }
  }

  /**
   * Classify a tool call by risk level.
   *
   * [G-P2-06] Two-pass classification:
   *   1. Static lookup (tool name in registry or dynamic shell analysis)
   *   2. Parameter-aware escalation (inspects params for dangerous patterns)
   */
  classify(toolName: string, params: Record<string, unknown>): ToolRiskConfig {
    // 1. Check if HITL is disabled
    if (!this.config.enabled || this.config.defaultStrategy === 'never') {
      return {
        level: ToolRiskLevel.LOW,
        requiresConfirmation: false,
      };
    }

    // 2. Check if always require confirmation
    if (this.config.defaultStrategy === 'always') {
      return {
        level: ToolRiskLevel.MEDIUM,
        requiresConfirmation: true,
        timeoutMs: this.getTimeout(ToolRiskLevel.MEDIUM),
      };
    }

    // 3. Static classification (registry + shell heuristics)
    let baseConfig: ToolRiskConfig;

    const staticConfig = this.toolRegistry.get(toolName);
    if (staticConfig) {
      baseConfig = { ...staticConfig };
    } else if (toolName === 'shell') {
      baseConfig = this.classifyBashCommand(params);
    } else {
      // Unknown tools default to MEDIUM
      baseConfig = {
        level: ToolRiskLevel.MEDIUM,
        requiresConfirmation: true,
        timeoutMs: this.getTimeout(ToolRiskLevel.MEDIUM),
      };
    }

    // 4. [G-P2-06] Parameter-aware dynamic escalation
    const escalation = this.checkParamEscalation(toolName, params);
    if (escalation) {
      const promoted = promoteRisk(baseConfig.level, escalation.targetLevel);
      if (promoted !== baseConfig.level) {
        baseConfig.level = promoted;
        baseConfig.requiresConfirmation = true;
        baseConfig.timeoutMs = this.getTimeout(promoted);
        baseConfig.justification = escalation.justification;
      }
    }

    return baseConfig;
  }

  /**
   * [G-P2-06] Check parameter escalation rules.
   * Returns the highest-priority matching rule or null.
   */
  private checkParamEscalation(
    toolName: string,
    params: Record<string, unknown>,
  ): ParamEscalationRule | null {
    let highest: ParamEscalationRule | null = null;

    for (const rule of PARAM_ESCALATION_RULES) {
      // Check tool pattern filter
      if (rule.toolPatterns && !rule.toolPatterns.some(p => p.test(toolName))) {
        continue;
      }

      // Check parameter values
      for (const key of rule.paramKeys) {
        const value = params[key];
        if (value === undefined || value === null) continue;

        const strValue = String(value);
        if (rule.valuePatterns.some(p => p.test(strValue))) {
          if (!highest || RISK_ORDER[rule.targetLevel] > RISK_ORDER[highest.targetLevel]) {
            highest = rule;
          }
          break; // No need to check other keys for this rule
        }
      }
    }

    return highest;
  }

  /**
   * Dynamic risk assessment for shell commands
   */
  private classifyBashCommand(params: Record<string, unknown>): ToolRiskConfig {
    const cmd = (params?.command || params?.cmd || '') as string;

    // Critical patterns: irreversible destructive operations
    const criticalPatterns = [
      /\brm\s+-rf\b/,           // rm -rf
      /\bformat\b/,             // format disk
      /\bmkfs\b/,               // make filesystem
      /\bdd\s+if=/,             // disk dump
      /\bshred\b/,              // secure delete
      /\b>(\s+)?\/dev\/(sd|hd|nvme)/, // write to disk device
    ];

    for (const pattern of criticalPatterns) {
      if (pattern.test(cmd)) {
        return {
          level: ToolRiskLevel.CRITICAL,
          requiresConfirmation: true,
          timeoutMs: undefined, // Wait forever for critical operations
          justification: 'Irreversible destructive operation',
        };
      }
    }

    // High-risk patterns: file modifications, network operations
    const highRiskPatterns = [
      /\brm\b/,                 // remove files
      /\bmv\b/,                 // move files
      /\bcp\b/,                 // copy files
      /\bchmod\b/,              // change permissions
      /\bchown\b/,              // change ownership
      /\bcurl\b/,               // network requests
      /\bwget\b/,               // download files
      /\bnc\b/,                 // netcat
      /\bssh\b/,                // SSH connections
      /\bscp\b/,                // secure copy
      /\brsync\b/,              // remote sync
    ];

    for (const pattern of highRiskPatterns) {
      if (pattern.test(cmd)) {
        return {
          level: ToolRiskLevel.HIGH,
          requiresConfirmation: true,
          timeoutMs: this.getTimeout(ToolRiskLevel.HIGH),
          justification: 'File system modification or network operation',
        };
      }
    }

    // Default shell commands: HIGH risk
    return {
      level: ToolRiskLevel.HIGH,
      requiresConfirmation: true,
      timeoutMs: this.getTimeout(ToolRiskLevel.HIGH),
      justification: 'Shell command execution',
    };
  }

  /**
   * Get timeout for a risk level
   */
  private getTimeout(level: ToolRiskLevel): number | undefined {
    const defaults = this.config.timeoutDefaults || {};

    switch (level) {
      case ToolRiskLevel.LOW:
        return undefined; // No timeout for low risk (no confirmation needed)

      case ToolRiskLevel.MEDIUM:
        return defaults.medium ?? 300000; // 5 minutes default

      case ToolRiskLevel.HIGH:
        return defaults.high ?? 600000; // 10 minutes default

      case ToolRiskLevel.CRITICAL:
        return defaults.critical ?? undefined; // Wait forever by default

      default:
        return undefined;
    }
  }

  /**
   * Create risk config from risk level
   */
  private createRiskConfig(level: ToolRiskLevel): ToolRiskConfig {
    const timeoutMs = this.getTimeout(level);

    return {
      level,
      requiresConfirmation: level !== ToolRiskLevel.LOW,
      timeoutMs,
    };
  }

  /**
   * Register a tool with custom risk configuration
   */
  registerTool(toolName: string, config: ToolRiskConfig): void {
    this.toolRegistry.set(toolName, config);
  }

  /**
   * Get all registered tools
   */
  getRegisteredTools(): Map<string, ToolRiskConfig> {
    return new Map(this.toolRegistry);
  }
}
