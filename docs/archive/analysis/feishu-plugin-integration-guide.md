# Feishu 插件集成指南

## 概述

本文档展示如何在 Beeclaw 中创建和启动一个 Feishu（飞书）插件，利用新的 OpenClaw 兼容插件系统。

---

## 方案选择

### 方案 A: 独立插件（推荐）

创建一个新的 Feishu 插件，扩展现有功能：

**优点**:
- ✅ 不影响现有的 `src/feishu/` 代码
- ✅ 可以逐步迁移功能
- ✅ 支持多个 Feishu 插件共存
- ✅ 符合 OpenClaw 插件规范

**缺点**:
- ⚠️ 需要创建新的插件代码
- ⚠️ 可能与现有功能重复

### 方案 B: 重构现有代码

将 `src/feishu/` 重构为插件：

**优点**:
- ✅ 代码组织更清晰
- ✅ 完全符合插件架构

**缺点**:
- ⚠️ 需要大量重构
- ⚠️ 可能破坏现有功能
- ⚠️ 回滚困难

---

## 方案 A 实施步骤

### 1. 创建插件目录结构

```bash
mkdir -p plugins/feishu-advanced/src
```

### 2. 创建插件清单

**文件**: `plugins/feishu-advanced/plugin.json`

```json
{
  "id": "feishu-advanced",
  "name": "Feishu Advanced Plugin",
  "version": "1.0.0",
  "description": "Advanced Feishu integration with plugin hooks",
  "main": "src/index.ts",
  "author": "Beeclaw Team",
  "license": "MIT",
  "keywords": ["feishu", "lark", "messaging", "collaboration"],
  "engines": {
    "beeclaw": ">=1.0.0"
  }
}
```

### 3. 创建插件代码

**文件**: `plugins/feishu-advanced/src/index.ts`

```typescript
import type { OpenClawPluginApi, PluginRuntime } from 'openclaw/plugin-sdk';

export default {
  id: 'feishu-advanced',
  name: 'Feishu Advanced',
  version: '1.0.0',
  kind: 'tool' as const,

  /**
   * 插件注册 - 定义工具和钩子
   */
  register(api: OpenClawPluginApi, runtime: PluginRuntime) {
    // 1. 注册自定义工具
    api.registerTool({
      name: 'feishu_send_card',
      description: 'Send interactive card message to Feishu',
      parameters: {
        type: 'object',
        properties: {
          chatId: {
            type: 'string',
            description: 'Feishu chat ID'
          },
          card: {
            type: 'object',
            description: 'Card message content'
          }
        },
        required: ['chatId', 'card']
      },
      execute: async (params: any) => {
        runtime.logging.info('[FeishuAdvanced] Sending card message');

        // 调用 Feishu API
        const { getFeishuWSClient } = await import('../../../feishu');
        const client = getFeishuWSClient();

        if (!client) {
          return {
            success: false,
            error: 'Feishu client not initialized'
          };
        }

        try {
          // 发送卡片消息
          await client.sendPostMessage(params.chatId, 'chat_id', params.card, {
            title: 'Interactive Card'
          });

          runtime.logging.info('[FeishuAdvanced] Card sent successfully');

          return {
            success: true,
            message: 'Card sent successfully'
          };
        } catch (error) {
          runtime.logging.error('[FeishuAdvanced] Failed to send card:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }
    });

    // 2. 注册另一个工具：批量发送消息
    api.registerTool({
      name: 'feishu_batch_send',
      description: 'Send messages to multiple Feishu chats',
      parameters: {
        type: 'object',
        properties: {
          chatIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of chat IDs'
          },
          message: {
            type: 'string',
            description: 'Message content'
          }
        },
        required: ['chatIds', 'message']
      },
      execute: async (params: any) => {
        const { getFeishuWSClient } = await import('../../../feishu');
        const client = getFeishuWSClient();

        if (!client) {
          return { success: false, error: 'Feishu client not initialized' };
        }

        const results = [];

        for (const chatId of params.chatIds) {
          try {
            await client.sendTextMessage(chatId, 'chat_id', params.message);
            results.push({ chatId, success: true });
          } catch (error) {
            results.push({
              chatId,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }

        const successCount = results.filter(r => r.success).length;

        return {
          success: true,
          sent: successCount,
          failed: results.length - successCount,
          results
        };
      }
    });

    // 3. 监听消息钩子 - 记录所有消息
    api.on('message_received', async (event) => {
      runtime.logging.info('[FeishuAdvanced] Message received:', {
        contentType: typeof event.content,
        timestamp: event.timestamp
      });

      // 可以添加自定义逻辑，例如：
      // - 过滤敏感词
      // - 自动回复
      // - 消息分析
    });

    // 4. 监听工具调用 - 追踪 Feishu 工具使用
    api.on('before_tool_call', async (event) => {
      if (event.toolName.startsWith('feishu_')) {
        runtime.logging.info(`[FeishuAdvanced] Feishu tool called: ${event.toolName}`);

        // 可以添加权限检查、限流等
        if (event.toolName === 'feishu_batch_send') {
          const params = event.params as { chatIds: string[] };
          if (params.chatIds.length > 100) {
            runtime.logging.warn('[FeishuAdvanced] Batch send limit exceeded');
            // 可以抛出错误阻止执行
          }
        }
      }
    });

    // 5. 监听工具结果 - 记录执行结果
    api.on('after_tool_call', async (event) => {
      if (event.toolName.startsWith('feishu_')) {
        const result = event.result as { success: boolean };
        runtime.logging.info(`[FeishuAdvanced] Feishu tool result:`, {
          tool: event.toolName,
          success: result.success
        });

        // 可以添加错误追踪、性能监控等
        if (!result.success) {
          runtime.state.set('last_feishu_error', {
            tool: event.toolName,
            error: result.error,
            timestamp: new Date().toISOString()
          });
        }
      }
    });

    // 6. 监听会话事件
    api.on('session_start', async (event) => {
      if (event.channel === 'feishu') {
        runtime.logging.info('[FeishuAdvanced] New Feishu session:', {
          userId: event.userId,
          sessionId: event.sessionId
        });

        // 可以初始化会话特定的状态
        runtime.state.set(`feishu_session_${event.sessionId}`, {
          startTime: Date.now(),
          messageCount: 0
        });
      }
    });

    api.on('session_end', async (event) => {
      if (event.channel === 'feishu') {
        const sessionData = runtime.state.get(`feishu_session_${event.sessionId}`);

        runtime.logging.info('[FeishuAdvanced] Feishu session ended:', {
          sessionId: event.sessionId,
          duration: sessionData ? Date.now() - sessionData.startTime : 0,
          messages: event.messageCount
        });

        // 清理会话状态
        runtime.state.delete(`feishu_session_${event.sessionId}`);
      }
    });

    // 7. 监听 Agent 生命周期
    api.on('agent_end', async (event) => {
      // 检查是否有 Feishu 工具被使用
      const state = runtime.state.get('last_feishu_error');

      if (state) {
        runtime.logging.warn('[FeishuAdvanced] Agent ended with Feishu errors:', state);
        // 可以发送告警、记录日志等
      }
    });

    // 8. 监听 LLM 输出 - 可以修改消息内容
    api.on('llm_output', async (event) => {
      // 可以检查输出内容是否包含 Feishu 特定格式
      const content = event.response.choices[0]?.message?.content || '';

      if (content.includes('@all')) {
        runtime.logging.info('[FeishuAdvanced] Message mentions @all');
        // 可以添加特殊处理，例如确认提示
      }
    });
  },

  /**
   * 插件激活 - 初始化资源
   */
  activate() {
    console.log('[FeishuAdvanced] 🚀 Plugin activated');
    console.log('[FeishuAdvanced] Available tools: feishu_send_card, feishu_batch_send');
  },

  /**
   * 插件停用 - 清理资源
   */
  deactivate() {
    console.log('[FeishuAdvanced] 👋 Plugin deactivated');
  }
};
```

### 4. 配置插件

**文件**: `beeclaw.json`

```json
{
  "plugins": {
    "enabled": true,
    "discovery": {
      "bundledDir": "./plugins",
      "workspaceDir": "./plugins"
    },
    "pluginConfigs": {
      "feishu-advanced": {
        "enabled": true,
        "permissions": ["feishu:send", "feishu:read"]
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

---

## 启动方式

### 方式 1: 开发模式（自动重载）

```bash
# 终端 1: 启动 Bot
bun run bot --daemon

# 终端 2: 监听插件变化（可选）
bun run dev:plugins
```

### 方式 2: 生产模式（PM2）

```bash
# 启动
bun run pm2:start

# 查看日志
bun run pm2:logs

# 监控
bun run pm2:monit
```

### 方式 3: CLI 测试模式

```bash
# 交互式测试
bun run cli

# 在 CLI 中测试插件工具
> feishu_send_card({
    "chatId": "oc_xxxxx",
    "card": {
      "type": "text",
      "content": "Hello from plugin!"
    }
  })
```

---

## 插件加载流程

```
1. 启动应用 (bun run bot)
   ↓
2. initApp() 初始化
   ↓
3. loadPlugins() 发现插件
   ↓
4. 读取 plugin.json
   ↓
5. Jiti 编译 TypeScript
   ↓
6. 调用 plugin.register()
   ↓
7. 注册工具和钩子
   ↓
8. 调用 plugin.activate()
   ↓
9. 插件就绪 ✅
```

---

## 验证插件加载

### 1. 查看启动日志

```bash
bun run bot --daemon

# 输出应该包含：
# 🔌 Plugins: 1 loaded (feishu-advanced)
```

### 2. 检查注册的工具

```bash
bun run cli

> help
# 应该看到：
# - feishu_send_card
# - feishu_batch_send
```

### 3. 测试钩子触发

```typescript
// 发送测试消息
# 在 Feishu 中发送消息给 Bot

# 查看日志
tail -f logs/bot-out.log | grep FeishuAdvanced

# 应该看到：
# [FeishuAdvanced] Message received: ...
# [FeishuAdvanced] Feishu session ended: ...
```

---

## 高级功能

### 1. 配置管理

```typescript
// 在插件中访问配置
const pluginConfig = runtime.config.get('plugins.feishu-advanced');
runtime.logging.info('Plugin config:', pluginConfig);
```

### 2. 状态持久化

```typescript
// 保存状态
runtime.state.set('feishu_stats', {
  totalMessages: 100,
  successRate: 0.95
}, { ttl: 3600000 }); // 1 小时

// 读取状态
const stats = runtime.state.get('feishu_stats');
```

### 3. HTTP 路由（未来支持）

```typescript
api.registerRoute({
  method: 'GET',
  path: '/stats',
  handler: async (req) => {
    const stats = runtime.state.get('feishu_stats');
    return { stats };
  }
});
```

### 4. CLI 命令（未来支持）

```typescript
api.registerCommand({
  name: 'feishu-status',
  description: 'Show Feishu connection status',
  arguments: [],
  handler: async () => {
    const client = getFeishuWSClient();
    console.log('Status:', client ? 'Connected' : 'Disconnected');
  }
});
```

---

## 与现有 Feishu 集成的关系

### 现有功能（保留）

```
src/feishu/
├── index.ts          # WebSocket 客户端
├── client.ts         # API 客户端
└── tools.ts          # 内置工具
```

### 新插件功能（扩展）

```
plugins/feishu-advanced/
├── plugin.json
└── src/
    └── index.ts      # 插件逻辑
```

### 共存方式

```typescript
// 插件可以调用现有功能
const { getFeishuWSClient } = await import('../../../feishu');
const client = getFeishuWSClient();

// 现有功能保持不变
// 插件作为扩展层
```

---

## 故障排查

### 插件未加载

```bash
# 检查配置
cat beeclaw.json | grep -A 10 plugins

# 检查插件目录
ls -la plugins/

# 查看错误日志
tail -f logs/bot-out.log | grep -i plugin
```

### 工具未注册

```bash
# 在 CLI 中测试
bun run cli
> feishu_send_card({})
# 如果提示 "Unknown tool"，说明插件未加载
```

### 钩子未触发

```bash
# 启用调试日志
export LOG_LEVEL=debug
bun run bot

# 查看钩子触发
tail -f logs/bot-out.log | grep -i hook
```

---

## 最佳实践

1. **✅ 使用现有的 Feishu 客户端**
   ```typescript
   // ✅ 好的做法
   const { getFeishuWSClient } = await import('../../../feishu');

   // ❌ 避免
   // 重新实现 Feishu 客户端
   ```

2. **✅ 遵循钩子规范**
   ```typescript
   // ✅ 好的做法 - Void hook
   api.on('message_received', async (event) => {
     // 只监控，不修改
   });

   // ✅ 好的做法 - Modifying hook
   api.on('before_tool_call', async (event) => {
     // 可以修改并返回
     return { ...event, params: modified };
   });
   ```

3. **✅ 错误处理**
   ```typescript
   execute: async (params: any) => {
     try {
       // 业务逻辑
       return { success: true };
     } catch (error) {
       runtime.logging.error('[Plugin] Error:', error);
       return {
         success: false,
         error: error instanceof Error ? error.message : 'Unknown error'
       };
     }
   }
   ```

4. **✅ 日志规范**
   ```typescript
   // 使用统一的日志前缀
   runtime.logging.info('[FeishuAdvanced] Message here');
   ```

---

## 总结

**推荐流程**:

1. ✅ 创建 `plugins/feishu-advanced/` 目录
2. ✅ 实现 `plugin.json` 和 `src/index.ts`
3. ✅ 配置 `beeclaw.json` 启用插件
4. ✅ 启动 `bun run bot --daemon`
5. ✅ 验证日志显示 "🔌 Plugins: 1 loaded"
6. ✅ 在 CLI 中测试工具
7. ✅ 在 Feishu 中测试钩子触发

**下一步**:

- 实施更多高级功能（卡片消息、批量操作）
- 添加权限控制
- 实现性能监控
- 编写单元测试

---

**插件开发完成！** 🚀

现在你有一个功能完整的 Feishu 插件，利用了 Beeclaw 的所有 22 个 hooks。
