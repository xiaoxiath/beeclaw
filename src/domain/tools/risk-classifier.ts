/**
 * Tool Risk Classifier for HITL (Human-in-the-Loop) System
 *
 * Classifies tools by risk level to determine which operations require user confirmation.
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
  web_search: { level: ToolRiskLevel.LOW, requiresConfirmation: false },
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
  Bash: {
    level: ToolRiskLevel.HIGH,
    requiresConfirmation: true,
    timeoutMs: 600000, // 10 minutes
  },
  shell_exec: {
    level: ToolRiskLevel.HIGH,
    requiresConfirmation: true,
    timeoutMs: 600000,
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

/**
 * Tool Risk Classifier
 *
 * Determines risk level of tool operations and whether user confirmation is required.
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
   * Classify a tool call by risk level
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

    // 3. Check static registry
    const staticConfig = this.toolRegistry.get(toolName);
    if (staticConfig) {
      return staticConfig;
    }

    // 4. Dynamic risk assessment for specific tools
    if (toolName === 'Bash' || toolName === 'shell_exec') {
      return this.classifyBashCommand(params);
    }

    // 5. Unknown tools default to MEDIUM
    return {
      level: ToolRiskLevel.MEDIUM,
      requiresConfirmation: true,
      timeoutMs: this.getTimeout(ToolRiskLevel.MEDIUM),
    };
  }

  /**
   * Dynamic risk assessment for Bash commands
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

    // Default Bash commands: HIGH risk
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
