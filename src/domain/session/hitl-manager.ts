/**
 * HITL Session Manager - Human-in-the-Loop 恢复逻辑
 *
 * 处理用户对 HITL 请求的响应（APPROVED/DENIED/用户输入）
 */

import { getSession, saveSession } from './index';
import { logger } from '../../infra/observability/logger';

/**
 * 处理用户的 HITL 响应
 *
 * @param sessionId - Session ID
 * @param userMessage - User's message (APPROVED/DENIED or user input)
 * @returns Response from agent
 */
export async function handleHITLResponse(
  sessionId: string,
  userMessage: string
): Promise<string> {
  const session = getSession(sessionId);
  if (!session) {
    logger.error(`[HITL] Session not found: ${sessionId}`);
    return 'Session not found';
  }

  const metadata = session.metadata || {};

  // Extract HITL state from session metadata
  const pendingConfirmation = (metadata as any).pendingConfirmation as {
    toolCall: { name: string; params: Record<string, unknown> };
    riskLevel: string;
    requestedAt: number;
    timeoutMs?: number;
  } | undefined;

  const pendingQuestion = (metadata as any).pendingQuestion as {
    question: string;
    options?: string[];
    context?: string;
    inputType?: string;
    toolCallId: string;
    askedAt: number;
  } | undefined;

  // 场景 1: 工具确认响应
  if (pendingConfirmation) {
    logger.info(`[HITL] Processing tool confirmation response for session ${sessionId}`);

    const decision = parseUserDecision(userMessage);
    const pending = pendingConfirmation;

    if (decision === 'APPROVED') {
      logger.info(`[HITL] User APPROVED tool execution: ${pending.toolCall.name}`);

      // 清除确认状态
      delete (metadata as any).pendingConfirmation;
      saveSession(session);

      // 构造恢复消息
      const resumeMessage = `The user has APPROVED the tool execution.\n\n` +
        `Tool: ${pending.toolCall.name}\n` +
        `Parameters: ${JSON.stringify(pending.toolCall.params, null, 2)}\n\n` +
        `Please continue with the original task.`;

      return resumeMessage;
    } else if (decision === 'DENIED') {
      logger.info(`[HITL] User DENIED tool execution: ${pending.toolCall.name}`);

      // 清除确认状态
      delete (metadata as any).pendingConfirmation;
      saveSession(session);

      // 构造拒绝消息
      const denyMessage = `The user has DENIED the tool execution.\n\n` +
        `Tool: ${pending.toolCall.name}\n\n` +
        `Please try an alternative approach or ask the user for guidance.`;

      return denyMessage;
    } else {
      // 未识别的响应，忽略确认请求
      logger.warn(`[HITL] Unrecognized response for tool confirmation: ${userMessage}`);
      return userMessage; // 当作普通消息处理
    }
  }

  // 场景 2: 用户输入响应
  if (pendingQuestion) {
    logger.info(`[HITL] Processing user input response for session ${sessionId}`);

    const pending = pendingQuestion;
    let resumeMessage: string;

    if (pending.inputType === 'choice' && pending.options) {
      // 选择题：解析用户选择
      const choiceIndex = parseUserChoice(userMessage, pending.options);

      if (choiceIndex !== null) {
        const selectedOption = pending.options[choiceIndex];
        resumeMessage = `The user has provided the following information:\n\n` +
          `Question: ${pending.question}\n` +
          `User's Choice: ${selectedOption} (option ${choiceIndex + 1})\n\n` +
          `Please continue with the task using this information.`;
      } else {
        // 用户输入无效，重新询问
        resumeMessage = `The user's response "${userMessage}" is not a valid choice. ` +
          `Valid options are: ${pending.options.join(', ')}.\n\n` +
          `Please ask the user again or try to interpret their input.`;
      }
    } else if (pending.inputType === 'confirmation') {
      // 确认型：解析 yes/no
      const confirmed = parseUserConfirmation(userMessage);
      resumeMessage = `The user has responded to the confirmation:\n\n` +
        `Question: ${pending.question}\n` +
        `User's Answer: ${confirmed ? 'YES' : 'NO'}\n\n` +
        `Please proceed accordingly.`;
    } else if (pending.inputType === 'multi_choice' && pending.options) {
      // 多选：解析多个选择
      const selectedIndices = parseMultiChoice(userMessage, pending.options);
      const selectedOptions = selectedIndices.map(i => pending.options![i]);

      resumeMessage = `The user has selected multiple options:\n\n` +
        `Question: ${pending.question}\n` +
        `Selected: ${selectedOptions.join(', ')}\n\n` +
        `Please continue with the task.`;
    } else {
      // 文本型：直接使用用户输入
      resumeMessage = `The user has provided the following information:\n\n` +
        `Question: ${pending.question}\n` +
        `User's Answer: ${userMessage}\n\n` +
        (pending.context ? `Context: ${pending.context}\n\n` : '') +
        `Please continue with the task using this information.`;
    }

    // 清除 pending question
    delete (metadata as any).pendingQuestion;
    saveSession(session);

    // 返回恢复消息
    return resumeMessage;
  }

  // 没有待处理的 HITL 状态（这是正常情况，表示这是普通消息）
  logger.debug?.(`[HITL] No pending HITL state for session ${sessionId} - treating as regular message`);
  return null; // 当作普通消息处理
}

/**
 * 解析用户的决策（APPROVED/DENIED）
 */
export function parseUserDecision(message: string): 'APPROVED' | 'DENIED' | null {
  const normalized = message.trim().toUpperCase();

  // 批准关键词
  if (['APPROVED', 'YES', 'OK', 'CONFIRM', 'PROCEED', '批准', '同意', '确认', '继续'].includes(normalized)) {
    return 'APPROVED';
  }

  // 拒绝关键词
  if (['DENIED', 'NO', 'CANCEL', 'REJECT', 'ABORT', '拒绝', '取消', '否决', '停止'].includes(normalized)) {
    return 'DENIED';
  }

  return null;
}

/**
 * 解析用户的选择（单选）
 */
export function parseUserChoice(input: string, options: string[]): number | null {
  const normalized = input.trim();

  // 尝试解析数字（1, 2, 3...）
  const num = parseInt(normalized);
  if (!isNaN(num) && num >= 1 && num <= options.length) {
    return num - 1;
  }

  // 尝试匹配选项文本
  const lowerInput = normalized.toLowerCase();
  for (let i = 0; i < options.length; i++) {
    if (options[i].toLowerCase().includes(lowerInput)) {
      return i;
    }
  }

  return null;
}

/**
 * 解析用户确认（yes/no）
 */
export function parseUserConfirmation(input: string): boolean {
  const normalized = input.trim().toUpperCase();
  return ['YES', 'OK', 'CONFIRM', 'SURE', '是', '对', '确认', '好的'].includes(normalized);
}

/**
 * 解析用户多选
 */
export function parseMultiChoice(input: string, options: string[]): number[] {
  // 支持持多种格式："1,2,3" 或 "1 2 3" 或 "A B C"
  const parts = input.split(/[,\s]+/).map(s => s.trim());
  const indices: number[] = [];

  for (const part of parts) {
    const num = parseInt(part);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      indices.push(num - 1);
    }
  }

  return [...new Set(indices)]; // 去重
}

/**
 * 设置 HITL 确认决策（用于 Card V2 按钮回调）
 *
 * @param sessionId - Session ID
 * @param toolCallId - Tool call ID
 * @param decision - User decision (APPROVED/DENIED)
 */
export function setDecision(
  sessionId: string,
  toolCallId: string,
  decision: 'APPROVED' | 'DENIED'
): void {
  const session = getSession(sessionId);
  if (!session) {
    logger.error(`[HITL] Session not found: ${sessionId}`);
    return;
  }

  const metadata = session.metadata || {};
  const pendingConfirmation = (metadata as any).pendingConfirmation;

  if (!pendingConfirmation) {
    logger.warn(`[HITL] No pending confirmation found for session ${sessionId}`);
    return;
  }

  // [FIX-4] Finalization guard: reject duplicate decision calls.
  // Feishu card callbacks may be re-delivered, causing setDecision to fire
  // multiple times for the same tool call. Only accept the first decision.
  const existingDecision = (metadata as any).buttonDecision;
  if (existingDecision && existingDecision.toolCallId === toolCallId) {
    logger.warn(`[HITL] Decision already set for toolCallId ${toolCallId} (was: ${existingDecision.decision}). Ignoring duplicate.`);
    return;
  }

  logger.info(`[HITL] Setting decision via button callback: ${decision} for tool ${pendingConfirmation.toolCall.name}`);

  // 将决策保存到 metadata，供后续 handleHITLResponse 使用
  (metadata as any).buttonDecision = {
    toolCallId,
    decision,
    timestamp: Date.now(),
    finalized: true, // [FIX-4] Mark as finalized to prevent overwrite
  };

  saveSession(session);
}

/**
 * 设置用户输入（用于 Card V2 按钮回调）
 *
 * @param sessionId - Session ID
 * @param requestId - Request ID
 * @param value - User input value
 */
export function setUserInput(
  sessionId: string,
  requestId: string,
  value: string | string[]
): void {
  const session = getSession(sessionId);
  if (!session) {
    logger.error(`[HITL] Session not found: ${sessionId}`);
    return;
  }

  const metadata = session.metadata || {};

  // [FIX-4] Finalization guard: reject duplicate user input for same requestId.
  const existingInput = (metadata as any).buttonUserInput;
  if (existingInput && existingInput.requestId === requestId && existingInput.finalized) {
    logger.warn(`[HITL] User input already set for requestId ${requestId}. Ignoring duplicate.`);
    return;
  }

  logger.info(`[HITL] Setting user input via button callback:`, { requestId, value });

  // 将用户输入保存到 metadata，供后续 handleHITLResponse 使用
  (metadata as any).buttonUserInput = {
    requestId,
    value,
    timestamp: Date.now(),
    finalized: true, // [FIX-4] Mark as finalized
  };

  saveSession(session);
}

/**
 * 恢复 HITL 会话（触发 Agent 继续执行）
 *
 * @param sessionId - Session ID
 */
export function resume(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) {
    logger.error(`[HITL] Session not found: ${sessionId}`);
    return;
  }

  const metadata = session.metadata || {};

  // [FIX-4] Double-resume guard: if hitlResumeReady is already true and was
  // set recently (within 30s), this is likely a duplicate callback. Skip.
  if ((metadata as any).hitlResumeReady === true) {
    const resumeAt = (metadata as any).hitlResumeAt || 0;
    const elapsed = Date.now() - resumeAt;
    if (elapsed < 30_000) {
      logger.warn(`[HITL] Session ${sessionId} already resumed ${elapsed}ms ago. Ignoring duplicate resume.`);
      return;
    }
    // If it's been more than 30s, allow re-resume (could be a legitimate retry)
    logger.info(`[HITL] Session ${sessionId} was resumed ${Math.round(elapsed / 1000)}s ago. Allowing re-resume.`);
  }

  logger.info(`[HITL] Resuming session ${sessionId} after button callback`);

  // 标记会话为可恢复状态
  (metadata as any).hitlResumeReady = true;
  (metadata as any).hitlResumeAt = Date.now();

  saveSession(session);

  // 注意：实际的 Agent 恢复由 Session Manager 处理
  // 这里只是设置标志，告诉 Session Manager 可以恢复了
}
