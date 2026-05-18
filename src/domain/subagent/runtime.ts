/**
 * Subagent Runtime
 *
 * Core runtime for spawning and executing subagents.
 * Integrates with SubagentRegistry for depth limiting, lifecycle tracking,
 * and persistent statistics.
 *
 * === Architecture (Clean Architecture Compliance) ===
 * Domain code MUST NOT import from adapter/ directly. External dependencies
 * (plugin system, hook runner) are injected via the `RuntimeDeps` interface.
 * The infra logger is the sole exception — logging is a cross-cutting concern.
 */

import {
  getSubagentProfile,
  resolveSubagentRole,
  type SubagentConfig,
  type SubagentPermissionProfile,
  type SubagentResult,
  type SubagentStats,
  type SubagentStatus,
  type SubagentType,
} from './types';
import { getSubagentRegistry } from './registry';
import { getLogger } from '../../infra/observability/logger';

const logger = getLogger('subagent.runtime');
import { createAgent, createDefaultToolExecutor, getAllToolsForAI } from '../agent';
import type { ToolExecutor } from '../agent/types';
import { buildSubagentSystemPrompt } from './prompts';

// ============================================================================
// Port interfaces — domain-side abstractions for adapter-layer dependencies
// ============================================================================

/**
 * Abstraction over the plugin hook runner.
 * Implementations live in the adapter layer; the domain only knows this shape.
 */
export interface RuntimeHookRunner {
  runSubagentSpawning(event: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  runSubagentSpawned(event: Record<string, unknown>): Promise<void>;
  runSubagentDeliveryTarget(event: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  runSubagentEnded(event: Record<string, unknown>): Promise<void>;
}

/**
 * Factory that creates an Agent capable of chat().
 * Default: `createAgent` from `../agent`. Override in tests or DI containers.
 */
export interface AgentLike {
  chat(message: string): Promise<string>;
  /** Estimated token count after chat completes (for usage tracking) */
  readonly estimatedTokens?: number;
}

export type AgentFactory = (options: Record<string, unknown>) => AgentLike;

/**
 * Function that returns all available tools in OpenAI function-calling format.
 */
export type ToolProvider = () => Array<{ function: { name: string }; [k: string]: unknown }>;

/**
 * External dependencies injected into SubagentRuntime.
 * All fields are optional — when omitted the runtime gracefully degrades.
 */
export interface RuntimeDeps {
  /** Factory to create an agent (default: imported createAgent) */
  agentFactory?: AgentFactory;
  /** Provider for the full tool catalogue (default: imported getAllToolsForAI) */
  toolProvider?: ToolProvider;
  /** Hook runner for plugin lifecycle events */
  hookRunner?: RuntimeHookRunner | null;
}

// ============================================================================
// Lazy default loaders (only imported when no DI override is supplied)
// ============================================================================

let _defaultAgentFactory: AgentFactory | null = null;
let _defaultToolProvider: ToolProvider | null = null;
let _defaultHookRunnerLoader: (() => RuntimeHookRunner | null) | null = null;

function getDefaultAgentFactory(): AgentFactory {
  if (!_defaultAgentFactory) {
    _defaultAgentFactory = createAgent as unknown as AgentFactory;
  }
  return _defaultAgentFactory;
}

function getDefaultToolProvider(): ToolProvider {
  if (!_defaultToolProvider) {
    _defaultToolProvider = getAllToolsForAI as unknown as ToolProvider;
  }
  return _defaultToolProvider;
}

function loadDefaultHookRunner(): RuntimeHookRunner | null {
  if (!_defaultHookRunnerLoader) {
    _defaultHookRunnerLoader = () => {
      try {
        // NOTE: Using require() intentionally — this is a synchronous lazy-loader
        // for an optional adapter-layer dependency. The try/catch provides graceful
        // degradation when the plugin system is not installed. Converting to
        // dynamic import() would require making the entire hook resolution chain
        // async, which would be a breaking API change.
        // eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
        const { getPluginRegistry } = require('../../adapter/plugins');
        // eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
        const { createHookRunner } = require('../../adapter/plugins/hook-runner');
        const pluginRegistry = getPluginRegistry();
        return createHookRunner(pluginRegistry) as RuntimeHookRunner;
      } catch {
        return null;
      }
    };
  }
  return _defaultHookRunnerLoader();
}

// ============================================================================
// Utility
// ============================================================================

/**
 * Simple concurrency limiter (avoids p-limit dependency)
 */
function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let activeCount = 0;

  function next() {
    activeCount--;
    if (queue.length > 0) {
      queue.shift()!();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        activeCount++;
        fn().then(resolve, reject).finally(next);
      };

      if (activeCount < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

/** Default max concurrent subagent spawns */
const DEFAULT_MAX_CONCURRENT_SUBAGENTS = 3;
const MAX_CONCURRENT_SUBAGENTS = 6;

function parseListSection(output: string, sectionName: string): string[] | undefined {
  const sectionRegex = new RegExp(`(?:^|\\n)${sectionName}:\\s*\\n([\\s\\S]*?)(?=\\n[a-z_]+:|$)`, 'i');
  const match = output.match(sectionRegex);
  if (!match) return undefined;

  const items = match[1]
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function parseScalarField(output: string, fieldName: string): string | undefined {
  const match = output.match(new RegExp(`(?:^|\\n)${fieldName}:\\s*(.+)`, 'i'));
  return match?.[1]?.trim();
}

function parseSubagentOutput(output: string): {
  status?: SubagentStatus;
  summary?: string;
  findings?: string[];
  verified?: string[];
  notVerified?: string[];
  nextAction?: string;
} {
  const rawStatus = parseScalarField(output, 'status')?.toLowerCase();
  const status = rawStatus === 'success' || rawStatus === 'partial' || rawStatus === 'failed'
    ? rawStatus
    : undefined;

  return {
    status,
    summary: parseScalarField(output, 'summary'),
    findings: parseListSection(output, 'findings'),
    verified: parseListSection(output, 'verified'),
    notVerified: parseListSection(output, 'not_verified'),
    nextAction: parseScalarField(output, 'next_action'),
  };
}

// ============================================================================
// SubagentRuntime
// ============================================================================

/**
 * Subagent Runtime — manages subagent execution with full DI support.
 */
export class SubagentRuntime {
  private provider: any; // AIProvider
  private model: string;
  private sessionKey: string;

  // Injected (or lazily loaded) dependencies
  private agentFactory: AgentFactory;
  private toolProvider: ToolProvider;
  private hookRunnerInstance: RuntimeHookRunner | null;
  private hookRunnerResolved = false;

  private stats: SubagentStats = {
    totalSpawned: 0,
    successful: 0,
    failed: 0,
    totalTokens: 0,
    totalDuration: 0,
    avgDuration: 0,
  };

  constructor(options: {
    provider: any;
    model: string;
    sessionKey?: string;
    deps?: RuntimeDeps;
  }) {
    this.provider = options.provider;
    this.model = options.model;
    this.sessionKey = options.sessionKey || 'root';

    const deps = options.deps || {};
    this.agentFactory = deps.agentFactory || getDefaultAgentFactory();
    this.toolProvider = deps.toolProvider || getDefaultToolProvider();

    if (deps.hookRunner !== undefined) {
      this.hookRunnerInstance = deps.hookRunner;
      this.hookRunnerResolved = true;
    } else {
      this.hookRunnerInstance = null;
      this.hookRunnerResolved = false;
    }
  }

  /** Lazily resolve hookRunner (only when first needed) */
  private getHookRunner(): RuntimeHookRunner | null {
    if (!this.hookRunnerResolved) {
      this.hookRunnerInstance = loadDefaultHookRunner();
      this.hookRunnerResolved = true;
    }
    return this.hookRunnerInstance;
  }

  /**
   * Get available tools for a subagent type.
   * Public for testing; runtime consumers should not call directly.
   */
  getToolsForType(type: SubagentType): Array<{ function: { name: string }; [k: string]: unknown }> {
    return this.getToolsForConfig({ type, task: '' });
  }

  private getToolsForConfig(config: SubagentConfig): Array<{ function: { name: string }; [k: string]: unknown }> {
    const allTools = this.toolProvider();
    const profile = getSubagentProfile(config.type);
    const allowed = new Set(profile.allowedTools);

    if (config.allowSubagentSpawn || profile.permissions.canSpawnSubagents) {
      allowed.add('spawn_subagent');
      allowed.add('spawn_parallel');
    }

    const disallowed = new Set([
      ...profile.disallowedTools,
      ...(config.disallowedTools ?? []),
    ]);

    if (config.allowSubagentSpawn || profile.permissions.canSpawnSubagents) {
      disallowed.delete('spawn_subagent');
      disallowed.delete('spawn_parallel');
    }

    const requested = config.tools
      ? config.tools.filter((name) => allowed.has(name))
      : [...allowed];

    return allTools.filter((tool) => {
      const name = tool.function.name;
      return requested.includes(name) && !disallowed.has(name);
    });
  }

  private getPermissionProfile(config: SubagentConfig): SubagentPermissionProfile {
    const profile = getSubagentProfile(config.type);
    const canSpawnSubagents = Boolean(config.allowSubagentSpawn || profile.permissions.canSpawnSubagents);
    return {
      ...profile.permissions,
      canSpawnSubagents,
      maxRuntimeMs: Math.min(config.timeout || profile.permissions.maxRuntimeMs, profile.permissions.maxRuntimeMs),
    };
  }

  /**
   * Spawn a single subagent
   */
  async spawn(config: SubagentConfig): Promise<SubagentResult> {
    const startTime = Date.now();
    const startedAt = new Date(startTime).toISOString();
    const subagentId = config.id || `subagent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const role = resolveSubagentRole(config.type);
    const profile = getSubagentProfile(config.type);

    logger.debug(`[Subagent] Spawning ${role} subagent: ${subagentId}`);
    logger.debug(`[Subagent] Task: ${config.task.substring(0, 100)}...`);

    // --- Early abort check ---
    if (config.signal?.aborted) {
      return {
        success: false,
        output: '',
        tokensUsed: 0,
        duration: 0,
        error: 'Aborted before start',
        id: subagentId,
        type: config.type,
        role,
        status: 'failed',
        summary: 'Subagent was aborted before it started.',
        notVerified: ['Task was not executed.'],
        nextAction: 'Main agent should decide whether to retry or skip this subtask.',
        startedAt,
        endedAt: startedAt,
      };
    }

    // --- Registry: depth check ---
    try {
      const registry = getSubagentRegistry();
      const { allowed, depth, maxDepth } = registry.checkDepth(this.sessionKey);
      if (!allowed) {
        return {
          success: false,
          output: '',
          tokensUsed: 0,
          duration: 0,
          error: `Subagent nesting depth ${depth} exceeds maximum ${maxDepth}`,
          id: subagentId,
          type: config.type,
          role,
          status: 'failed',
          summary: 'Subagent nesting depth limit blocked execution.',
          notVerified: ['Task was not executed due to depth policy.'],
          nextAction: 'Main agent should run the work locally or flatten the delegation plan.',
          startedAt,
          endedAt: new Date().toISOString(),
        };
      }
    } catch {
      // Registry not initialized, skip depth check
    }

    // --- Obtain hook runner once, reuse throughout spawn ---
    const hookRunner = this.getHookRunner();

    // Trigger subagent_spawning hook (modifying)
    let modifiedConfig = config;
    if (hookRunner) {
      try {
        const spawningEvent = {
          subagentId,
          type: config.type,
          task: config.task,
          context: config.context,
          provider: config.provider || this.provider,
          model: config.model || this.model,
          timestamp: new Date().toISOString(),
        };

        const result = await hookRunner.runSubagentSpawning(spawningEvent);

        if (result) {
          modifiedConfig = {
            ...config,
            task: (result.task as string) || config.task,
            context: (result.context as string) || config.context,
            model: (result.model as string) || config.model,
            provider: result.provider || config.provider,
          };
        }
      } catch (error) {
        logger.debug('Plugin hook runSubagentSpawning failed:', error);
      }
    }

    this.stats.totalSpawned++;

    const tools = this.getToolsForConfig(modifiedConfig);
    const toolNames = tools.map((tool) => tool.function.name);
    const permissions = this.getPermissionProfile(modifiedConfig);
    let toolCallsCount = 0;
    const defaultToolExecutor = createDefaultToolExecutor();
    const budgetedToolExecutor: ToolExecutor = async (name, params, userContext) => {
      toolCallsCount += 1;
      if (toolCallsCount > permissions.maxToolCalls) {
        throw new Error(`Subagent tool call budget exceeded (${permissions.maxToolCalls})`);
      }
      return defaultToolExecutor(name, params, userContext);
    };

    // --- Registry: register subagent ---
    try {
      const registry = getSubagentRegistry();
      await registry.register({
        runId: subagentId,
        childSessionKey: subagentId,
        requesterSessionKey: this.sessionKey,
        task: modifiedConfig.task,
        type: modifiedConfig.type,
        role,
        model: modifiedConfig.model || this.model,
        provider: (modifiedConfig.provider || this.provider).type,
        spawnMode: 'run',
        cleanup: 'delete',
        expectsCompletionMessage: false,
        toolNames,
        permissions,
      });
      await registry.start(subagentId);
    } catch {
      // Registry not initialized, skip registration
    }

    try {
      // Build system prompt
      // buildSubagentSystemPrompt is statically imported at the top
      const systemPrompt = buildSubagentSystemPrompt(
        modifiedConfig.type,
        modifiedConfig.task,
        modifiedConfig.context,
        {
          expectedOutput: modifiedConfig.expectedOutput,
          successCriteria: modifiedConfig.successCriteria,
          ownership: modifiedConfig.ownership,
          constraints: modifiedConfig.constraints,
          toolNames,
        },
      );

      // Create agent via injected factory
      const agent = this.agentFactory({
        provider: modifiedConfig.provider || this.provider,
        model: modifiedConfig.model || this.model,
        systemPrompt,
        tools,
        toolExecutor: budgetedToolExecutor,
        maxToolIterations: permissions.maxToolCalls,
        maxTokens: modifiedConfig.maxTokens,
        loadCoreMemory: false,
        autoRefreshMemory: false,
        tokenStatsConfig: { showTokenStats: false },
      });

      // Trigger subagent_spawned hook (void)
      if (hookRunner) {
        try {
          await hookRunner.runSubagentSpawned({
            subagentId,
            type: modifiedConfig.type,
            role,
            task: modifiedConfig.task,
            toolNames,
            permissions,
            provider: (modifiedConfig.provider || this.provider).type,
            model: modifiedConfig.model || this.model,
            timestamp: new Date().toISOString(),
          });
        } catch {
          // Hook failed, non-critical
        }
      }

      // Execute with timeout, abort signal, and retry
      const defaultTimeout = parseInt(process.env.SUBAGENT_TIMEOUT_MS || '180000', 10);
      const timeout = Math.min(
        modifiedConfig.timeout || defaultTimeout,
        profile.permissions.maxRuntimeMs,
      );
      const MAX_RETRIES = 2;

      let output: string | undefined;
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Build race competitors
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          let abortCleanup: (() => void) | undefined;
          const competitors: Promise<any>[] = [
            agent.chat(modifiedConfig.task),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error(`Subagent timeout after ${timeout}ms`)), timeout);
            }),
          ];

          // Add abort signal as a race competitor
          if (modifiedConfig.signal) {
            competitors.push(
              new Promise<never>((_, reject) => {
                if (modifiedConfig.signal!.aborted) {
                  reject(new Error('Aborted'));
                  return;
                }
                const onAbort = () => reject(new Error('Aborted'));
                modifiedConfig.signal!.addEventListener('abort', onAbort, { once: true });
                abortCleanup = () => modifiedConfig.signal!.removeEventListener('abort', onAbort);
              })
            );
          }

          try {
            output = await Promise.race(competitors);
          } finally {
            if (timeoutId) clearTimeout(timeoutId);
            abortCleanup?.();
          }

          if (attempt > 0) {
            logger.debug(`[Subagent] ${subagentId} succeeded after ${attempt + 1} attempts`);
          }
          break;

        } catch (error) {
          let errorMsg: string;
          if (error instanceof Error) {
            errorMsg = error.message;
            lastError = error;
          } else if (typeof error === 'string') {
            errorMsg = error;
            lastError = new Error(error);
          } else {
            try { errorMsg = JSON.stringify(error); } catch { errorMsg = String(error); }
            lastError = new Error(errorMsg);
          }

          // Non-retryable: abort signal
          if (errorMsg === 'Aborted') {
            throw lastError;
          }

          if (attempt === MAX_RETRIES) {
            logger.error(`[Subagent] ${subagentId} failed after ${MAX_RETRIES + 1} attempts:`, errorMsg);
            throw lastError;
          }

          const isRetryable =
            errorMsg.includes('timeout') ||
            errorMsg.includes('network') ||
            errorMsg.includes('ECONNRESET') ||
            errorMsg.includes('ETIMEDOUT') ||
            errorMsg.includes('rate limit');

          if (!isRetryable) {
            logger.error(`[Subagent] ${subagentId} non-retryable error:`, errorMsg);
            throw lastError;
          }

          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          logger.warn(
            `[Subagent] ${subagentId} attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${errorMsg} — retrying in ${Math.round(delay / 1000)}s`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      if (!output) {
        throw new Error('No output from subagent');
      }

      const duration = Date.now() - startTime;
      const endedAt = new Date().toISOString();

      // ---------------------------------------------------------------
      // Token tracking: extract from agent if available
      // ---------------------------------------------------------------
      let tokensUsed = 0;
      if (typeof (agent as any).estimatedTokens === 'number') {
        tokensUsed = (agent as any).estimatedTokens;
      }

      // Update stats
      this.stats.successful++;
      this.stats.totalTokens += tokensUsed;
      this.stats.totalDuration += duration;
      this.stats.avgDuration = this.stats.totalDuration / this.stats.totalSpawned;

      logger.debug(`[Subagent] ${subagentId} completed in ${duration}ms (tokens: ${tokensUsed})`);

      const parsedOutput = parseSubagentOutput(output);

      let result: SubagentResult = {
        success: true,
        status: parsedOutput.status || 'success',
        output,
        summary: parsedOutput.summary,
        findings: parsedOutput.findings,
        verified: parsedOutput.verified,
        notVerified: parsedOutput.notVerified,
        nextAction: parsedOutput.nextAction,
        tokensUsed,
        duration,
        id: subagentId,
        type: modifiedConfig.type,
        role,
        toolNames,
        permissions,
        startedAt,
        endedAt,
      };

      // --- Registry: complete (success) ---
      try {
        const registry = getSubagentRegistry();
        await registry.complete(subagentId, 'ok', {
          output,
          tokensUsed: result.tokensUsed,
          toolCallsCount,
        });
      } catch {
        // Registry not initialized
      }

      // Trigger subagent_delivery_target hook (modifying)
      if (hookRunner) {
        try {
          const deliveryEvent = {
            subagentId,
            type: modifiedConfig.type,
            role,
            output,
            result,
            toolNames,
            permissions,
            timestamp: new Date().toISOString(),
          };

          const modifiedDelivery = await hookRunner.runSubagentDeliveryTarget(deliveryEvent);

          if (modifiedDelivery?.output) {
            output = modifiedDelivery.output as string;
            result.output = output || '';
          }
          if (modifiedDelivery?.result) {
            result = { ...result, ...(modifiedDelivery.result as SubagentResult) };
          }
        } catch {
          // Hook failed, non-critical
        }
      }

      // Trigger subagent_ended hook (void)
      if (hookRunner) {
        try {
          await hookRunner.runSubagentEnded({
            subagentId,
            type: modifiedConfig.type,
            role,
            success: true,
            duration,
            output,
            tokensUsed,
            toolNames,
            permissions,
            timestamp: new Date().toISOString(),
          });
        } catch {
          // Hook failed, non-critical
        }
      }

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const endedAt = new Date().toISOString();

      let errorMessage: string;
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else {
        try { errorMessage = JSON.stringify(error); } catch { errorMessage = String(error); }
      }

      this.stats.failed++;
      this.stats.totalDuration += duration;

      logger.error(`[Subagent] ${subagentId} failed:`, errorMessage);

      // --- Registry: complete (error) ---
      try {
        const registry = getSubagentRegistry();
        await registry.complete(subagentId, 'error', {
          error: errorMessage,
          toolCallsCount,
        });
      } catch {
        // Registry not initialized
      }

      // Trigger subagent_ended hook (void) for failure case
      if (hookRunner) {
        try {
          await hookRunner.runSubagentEnded({
            subagentId,
            type: modifiedConfig.type,
            role,
            success: false,
            duration,
            error: errorMessage,
            toolNames,
            permissions,
            timestamp: new Date().toISOString(),
          });
        } catch {
          // Hook failed, non-critical
        }
      }

      return {
        success: false,
        status: 'failed',
        output: '',
        summary: `Subagent failed: ${errorMessage}`,
        verified: [],
        notVerified: ['Task did not complete successfully.'],
        nextAction: 'Main agent should inspect the failure and decide whether to retry, narrow scope, or run locally.',
        tokensUsed: 0,
        duration,
        error: errorMessage,
        id: subagentId,
        type: modifiedConfig.type,
        role,
        toolNames,
        permissions,
        startedAt,
        endedAt,
      };
    }
  }

  /**
   * Spawn multiple subagents in parallel with concurrency limiting.
   */
  async spawnParallel(
    configs: SubagentConfig[],
    maxConcurrency?: number
  ): Promise<SubagentResult[]> {
    const requestedConcurrency =
      maxConcurrency ?? (parseInt(process.env.SUBAGENT_MAX_CONCURRENCY || '0', 10) || DEFAULT_MAX_CONCURRENT_SUBAGENTS);
    const concurrency = Math.min(MAX_CONCURRENT_SUBAGENTS, Math.max(1, requestedConcurrency));

    logger.debug(
      `[Subagent] Spawning ${configs.length} subagents in parallel (max concurrency: ${concurrency})`
    );

    const startTime = Date.now();
    const limit = pLimit(concurrency);

    const results = await Promise.all(
      configs.map(config => limit(() => this.spawn(config)))
    );

    const totalDuration = Date.now() - startTime;
    const successful = results.filter(r => r.success).length;

    logger.debug(
      `[Subagent] Parallel spawn completed: ${successful}/${configs.length} successful in ${totalDuration}ms`
    );

    return results;
  }

  /**
   * Get runtime statistics
   */
  getStats(): SubagentStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalSpawned: 0,
      successful: 0,
      failed: 0,
      totalTokens: 0,
      totalDuration: 0,
      avgDuration: 0,
    };
  }
}

// Singleton instance
let runtimeInstance: SubagentRuntime | null = null;

/**
 * Initialize the subagent runtime
 */
export function initSubagentRuntime(options: {
  provider: any;
  model: string;
  sessionKey?: string;
  deps?: RuntimeDeps;
}): SubagentRuntime {
  runtimeInstance = new SubagentRuntime(options);
  return runtimeInstance;
}

/**
 * Get the subagent runtime instance
 */
export function getSubagentRuntime(): SubagentRuntime {
  if (!runtimeInstance) {
    throw new Error('SubagentRuntime not initialized. Call initSubagentRuntime() first.');
  }
  return runtimeInstance;
}

/**
 * Spawn a single subagent (convenience function)
 */
export async function spawnSubagent(config: SubagentConfig): Promise<SubagentResult> {
  const runtime = getSubagentRuntime();
  return runtime.spawn(config);
}

/**
 * Spawn multiple subagents in parallel (convenience function)
 */
export async function spawnParallelSubagents(
  configs: SubagentConfig[],
  maxConcurrency?: number,
): Promise<SubagentResult[]> {
  const runtime = getSubagentRuntime();
  return runtime.spawnParallel(configs, maxConcurrency);
}
