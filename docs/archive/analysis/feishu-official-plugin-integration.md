# 飞书官方 OpenClaw 插件集成到 Beeclaw

## 概述

`tmp/feishu-bot-package` 是飞书官方为 OpenClaw 提供的插件安装工具，包含：
- CLI 工具：`feishu-plugin-onboard`
- 官方插件包：`@larksuiteoapi/feishu-openclaw-plugin`

---

## 📦 包内容分析

### 1. CLI 工具功能

```bash
feishu-plugin-onboard <command>

Commands:
  install   安装并配置飞书官方插件
  info      显示配置信息
  doctor    诊断安装问题
  update    更新飞书官方插件
```

### 2. Install 命令详解

**功能**:
1. 检查 OpenClaw 版本（需要 >= 2026.2.26）
2. 禁用内置的 feishu 插件
3. 通过 npm 安装 `@larksuiteoapi/feishu-openclaw-plugin`
4. 配置 `~/.openclaw/config.json` 中的 channels.feishu
5. 添加插件到 `plugins.allow` 列表

**安装位置**: `~/.openclaw/extensions/feishu-openclaw-plugin/`

**配置示例**:
```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "domain": "feishu",
      "connectionMode": "websocket",
      "requireMention": true,
      "dmPolicy": "pairing",
      "groupPolicy": "open"
    }
  },
  "plugins": {
    "allow": ["feishu-openclaw-plugin"]
  }
}
```

---

## 🔧 集成到 Beeclaw

### 方案 A: 直接使用 CLI 工具（推荐测试）

**适用场景**: 快速测试飞书官方插件功能

#### 步骤 1: 安装 CLI 工具

```bash
# 方式 1: 全局安装
cd tmp/feishu-bot-package
npm install -g .

# 验证安装
feishu-plugin-onboard --version
```

#### 步骤 2: 运行安装命令

```bash
# 安装飞书官方插件到 OpenClaw
feishu-plugin-onboard install

# 按提示输入：
# - App ID: 你的飞书应用 ID
# - App Secret: 你的飞书应用密钥
```

#### 步骤 3: 查看安装结果

```bash
# 查看配置信息
feishu-plugin-onboard info --all

# 诊断问题
feishu-plugin-onboard doctor --fix
```

#### 步骤 4: 手动迁移到 Beeclaw

```bash
# 1. 复制插件到 Beeclaw
cp -r ~/.openclaw/extensions/feishu-openclaw-plugin ./plugins/

# 2. 复制配置
# 从 ~/.openclaw/config.json 中提取 channels.feishu 配置
# 添加到 beeclaw.json
```

---

### 方案 B: 手动安装插件（推荐生产）

**适用场景**: 完全控制插件加载过程

#### 步骤 1: 直接安装 npm 包

```bash
# 安装到项目依赖
bun add @larksuiteoapi/feishu-openclaw-plugin

# 或者安装到插件目录
mkdir -p plugins/feishu-openclaw-plugin
cd plugins/feishu-openclaw-plugin
npm init -y
npm install @larksuiteoapi/feishu-openclaw-plugin
```

#### 步骤 2: 创建插件包装器

**文件**: `plugins/feishu-openclaw-plugin/plugin.json`

```json
{
  "id": "feishu-openclaw-plugin",
  "name": "Feishu Official Plugin",
  "version": "1.0.0",
  "main": "src/index.ts",
  "description": "Official Feishu integration for Beeclaw"
}
```

#### 步骤 3: 创建适配器

**文件**: `plugins/feishu-openclaw-plugin/src/index.ts`

```typescript
import type { OpenClawPluginApi, PluginRuntime } from 'openclaw/plugin-sdk';

// 导入飞书官方插件
// 注意：需要根据实际的包结构调整导入路径
let officialPlugin: any;

try {
  officialPlugin = require('@larksuiteoapi/feishu-openclaw-plugin');
} catch (error) {
  console.error('[FeishuOfficial] Failed to load official plugin:', error);
}

export default {
  id: 'feishu-openclaw-plugin',
  name: 'Feishu Official Plugin',
  version: '1.0.0',
  kind: 'tool' as const,

  register(api: OpenClawPluginApi, runtime: PluginRuntime) {
    if (!officialPlugin) {
      runtime.logging.error('[FeishuOfficial] Official plugin not loaded');
      return;
    }

    // 方式 1: 直接使用官方插件的注册逻辑
    if (typeof officialPlugin.register === 'function') {
      officialPlugin.register(api, runtime);
      runtime.logging.info('[FeishuOfficial] Using official plugin registration');
      return;
    }

    // 方式 2: 包装官方插件提供的工具
    if (officialPlugin.tools && Array.isArray(officialPlugin.tools)) {
      officialPlugin.tools.forEach((tool: any) => {
        api.registerTool({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          execute: tool.execute
        });
      });
      runtime.logging.info(`[FeishuOfficial] Registered ${officialPlugin.tools.length} tools`);
    }

    // 方式 3: 包装官方插件提供的钩子
    if (officialPlugin.hooks) {
      Object.entries(officialPlugin.hooks).forEach(([hookName, handler]) => {
        api.on(hookName as any, handler as any);
      });
      runtime.logging.info(`[FeishuOfficial] Registered ${Object.keys(officialPlugin.hooks).length} hooks`);
    }
  },

  activate() {
    console.log('[FeishuOfficial] 🚀 Plugin activated');
  },

  deactivate() {
    console.log('[FeishuOfficial] 👋 Plugin deactivated');
  }
};
```

#### 步骤 4: 配置 Beeclaw

**文件**: `beeclaw.json`

```json
{
  "plugins": {
    "enabled": true,
    "discovery": {
      "bundledDir": "./plugins"
    },
    "pluginConfigs": {
      "feishu-openclaw-plugin": {
        "enabled": true
      }
    }
  },
  "feishu": {
    "enabled": true,
    "appId": "${LARK_BEECLAW_APPID}",
    "appSecret": "${LARK_BEECLAW_AS}"
  }
}
```

#### 步骤 5: 启动 Beeclaw

```bash
# 启动 Bot
bun run bot --daemon

# 查看日志确认插件加载
tail -f logs/bot-out.log | grep -i feishu

# 应该看到：
# 🔌 Plugins: 1 loaded (feishu-openclaw-plugin)
# [FeishuOfficial] 🚀 Plugin activated
```

---

### 方案 C: 参考实现自定义插件（推荐长期）

**适用场景**: 完全适配 Beeclaw 架构，避免依赖问题

#### 步骤 1: 分析官方插件功能

```bash
# 查看官方插件提供的工具
npm info @larksuiteoapi/feishu-openclaw-plugin

# 如果有源码，查看源码结构
ls -la node_modules/@larksuiteoapi/feishu-openclaw-plugin/
```

#### 步骤 2: 提取核心功能

根据官方插件，提取以下功能：

1. **工具列表**:
   - `feishu_send_message` - 发送消息
   - `feishu_create_doc` - 创建文档
   - `feishu_fetch_doc` - 获取文档
   - `feishu_im_read` - 读取消息
   - 等等...

2. **钩子列表**:
   - `message_received` - 消息接收处理
   - `session_start` - 会话初始化
   - 等等...

#### 步骤 3: 创建自定义实现

**文件**: `plugins/feishu-custom/plugin.json`

```json
{
  "id": "feishu-custom",
  "name": "Feishu Custom Plugin",
  "version": "1.0.0",
  "main": "src/index.ts"
}
```

**文件**: `plugins/feishu-custom/src/index.ts`

```typescript
import type { OpenClawPluginApi, PluginRuntime } from 'openclaw/plugin-sdk';

export default {
  id: 'feishu-custom',
  name: 'Feishu Custom',
  version: '1.0.0',
  kind: 'tool' as const,

  register(api: OpenClawPluginApi, runtime: PluginRuntime) {
    // 复用 Beeclaw 现有的 Feishu 客户端
    api.registerTool({
      name: 'feishu_send_message',
      description: 'Send message to Feishu chat',
      parameters: {
        type: 'object',
        properties: {
          chatId: { type: 'string', description: 'Chat ID' },
          message: { type: 'string', description: 'Message content' }
        },
        required: ['chatId', 'message']
      },
      execute: async (params: any) => {
        const { getFeishuWSClient } = await import('../../../feishu');
        const client = getFeishuWSClient();

        if (!client) {
          return { success: false, error: 'Feishu client not initialized' };
        }

        try {
          await client.sendTextMessage(params.chatId, 'chat_id', params.message);
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }
    });

    // 添加更多工具...

    runtime.logging.info('[FeishuCustom] Plugin registered');
  },

  activate() {
    console.log('[FeishuCustom] 🚀 Activated');
  }
};
```

---

## 🚀 快速启动指南

### 最简单的方式（5分钟）

```bash
# 1. 运行 CLI 工具
cd tmp/feishu-bot-package
node dist/index.js install

# 2. 按提示输入 App ID 和 Secret

# 3. 查看生成的配置
node dist/index.js info --all

# 4. 手动复制配置到 Beeclaw
# 从 ~/.openclaw/config.json 复制 channels.feishu 部分
# 粘贴到 beeclaw.json

# 5. 重启 Beeclaw
bun run bot --daemon
```

### 开发调试方式

```bash
# 终端 1: 启动 Beeclaw
bun run bot --daemon

# 终端 2: 监控日志
tail -f logs/bot-out.log

# 终端 3: 测试插件
bun run cli
> feishu_send_message({chatId: "oc_xxx", message: "test"})
```

---

## 📊 方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **A: CLI 工具** | ✅ 快速安装<br>✅ 官方支持 | ⚠️ 依赖 OpenClaw<br>⚠️ 可能不兼容 | 快速测试 |
| **B: 手动安装** | ✅ 完全控制<br>✅ 可以定制 | ⚠️ 需要适配<br>⚠️ 维护成本 | 生产环境 |
| **C: 自定义实现** | ✅ 完全兼容<br>✅ 可维护 | ⚠️ 开发工作量大<br>⚠️ 功能可能不完整 | 长期使用 |

---

## 🔍 故障排查

### 问题 1: CLI 工具报错 "OpenClaw not found"

**原因**: Beeclaw 不是 OpenClaw，CLI 工具依赖 OpenClaw

**解决**:
```bash
# 跳过 CLI 工具，直接手动安装
bun add @larksuiteoapi/feishu-openclaw-plugin
```

### 问题 2: 插件加载失败

**检查步骤**:
```bash
# 1. 查看日志
tail -f logs/bot-out.log | grep -i error

# 2. 检查插件目录
ls -la plugins/

# 3. 验证配置
cat beeclaw.json | grep -A 5 plugins
```

### 问题 3: 工具未注册

**调试方法**:
```typescript
// 在插件中添加日志
register(api: OpenClawPluginApi, runtime: PluginRuntime) {
  console.log('[Debug] Registering plugin...');
  console.log('[Debug] API:', Object.keys(api));
  console.log('[Debug] Runtime:', Object.keys(runtime));

  // 注册工具
  api.registerTool({...});
  console.log('[Debug] Tool registered');
}
```

---

## 💡 推荐方案

### 对于快速验证

**使用方案 A（CLI 工具）**:
```bash
cd tmp/feishu-bot-package
node dist/index.js install
# 查看生成的配置，手动应用到 Beeclaw
```

### 对于生产环境

**使用方案 C（自定义实现）**:
1. 参考官方插件的功能列表
2. 基于 Beeclaw 现有的 `src/feishu/` 实现
3. 创建符合 OpenClaw 规范的插件
4. 充分测试后部署

---

## 📝 下一步

1. **✅ 选择方案**: 推荐方案 C（自定义实现）
2. **✅ 创建插件**: 参考 `docs/feishu-plugin-integration-guide.md`
3. **✅ 测试功能**: 在 CLI 中测试工具和钩子
4. **✅ 生产部署**: 使用 PM2 启动

---

**完整示例**: 参见 `docs/feishu-plugin-integration-guide.md`

**问题反馈**: 如果遇到兼容性问题，可以：
1. 查看官方插件的 TypeScript 定义
2. 参考 OpenClaw 的插件规范
3. 在 Beeclaw 中实现适配层
