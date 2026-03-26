/**
 * Deep Analysis Tool
 *
 * Tool for LLM to request background deep analysis for complex questions
 */

import { logger } from '../../infra/observability/logger';
import { z } from 'zod';
import { getTaskManager } from '../../infra/queue/manager';

// Local interface (no external queue/types module exists)
interface AnalysisJobData {
  sessionId: string;
  userId: string;
  chatId: string;
  originalMessage: string;
  analysisTasks: string[];
  context: string;
  createdAt: string;
}


// Tool result type
export type DeepAnalysisToolResult = {
  success: boolean;
  data?: {
    jobId: string;
    message: string;
  };
  error?: string;
};

// Schema for request_deep_analysis tool
export const RequestDeepAnalysisSchema = z.object({
  reason: z.string().describe('Why this question needs deep analysis'),
  quick_response: z.string().describe('Quick response to send to the user immediately'),
  analysis_tasks: z.array(z.string()).optional().describe('List of analysis tasks to perform'),
});

// Tool definition for AI
export const requestDeepAnalysisTool = {
  name: 'request_deep_analysis',
  description: '当问题需要深度分析、多步推理、大量搜索时，调用此工具请求后台深度处理。这会先发送快速回复给用户，然后在后台进行详细分析，完成后推送结果。',
  parameters: {
    type: 'object' as const,
    properties: {
      reason: {
        type: 'string',
        description: '为什么需要深度分析（例如：需要搜索多个主题、需要对比分析、需要详细报告等）',
      },
      quick_response: {
        type: 'string',
        description: '给用户的快速回复，告知正在处理（例如："这是个好问题！我来深入分析一下，请稍等..."）',
      },
      analysis_tasks: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: '需要执行的分析任务列表（例如：["搜索最新AI行业动态", "分析主要玩家", "总结趋势"]）',
      },
    },
    required: ['reason', 'quick_response'],
  },
};

// Context type for tool execution
export interface DeepAnalysisContext {
  sessionId: string;
  userId: string;
  chatId: string;
  originalMessage: string;
}

// Per-session context map to avoid race conditions under concurrent requests
const contextMap: Map<string, DeepAnalysisContext> = new Map();

/**
 * Set the context for a specific session's deep analysis
 */
export function setDeepAnalysisContext(context: DeepAnalysisContext | null): void {
  if (context) {
    contextMap.set(context.sessionId, context);
  }
}

/**
 * Clear the context for deep analysis tool.
 * If sessionId is provided, only that session's context is removed;
 * otherwise all contexts are cleared (backward-compat).
 */
export function clearDeepAnalysisContext(sessionId?: string): void {
  if (sessionId) {
    contextMap.delete(sessionId);
  } else {
    contextMap.clear();
  }
}

/**
 * Get the context for a specific session (or the most-recently-set context
 * when no sessionId is provided, for backward compatibility).
 */
export function getDeepAnalysisContext(sessionId?: string): DeepAnalysisContext | null {
  if (sessionId) {
    return contextMap.get(sessionId) ?? null;
  }
  // Backward compatibility: return the last inserted entry
  const values = Array.from(contextMap.values());
  return values.length > 0 ? values[values.length - 1] : null;
}

/**
 * Execute the request_deep_analysis tool
 */
export async function executeRequestDeepAnalysis(
  params: Record<string, unknown>
): Promise<DeepAnalysisToolResult> {
  const parsed = RequestDeepAnalysisSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { reason, quick_response, analysis_tasks } = parsed.data;

  // Get context
  const context = getDeepAnalysisContext();
  if (!context) {
    return {
      success: false,
      error: 'No context available for deep analysis. This tool can only be used during active conversations.',
    };
  }

  const { sessionId, userId, chatId, originalMessage } = context;

  try {
    // Use port interface to send quick reply (avoids domain → adapter import)
    const { getChannelClientPort } = await import('../ports');

    // 1. Send quick reply via port interface
    const client = getChannelClientPort();
    if (client && chatId) {
      await client.sendTextMessage?.(chatId, 'chat_id', quick_response);
      logger.debug(`[DeepAnalysis] Quick reply sent to chat: ${chatId}`);
    }

    // 2. Create analysis job
    const defaultTasks = [
      '分析问题的核心要点',
      '搜索相关信息',
      '综合分析并得出结论',
    ];

    const jobData: AnalysisJobData = {
      sessionId,
      userId,
      chatId,
      originalMessage,
      analysisTasks: analysis_tasks || defaultTasks,
      context: reason,
      createdAt: new Date().toISOString(),
    };

    const manager = getTaskManager();
    await manager.initialize();

    const { jobId } = await manager.addJob('proactive-jobs' as any, 'deep-analysis', jobData);

    logger.info(`[DeepAnalysis] Created analysis job: ${jobId}`);
    logger.debug(`[DeepAnalysis] Reason: ${reason}`);
    logger.debug(`[DeepAnalysis] Tasks: ${jobData.analysisTasks.join(', ')}`);

    return {
      success: true,
      data: {
        jobId,
        message: `已安排后台深度分析。快速回复已发送，分析完成后将推送结果。`,
      },
    };
  } catch (error) {
    logger.error('[DeepAnalysis] Failed to create analysis job:', error);
    return {
      success: false,
      error: `Failed to create analysis job: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Get tool definition for AI
 */
export function getDeepAnalysisToolForAI() {
  return {
    name: requestDeepAnalysisTool.name,
    description: requestDeepAnalysisTool.description,
    parameters: requestDeepAnalysisTool.parameters,
  };
}

/**
 * Check if tool name is a deep analysis tool
 */
export function isDeepAnalysisTool(name: string): boolean {
  return name === 'request_deep_analysis';
}
