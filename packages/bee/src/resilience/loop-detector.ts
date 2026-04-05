/**
 * bee -- Loop Detector.
 *
 * Three-level loop detection for repeated tool calls:
 *   Level 1: Exact duplicate -- same tool + same parameter hash
 *   Level 2: Semantic duplicate -- same tool + highly similar parameters
 *   Level 3: Progress stall -- consecutive tool results carry no new information
 *
 * Extracted from beeclaw's src/infra/resilience/loop-detector.ts.
 */

import { createHash } from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface LoopDetectorConfig {
  /** Level 1: exact duplicate check window (last N calls) */
  exactDuplicateWindow: number;
  /** Level 1: max allowed exact duplicates */
  maxExactDuplicates: number;
  /** Level 2: similarity threshold (0-1) for semantic duplicates */
  semanticSimilarityThreshold: number;
  /** Level 2: max allowed semantic duplicates */
  maxSemanticDuplicates: number;
  /** Level 3: stall detection window (consecutive N steps) */
  progressStallWindow: number;
  /** Level 3: minimum information gain (0-1), below which progress is stalled */
  minInformationGain: number;
  /** Whether to inject a warning first (instead of breaking immediately) */
  injectWarningFirst: boolean;
  /** Max tolerated warnings before forcing a break */
  maxWarningsBeforeBreak: number;
}

export interface ToolCallRecord {
  /** Tool name */
  toolName: string;
  /** Original parameters */
  params: Record<string, unknown>;
  /** Parameter fingerprint hash */
  fingerprint: string;
  /** Tool result summary hash */
  resultHash: string | null;
  /** Timestamp */
  timestamp: number;
  /** Iteration number */
  iteration: number;
}

export interface LoopDetectionResult {
  /** Whether a loop was detected */
  detected: boolean;
  /** Detection level */
  level: 0 | 1 | 2 | 3;
  /** Detection type description */
  type: 'none' | 'exact_duplicate' | 'semantic_duplicate' | 'progress_stall';
  /** Detail message */
  details: string;
  /** Suggested action */
  action: 'continue' | 'warn' | 'break';
  /** Warning message to inject (when action === 'warn') */
  warningMessage?: string;
  /** Tool involved in the loop */
  involvedTool?: string;
  /** Repetition count */
  repetitionCount?: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_LOOP_DETECTOR_CONFIG: LoopDetectorConfig = {
  exactDuplicateWindow: 10,
  maxExactDuplicates: 2,
  semanticSimilarityThreshold: 0.85,
  maxSemanticDuplicates: 3,
  progressStallWindow: 5,
  minInformationGain: 0.1,
  injectWarningFirst: true,
  maxWarningsBeforeBreak: 2,
};

// ============================================================================
// LoopDetector
// ============================================================================

export class LoopDetector {
  private readonly config: LoopDetectorConfig;
  private readonly history: ToolCallRecord[] = [];
  private readonly resultHashes = new Set<string>();
  private warningCount = 0;
  private readonly maxHistory = 200; // prevent memory leaks

  constructor(config: Partial<LoopDetectorConfig> = {}) {
    this.config = { ...DEFAULT_LOOP_DETECTOR_CONFIG, ...config };
  }

  /**
   * Record a tool call (before execution).
   */
  recordToolCall(toolName: string, params: Record<string, unknown>, iteration: number): void {
    const fingerprint = this.computeFingerprint(toolName, params);

    this.history.push({
      toolName,
      params,
      fingerprint,
      resultHash: null,
      timestamp: Date.now(),
      iteration,
    });

    // Prevent memory leaks
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
  }

  /**
   * Record a tool result (after execution).
   */
  recordToolResult(result: unknown): void {
    const last = this.history[this.history.length - 1];
    if (last) {
      const rHash = this.hashResult(result);
      last.resultHash = rHash;
      this.resultHashes.add(rHash);
    }
  }

  /**
   * Check for a loop before each tool call.
   */
  check(toolName: string, params: Record<string, unknown>): LoopDetectionResult {
    const fingerprint = this.computeFingerprint(toolName, params);

    // Level 1: Exact duplicate
    const exactResult = this.checkExactDuplicate(toolName, fingerprint);
    if (exactResult.detected) return exactResult;

    // Level 2: Semantic duplicate
    const semanticResult = this.checkSemanticDuplicate(toolName, params);
    if (semanticResult.detected) return semanticResult;

    // Level 3: Progress stall
    const stallResult = this.checkProgressStall();
    if (stallResult.detected) return stallResult;

    return {
      detected: false,
      level: 0,
      type: 'none',
      details: 'No loop detected',
      action: 'continue',
    };
  }

  /**
   * Acknowledge that a warning has been shown (after injecting a system message).
   */
  acknowledgeWarning(): void {
    this.warningCount++;
  }

  /**
   * Reset the detector state (start of a new chat turn).
   */
  reset(): void {
    this.history.length = 0;
    this.resultHashes.clear();
    this.warningCount = 0;
  }

  /**
   * Get current statistics.
   */
  getStats(): {
    totalCalls: number;
    uniqueFingerprints: number;
    uniqueResults: number;
    warningCount: number;
    topRepeatedTools: Array<{ tool: string; count: number }>;
  } {
    const fingerprintCounts = new Map<string, number>();
    const toolCounts = new Map<string, number>();

    for (const record of this.history) {
      fingerprintCounts.set(record.fingerprint, (fingerprintCounts.get(record.fingerprint) ?? 0) + 1);
      toolCounts.set(record.toolName, (toolCounts.get(record.toolName) ?? 0) + 1);
    }

    const topTools = [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tool, count]) => ({ tool, count }));

    return {
      totalCalls: this.history.length,
      uniqueFingerprints: fingerprintCounts.size,
      uniqueResults: this.resultHashes.size,
      warningCount: this.warningCount,
      topRepeatedTools: topTools,
    };
  }

  // ============================================================================
  // Level 1: Exact Duplicate Detection
  // ============================================================================

  private checkExactDuplicate(toolName: string, fingerprint: string): LoopDetectionResult {
    const window = this.history.slice(-this.config.exactDuplicateWindow);
    const duplicateCount = window.filter(r => r.fingerprint === fingerprint).length;

    if (duplicateCount < this.config.maxExactDuplicates) {
      return { detected: false, level: 0, type: 'none', details: '', action: 'continue' };
    }

    const action = this.determineAction(duplicateCount, this.config.maxExactDuplicates);

    return {
      detected: true,
      level: 1,
      type: 'exact_duplicate',
      details: `Tool "${toolName}" called ${duplicateCount} times with identical arguments in last ${this.config.exactDuplicateWindow} calls`,
      action,
      warningMessage:
        action === 'warn'
          ? this.buildWarningMessage(
              toolName,
              duplicateCount,
              'exact',
              `You have called ${toolName} ${duplicateCount} times with identical arguments. ` +
                `This will not produce a new result. Try a different approach or inform the user of the difficulty.`,
            )
          : undefined,
      involvedTool: toolName,
      repetitionCount: duplicateCount,
    };
  }

  // ============================================================================
  // Level 2: Semantic Duplicate Detection
  // ============================================================================

  private checkSemanticDuplicate(toolName: string, params: Record<string, unknown>): LoopDetectionResult {
    const recentSameTool = this.history
      .filter(r => r.toolName === toolName)
      .slice(-this.config.exactDuplicateWindow);

    let semanticDuplicateCount = 0;

    for (const record of recentSameTool) {
      const similarity = this.computeParamSimilarity(record.params, params);
      if (similarity >= this.config.semanticSimilarityThreshold) {
        semanticDuplicateCount++;
      }
    }

    if (semanticDuplicateCount < this.config.maxSemanticDuplicates) {
      return { detected: false, level: 0, type: 'none', details: '', action: 'continue' };
    }

    const action = this.determineAction(semanticDuplicateCount, this.config.maxSemanticDuplicates);

    return {
      detected: true,
      level: 2,
      type: 'semantic_duplicate',
      details: `Tool "${toolName}" called ${semanticDuplicateCount} times with highly similar arguments (similarity >= ${this.config.semanticSimilarityThreshold})`,
      action,
      warningMessage:
        action === 'warn'
          ? this.buildWarningMessage(
              toolName,
              semanticDuplicateCount,
              'semantic',
              `You have called ${toolName} ${semanticDuplicateCount} times with very similar arguments. ` +
                `Try different keywords or use a different tool to get the information you need.`,
            )
          : undefined,
      involvedTool: toolName,
      repetitionCount: semanticDuplicateCount,
    };
  }

  // ============================================================================
  // Level 3: Progress Stall Detection
  // ============================================================================

  private checkProgressStall(): LoopDetectionResult {
    if (this.history.length < this.config.progressStallWindow) {
      return { detected: false, level: 0, type: 'none', details: '', action: 'continue' };
    }

    const recentWindow = this.history.slice(-this.config.progressStallWindow);
    const recentWithResults = recentWindow.filter(r => r.resultHash !== null);

    if (recentWithResults.length === 0) {
      return { detected: false, level: 0, type: 'none', details: '', action: 'continue' };
    }

    // Calculate result deduplication rate within the window
    const uniqueResults = new Set(recentWithResults.map(r => r.resultHash));
    // Check which hashes are new (not seen in older history)
    const newResults = [...uniqueResults].filter(h => {
      const olderHistory = this.history.slice(0, -this.config.progressStallWindow);
      return !olderHistory.some(r => r.resultHash === h);
    });

    const informationGain =
      recentWithResults.length > 0 ? newResults.length / recentWithResults.length : 1;

    if (informationGain >= this.config.minInformationGain) {
      return { detected: false, level: 0, type: 'none', details: '', action: 'continue' };
    }

    const action = this.determineAction(this.config.progressStallWindow, this.config.progressStallWindow);

    return {
      detected: true,
      level: 3,
      type: 'progress_stall',
      details: `Last ${this.config.progressStallWindow} tool calls produced ${newResults.length} new unique results (information gain: ${(informationGain * 100).toFixed(1)}%)`,
      action,
      warningMessage:
        action === 'warn'
          ? this.buildWarningMessage(
              'multiple',
              this.config.progressStallWindow,
              'stall',
              `The last ${this.config.progressStallWindow} tool calls produced almost no new information. ` +
                `You may be in a loop. Re-evaluate your strategy, try a different approach, or explain the current progress and difficulties to the user.`,
            )
          : undefined,
      repetitionCount: this.config.progressStallWindow,
    };
  }

  // ============================================================================
  // Internal Helpers
  // ============================================================================

  /**
   * Compute a deterministic fingerprint for a tool call.
   */
  private computeFingerprint(toolName: string, params: Record<string, unknown>): string {
    const normalized = {
      tool: toolName,
      params: this.canonicalize(params),
    };
    return createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Deterministic serialization -- sort keys, ignore volatile fields.
   */
  private canonicalize(obj: unknown): unknown {
    if (obj === null || obj === undefined) return null;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => this.canonicalize(item));

    const record = obj as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    const volatileFields = new Set([
      'timestamp', 'ts', 'created_at', 'updated_at', 'request_id',
      'trace_id', 'span_id', 'nonce', 'random', 'session_id',
    ]);

    const keys = Object.keys(record).filter(k => !volatileFields.has(k)).sort();
    for (const key of keys) {
      sorted[key] = this.canonicalize(record[key]);
    }
    return sorted;
  }

  /**
   * Hash a tool result.
   */
  private hashResult(result: unknown): string {
    const str = typeof result === 'string' ? result : JSON.stringify(result ?? '');
    // Truncate long results to avoid performance issues
    const truncated = str.length > 2000 ? str.slice(0, 2000) : str;
    return createHash('sha256').update(truncated).digest('hex').slice(0, 16);
  }

  /**
   * Compute Jaccard similarity between two parameter sets (0-1).
   */
  private computeParamSimilarity(
    params1: Record<string, unknown>,
    params2: Record<string, unknown>,
  ): number {
    const flat1 = this.flattenParams(params1);
    const flat2 = this.flattenParams(params2);

    if (flat1.size === 0 && flat2.size === 0) return 1;
    if (flat1.size === 0 || flat2.size === 0) return 0;

    let intersection = 0;
    for (const [key, value] of flat1) {
      if (flat2.get(key) === value) {
        intersection++;
      }
    }

    const union = new Set([...flat1.keys(), ...flat2.keys()]).size;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Flatten nested parameters into a key-value Map.
   */
  private flattenParams(obj: Record<string, unknown>, prefix = ''): Map<string, string> {
    const result = new Map<string, string>();

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const nested = this.flattenParams(value as Record<string, unknown>, fullKey);
        for (const [nk, nv] of nested) {
          result.set(nk, nv);
        }
      } else {
        result.set(fullKey, String(value));
      }
    }

    return result;
  }

  /**
   * Determine the action based on repetition count and threshold.
   */
  private determineAction(count: number, threshold: number): 'continue' | 'warn' | 'break' {
    if (count < threshold) return 'continue';

    if (this.config.injectWarningFirst && this.warningCount < this.config.maxWarningsBeforeBreak) {
      return 'warn';
    }

    return 'break';
  }

  /**
   * Build a warning message to inject for the LLM.
   */
  private buildWarningMessage(
    _toolName: string,
    _count: number,
    type: 'exact' | 'semantic' | 'stall',
    message: string,
  ): string {
    const typeLabel = {
      exact: 'Exact Duplicate',
      semantic: 'Semantic Duplicate',
      stall: 'Progress Stall',
    }[type];

    return `Loop Detection Warning [${typeLabel}]\n\n${message}\n\n` +
      `Note: If you believe the repeated operation is genuinely needed, explain why in your response. Otherwise, adjust your strategy.`;
  }
}
