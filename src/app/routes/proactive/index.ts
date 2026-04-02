/**
 * Proactive Integration Module
 *
 * Provides Feishu bot integration with memory system.
 * This barrel file re-exports from the split modules:
 * - feishu-auth.ts    — Feishu tenant access token management
 * - image-handler.ts  — Image message download and processing
 * - feishu-ws.ts      — Feishu WebSocket long-connection handler
 */

import { initSessionManager } from '../../../domain/session';
import type { AIProvider } from '../../../infra/config/schema';
import type { TokenStatsConfig } from '../../../domain/agent';
import { sendProactiveMessage } from '../../../domain/session';
import { pushNotification } from '../../../domain/proactive/pusher';
import { evaluatePatterns } from '../../../domain/proactive/triggers';
import { getGoalStore } from '../../../domain/agent/goal/store';

// Initialize session manager with config (call this during app startup)
export function initProactiveApi(config: {
  provider: AIProvider;
  model: string;
  systemPrompt?: string;
  useTools?: boolean;
  tokenStatsConfig?: Partial<TokenStatsConfig>;
  visionConfig?: {
    visionModel?: string;
    textModel?: string;
    visionSystemPrompt?: string;
    fallbackOnError?: 'description' | 'placeholder' | 'retry';
    maxRetries?: number;
  };
  params?: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    [key: string]: any;
  };
}): void {
  initSessionManager(config);
}

// Re-export from sub-modules
export { initFeishuWSIntegration } from './feishu-ws';
export { getTenantAccessToken } from './feishu-auth';
export { downloadFeishuImage, buildMultimodalContent } from './image-handler';

// Export utilities for external use
export { sendProactiveMessage, pushNotification, evaluatePatterns, getGoalStore };
