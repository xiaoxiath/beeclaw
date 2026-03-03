/**
 * Deep Analysis Tool
 *
 * Tool for LLM to request background deep analysis for complex questions
 */

import { z } from 'zod';
import { getTaskManager } from '../queue/manager';
import type { AnalysisJobData } from '../queue/types';

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

// Global context for deep analysis (set by the agent when processing messages)
let currentContext: DeepAnalysisContext | null = null;

/**
 * Set the current context for deep analysis tool
 */
export function setDeepAnalysisContext(context: DeepAnalysisContext | null): void {
  currentContext = context;
}

/**
 * Clear the current context for deep analysis tool
 */
export function clearDeepAnalysisContext(): void {
  currentContext = null;
}

/**
 * Get the current context for deep analysis tool
 */
export function getDeepAnalysisContext(): DeepAnalysisContext | null {
  return currentContext;
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
    // Import feishu client dynamically to avoid circular dependencies
    const { getFeishuWSClient } = await import('../feishu');

    // 1. Send quick reply to Feishu
    const client = getFeishuWSClient();
    if (client && chatId) {
      await client.sendTextMessage(chatId, 'chat_id', quick_response);
      console.log(`[DeepAnalysis] Quick reply sent to chat: ${chatId}`);
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

    const { jobId } = await manager.addJob('analysis-jobs', 'deep-analysis', jobData);

    console.log(`[DeepAnalysis] Created analysis job: ${jobId}`);
    console.log(`[DeepAnalysis] Reason: ${reason}`);
    console.log(`[DeepAnalysis] Tasks: ${jobData.analysisTasks.join(', ')}`);

    return {
      success: true,
      data: {
        jobId,
        message: `已安排后台深度分析。快速回复已发送，分析完成后将推送结果。`,
      },
    };
  } catch (error) {
    console.error('[DeepAnalysis] Failed to create analysis job:', error);
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
