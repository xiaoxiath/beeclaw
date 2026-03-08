# 智能会话功能和动态上下文

> 实施日期: 2026-02-28
> 状态: ✅ 已完成

本文档描述了 Beeclaw 的两个智能功能：动态日期时间提示词和智能会话恢复。

---

## 1. 动态日期时间提示词

### 功能说明

在每次对话开始时，自动在 System Prompt 中注入当前日期时间信息，让 AI 知道"现在是什么时候"。

### 实现位置

`src/agent/tools.ts` - `buildSystemPrompt()` 函数

### 注入的信息

```markdown
# Current Context

**Date**: 2026年2月28日 星期五
**Time**: 21:30
**Timezone**: Asia/Shanghai

---
```

### 使用效果

AI 现在可以：
- 知道今天是星期几
- 知道具体时间（用于时间相关的提醒）
- 理解时区信息
- 在回答时考虑当前时间上下文

### 示例对话

```
用户: 帮我安排明天的任务

AI: 好的！今天是 2026年2月28日 星期五，明天是周六。
    我可以帮你规划周末的任务安排...
```

### 技术实现

```typescript
// src/agent/tools.ts

export function buildSystemPrompt(
  basePrompt: string,
  coreContext?: { user: string; soul: string; facts?: string; skills?: string }
): string {
  let prompt = basePrompt;

  // Add dynamic date/time context at the top
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const timeStr = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  prompt = `# Current Context

**Date**: ${dateStr}
**Time**: ${timeStr}
**Timezone**: ${timezone}

---

${prompt}`;

  // ... rest of the function
}
```

---

## 2. 智能会话恢复

### 功能说明

根据当前工作上下文（工作目录、最近文件等），在 CLI 启动时推荐相关的历史会话。

### 实现位置

- `src/session/recommender.ts` - 推荐引擎
- `src/cli.ts` - 集成到 CLI 启动流程

### 推荐算法

#### 评分维度

1. **时间相关性** (30% 权重)
   - 24小时内: 1.0
   - 本周内: 0.7
   - 本月内: 0.4
   - 更早: 0.2

2. **路径相似度** (40% 权重)
   - 从当前工作目录提取关键词
   - 与会话 ID 中的关键词匹配
   - 使用集合相似度计算

3. **内容匹配度** (30% 权重)
   - 检查会话消息中是否包含当前上下文关键词
   - 扫描最近 10 条消息
   - 每个匹配 +0.1 分，最高 1.0

#### 上下文收集

```typescript
interface RecommenderContext {
  workingDirectory: string;    // 当前工作目录
  recentFiles?: string[];      // 最近修改的文件
  currentTime?: Date;          // 当前时间
  keywords?: string[];         // 额外关键词
}
```

### CLI 启动效果

```bash
$ bun run src/cli.ts

🐝 Beeclaw CLI
Type /help for available commands, /quit to exit

✅ Systems initialized
📁 Memory: ./data/memory
📬 Session: cli-keith-2026-02-28 (5 messages)

💡 Related sessions found:
1. cli-keith-2026-02-27
   📅 2月27日 18:30 | 💬 15 messages | 🎯 85% match
   🕐 Recent session | 📁 Related to current directory

2. cli-keith-beeclaw-2026-02-25
   📅 2月25日 14:20 | 💬 32 messages | 🎯 72% match
   💬 Discusses: beeclaw, session, refactor

   Use /sessions to see all sessions
```

### 查看所有会话

```bash
> /sessions

📋 8 Sessions:

  CLI (6):
    • cli-keith-2026-02-28 (5 msgs, 2月28日 21:30) ✓
    • cli-keith-2026-02-27 (15 msgs, 2月27日 18:30)
    • cli-keith-beeclaw-2026-02-25 (32 msgs, 2月25日 14:20)
    • cli-keith-2026-02-24 (8 msgs, 2月24日 09:15)
    ... and 2 more

  FEISHU (2):
    • feishu-ou_xxx-2026-02-28 (12 msgs, 2月28日 16:45)
    • feishu-ou_xxx-2026-02-27 (20 msgs, 2月27日 10:30)
```

### 核心代码

#### 推荐引擎

```typescript
// src/session/recommender.ts

export function recommendSessions(
  context: RecommenderContext,
  options?: {
    maxRecommendations?: number;
    minRelevanceScore?: number;
  }
): SessionRecommendation[] {
  const maxRecommendations = options?.maxRecommendations || 5;
  const minRelevanceScore = options?.minRelevanceScore || 0.3;

  // Get all sessions
  const allSessions = listSessions();

  // Filter out today's CLI session
  const today = new Date().toISOString().split('T')[0];
  const candidateSessions = allSessions.filter(s =>
    !(s.channel === 'cli' && s.id.includes(today))
  );

  // Extract keywords from context
  const contextKeywords = [
    ...extractPathKeywords(context.workingDirectory),
    ...(context.keywords || []),
  ];

  // Score each session
  const recommendations: SessionRecommendation[] = [];

  for (const session of candidateSessions) {
    const reasons: string[] = [];
    let totalScore = 0;

    // 1. Time relevance (weight: 30%)
    const timeRelevance = calculateTimeRelevance(session.updatedAt);
    totalScore += timeRelevance * 0.3;

    // 2. Path similarity (weight: 40%)
    const sessionKeywords = session.id.split('-').filter(Boolean);
    const pathSimilarity = calculateKeywordSimilarity(contextKeywords, sessionKeywords);
    totalScore += pathSimilarity * 0.4;

    // 3. Content match (weight: 30%)
    const contentMatch = checkContentMatch(session, contextKeywords);
    totalScore += contentMatch.score * 0.3;

    if (totalScore >= minRelevanceScore) {
      recommendations.push({
        sessionId: session.id,
        session,
        relevanceScore: totalScore,
        reasons,
      });
    }
  }

  return recommendations
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxRecommendations);
}
```

#### CLI 集成

```typescript
// src/cli.ts

// Smart session recommendations
try {
  const recommendations = recommendSessions({
    workingDirectory: process.cwd(),
    currentTime: new Date(),
  }, {
    maxRecommendations: 3,
    minRelevanceScore: 0.3,
  });

  if (recommendations.length > 0) {
    console.log('\n💡 Related sessions found:');
    for (let i = 0; i < recommendations.length; i++) {
      console.log(formatRecommendation(recommendations[i], i));
    }
    console.log('   Use /sessions to see all sessions');
  }
} catch (error) {
  // Recommender might fail, that's ok
}
```

---

## 3. 使用场景

### 场景 1: 项目切换

```bash
cd ~/workspace/project-a
bun run src/cli.ts

# 推荐 project-a 相关的历史会话
```

### 场景 2: 日常工作中断后恢复

```bash
# 早上打开 CLI
bun run src/cli.ts

# 推荐昨天的工作会话
# 💡 Related sessions found:
# 1. cli-keith-2026-02-27
#    📅 2月27日 18:30 | 💬 15 messages | 🎯 85% match
#    🕐 Recent session
```

### 场景 3: 跨渠道会话查看

```bash
> /sessions

# 查看所有渠道的会话（CLI, 飞书 Bot 等）
# 可以了解在飞书中的对话历史
```

---

## 4. 配置选项

### 推荐引擎配置

```typescript
recommendSessions(context, {
  maxRecommendations: 3,      // 最多推荐 3 个会话
  minRelevanceScore: 0.3,     // 最低相关性分数 (0-1)
});
```

### 调整评分权重

可以在 `src/session/recommender.ts` 中调整权重：

```typescript
// 当前权重
totalScore += timeRelevance * 0.3;     // 30%
totalScore += pathSimilarity * 0.4;    // 40%
totalScore += contentMatch * 0.3;      // 30%
```

---

## 5. 未来优化方向

### 已实现 ✅
- [x] 动态日期时间注入
- [x] 基于工作目录的会话推荐
- [x] 时间相关性评分
- [x] 内容关键词匹配
- [x] `/sessions` 命令

### 待实现 🚧
- [ ] `/session <id>` - 切换到指定会话
- [ ] `/session new` - 创建新会话（非今日）
- [ ] 会话搜索功能 (`/session search <query>`)
- [ ] 会话标签系统
- [ ] 基于文件修改时间的更智能推荐
- [ ] 会话主题自动提取
- [ ] 跨会话主题关联

---

## 6. 相关文件

| 文件 | 描述 |
|------|------|
| `src/agent/tools.ts` | 动态日期时间注入 |
| `src/session/recommender.ts` | 会话推荐引擎 |
| `src/cli.ts` | CLI 集成 |
| `src/session/index.ts` | SessionManager |

---

## 7. 总结

这两个功能显著提升了用户体验：

1. **动态日期时间** - AI 现在有时间意识，可以更好地理解时间相关的请求
2. **智能会话恢复** - 用户可以轻松找到并恢复相关的历史对话

结合之前的**统一会话管理**，Beeclaw 现在提供了完整的会话生命周期管理：
- ✅ 会话持久化
- ✅ 跨渠道共享
- ✅ 智能推荐
- ✅ 时间上下文
