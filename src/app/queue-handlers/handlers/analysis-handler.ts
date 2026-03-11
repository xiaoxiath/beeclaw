/**
 * Analysis Worker Handler
 *
 * Handles deep analysis jobs for complex questions
 */

import type { Job } from 'bunqueue/client';
import type { AnalysisJobData } from '../../../infra/queue/types';
import { getFeishuWSClient } from '../../../adapter/feishu';
import { sendProactiveMessage } from '../../../domain/session';

export async function handleAnalysisJob(job: Job<AnalysisJobData>): Promise<unknown> {
  const { sessionId, userId, chatId, originalMessage, analysisTasks, context } = job.data;

  console.log(`[Worker:analysis] Processing deep analysis job`);
  console.log(`  Session: ${sessionId}, Chat: ${chatId}`);
  console.log(`  Tasks: ${analysisTasks.join(', ')}`);

  await job.updateProgress(10);

  try {
    // Build the deep analysis prompt
    const analysisPrompt = buildAnalysisPrompt(originalMessage, analysisTasks, context);

    await job.updateProgress(20);

    // Use sendProactiveMessage to get the analysis result
    // This reuses the existing agent infrastructure with full tool access
    const result = await sendProactiveMessage({
      message: analysisPrompt,
      userId,
      channel: 'feishu',
      sessionId: `${sessionId}-analysis`,
    });

    await job.updateProgress(80);

    if (!result.success || !result.response) {
      console.error('[Worker:analysis] Analysis failed:', result.error);
      return {
        success: false,
        sessionId,
        chatId,
        error: result.error || 'Analysis failed',
        failedAt: new Date().toISOString(),
      };
    }

    // Format the result for pushing to user
    const formattedResult = formatAnalysisResult(originalMessage, result.response);

    // Push result to Feishu
    const client = getFeishuWSClient();
    if (client && chatId) {
      try {
        await client.sendTextMessage(chatId, 'chat_id', formattedResult);
        console.log(`[Worker:analysis] Result pushed to Feishu chat: ${chatId}`);
      } catch (error) {
        console.error('[Worker:analysis] Failed to push result to Feishu:', error);
        // Still return success since analysis completed
      }
    }

    await job.updateProgress(100);

    console.log(`[Worker:analysis] Job completed for session ${sessionId}`);

    return {
      success: true,
      sessionId,
      chatId,
      analysisTasks,
      completedAt: new Date().toISOString(),
      resultLength: result.response.length,
    };
  } catch (error) {
    console.error(`[Worker:analysis] Job failed for session ${sessionId}:`, error);

    return {
      success: false,
      sessionId,
      chatId,
      error: error instanceof Error ? error.message : 'Unknown error',
      failedAt: new Date().toISOString(),
    };
  }
}

/**
 * Build the deep analysis prompt
 */
function buildAnalysisPrompt(
  originalMessage: string,
  analysisTasks: string[],
  context?: string
): string {
  const taskList = analysisTasks.map((task, i) => `${i + 1}. ${task}`).join('\n');

  let prompt = `# 深度分析任务

用户提出了一个复杂的问题，需要你进行深度分析。请按照以下分析任务逐步处理：

## 原始问题
${originalMessage}

## 分析任务
${taskList}
`;

  if (context) {
    prompt += `\n## 相关上下文\n${context}\n`;
  }

  prompt += `
## 分析要求

1. **系统性分析**: 按照分析任务列表逐一处理
2. **深入思考**: 对每个任务进行深入分析，不要停留在表面
3. **搜索支持**: 使用 web_search 工具获取最新信息
4. **逻辑推理**: 对复杂问题进行多步推理
5. **清晰呈现**: 用结构化的方式呈现分析结果

## 输出格式

请用以下格式输出分析结果：

\`\`\`
📊 深度分析报告

## 核心发现
[主要发现和结论]

## 详细分析
[按照分析任务逐一展开]

## 建议/结论
[基于分析的最终建议或结论]
\`\`\`

请开始你的深度分析。`;

  return prompt;
}

/**
 * Format the analysis result for pushing to user
 */
function formatAnalysisResult(originalMessage: string, analysisResponse: string): string {
  // Add a header indicating this is the result of deep analysis
  const header = `📊 关于你之前的问题，我完成了深度分析：

---
`;

  const footer = `

---
💡 还有其他问题吗？`;

  return `${header}${analysisResponse}${footer}`;
}
