// idle-rotation utilities (pure functions, no side effects)

// ---------------------------------------------------------------------------
// Session Idle Rotation
// ---------------------------------------------------------------------------

/**
 * Default idle threshold: if a session hasn't seen activity for this many
 * milliseconds, treat it as a "new conversation" by archiving old messages
 * into the summary and starting fresh.
 *
 * 2 hours is a sensible default — long enough for multi-turn work, short
 * enough to prevent day-spanning sessions from confusing the LLM.
 */
const SESSION_IDLE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Check whether the session has been idle long enough to warrant rotation
 * (archiving old messages into a summary).
 *
 * @returns true if the session is idle and should be rotated
 */
export function isSessionIdle(
  updatedAt: string,
  now: Date = new Date(),
  thresholdMs: number = SESSION_IDLE_THRESHOLD_MS,
): boolean {
  const lastActivity = new Date(updatedAt).getTime();
  const elapsed = now.getTime() - lastActivity;
  return elapsed > thresholdMs;
}

/**
 * Build a concise summary of old messages for archival.
 * This is a simple text-based summary (no LLM call) used when rotating
 * an idle session.
 */
export function buildIdleRotationSummary(
  messages: Array<{ role: string; content: string; timestamp?: string }>,
  oldSummary?: string,
): string {
  if (messages.length === 0 && !oldSummary) return '';

  const parts: string[] = [];

  if (oldSummary) {
    parts.push(oldSummary);
  }

  if (messages.length > 0) {
    // Extract the date range of the archived messages
    const firstTs = messages[0]?.timestamp;
    const lastTs = messages[messages.length - 1]?.timestamp;
    const dateRange = firstTs && lastTs
      ? `(${new Date(firstTs).toLocaleDateString('zh-CN')} ~ ${new Date(lastTs).toLocaleDateString('zh-CN')})`
      : '';

    // Build a brief digest from user messages only (assistant responses are derivative)
    const userTopics = messages
      .filter(m => m.role === 'user')
      .map(m => {
        const text = typeof m.content === 'string' ? m.content : '';
        // Take first 80 chars as a topic hint
        return text.length > 80 ? text.substring(0, 77) + '...' : text;
      })
      .slice(-6); // Keep at most 6 recent topics

    const topicList = userTopics.length > 0
      ? `讨论话题: ${userTopics.join('; ')}`
      : '';

    parts.push(
      `[旧对话存档 ${dateRange}, ${messages.length} 条消息] ${topicList}`.trim(),
    );
  }

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Temporal Marker for History Replay
// ---------------------------------------------------------------------------

/**
 * When replaying old session messages into a new Agent, insert a temporal
 * marker if the messages were from a different calendar day. This prevents
 * the LLM from confusing old conversation dates with the current date.
 *
 * @returns A string to prepend to the first replayed message, or null if
 *          no marker is needed (same day).
 */
export function buildTemporalMarker(
  messages: Array<{ timestamp?: string }>,
  now: Date = new Date(),
  timezone: string = 'Asia/Shanghai',
): string | null {
  if (messages.length === 0) return null;

  // Find the most recent message timestamp
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg?.timestamp) return null;

  const lastMsgDate = new Date(lastMsg.timestamp);
  
  // Compare calendar dates in the user's timezone
  const nowDateStr = now.toLocaleDateString('zh-CN', { timeZone: timezone });
  const lastMsgDateStr = lastMsgDate.toLocaleDateString('zh-CN', { timeZone: timezone });

  if (nowDateStr === lastMsgDateStr) return null; // Same day — no marker needed

  // Different day — build a clear temporal separator
  const daysDiff = Math.round(
    (now.getTime() - lastMsgDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  const lastDateFormatted = lastMsgDate.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
    timeZone: timezone,
  });

  return `[以下是 ${lastDateFormatted} 的历史对话记录（${daysDiff} 天前），仅供参考上下文。当前实际时间以 Runtime Context 为准。]`;
}
