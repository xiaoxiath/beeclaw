# Beeclaw 快速配置指南

## 最快上手方式（30 秒）

```bash
# 1. 复制配置模板
cp .env.example .env

# 2. 编辑 .env，填入 API Key
echo 'ZHIPU_API_KEY=your_key_here' >> .env

# 3. 启动
bun run start
```

完成！🎉

---

## 配置方式对比

| 方式 | 难度 | 灵活性 | 推荐场景 |
|------|------|--------|----------|
| 环境变量 | ⭐ 最简单 | 中等 | 快速测试、单一环境 |
| 配置文件 | ⭐⭐ 简单 | 高 | 多环境、复杂配置 |
| 混合使用 | ⭐⭐⭐ 中等 | 最高 | 生产环境、多模型 |

---

## 方式 1: 纯环境变量（推荐新手）

### CLI 模式

```bash
# 创建 .env
cat > .env << 'EOF'
ZHIPU_API_KEY=your_zhipu_api_key_here
EOF

# 启动 CLI
bun run cli
```

### 飞书 Bot 模式

```bash
# 创建 .env
cat > .env << 'EOF'
ZHIPU_API_KEY=your_zhipu_api_key_here
LARK_BEECLAW_APPID=cli_xxxxxxxxxxxx
LARK_BEECLAW_AS=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EOF

# 启动 Bot
bun run start
```

**优点**:
- ✅ 最简单
- ✅ 敏感信息不进代码库
- ✅ 适合快速测试

**缺点**:
- ❌ 不适合复杂配置
- ❌ 环境变量多了难管理

---

## 方式 2: 配置文件（推荐进阶）

### 创建 beeclaw.json

```bash
cat > beeclaw.json << 'EOF'
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "models": ["glm-5"],
      "default": true
    }
  ],
  "agents": [
    {
      "id": "default",
      "name": "GLM Assistant",
      "provider": "zhipu",
      "model": "glm-5",
      "systemPrompt": "你是一个有用的AI助手。",
      "maxTokens": 65536
    }
  ]
}
EOF
```

### 配合环境变量

```bash
# .env
ZHIPU_API_KEY=your_api_key
```

**优点**:
- ✅ 配置结构清晰
- ✅ 可以版本控制（不含敏感信息）
- ✅ 支持多环境

**缺点**:
- ❌ 需要维护两个文件

---

## 方式 3: 混合配置（推荐生产）

### 目录结构

```
beeclaw/
├── .env                    # 敏感信息
├── .env.production         # 生产环境
├── beeclaw.json           # 基础配置
└── beeclaw.prod.json      # 生产配置
```

### 配置示例

`.env`:
```env
ZHIPU_API_KEY=dev_api_key
BEECLAW_LOG_LEVEL=debug
```

`.env.production`:
```env
ZHIPU_API_KEY=prod_api_key
BEECLAW_LOG_LEVEL=warn
BEECLAW_AUTH_ENABLED=true
BEECLAW_AUTH_PASSWORD=secure_password
```

`beeclaw.json`:
```json
{
  "providers": [
    {
      "name": "zhipu-vision",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "models": ["GLM-4.6V"],
      "default": true
    }
  ],
  "agents": [
    {
      "id": "vision-agent",
      "provider": "zhipu-vision",
      "model": "GLM-4.6V",
      "systemPrompt": "视觉助手",
      "default": true
    }
  ]
}
```

**优点**:
- ✅ 安全：敏感信息与环境隔离
- ✅ 灵活：支持多环境切换
- ✅ 清晰：配置分层明确

---

## 常见配置场景

### 场景 1: 仅使用 CLI

最简单配置：

```bash
export ZHIPU_API_KEY="your_key"
bun run cli
```

### 场景 2: 飞书机器人 + 视觉识别

`.env`:
```env
ZHIPU_API_KEY=your_key
LARK_BEECLAW_APPID=cli_xxx
LARK_BEECLAW_AS=xxx_secret
```

`beeclaw.json`:
```json
{
  "providers": [
    {
      "name": "zhipu-vision",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "models": ["GLM-4.6V"],
      "default": true
    }
  ],
  "agents": [
    {
      "id": "vision-agent",
      "provider": "zhipu-vision",
      "model": "GLM-4.6V",
      "systemPrompt": "你是一个视觉助手，可以识别和分析图片。",
      "default": true
    }
  ]
}
```

### 场景 3: 多模型切换

`beeclaw.json`:
```json
{
  "providers": [
    {
      "name": "zhipu-text",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "models": ["glm-5"]
    },
    {
      "name": "zhipu-vision",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",
      "models": ["GLM-4.6V"],
      "default": true
    }
  ],
  "agents": [
    {
      "id": "text-agent",
      "provider": "zhipu-text",
      "model": "glm-5",
      "systemPrompt": "文本助手"
    },
    {
      "id": "vision-agent",
      "provider": "zhipu-vision",
      "model": "GLM-4.6V",
      "systemPrompt": "视觉助手",
      "default": true
    }
  ]
}
```

### 场景 4: 生产环境部署

`.env.production`:
```env
ZHIPU_API_KEY=prod_api_key
BEECLAW_PORT=8080
BEECLAW_HOST=127.0.0.1
BEECLAW_AUTH_ENABLED=true
BEECLAW_AUTH_PASSWORD=change_me_to_secure_password
BEECLAW_LOG_LEVEL=warn
LARK_BEECLAW_APPID=cli_prod
LARK_BEECLAW_AS=prod_secret
```

启动：
```bash
NODE_ENV=production bun run start
```

---

## 配置项速查

### 必需配置

| 配置 | 环境变量 | 获取方式 |
|-----|----------|----------|
| 智谱 API Key | `ZHIPU_API_KEY` | https://open.bigmodel.cn/ |

### 可选配置

| 分类 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| **服务器** |
| 端口 | `BEECLAW_PORT` | 3000 | HTTP 端口 |
| 主机 | `BEECLAW_HOST` | 0.0.0.0 | 绑定地址 |
| **认证** |
| 启用 | `BEECLAW_AUTH_ENABLED` | false | 是否启用 |
| 密码 | `BEECLAW_AUTH_PASSWORD` | - | HTTP 密码 |
| **日志** |
| 级别 | `BEECLAW_LOG_LEVEL` | info | debug/info/warn/error |
| **飞书** |
| App ID | `LARK_BEECLAW_APPID` | - | 飞书应用 ID |
| App Secret | `LARK_BEECLAW_AS` | - | 飞书应用密钥 |

---

## 环境变量完整列表

### AI Provider

```bash
# 智谱（推荐）
ZHIPU_API_KEY=your_key

# MiniMax（可选）
MINIMAX_API_KEY=your_key
```

### 服务器

```bash
BEECLAW_PORT=3000          # 端口
BEECLAW_HOST=0.0.0.0       # 主机
```

### 认证

```bash
BEECLAW_AUTH_ENABLED=false     # 启用认证
BEECLAW_AUTH_PASSWORD=secret   # 认证密码
```

### 日志

```bash
BEECLAW_LOG_LEVEL=info  # debug, info, warn, error
```

### 飞书

```bash
LARK_BEECLAW_APPID=cli_xxx      # 应用 ID
LARK_BEECLAW_AS=xxx_secret      # 应用密钥
```

---

## 配置验证

启动后检查配置是否正确：

```bash
bun run cli

# 在 CLI 中
> /status
```

会显示：
- 当前使用的 Provider
- 模型配置
- 内存路径
- 飞书配置状态

---

## 动态上下文配置（可选）

Beeclaw 支持在系统提示词中注入动态上下文信息，包括：

### 1. 节假日信息（自动启用）

自动从 holiday.ailcc.com API 获取中国节假日信息，无需配置。

**示例输出**:
```
今天是 2026-03-02 周一，【工作日】
今天是 2026-10-01 周四，【国庆节假期】
今天是 2026-02-28 周六，【调休工作日】
```

### 2. 天气信息（可选）

通过和风天气 API 获取实时天气信息。

**配置方式**:

```bash
# 在 .env 中添加
QWEATHER_APIHOST=devapi.qweather.com  # 或 api.qweather.com (生产环境)
QWEATHER_TOKEN=your_token_here         # 从 https://dev.qweather.com/ 获取
QWEATHER_LOCATION=北京                  # 默认查询城市
```

**示例输出**:
```
北京当前天气：晴，温度5°C，西北风3-4级，湿度20%
```

**获取 Token**:
1. 访问 [和风天气开发者平台](https://dev.qweather.com/)
2. 注册账号并创建应用
3. 复制 JWT Token 到 `QWEATHER_TOKEN`

**不配置的影响**: 天气信息不会显示，但不影响其他功能。

---

## 常见问题

### Q: 飞书配置可选吗？

**A**: 是的！飞书是可选的。如果只用 CLI 模式，无需配置飞书。

### Q: 必须用 beeclaw.json 吗？

**A**: 不必须！纯环境变量就可以运行。配置文件是为了更复杂的场景。

### Q: 如何切换模型？

**A**: 两种方式：
1. 环境变量：在 `.env` 中修改，重启生效
2. 配置文件：修改 `beeclaw.json` 中的 `default` agent

### Q: 配置优先级是什么？

**A**: 环境变量 > 配置文件 > 默认值

---

## 下一步

- 📖 [完整配置参考](./configuration.md)
- 🚀 [快速开始](./getting-started.md)
- 🤖 [飞书集成](./feishu-integration.md)
