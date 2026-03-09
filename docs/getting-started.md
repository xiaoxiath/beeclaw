# 快速开始

本指南将帮助你在几分钟内启动 Beeclaw。

## 前置要求

- [Bun](https://bun.sh/) >= 1.0.0
- 一个 AI API 密钥（智谱 GLM、OpenAI 或其他兼容提供商）

## 安装

```bash
# 克隆项目
git clone <your-repo-url>
cd beeclaw

# 安装依赖
bun install
```

## 配置

### 1. 创建配置文件

```bash
# 复制示例配置
cp beeclaw.example.json beeclaw.json
```

### 2. 配置 AI 提供商

编辑 `beeclaw.json`：

**使用智谱 GLM（推荐国内用户）：**

```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "models": ["glm-4", "glm-5"],
      "default": true
    }
  ],
  "agents": [
    {
      "id": "beeclaw",
      "name": "Beeclaw Assistant",
      "provider": "zhipu",
      "model": "glm-4",
      "systemPrompt": "You are Beeclaw, a helpful AI assistant.",
      "tools": ["memory_*", "goal_*", "skill_*", "persona_*"]
    }
  ]
}
```

**使用 OpenAI：**

```json
{
  "providers": [
    {
      "name": "openai",
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}",
      "baseUrl": "https://api.openai.com/v1",
      "models": ["gpt-4o", "gpt-4o-mini"],
      "default": true
    }
  ]
}
```

### 3. 设置环境变量

```bash
# 方式一：直接设置
export ZHIPU_API_KEY=your-key-here

# 方式二：使用 .env 文件
echo "ZHIPU_API_KEY=your-key-here" > .env
```

## 使用方式

### CLI 模式

```bash
# 启动交互式 CLI
bun run cli

# 禁用工具调用（纯聊天）
bun run cli --no-tools

# 启动守护进程（后台调度）
bun run cli --daemon
```

### 飞书 Bot 模式

```bash
# 设置飞书凭证
export LARK_BEECLAW_APPID="cli_xxxxxxxxxxxx"
export LARK_BEECLAW_AS="your-app-secret"

# 启动 Bot
bun run bot
```

详见 [飞书指南](./feishu-guide.md)。

## CLI 基本使用

### 常用命令

```
> /help                        # 显示帮助
> /model list                  # 列出可用模型
> /model switch zhipu glm-4    # 切换模型
> /goal create 学习新技能      # 创建目标
> /memory record user 我喜欢简洁的代码  # 记录事实
> /quit                        # 退出
```

### 多行输入

粘贴大量内容时会自动检测并显示摘要。

## 下一步

- [CLI 参考](./cli-reference.md) - CLI 命令详解
- [飞书指南](./feishu-guide.md) - 飞书 Bot 配置
- [配置指南](./configuration.md) - 详细配置选项
- [记忆系统](./guide/memory-system.md) - 记忆系统设计

## 故障排除

### API 密钥无效

确保环境变量正确设置：

```bash
echo $ZHIPU_API_KEY
```

### 依赖问题

```bash
# 清理并重新安装
rm -rf node_modules bun.lock
bun install
```

### 飞书连接失败

1. 检查 App ID 和 App Secret 是否正确
2. 确保应用已发布并可用
3. 检查网络是否能访问 `open.feishu.cn`
