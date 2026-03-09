/**
 * Subagent Runtime
 *
 * Core runtime for spawning and executing subagents
 */

import { createAgent, getAllToolsForAI } from '../agent';
import { buildSubagentSystemPrompt } from './prompts';
import { SUBAGENT_TOOL_SETS, type SubagentConfig, type SubagentResult, type SubagentStats, type SubagentType } from './types';
import type { AIProvider } from '../config/schema';
import type { OpenAITool } from '../agent/types';
import { getPluginRegistry } from '../plugins';
import { createHookRunner } from '../plugins/hook-runner';
import { logger } from '../utils/logger';

/**
 * Simple concurrency limiter (avoids p-limit dependency)
 * Limits the number of concurrent async operations
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

/**
 * Subagent Runtime - manages subagent execution
 */
export class SubagentRuntime {
  private provider: AIProvider;
  private model: string;
  private stats: SubagentStats = {
    totalSpawned: 0,
    successful: 0,
    failed: 0,
    totalTokens: 0,
    totalDuration: 0,
    avgDuration: 0,
  };

  constructor(options: {
    provider: AIProvider;
    model: string;
  }) {
    this.provider = options.provider;
    this.model = options.model;
  }

  /**
   * Get available tools for a subagent type
   */
  private getToolsForType(type: SubagentType): OpenAITool[] {
    const allTools = getAllToolsForAI();

    // For 'general' type, all tools are available
    if (type === 'general') {
      return allTools;
    }

    // Filter tools based on type
    const allowedTools = SUBAGENT_TOOL_SETS[type];
    return allTools.filter(tool =>
      allowedTools.includes(tool.function.name)
    );
  }

  /**
   * Spawn a single subagent
   */
  async spawn(config: SubagentConfig): Promise<SubagentResult> {
    const startTime = Date.now();
    const subagentId = config.id || `subagent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[Subagent] Spawning ${config.type} subagent: ${subagentId}`);
    console.log(`[Subagent] Task: ${config.task.substring(0, 100)}...`);

    // Trigger subagent_spawning hook (modifying)
    let modifiedConfig = config;
    try {
      const registry = getPluginRegistry();
      const hookRunner = createHookRunner(registry);

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

      // Apply modifications if returned
      if (result) {
        modifiedConfig = {
          ...config,
          task: result.task || config.task,
          context: result.context || config.context,
          model: result.model || config.model,
          provider: result.provider || config.provider,
        };
      }
    } catch (error) {
      logger.debug('Plugin system not initialized:', error);
    }

    this.stats.totalSpawned++;

    try {
      // Build system prompt
      const systemPrompt = buildSubagentSystemPrompt(
        modifiedConfig.type,
        modifiedConfig.task,
        modifiedConfig.context
      );

      // Get tools
      const tools = modifiedConfig.tools
        ? getAllToolsForAI().filter(t => modifiedConfig.tools!.includes(t.function.name))
        : this.getToolsForType(modifiedConfig.type);

      // Create agent
      const agent = createAgent({
        provider: modifiedConfig.provider || this.provider,
        model: modifiedConfig.model || this.model,
        systemPrompt,
        tools,
        maxTokens: modifiedConfig.maxTokens,
        loadCoreMemory: false, // Don't load core memory for subagents
        autoRefreshMemory: false,
        tokenStatsConfig: { showTokenStats: false }, // Don't show token stats
      });

      // Trigger subagent_spawned hook (void)
      try {
        const registry = getPluginRegistry();
        const hookRunner = createHookRunner(registry);

        await hookRunner.runSubagentSpawned({
          subagentId,
          type: modifiedConfig.type,
          task: modifiedConfig.task,
          provider: (modifiedConfig.provider || this.provider).type,
          model: modifiedConfig.model || this.model,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Plugin system not initialized
      }

      // Execute with timeout and retry
      // Default 3 minutes for large models
      // Can be configured via SUBAGENT_TIMEOUT_MS environment variable or config.timeout
      const defaultTimeout = parseInt(process.env.SUBAGENT_TIMEOUT_MS || '180000', 10);
      const timeout = modifiedConfig.timeout || defaultTimeout;
      const MAX_RETRIES = 2; // Subagent has fewer retries than main agent

      let output: string | undefined;
      let lastError: Error | undefined;

      // Retry loop
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Subagent timeout after ${timeout}ms`)), timeout)
          );

          output = await Promise.race([
            agent.chat(config.task),
            timeoutPromise,
          ]);

          // Success! Break out of retry loop
          if (attempt > 0) {
            console.log(`[Subagent] ${subagentId} succeeded after ${attempt + 1} attempts`);
          }
          break;

        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const errorMsg = lastError.message;

          // Check if this is the last attempt
          if (attempt === MAX_RETRIES) {
            console.error(`[Subagent] ${subagentId} failed after ${MAX_RETRIES + 1} attempts:`, errorMsg);
            throw lastError;
          }

          // Check if error is retryable
          const isRetryable =
            errorMsg.includes('timeout') ||
            errorMsg.includes('network') ||
            errorMsg.includes('ECONNRESET') ||
            errorMsg.includes('ETIMEDOUT') ||
            errorMsg.includes('rate limit');

          if (!isRetryable) {
            console.error(`[Subagent] ${subagentId} non-retryable error:`, errorMsg);
            throw lastError;
          }

          // Calculate delay with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);

          console.warn(
            `[Subagent] ${subagentId} attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${errorMsg}\n` +
            `  Retrying in ${Math.round(delay / 1000)}s...`
          );

          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      if (!output) {
        throw new Error('No output from subagent');
      }

      const duration = Date.now() - startTime;

      // Update stats
      this.stats.successful++;
      this.stats.totalDuration += duration;
      this.stats.avgDuration = this.stats.totalDuration / this.stats.totalSpawned;

      console.log(`[Subagent] ${subagentId} completed in ${duration}ms`);

      // Build result
      let result: SubagentResult = {
        success: true,
        output,
        tokensUsed: 0, // TODO: extract from agent
        duration,
        id: subagentId,
      };

      // Trigger subagent_delivery_target hook (modifying)
      try {
        const registry = getPluginRegistry();
        const hookRunner = createHookRunner(registry);

        const deliveryEvent = {
          subagentId,
          type: modifiedConfig.type,
          output,
          result,
          timestamp: new Date().toISOString(),
        };

        const modifiedDelivery = await hookRunner.runSubagentDeliveryTarget(deliveryEvent);

        // Apply modifications if returned
        if (modifiedDelivery?.output) {
          output = modifiedDelivery.output;
          result.output = output;
        }
        if (modifiedDelivery?.result) {
          result = { ...result, ...modifiedDelivery.result };
        }
      } catch {
        // Plugin system not initialized
      }

      // Trigger subagent_ended hook (void)
      try {
        const registry = getPluginRegistry();
        const hookRunner = createHookRunner(registry);

        await hookRunner.runSubagentEnded({
          subagentId,
          type: modifiedConfig.type,
          success: true,
          duration,
          output,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Plugin system not initialized
      }

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.stats.failed++;
      this.stats.totalDuration += duration;

      console.error(`[Subagent] ${subagentId} failed:`, errorMessage);

      // Trigger subagent_ended hook (void) for failure case
      try {
        const registry = getPluginRegistry();
        const hookRunner = createHookRunner(registry);

        await hookRunner.runSubagentEnded({
          subagentId,
          type: modifiedConfig.type,
          success: false,
          duration,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Plugin system not initialized
      }

      return {
        success: false,
        output: '',
        tokensUsed: 0,
        duration,
        error: errorMessage,
        id: subagentId,
      };
    }
  }

  /**
   * Spawn multiple subagents in parallel with concurrency limiting.
   *
   * @param configs - Array of subagent configurations
   * @param maxConcurrency - Maximum number of subagents running simultaneously
   *                         (default: 3, configurable via SUBAGENT_MAX_CONCURRENCY env var)
   */
  async spawnParallel(
    configs: SubagentConfig[],
    maxConcurrency?: number
  ): Promise<SubagentResult[]> {
    const concurrency = maxConcurrency
      ?? (parseInt(process.env.SUBAGENT_MAX_CONCURRENCY || '0', 10) || DEFAULT_MAX_CONCURRENT_SUBAGENTS);

    console.log(
      `[Subagent] Spawning ${configs.length} subagents in parallel ` +
      `(max concurrency: ${concurrency})`
    );

    const startTime = Date.now();
    const limit = pLimit(concurrency);

    const results = await Promise.all(
      configs.map(config => limit(() => this.spawn(config)))
    );

    const totalDuration = Date.now() - startTime;
    const successful = results.filter(r => r.success).length;

    console.log(
      `[Subagent] Parallel spawn completed: ${successful}/${configs.length} ` +
      `successful in ${totalDuration}ms`
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
  provider: AIProvider;
  model: string;
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
export async function spawnParallelSubagents(configs: SubagentConfig[]): Promise<SubagentResult[]> {
  const runtime = getSubagentRuntime();
  return runtime.spawnParallel(configs);
}
