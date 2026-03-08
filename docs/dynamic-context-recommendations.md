# 推荐的动态系统提示词

> 除了已实现的"时间意识"，这里列出其他推荐的动态上下文提示词

---

## 优先级分类

### 🔴 P0 - 强烈推荐（立即实施）

#### 1. 工作目录和项目上下文

**信息**:
- 当前工作目录（`process.cwd()`）
- 项目名称（从 package.json/pyproject.toml 提取）
- 项目类型（Node.js/Python/Rust 等）
- Git 分支和状态

**示例**:
```markdown
# Working Context

**Directory**: /Users/keith/workspace/beeclaw
**Project**: beeclaw (TypeScript/Bun)
**Git Branch**: main
**Git Status**: 2 modified files, 1 untracked
```

**用途**:
- AI 知道用户在哪个项目工作
- 可以智能推荐项目相关的命令
- 理解代码上下文

---

#### 2. 活跃目标提醒

**信息**:
- 当前活跃的 goals 数量
- 最近更新的 goal
- 即将到期的 goal

**示例**:
```markdown
# Active Goals

**Total**: 3 active goals
**Recent**: "CLI 和 Bot 会话统一" (85% complete)
**Due Soon**: "完成 v0.3.0 发布" (3 days left)
```

**用途**:
- AI 主动询问目标进展
- 提醒即将到期的任务
- 保持长期目标的一致性

---

#### 3. 会话统计

**信息**:
- 本次会话对话轮数
- 使用的工具列表
- Token 消耗统计

**示例**:
```markdown
# Session Stats

**Messages**: 12 turns
**Tools Used**: memory_record (3), web_search (1)
**Tokens**: ~5,200 used
```

**用途**:
- AI 知道对话深度
- 可以建议休息或总结
- 成本意识

---

### 🟡 P1 - 推荐（近期实施）

#### 4. 系统环境信息

**信息**:
- 操作系统（macOS/Linux/Windows）
- Shell 类型（zsh/bash/fish）
- 可用开发工具（docker, kubectl, git 等）

**示例**:
```markdown
# System Environment

**OS**: macOS 14.3 (Darwin 25.2.0)
**Shell**: zsh
**Available Tools**: git, docker, node, bun, python3
```

**用途**:
- 生成正确的命令语法
- 推荐适合系统的工具
- 避免推荐不可用的命令

---

#### 5. 最近记忆摘要

**信息**:
- 最近记录的 3-5 条事实
- 最近讨论的主要话题
- 用户偏好摘要

**示例**:
```markdown
# Recent Memory

**Recent Facts**:
- 用户偏好使用 Bun 而不是 Node.js
- 项目使用 TypeScript
- 最近在重构会话管理

**Last Session Topics**: CLI/Bot 统一, 会话持久化
```

**用途**:
- 保持对话连续性
- 快速恢复上下文
- 个性化响应

---

#### 6. 节假日和工作时间

**信息**:
- 是否是节假日
- 是否是工作时间
- 特殊日期提醒

**示例**:
```markdown
# Time Context

**Type**: Workday (Friday)
**Holiday**: None
**Work Hours**: Yes (14:30 is within 9-18)
**Special**: End of month (Feb 28)
```

**用途**:
- 调整响应风格（工作 vs 休闲）
- 月末/季末提醒
- 节假日问候

---

### 🟢 P2 - 可选（未来增强）

#### 7. 网络和 API 状态

**信息**:
- 网络连接状态
- API 配额剩余
- 最近 API 响应时间

**示例**:
```markdown
# API Status

**Network**: Connected
**API Quota**: ~85% remaining
**Avg Response**: 1.2s
```

**用途**:
- 调整请求频率
- 提醒配额限制
- 选择合适的模型

---

#### 8. 项目依赖状态

**信息**:
- 是否有依赖更新
- 安全漏洞提醒
- 过时的包

**示例**:
```markdown
# Dependencies

**Updates Available**: 5 packages
**Security Alerts**: 1 (lodash <4.17.21)
**Outdated**: typescript (5.3 → 5.4)
```

**用途**:
- 主动提醒安全问题
- 建议升级时机
- 维护意识

---

#### 9. 最近文件活动

**信息**:
- 最近修改的文件
- 正在编辑的文件（如果可以检测）
- 文件树变化

**示例**:
```markdown
# Recent Files

**Modified**:
- src/cli.ts (5 min ago)
- src/session/index.ts (10 min ago)

**Created**: src/session/recommender.ts (today)
```

**用途**:
- 理解用户当前工作焦点
- 智能代码建议
- 上下文相关的帮助

---

#### 10. 用户活跃度分析

**信息**:
- 使用频率
- 常用功能
- 使用模式（早上/晚上）

**示例**:
```markdown
# User Activity

**Usage**: Daily active user
**Peak Hours**: 9-11 AM, 2-6 PM
**Favorite Tools**: memory_record, web_search
**Common Tasks**: Code review, debugging
```

**用途**:
- 个性化推荐
- 最佳时间建议
- 功能发现

---

## 实施优先级矩阵

| 功能 | 实施难度 | 价值 | 优先级 | 预计时间 |
|------|---------|------|--------|---------|
| 工作目录上下文 | ⭐ 简单 | ⭐⭐⭐⭐⭐ | P0 | 30分钟 |
| 活跃目标提醒 | ⭐ 简单 | ⭐⭐⭐⭐⭐ | P0 | 20分钟 |
| 会话统计 | ⭐ 简单 | ⭐⭐⭐⭐ | P0 | 20分钟 |
| 系统环境 | ⭐⭐ 中等 | ⭐⭐⭐⭐ | P1 | 1小时 |
| 最近记忆摘要 | ⭐⭐ 中等 | ⭐⭐⭐⭐ | P1 | 1小时 |
| 节假日检测 | ⭐⭐ 中等 | ⭐⭐⭐ | P1 | 1.5小时 |
| 网络状态 | ⭐⭐⭐ 复杂 | ⭐⭐⭐ | P2 | 2小时 |
| 依赖状态 | ⭐⭐⭐ 复杂 | ⭐⭐⭐ | P2 | 3小时 |
| 文件活动 | ⭐⭐⭐ 复杂 | ⭐⭐⭐⭐ | P2 | 2小时 |
| 活跃度分析 | ⭐⭐⭐⭐ 很复杂 | ⭐⭐⭐ | P2 | 4小时 |

---

## 推荐实施方案

### Phase 1: 核心上下文（立即实施）

实现 P0 优先级的 3 个功能：

1. **工作目录上下文** - 让 AI 知道在哪里
2. **活跃目标提醒** - 让 AI 知道要做什么
3. **会话统计** - 让 AI 知道对话深度

**实施时间**: 1-2 小时
**代码改动**: 主要在 `src/agent/tools.ts` 的 `buildSystemPrompt()`

### Phase 2: 环境感知（1周内）

实现 P1 优先级的 3 个功能：

4. **系统环境** - OS、Shell、工具
5. **最近记忆摘要** - 快速恢复上下文
6. **节假日检测** - 工作时间意识

**实施时间**: 3-4 小时

### Phase 3: 高级感知（未来）

根据用户反馈，选择性实现 P2 功能。

---

## 代码实现示例

### 工作目录上下文

```typescript
// src/agent/tools.ts

function getWorkingContext(): string {
  const cwd = process.cwd();
  const projectName = basename(cwd);

  // Detect project type
  let projectType = 'Unknown';
  if (existsSync(join(cwd, 'package.json'))) {
    projectType = 'Node.js/TypeScript';
  } else if (existsSync(join(cwd, 'requirements.txt'))) {
    projectType = 'Python';
  } else if (existsSync(join(cwd, 'Cargo.toml'))) {
    projectType = 'Rust';
  }

  // Get git info
  let gitBranch = 'N/A';
  let gitStatus = 'Clean';
  try {
    gitBranch = execSync('git branch --show-current', { cwd, encoding: 'utf-8' }).trim();
    const status = execSync('git status --short', { cwd, encoding: 'utf-8' }).trim();
    if (status) {
      const lines = status.split('\n').filter(Boolean);
      gitStatus = `${lines.length} changes`;
    }
  } catch {}

  return `# Working Context

**Directory**: ${cwd}
**Project**: ${projectName} (${projectType})
**Git Branch**: ${gitBranch}
**Git Status**: ${gitStatus}`;
}
```

### 活跃目标提醒

```typescript
// src/agent/tools.ts

function getActiveGoalsContext(): string | null {
  try {
    const goalStore = getGoalStore();
    const goals = goalStore.list().filter(g => g.state === 'active');

    if (goals.length === 0) return null;

    const recentGoal = goals.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )[0];

    const dueSoonGoals = goals.filter(g => {
      if (!g.targetDate) return false;
      const days = (new Date(g.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return days > 0 && days < 7;
    });

    let context = `# Active Goals\n\n**Total**: ${goals.length} active goals`;

    if (recentGoal) {
      context += `\n**Recent**: "${recentGoal.title}" (${recentGoal.progress}% complete)`;
    }

    if (dueSoonGoals.length > 0) {
      context += `\n**Due Soon**: ${dueSoonGoals.map(g => `"${g.title}"`).join(', ')}`;
    }

    return context;
  } catch {
    return null;
  }
}
```

### 会话统计

```typescript
// src/agent/tools.ts

function getSessionStats(session: Session): string {
  const messageCount = session.messages.length;
  const userMessages = session.messages.filter(m => m.role === 'user').length;

  // Count tool usage
  const toolUsage: Record<string, number> = {};
  for (const msg of session.messages) {
    if (msg.role === 'assistant' && msg.content.includes('tool')) {
      // Simple heuristic - can be improved
      const matches = msg.content.match(/Using tool: (\w+)/g);
      if (matches) {
        for (const match of matches) {
          const toolName = match.replace('Using tool: ', '');
          toolUsage[toolName] = (toolUsage[toolName] || 0) + 1;
        }
      }
    }
  }

  const topTools = Object.entries(toolUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ');

  return `# Session Stats

**Messages**: ${messageCount} (${userMessages} from you)
**Tools Used**: ${topTools || 'None'}`;
}
```

---

## 完整集成示例

```typescript
// src/agent/tools.ts

export function buildSystemPrompt(
  basePrompt: string,
  coreContext?: { user: string; soul: string; facts?: string; skills?: string },
  sessionContext?: Session
): string {
  let prompt = basePrompt;

  // 1. Time context (already implemented)
  const timeContext = getTimeContext();
  prompt = `${timeContext}\n---\n\n${prompt}`;

  // 2. Working context (P0)
  const workingContext = getWorkingContext();
  prompt = `${workingContext}\n---\n\n${prompt}`;

  // 3. Active goals (P0)
  const goalsContext = getActiveGoalsContext();
  if (goalsContext) {
    prompt = `${prompt}\n\n${goalsContext}`;
  }

  // 4. Session stats (P0)
  if (sessionContext) {
    const statsContext = getSessionStats(sessionContext);
    prompt = `${prompt}\n\n${statsContext}`;
  }

  // 5. Trait-based personality (existing)
  const traitPrompt = getTraitSystemPrompt();
  if (traitPrompt) {
    prompt = `${traitPrompt}\n---\n\n${prompt}`;
  }

  // 6. Core memory context (existing)
  if (coreContext) {
    // ... existing code
  }

  return prompt;
}
```

---

## 预期效果

### 示例 System Prompt

```markdown
# Current Context

**Date**: 2026年2月28日 星期五
**Time**: 21:30
**Timezone**: Asia/Shanghai

---

# Working Context

**Directory**: /Users/keith/workspace/beeclaw
**Project**: beeclaw (TypeScript/Bun)
**Git Branch**: feature/smart-context
**Git Status**: 3 changes

---

# Active Goals

**Total**: 3 active goals
**Recent**: "实现智能会话推荐" (90% complete)
**Due Soon**: "完成 v0.3.0 发布" (3 days left)

---

# Session Stats

**Messages**: 8 (4 from you)
**Tools Used**: memory_record (2), web_search (1)

---

[Personality traits...]

---

[Base system prompt...]

---

[User information...]

---

[Available skills...]
```

---

## 总结

### 立即实施 (P0)

1. ✅ **时间上下文** - 已完成
2. 🔨 **工作目录上下文** - 30分钟
3. 🔨 **活跃目标提醒** - 20分钟
4. 🔨 **会话统计** - 20分钟

**总计**: 1-2 小时可完成核心动态上下文系统

### 预期收益

- AI 有更强的上下文感知能力
- 更智能的主动建议
- 更好的对话连续性
- 更个性化的响应

### 下一步

要我帮你实现 P0 优先级的 3 个功能吗？预计只需要 1-2 小时就能完成。
