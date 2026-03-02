# Beeclaw

AI 助手 - 支持 CLI 和飞书 Bot 两种使用方式。

## 使用方式

```bash
# CLI 模式 - 交互式命令行
bun run cli

# Bot 模式 - 飞书机器人
bun run bot
```

## 快速开始

### 1. 安装

```bash
bun install
```

### 2. 配置 AI Provider

创建 `beeclaw.json`：

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

### 3. 设置环境变量

```bash
export ZHIPU_API_KEY=your-key-here
```

### 4. 启动 CLI

```bash
bun run cli
```

## 飞书 Bot

### 1. 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 启用机器人能力
4. 获取 App ID 和 App Secret

### 2. 配置权限

- `im:message` - 获取与发送消息
- `im:message:send_as_bot` - 以应用身份发送消息

### 3. 设置环境变量

```bash
export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
export LARK_BEECLAW_AS="your-app-secret"
```

### 4. 启动 Bot

```bash
bun run bot
```

## CLI 命令

```
/help              显示帮助
/quit              退出
/clear             清除对话历史
/model list        列出可用模型
/model switch <name> [model]  切换模型

# 记忆管理
/memory ls <path>          列出记忆目录
/memory grep <query>       搜索记忆
/memory record <cat> <fact> 记录事实

# 目标管理
/goal                       列出所有目标
/goal create <title>        创建新目标
/goal update <id> <state>   更新目标状态

# 技能管理
/skill list                 列出所有技能
/skill get <name>           获取技能详情
```

## 项目结构

```
src/
├── cli.ts            # CLI 入口
├── bot.ts            # 飞书 Bot 入口
├── agent/            # AI Agent 核心
├── memory/           # 记忆系统
│   ├── store.ts      # 存储管理
│   ├── indexer.ts    # 关键词索引
│   ├── compression.ts # 压缩系统
│   └── tools.ts      # 记忆工具
├── goal/             # 目标系统
├── skills/           # 技能系统
├── feishu/           # 飞书集成
└── routes/           # 集成逻辑

data/memory/
├── SOUL.md           # AI 人格设定
├── USER.md           # 用户信息（精简）
├── facts/            # 动态事实（日/周级）
│   ├── events.md     # 近期事件
│   ├── investments.md # 投资持仓
│   ├── lessons.md    # 经验教训
│   └── preferences.md # 偏好设置
└── knowledge/        # 稳定知识（月/年级）
    ├── career.md     # 职业与FIRE
    ├── family.md     # 家庭详情
    ├── finance.md    # 财务概况
    └── health.md     # 健康信息
```

## 文档

| 文档 | 描述 |
|------|------|
| [架构设计](./ARCHITECTURE.md) | 系统架构和核心设计 |
| [进化系统](./skills/beeclaw-reflection/SKILL.md) | 自我进化和学习机制 |

## License

MIT
