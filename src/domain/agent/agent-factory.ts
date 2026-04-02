/**
 * Agent Factory — createAgent() factory function and configuration initialization.
 *
 * Responsible for:
 * - Accepting caller options (provider, model, prompts, tools, etc.)
 * - Delegating system-prompt assembly to prompt-builder
 * - Merging three-layer parameter resolution (params > legacy options)
 * - Constructing and returning an Agent instance
 *
 * Extracted from the Agent god-object (index.ts) for single-responsibility.
 */

import type { AIProvider } from '../../infra/config/schema';
import type { AgentOptions, OpenAITool, ToolExecutor } from './types';
import type { AgentContextConfig, TokenStatsConfig } from './context';
import { SYSTEM_PROMPTS } from './tools';
import { Agent } from './orchestrator';
import { assembleSystemPrompt } from './prompt-builder';

/**
 * Create agent with default configuration.
 *
 * Merges `params` (three-layer resolution) with legacy top-level options,
 * assembles the system prompt (with core memory + skills), and returns
 * a fully initialised Agent.
 */
export function createAgent(options: {
  provider: AIProvider;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  tools?: OpenAITool[];
  toolExecutor?: ToolExecutor;
  loadCoreMemory?: boolean;
  autoRefreshMemory?: boolean;
  contextConfig?: Partial<AgentContextConfig>;
  tokenStatsConfig?: Partial<TokenStatsConfig>;
  /** Resolved model parameters from three-layer configuration */
  params?: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    top_k?: number;
    do_sample?: boolean;
    stream?: boolean;
    thinking?: { type: 'enabled' | 'disabled' };
    [key: string]: any;
  };
  /** Tools that should be blocked from execution */
  blockedTools?: string[];
}): Agent {
  const systemPrompt = assembleSystemPrompt({
    systemPrompt: options.systemPrompt || SYSTEM_PROMPTS.default,
    loadCoreMemory: options.loadCoreMemory,
  });

  // Merge params with legacy options (params take precedence)
  const mergedOptions = {
    ...options,
    temperature: options.params?.temperature ?? options.temperature,
    topP: options.params?.top_p ?? options.topP,
    maxTokens: options.params?.max_tokens ?? options.maxTokens,
  };

  return new Agent({
    ...mergedOptions,
    systemPrompt,
    autoRefreshMemory: options.autoRefreshMemory ?? false,
    contextConfig: options.contextConfig,
    tokenStatsConfig: options.tokenStatsConfig,
  } as AgentOptions & { contextConfig?: Partial<AgentContextConfig>; tokenStatsConfig?: Partial<TokenStatsConfig> });
}
