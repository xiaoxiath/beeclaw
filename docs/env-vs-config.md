# .env vs beeclaw.json 配置对比分析

## 📊 配置分布统计

### .env 文件（25项配置)
```
AI Provider API Keys (2):
  - ZHIPU_API_KEY
  - MINIMAX_API_KEY

Feishu Bot (2):
  - LARK_BEECLAW_APPID
  - LARK_BEECLAW_AS

服务器配置 (2):
  - BEECLAW_PORT
  - BEECLAW_HOST

认证配置 (2):
  - BEECLAW_SHOW_THINKING
  - BEECLAW_SHOW_TOOL_PROCESS

天气 API (1):
  - QWEATHER_API_KEY
  - QWEATHER_APIHOST
  - QWEATHER_LOCATION

搜索 API (6):
  - BOCHA_API_KEY
  - TAVILY_API_KEY
  - GOOGLE_SEARCH_API_KEY
  - GOOGLE_SEARCH_CX
  - BING_SEARCH_API_KEY
  - BRAVE_SEARCH_API_KEY

Web UI (2):
  - WEBUI_PORT
  - WEBUI_AUTH_TOKEN

Token 统计 (1):
  - BEECLAW_SHOW_TOKEN_STATS

其他 (7):
  - DEBUG
  - NODE_ENV
  - TZ
  - LANG
  - TERM
  - PAGER
  - http_proxy
  - https_proxy
```

### beeclaw.json 文件
```
AI Providers (1 provider):
  - zhipu: 模型配置, API Key)

Roles (4 roles):
  - chat
  - fast
  - vision
  - embedding

LLM Router:
  - enabled
  - tiers
  - fallbackEnabled
  - costTracking

Agent:
  - role
  - visionRole
  - name
  - systemPrompt

Tool Selector:
  - embedding
  - strategy
  - maxTools

Compression:
  - role
  - enabled
  - threshold
  - keepRecent
  - maxSummaryTokens
  - strategy

Feishu:
  - enabled
  - appId (引用环境变量)
  - appSecret (引用环境变量)
  - useCardV2
  - logLevel

User:
  - location
  - timezone
  - locale

Weather:
  - apiHost
  - apiKey (引用环境变量)
  - defaultLocation

Memory:
  - type
  - path
  - tools
  - retention

MCP:
  - enabled
  - servers

Hooks:
  - enabled
  - directories

Logging:
  - level
  - format

Web:
  - enabled
  - port
  - auth
```

## 🎯 配置分类

### ✅ 必须在 .env 中（敏感信息)

1. **API Keys**
   - ZHIPU_API_KEY
   - MINIMAX_API_KEY
   - BOCHA_API_KEY
   - TAVILY_API_KEY
   - QWEATHER_API_KEY
   - WEBUI_AUTH_TOKEN

2. **Secret**
   - LARK_BEECLAW_APPID
   - LARK_BEECLAW_AS
   - GOOGLE_SEARCH_CX

3. **认证**
   - BEECLAW_AUTH_PASSWORD (如果启用)

### ✅ 可以合并到 beeclaw.json 中(非敏感信息)

1. **服务器配置**
   ```json
   "web": {
     "port": "${BEECLAW_PORT}",
     "host": "${BEECLAW_HOST}"
   }
   ```

2. **功能开关**
   ```json
   "tokenStats": {
     "enabled": "${BEECLAW_SHOW_TOKEN_STATS}"
   }
   ```

3. **日志配置**
   ```json
   "logging": {
     "level": "debug"  // 如果需要调试
   }
   ```

### ❌ 建议移除或保持现状

1. **Thinking 模式** - 未使用，可移除
2. **Tool Process** - 未使用，可移除
3. **天气默认位置** - 与 user.location 重复

4. **搜索引擎 API Keys** - 未使用，可移除

   - GOOGLE_SEARCH_API_KEY
   - BING_SEARCH_API_KEY
   - BRAVE_SEARCH_API_KEY

5. **多余的环境变量** - 未使用，可移除
   - DEBUG
   - NODE_ENV
   - TZ
   - LANG
   - TERM
   - PAGER

   - http_proxy
   - https_proxy

```

## 💡 迁移建议

### 第一步： 清理未使用的配置
```diff
# 移除未使用的配置
-BEECLAW_SHOW_THINKING
-BEECLAW_SHOW_TOOL_PROCESS
-QWEATHER_LOCATION  # 使用 user.location
-GOOGLE_SEARCH_API_KEY
-GOOGLE_SEARCH_CX
-BING_SEARCH_API_KEY
-BRAVE_SEARCH_API_KEY
-DEBUG
-NODE_ENV
-TZ
-LANG
-TERM
-PAGER
-http_proxy
-https_proxy
```

### 第二步: 迁移服务器配置到 beeclaw.json
```json
"web": {
  "enabled": false,
  "port": "${BEECLAW_PORT}",
  "host": "${BEECLAW_HOST}"
}
```

### 第三步: 迁移 Token 统计配置
```json
"tokenStats": {
  "enabled": "${BEECLAW_SHOW_TOKEN_STATS}"
}
```

### 第四步: 更新 .env.example
```diff
# 移除已迁移的环境变量
# BEECLAW_PORT
# BEECLAW_HOST
# BEECLAW_SHOW_TOKEN_STATS

```

保留未使用的环境变量作为示例（注释掉）```
# 示例配置（已注释)
# GOOGLE_SEARCH_API_KEY=your_google_api_key
# GOOGLE_SEARCH_CX=your_custom_search_engine_id
```
```

## 📋 最终配置文件结构

### .env (敏感信息)
```bash
# AI Provider API Keys
ZHIPU_API_KEY=your_key_here
MINIMAX_API_KEY=your_key_here

# Feishu Bot
LARK_BEECLAW_APPID=cli_xxxxxxxxxxxx
LARK_BEECLAW_AS=your_app_secret

# Weather API
QWEATHER_API_KEY=your_key_here

# Search APIs
BOCHA_API_KEY=your_key_here
TAVILY_API_KEY=your_key_here

# Web UI
WEBUI_AUTH_TOKEN=your_token_here
```

### beeclaw.json (业务配置)
```json
{
  "providers": [...],
  "roles": {...},
  "web": {
    "enabled": false,
    "port": "${BEECLAW_PORT}",
    "host": "${BEECLAW_HOST}"
  },
  "tokenStats": {
    "enabled": "${BEECLAW_SHOW_TOKEN_STATS}"
  },
  ...
}
```

```

## ✅ 优势
- **安全**: 敏感信息不会提交到 Git
- **灵活**: 支持环境变量插值
- **清晰**: 配置职责分离

- **可维护**: 易于理解和修改

