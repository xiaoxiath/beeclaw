# 配置管理最佳实践

## 📁 文件结构

```
beeclaw/
├── .env                    # 本地敏感配置（已在 .gitignore）
├── .env.example            # 敏感配置模板（提交到 Git）
├── beeclaw.json            # 本地完整配置（已在 .gitignore）
├── beeclaw.example.json    # 配置模板（提交到 Git）
└── beeclaw.schema.json     # JSON Schema（提交到 Git）
```

## 🎯 配置分层策略

### Layer 1: 环境变量（.env）- 敏感信息

**用途**: 存储 API Keys、密码等敏感信息

**示例** (.env.example):
```bash
# AI Provider API Keys
ZHIPU_API_KEY=your_zhipu_api_key_here
MINIMAX_API_KEY=your_minimax_api_key_here

# Feishu Bot
LARK_BEECLAW_APPID=your_app_id
LARK_BEECLAW_AS=your_app_secret

# Search APIs
BOCHA_API_KEY=your_bocha_api_key
TAVILY_API_KEY=your_tavily_api_key

# Weather API
QWEATHER_API_KEY=your_qweather_api_key

# Web UI
WEBUI_AUTH_TOKEN=your_auth_token
```

**特点**:
- ✅ 不提交到 Git（.gitignore）
- ✅ 每个开发者维护自己的 .env
- ✅ 提供模板文件 .env.example

### Layer 2: 应用配置（beeclaw.json）- 业务配置

**用途**: 存储应用逻辑配置，通过环境变量引用敏感信息

**示例** (beeclaw.example.json):
```json
{
  "providers": [
    {
      "name": "zhipu",
      "type": "zhipu",
      "apiKey": "${ZHIPU_API_KEY}",  // 引用环境变量
      "default": true,
      "models": {
        "glm-5": { "contextWindow": 131072 },
        "glm-4.7-flashx": { "contextWindow": 131072 }
      }
    }
  ],

  "roles": {
    "chat": {
      "provider": "zhipu",
      "model": "glm-5",
      "params": { "temperature": 0.7 }
    }
  },

  "feishu": {
    "enabled": true,
    "appId": "${LARK_BEECLAW_APPID}",  // 引用环境变量
    "appSecret": "${LARK_BEECLAW_AS}",
    "useCardV2": true
  },

  "weather": {
    "apiHost": "devapi.qweather.com",
    "apiKey": "${QWEATHER_API_KEY}"  // 引用环境变量
  },

  "web": {
    "enabled": false,
    "port": 3000,
    "auth": {
      "level": "token",
      "tokens": ["${WEBUI_AUTH_TOKEN}"]  // 引用环境变量
    }
  }
}
```

**特点**:
- ✅ 不提交到 Git（.gitignore）
- ✅ 使用 `${VAR_NAME}` 语法引用环境变量
- ✅ 提供模板文件 beeclaw.example.json

### Layer 3: 配置模板（.example 文件）- 提交到 Git

**用途**: 提供配置示例和文档

**包含**:
- `.env.example` - 环境变量模板
- `beeclaw.example.json` - 完整配置模板
- `beeclaw.schema.json` - JSON Schema 验证

## 🔧 改进建议

### 1. 更新 .env.example

**问题**: 当前 .env 包含过多非敏感配置

**建议**: 只保留真正的敏感信息

```bash
# .env.example - 只包含敏感信息
# ============================================
# AI Provider API Keys（必需）
# ============================================
ZHIPU_API_KEY=your_zhipu_api_key_here
MINIMAX_API_KEY=your_minimax_api_key_here

# ============================================
# Feishu 飞书配置（用于飞书机器人）
# ============================================
LARK_BEECLAW_APPID=your_app_id_here
LARK_BEECLAW_AS=your_app_secret_here

# ============================================
# 第三方 API Keys（可选）
# ============================================
# 搜索 API
BOCHA_API_KEY=your_bocha_api_key_here
TAVILY_API_KEY=your_tavily_api_key_here

# 天气 API
QWEATHER_API_KEY=your_qweather_api_key_here

# Web UI 认证
WEBUI_AUTH_TOKEN=your_auth_token_here
```

**移除的配置** (应该移到 beeclaw.json):
- ❌ BEECLAW_PORT - 非敏感，业务配置
- ❌ BEECLAW_HOST - 非敏感，业务配置
- ❌ BEECLAW_SHOW_THINKING - 非敏感，功能开关
- ❌ BEECLAW_SHOW_TOOL_PROCESS - 非敏感，功能开关
- ❌ QWEATHER_APIHOST - 非敏感，API endpoint

### 2. 更新 beeclaw.example.json

**添加更多配置项**:

```json
{
  "web": {
    "enabled": false,
    "port": "${BEECLAW_PORT:-3000}",  // 支持默认值语法
    "host": "${BEECLAW_HOST:-0.0.0.0}",
    "auth": {
      "level": "token",
      "tokens": ["${WEBUI_AUTH_TOKEN}"]
    }
  },

  "logging": {
    "level": "info",
    "showThinking": "${BEECLAW_SHOW_THINKING:-false}",
    "showToolProcess": "${BEECLAW_SHOW_TOOL_PROCESS:-false}"
  }
}
```

### 3. 增强环境变量插值功能

**建议**: 支持默认值语法 `${VAR:-default}`

```typescript
// src/infra/config/index.ts
content = content.replace(/\$\{(\w+)(?::-(.+?))?\}/g, (_, varName, defaultValue) => {
  const value = process.env[varName];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    logger.warn(`Environment variable ${varName} is not set`);
    return '';
  }
  return value;
});
```

## 📋 迁移清单

### 阶段 1: 清理 .env（推荐）

- [ ] 从 .env 移除非敏感配置
- [ ] 更新 .env.example 只保留敏感信息
- [ ] 在 beeclaw.json 中添加移除的配置项
- [ ] 测试配置加载

### 阶段 2: 增强功能（可选）

- [ ] 实现默认值语法 `${VAR:-default}`
- [ ] 添加配置验证和错误提示
- [ ] 创建配置迁移脚本

## 🎯 最终推荐

**保持当前的分层架构**:

1. ✅ **保留 .env** - 存储敏感信息（API keys）
2. ✅ **保留 beeclaw.json** - 存储业务配置，使用 `${VAR}` 引用环境变量
3. ✅ **保留 .example 文件** - 提供模板，提交到 Git
4. ✅ **保持 .gitignore** - 防止敏感信息提交

**优势**:
- 🔒 安全 - 敏感信息不提交
- 🔧 灵活 - 支持多环境配置
- 📚 清晰 - 配置职责分离
- 👥 协作友好 - 每个人独立配置

## 📖 使用流程

### 新开发者加入

```bash
# 1. 复制模板文件
cp .env.example .env
cp beeclaw.example.json beeclaw.json

# 2. 编辑 .env，填入自己的 API keys
vim .env

# 3. 根据需要调整 beeclaw.json
vim beeclaw.json

# 4. 启动应用
bun run bot
```

### 部署到生产

```bash
# 1. 设置生产环境变量
export ZHIPU_API_KEY=prod_key_here
export LARK_BEECLAW_APPID=prod_app_id

# 2. 使用生产配置文件
cp beeclaw.prod.json beeclaw.json

# 3. 启动服务
pm2 start beeclaw
```

## ⚠️ 注意事项

1. **不要提交 .env 和 beeclaw.json**
   - 已在 .gitignore 中
   - 包含敏感信息

2. **定期更新 .example 文件**
   - 添加新配置时同步更新模板
   - 添加注释说明

3. **文档化配置项**
   - 在 CLAUDE.md 中说明配置方法
   - 在 .example 文件中添加注释

---

**总结**: 建议保持当前的分层架构，只优化配置项的分布，将非敏感配置从 .env 移到 beeclaw.json。
