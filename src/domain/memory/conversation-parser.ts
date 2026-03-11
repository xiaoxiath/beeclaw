/**
 * Robust Conversation Record Parser  (P2-#11)
 *
 * 原始实现问题：
 *  - 对话记录以 Markdown 格式存储 (conversations/YYYY-MM/DD.md)
 *  - recordConversation() 写入格式和 generateSummary() 解析格式耦合但不严格
 *  - 解析依赖 startsWith('## ') 和 startsWith('**用户**') 等脆弱匹配
 *  - 多行消息、代码块内的 ## 会导致误切分
 *  - 缺少格式验证和容错
 *
 * 优化方案：
 *  1. 定义严格的对话记录 schema + 写入/读取对称
 *  2. 基于状态机的 Markdown 解析器（正确处理代码块嵌套）
 *  3. 解析容错 + 错误恢复（跳过格式错误的段落而非整个文件失败）
 *  4. 同时支持旧格式和新格式的读取
 *
 * ⚡ 新增文件 — 提供解析器，由 store.ts 和 compression.ts 调用
 */

// ---------------------------------------------------------------------------
// 1. 对话记录数据结构
// ---------------------------------------------------------------------------

/** 单条对话 */
export interface ConversationTurn {
  /** 时间 (HH:mm 或 ISO string) */
  time: string;
  /** 来源 (agent, cli, lark:private:xxx 等) */
  source: string;
  /** 用户消息 */
  userMessage: string;
  /** 助手回复 */
  assistantMessage: string;
  /** 关键决策 */
  decision?: string;
  /** 相关文件 */
  relatedFiles?: string[];
  /** 技能触发 */
  skillTriggered?: string;
  /** 额外元数据 */
  metadata?: Record<string, string>;
}

/** 一天的对话记录 */
export interface DayConversationRecord {
  /** 日期标题 (YYYY-MM-DD) */
  date: string;
  /** 对话列表 */
  turns: ConversationTurn[];
  /** 解析警告 */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// 2. 状态机解析器
// ---------------------------------------------------------------------------

type ParserState =
  | 'IDLE'            // 等待新段落
  | 'HEADER'          // 读到 ## 时间标题
  | 'USER'            // 正在读用户消息
  | 'ASSISTANT'       // 正在读助手回复
  | 'METADATA'        // 正在读元数据（决策/文件/技能）
  | 'CODE_BLOCK';     // 在代码块内（不做标题切分）

/**
 * 基于状态机的 Markdown 对话记录解析器。
 * 正确处理代码块嵌套，避免代码内的 ## 和 ** 触发误切分。
 */
export function parseConversationMarkdown(markdown: string): DayConversationRecord {
  const lines = markdown.split('\n');
  const turns: ConversationTurn[] = [];
  const warnings: string[] = [];

  let date = '';
  let state: ParserState = 'IDLE';
  let codeBlockDepth = 0; // 代码块嵌套计数

  // 当前正在构建的 turn
  let currentTurn: Partial<ConversationTurn> = {};
  let currentContent = '';

  function finalizeTurn(): void {
    // 保存当前 content 到相应字段
    if (state === 'USER' && currentContent.trim()) {
      currentTurn.userMessage = currentContent.trim();
    } else if (state === 'ASSISTANT' && currentContent.trim()) {
      currentTurn.assistantMessage = currentContent.trim();
    }

    // 如果 turn 有足够数据，保存
    if (currentTurn.time && (currentTurn.userMessage || currentTurn.assistantMessage)) {
      turns.push({
        time: currentTurn.time || '',
        source: currentTurn.source || 'unknown',
        userMessage: currentTurn.userMessage || '',
        assistantMessage: currentTurn.assistantMessage || '',
        decision: currentTurn.decision,
        relatedFiles: currentTurn.relatedFiles,
        skillTriggered: currentTurn.skillTriggered,
        metadata: currentTurn.metadata,
      });
    } else if (currentTurn.time) {
      warnings.push(`Incomplete turn at ${currentTurn.time}: missing user or assistant message`);
    }

    currentTurn = {};
    currentContent = '';
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块状态追踪（在任何其他判断之前）
    if (line.trimStart().startsWith('```')) {
      if (codeBlockDepth === 0) {
        codeBlockDepth++;
      } else {
        codeBlockDepth--;
      }

      // 在代码块内，直接追加到当前 content
      if (state === 'USER' || state === 'ASSISTANT') {
        currentContent += line + '\n';
      }
      continue;
    }

    // 在代码块内，所有内容原样追加
    if (codeBlockDepth > 0) {
      if (state === 'USER' || state === 'ASSISTANT') {
        currentContent += line + '\n';
      }
      continue;
    }

    // --- 以下是代码块外的正常解析 ---

    // 文件标题（# YYYY-MM-DD 或 # YYYY-MM/DD）
    const dateMatch = line.match(/^# (\d{4}-\d{2}(?:-\d{2})?)/);
    if (dateMatch) {
      date = dateMatch[1];
      continue;
    }

    // 段落分隔符
    if (line.trim() === '---') {
      finalizeTurn();
      state = 'IDLE';
      continue;
    }

    // 对话标题（## HH:mm - source）
    const turnHeaderMatch = line.match(/^## (\d{1,2}:\d{2})(?:\s*-\s*(.+))?$/);
    if (turnHeaderMatch) {
      // 保存之前的 turn
      if (state !== 'IDLE') {
        finalizeTurn();
      }

      currentTurn = {
        time: turnHeaderMatch[1],
        source: turnHeaderMatch[2]?.trim() || 'unknown',
      };
      state = 'HEADER';
      continue;
    }

    // 用户消息标记
    const userMatch = line.match(/^\*\*(?:用户|User)\*\*[：:]\s*(.*)/);
    if (userMatch) {
      if (state === 'ASSISTANT' && currentContent.trim()) {
        currentTurn.assistantMessage = currentContent.trim();
      }
      currentContent = userMatch[1] ? userMatch[1] + '\n' : '';
      state = 'USER';
      continue;
    }

    // 助手消息标记
    const assistantMatch = line.match(/^\*\*(?:助手|Assistant)\*\*[：:]\s*(.*)/);
    if (assistantMatch) {
      if (state === 'USER' && currentContent.trim()) {
        currentTurn.userMessage = currentContent.trim();
      }
      currentContent = assistantMatch[1] ? assistantMatch[1] + '\n' : '';
      state = 'ASSISTANT';
      continue;
    }

    // 元数据字段
    const decisionMatch = line.match(/^\*\*(?:关键决策|Decision)\*\*[：:]\s*(.*)/);
    if (decisionMatch) {
      if (state === 'ASSISTANT' && currentContent.trim()) {
        currentTurn.assistantMessage = currentContent.trim();
        currentContent = '';
      }
      currentTurn.decision = decisionMatch[1].trim();
      state = 'METADATA';
      continue;
    }

    const filesMatch = line.match(/^\*\*(?:相关文件|Related Files)\*\*[：:]\s*(.*)/);
    if (filesMatch) {
      currentTurn.relatedFiles = filesMatch[1].split(',').map(f => f.trim()).filter(Boolean);
      state = 'METADATA';
      continue;
    }

    const skillMatch = line.match(/^\*\*(?:技能触发|Skill Triggered)\*\*[：:]\s*(.*)/);
    if (skillMatch) {
      currentTurn.skillTriggered = skillMatch[1].trim();
      state = 'METADATA';
      continue;
    }

    // 普通内容行
    if (state === 'USER' || state === 'ASSISTANT') {
      currentContent += line + '\n';
    }
    // HEADER 或 METADATA 状态下的空行忽略
  }

  // 处理文件末尾的未闭合 turn
  if (state !== 'IDLE') {
    finalizeTurn();
  }

  // 未闭合的代码块警告
  if (codeBlockDepth > 0) {
    warnings.push('Unclosed code block detected at end of file');
  }

  return { date, turns, warnings };
}

// ---------------------------------------------------------------------------
// 3. 标准化写入格式
// ---------------------------------------------------------------------------

/**
 * 将 ConversationTurn 序列化为标准 Markdown。
 * 与 parseConversationMarkdown 完全对称。
 */
export function serializeConversationTurn(turn: ConversationTurn): string {
  const lines: string[] = [];

  lines.push(`## ${turn.time} - ${turn.source}`);
  lines.push('');

  // 用户消息：如果包含多行，保持原始格式
  lines.push(`**用户**：${turn.userMessage}`);
  lines.push('');

  // 助手回复
  lines.push(`**助手**：${turn.assistantMessage}`);

  // 元数据
  if (turn.decision) {
    lines.push('');
    lines.push(`**关键决策**：${turn.decision}`);
  }
  if (turn.relatedFiles && turn.relatedFiles.length > 0) {
    lines.push('');
    lines.push(`**相关文件**：${turn.relatedFiles.join(', ')}`);
  }
  if (turn.skillTriggered) {
    lines.push('');
    lines.push(`**技能触发**：${turn.skillTriggered}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

/**
 * 创建一天的对话记录文件头。
 */
export function createDayHeader(date: string): string {
  return `# ${date}\n\n`;
}

// ---------------------------------------------------------------------------
// 4. 兼容旧格式读取
// ---------------------------------------------------------------------------

/**
 * 尝试解析旧格式的对话记录。
 * 旧格式可能缺少严格的 ** 标记，或时间格式不同。
 */
export function parseConversationLegacy(markdown: string): DayConversationRecord {
  // 先尝试标准解析
  const result = parseConversationMarkdown(markdown);

  // 如果标准解析有结果，直接返回
  if (result.turns.length > 0) return result;

  // Fallback: 松散解析
  const turns: ConversationTurn[] = [];
  const warnings: string[] = ['Using legacy parsing mode'];

  // 按 ## 或 --- 切分段落
  const sections = markdown.split(/(?=^## |\n---\n)/m).filter(s => s.trim());

  for (const section of sections) {
    const lines = section.trim().split('\n');

    // 提取时间
    const timeMatch = lines[0]?.match(/^##\s*(\d{1,2}:\d{2})/);
    if (!timeMatch) continue;

    let userMsg = '';
    let assistantMsg = '';

    for (const line of lines.slice(1)) {
      const trimmed = line.trim();
      if (/^(?:\*\*)?(?:用户|User|Q)(?:\*\*)?[：:]/.test(trimmed)) {
        userMsg = trimmed.replace(/^(?:\*\*)?(?:用户|User|Q)(?:\*\*)?[：:]\s*/, '');
      } else if (/^(?:\*\*)?(?:助手|Assistant|A|AI)(?:\*\*)?[：:]/.test(trimmed)) {
        assistantMsg = trimmed.replace(/^(?:\*\*)?(?:助手|Assistant|A|AI)(?:\*\*)?[：:]\s*/, '');
      }
    }

    if (userMsg || assistantMsg) {
      turns.push({
        time: timeMatch[1],
        source: 'legacy',
        userMessage: userMsg,
        assistantMessage: assistantMsg,
      });
    }
  }

  return { date: '', turns, warnings };
}

// ---------------------------------------------------------------------------
// 5. 对话统计工具
// ---------------------------------------------------------------------------

export interface ConversationStats {
  /** 对话总轮数 */
  totalTurns: number;
  /** 有决策记录的轮数 */
  turnsWithDecisions: number;
  /** 触发技能的轮数 */
  turnsWithSkills: number;
  /** 用户消息平均长度 (字符) */
  avgUserMessageLength: number;
  /** 助手回复平均长度 (字符) */
  avgAssistantMessageLength: number;
  /** 按来源分组的轮数 */
  turnsBySource: Record<string, number>;
  /** 使用的技能列表 */
  usedSkills: string[];
}

/**
 * 计算对话统计信息。
 */
export function calculateConversationStats(record: DayConversationRecord): ConversationStats {
  const { turns } = record;

  const turnsBySource: Record<string, number> = {};
  const skills = new Set<string>();
  let totalUserLen = 0;
  let totalAssistantLen = 0;
  let decisionsCount = 0;
  let skillsCount = 0;

  for (const turn of turns) {
    turnsBySource[turn.source] = (turnsBySource[turn.source] || 0) + 1;
    totalUserLen += turn.userMessage.length;
    totalAssistantLen += turn.assistantMessage.length;
    if (turn.decision) decisionsCount++;
    if (turn.skillTriggered) {
      skillsCount++;
      skills.add(turn.skillTriggered);
    }
  }

  return {
    totalTurns: turns.length,
    turnsWithDecisions: decisionsCount,
    turnsWithSkills: skillsCount,
    avgUserMessageLength: turns.length > 0 ? Math.round(totalUserLen / turns.length) : 0,
    avgAssistantMessageLength: turns.length > 0 ? Math.round(totalAssistantLen / turns.length) : 0,
    turnsBySource,
    usedSkills: Array.from(skills),
  };
}
