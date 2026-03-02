# Beeclaw 架构设计

## 核心系统

### 1. Agent 系统

Agent 是 AI 对话的核心，负责：
- 管理对话历史
- 调用 AI API
- 执行工具调用
- 上下文管理

#### 上下文管理（Context Management）

基于 Token 的智能上下文管理，防止对话超出模型限制：

```typescript
// 配置
interface ContextConfig {
  maxTokens: 120000;           // 最大 token 数（留 8k 给响应）
  keepRecent: 6;               // 始终保留最近 N 条消息
  keepSystem: true;            // 始终保留 system prompt
  compressionThreshold: 0.8;   // 80% 时触发压缩
}
```

**压缩策略：**
1. 当 tokens > maxTokens × 0.8 时触发
2. 保留：system prompt + 最近 6 条消息
3. 压缩中间消息：
   - Tool result：截断长数组、长字符串
   - Assistant：摘要 tool calls、压缩代码块
4. 不调用额外 AI，纯规则压缩

**文件：**
- `src/agent/index.ts` - Agent 类
- `src/agent/context.ts` - Token 估算和压缩工具
- `src/agent/tools.ts` - System Prompt 构建

### 2. 记忆系统

双层存储架构：

```
data/memory/
├── SOUL.md           # AI 人格设定
├── USER.md           # 用户信息（精简）
├── facts/            # 动态事实（日/周级更新）
│   ├── events.md     # 近期事件
│   ├── preferences.md # 偏好设置
│   └── lessons.md    # 经验教训
├── knowledge/        # 稳定知识（月/年级更新）
│   ├── career.md     # 职业信息
│   └── family.md     # 家庭信息
├── conversations/    # 对话记录（按月/天）
├── consolidated/     # 压缩摘要
└── archive/          # 长期存档
```

**记忆压缩：**
- 7 天后自动压缩为摘要
- 90 天后归档
- 基于重要性评分决定保留/摘要/删除

**文件：**
- `src/memory/store.ts` - 存储管理
- `src/memory/indexer.ts` - 关键词索引
- `src/memory/compression.ts` - 压缩系统
- `src/memory/scoring.ts` - 重要性评分

### 3. 进化系统（Evolution）

LLM 驱动的自我进化能力：

**偏好学习：**
- LLM 在对话中自动检测用户偏好
- 通过 `memory_write` 保存到 `facts/preferences.md`

**技能沉淀：**
- LLM 发现重复模式时自动创建技能
- 通过 `skill_create` 创建新技能
- 通过 `skill_update` 改进技能

**反思改进：**
- LLM 收到纠正时分析原因
- 通过 `skill_record` 记录成功/失败
- 改进后的技能自动可用

**自我进化（Self-Evolution）：**
- 定期审视 `facts/lessons.md` 中的经验教训
- 提炼成抽象原则，更新到 `SOUL.md`
- 保持 SOUL.md 风格：英文、简洁、有力
- 每天凌晨 4:00 自动执行（daemon 模式）
- 最多保留 6 条核心原则

```
每天 4:00 AM
    │
    ▼
读取 SOUL.md (当前身份)
    │
    ▼
读取 lessons.md (最近教训)
    │
    ▼
分析模式、提炼原则
    │
    ▼
需要更新？
    ├─ 是 → 更新 SOUL.md
    └─ 否 → 跳过
```

**文件：**
- `src/evolution/reflection-trigger.ts` - 统计记录
- `src/evolution/preference-learning.ts` - 类型定义
- `src/evolution/self-evolution.ts` - 自我进化调度
- `skills/beeclaw-reflection/SKILL.md` - 反思技能
- `skills/beeclaw-self-evolution/SKILL.md` - 自我进化技能

### 4. 技能系统

动态技能管理：

```
skills/
├── skill-name/
│   ├── SKILL.md          # 技能定义（必需）
│   ├── scripts/          # 可执行脚本
│   ├── references/       # 参考文档
│   ├── agents/           # Agent 指令
│   └── evals/            # 评估测试
```

**技能工具：**

| 工具 | 用途 | 推荐度 |
|------|------|--------|
| `skill_ensure` | 创建或更新技能（自动判断） | ⭐ 推荐 |
| `skill_create` | 仅创建新技能 | 特殊场景 |
| `skill_update` | 仅更新已有技能 | 特殊场景 |
| `skill_search` | 搜索技能 | 查找时用 |
| `skill_record` | 记录使用结果 | 成熟度追踪 |
| `skill_maturity` | 检查成熟度 | 发布前用 |

**推荐流程：**
```
skill_ensure → skill_record → skill_maturity
```

**skill_ensure 优势：**
- 自动检测技能是否存在
- 存在则更新，不存在则创建
- 无需先搜索再决定用哪个工具
- 返回明确结果（created/updated）

**文件：**
- `src/skills/store.ts` - 技能存储
- `src/skills/tools.ts` - 技能工具

### 5. 会话系统

跨会话对话管理：

```typescript
interface Session {
  id: string;
  userId: string;
  messages: SessionMessage[];
  summary?: string;     // 历史摘要
}
```

- 存储路径：`data/memory/sessions/{sessionId}.json`
- 内存缓存活跃会话
- 消息数超过 20 时压缩为摘要

**文件：**
- `src/session/index.ts` - 会话管理

## 飞书集成

### 消息流程

```
用户消息 → WebSocket → 添加表情确认 → Session Manager → Agent → 回复
```

**文件：**
- `src/feishu/ws-client.ts` - WebSocket 客户端
- `src/feishu/client.ts` - API 客户端
- `src/routes/proactive.ts` - 消息处理

### 表情回复

随机从以下表情中选择：
- Typing
- Get
- LGTM
- Coffee
- Status_PrivateMessage
- OK

## 配置

### AI Provider

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "models": ["glm-4"],
      "default": true
    }
  ]
}
```

### 环境变量

```bash
# AI Provider
ZHIPU_API_KEY=your-key

# 飞书 Bot
LARK_BEECLAW_APPID=cli_xxx
LARK_BEECLAW_AS=your-secret
```

## 测试

```bash
# 运行所有测试
bun test

# 运行特定测试
bun test src/agent/__tests__/context.test.ts
```

## 关键设计决策

### 1. 为什么用文件系统而非数据库？

- 简单、透明、易于调试
- AI 可以直接读写文件
- 版本控制友好
- 无需额外依赖

### 2. 为什么上下文压缩不用 AI？

- 速度：无额外 API 调用
- 成本：不增加 token 消耗
- 可靠性：规则稳定可控
- 足够好：保留关键信息

### 3. 为什么进化检测用 LLM 而非正则？

- 语义理解：能理解复杂表达
- 零维护：无需手动维护模式
- 上下文：结合对话判断
- 无额外成本：主对话 LLM 顺便处理

### 4. 为什么自我进化要定时执行？

- 避免频繁修改：原则应该稳定，不是每条消息都变
- 批量处理：积累多条教训后一起提炼更高效
- 异步执行：不阻塞用户对话
- 可控性：用户可以手动触发或关闭
