# Beeclaw CLI 参考

Beeclaw 命令行工具提供交互式 AI 对话体验。

## 启动

```bash
# 启动交互式对话
bun run cli

# 禁用工具调用
bun run cli --no-tools

# 守护进程模式（后台调度）
bun run cli --daemon

# 停止守护进程
bun run cli --daemon-stop

# 显示帮助
bun run cli --help
```

## 命令列表

### 模型管理

| 命令 | 说明 |
|------|------|
| `/model` | 显示当前模型信息 |
| `/model list` | 列出所有可用的 Provider 和模型 |
| `/model switch <name> [model]` | 切换到指定的 Provider/模型 |

**示例：**
```
> /model list

📋 Available Providers & Models:

  zhipu (default) ✓
    Type: zhipu
    Models: glm-4, glm-5

  minimax
    Type: minimax
    Models: MiniMax-M2.5

> /model switch minimax MiniMax-M2.5

✅ Switched to minimax / MiniMax-M2.5
```

### 提醒系统

| 命令 | 说明 |
|------|------|
| `/reminder` | 显示待处理的提醒 |
| `/reminder add <time> <msg>` | 添加提醒 |
| `/reminder cancel <id>` | 取消提醒 |
| `/reminder auto` | 切换后台自动检查 |

**时间格式：**
- `10s` - 10秒后
- `5m` - 5分钟后
- `2h` - 2小时后
- `1d` - 1天后
- `14:30` - 今天14:30（如已过则明天）

**示例：**
```
> /reminder add 30s 该休息了

✅ Reminder set for 30s from now (7:30:00 PM)
   Message: "该休息了"

> /reminder

⏰ Pending Reminders:

  1. [reminder-xxx] "该休息了" in 25s

> /reminder cancel 1

✅ Reminder cancelled: "该休息了"
```

### 目标管理

| 命令 | 说明 |
|------|------|
| `/goal` | 列出所有目标 |
| `/goal active` | 列出活跃目标 |
| `/goal get <id>` | 获取目标详情 |
| `/goal create <title>` | 创建新目标 |
| `/goal update <id> <state>` | 更新目标状态 (active/paused/completed/cancelled) |
| `/goal checkpoint <id> <title>` | 添加里程碑 |

**示例：**
```
> /goal create 学习 TypeScript

✅ Created goal: goal-xxx
   Title: 学习 TypeScript

> /goal active

📋 Active Goals:

  1. [goal-xxx] 学习 TypeScript
     Progress: 0% | Created: 2025-02-27

> /goal checkpoint goal-xxx 完成基础语法

✅ Added checkpoint to goal-xxx
```

### 人格管理 (AIEOS)

| 命令 | 说明 |
|------|------|
| `/persona` | 显示当前人格信息 |
| `/persona traits` | 显示心理特质 (MBTI, OCEAN) |
| `/persona export` | 导出人格包 |
| `/persona explain` | 解释特质含义 |

**示例：**
```
> /persona traits

📋 Personality Traits:

MBTI: INTJ
  独立思考者，战略规划

OCEAN (Big Five):
  Openness: 85% - 高度开放
  Conscientiousness: 90% - 高度尽责
  Extraversion: 40% - 较低外向
  Agreeableness: 60% - 适度宜人
  Neuroticism: 15% - 情绪稳定

Linguistic Style:
  Formality: 30% - 轻松自然
  Humor: 35% - 适度幽默
  Directness: 75% - 直接坦率
```

### 记忆管理

| 命令 | 说明 |
|------|------|
| `/memory ls [path]` | 列出记忆目录 |
| `/memory grep <query>` | 全文搜索记忆 |
| `/memory search <query>` | 索引搜索（更快） |
| `/memory read <file>` | 读取记忆文件 |
| `/memory record <cat> <fact>` | 记录事实到指定分类 |
| `/memory index` | 重建关键词索引 |
| `/memory refresh` | 刷新 facts/*.md 到上下文 |
| `/memory compress [--dry-run]` | 压缩旧记忆 |
| `/memory stats` | 显示压缩统计 |

**分类：** `events`（事件）, `investments`（投资）, `lessons`（教训）, `preferences`（偏好）

**示例：**
```
> /memory ls facts

f events.md
f investments.md
f lessons.md
f preferences.md

> /memory ls knowledge

f README.md
f career.md
f family.md
f finance.md
f health.md

> /memory search 裁员

📄 data/memory/facts/lessons.md
   Matched: 裁员

📄 data/memory/facts/events.md
   Matched: 裁员

> /memory record lessons 金融建议前必须核实实时价格

✅ Recorded to facts/lessons.md

> /memory index

✅ Index rebuilt: 100 keywords indexed
   Facts keywords: 25
   Knowledge keywords: 75

> /memory compress --dry-run

🗜️  Memory Compression

  (Dry run - no changes will be made)

  Results:
    Processed: 3
    Summarized: 0
    Archived: 0
    Deleted: 0
```

### 技能管理

| 命令 | 说明 |
|------|------|
| `/skill list` | 列出所有技能 |
| `/skill get <name>` | 获取技能详情 |
| `/skill create <name> <desc>` | 创建新技能 |
| `/skill search <query>` | 搜索技能 |
| `/skill maturity <name>` | 检查技能成熟度 |
| `/skill delete <name>` | 删除技能 |

### 主动调度

| 命令 | 说明 |
|------|------|
| `/proactive` | 列出调度任务 |
| `/proactive add <cron> <type>` | 添加定时任务 |
| `/proactive cancel <id>` | 取消定时任务 |
| `/notifications` | 查看待通知 |

**Cron 格式：** `分 时 日 月 周`

**示例：**
```
> /proactive add "0 9 * * *" check_goal_progress

✅ Created schedule: schedule-xxx
   Cron: 0 9 * * * (daily at 9:00 AM)
   Task: check_goal_progress

> /proactive

📋 Scheduled Tasks:

  1. [schedule-xxx] check_goal_progress
     Cron: 0 9 * * *
     Next run: 2025-02-28 09:00:00
```

### 后台模式

| 命令 | 说明 |
|------|------|
| `/auto` | 切换后台自动模式 |

**后台模式功能：**
- 每 5 秒检查到期提醒
- 自动弹出提醒通知
- 执行定时任务

### 通用命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/clear` | 清除对话历史 |
| `/multi` | 多行输入模式（以 END 结束） |
| `/tools` | 显示可用的 AI 工具 |
| `/quit` 或 `/exit` | 退出 CLI |

### 可用的 AI 工具

执行 `/tools` 命令查看所有可用工具：

**网络工具**:
- 🌐 `web_search` - 多引擎网页搜索
- 📄 `web_fetch` - 获取网页内容
- 🔍 `deep_research` - 深度多角度研究

**文件工具**:
- 📖 `file_read` - 读取本地文件
- ✏️ `file_write` - 写入文件内容
- 📁 `file_list` - 列出目录文件
- 🗑️ `file_delete` - 删除文件

**系统工具**:
- 💻 `shell` - 安全执行 Shell 命令
- 🤖 `claude_code` - Claude Code SDK

**实用工具**:
- 🕐 `time_now` - 获取当前时间
- 🔢 `calc` - 数学计算
- 📦 `code_execute` - 执行 JavaScript
- 🌤️ `weather` - 获取天气信息
- 🔗 `url_shorten` - 短链接生成
- 📱 `qrcode` - 二维码生成

**任务工具**:
- 📋 `task_create` - 创建后台任务
- 📊 `task_status` - 查看任务状态
- 📝 `task_list` - 列出所有任务
- ❌ `task_cancel` - 取消任务

详细文档参见 [工具参考](./tools.md)。

### 多行输入模式

用于粘贴大量内容：

```
> /multi

📝 Multi-line mode enabled. End with 'END':

> 这是一段很长的内容...
> 可以跨多行...
> END

✅ Submitted 3 lines
```

## 配置

### Provider 配置

在 `beeclaw.json` 中配置：

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "models": ["glm-4", "glm-5"],
      "default": true
    },
    {
      "name": "openai",
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}",
      "models": ["gpt-4o", "gpt-4o-mini"]
    },
    {
      "name": "minimax",
      "type": "minimax",
      "apiKey": "${MINIMAX_API_KEY}",
      "models": ["MiniMax-M2.5"]
    }
  ]
}
```

### 环境变量

```bash
export ZHIPU_API_KEY=xxx
export OPENAI_API_KEY=sk-xxx
export MINIMAX_API_KEY=xxx
```

## API 重试机制

API 调用失败时自动重试：

| 错误类型 | 是否重试 |
|----------|----------|
| 网络错误 (ECONNRESET, ETIMEDOUT) | ✅ 重试 |
| 429 Rate Limit | ✅ 重试 |
| 500/502/503 服务器错误 | ✅ 重试 |
| 401 Unauthorized | ❌ 不重试 |
| 404 Not Found | ❌ 不重试 |
| 余额不足 | ❌ 不重试 |

**重试策略：**
- 最大重试次数：3 次
- 初始延迟：1 秒
- 指数退避：每次延迟翻倍
- 最大延迟：60 秒

## 记忆系统

### 目录结构

```
data/memory/
├── SOUL.md           # AI 性格、价值观、行为准则
├── USER.md           # 用户画像（精简版）
├── traits.json       # 心理特质 (MBTI, OCEAN)
├── index.json        # 关键词索引
│
├── facts/            # 动态事实（日/周级更新）
│   ├── events.md     # 近期事件、日程
│   ├── investments.md # 投资持仓
│   ├── lessons.md    # 经验教训
│   └── preferences.md # 用户偏好
│
├── knowledge/        # 稳定知识（月/年级更新）
│   ├── README.md     # 规范文档
│   ├── career.md     # 职业、FIRE计划
│   ├── family.md     # 家庭成员详情
│   ├── finance.md    # 财务概况
│   └── health.md     # 健康信息
│
├── conversations/    # 对话记录
├── decisions/        # 决策记录
├── goals/            # 目标存储
├── proactive/        # 调度配置
├── consolidated/     # 压缩摘要
└── archive/          # 长期存档
```

### facts vs knowledge

| 目录 | 更新频率 | 内容 |
|------|----------|------|
| `facts/` | 日/周级 | 近期事件、投资持仓、经验教训 |
| `knowledge/` | 月/年级 | 家庭、职业、财务概况、健康 |

### 实时刷新

修改 `facts/*.md` 后，执行：

```
> /memory refresh
```

或在代码中启用自动刷新：

```typescript
const agent = createAgent({
  provider,
  model,
  autoRefreshMemory: true,  // 每次对话前自动刷新
});
```

## 守护进程模式

```bash
# 启动守护进程
bun run src/cli.ts --daemon

# 后台运行，支持：
# - 定时任务执行
# - 提醒通知
# - 目标进度检查

# 停止守护进程
bun run src/cli.ts --daemon-stop
```

## 相关文档

| 文档 | 描述 |
|------|------|
| [配置指南](./configuration.md) | 详细配置选项 |
| [记忆设计](./guide/memory-system.md) | 记忆系统设计 |
| [AIEOS 协议](./architecture.md) | 人格协议实现 |
