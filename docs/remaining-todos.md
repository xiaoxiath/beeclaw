# Beeclaw Plugin System - 剩余 TODO 清单

## 📋 总览

**完成度**: **52% 钩子实现**，**100% 核心监控功能** ✅
**剩余任务**: 37 项（按优先级分类）

---

## ✅ 已完成任务（Phase 3.0-3.3）

### Phase 3 - 基础钩子集成 ✅
- [x] `message_received` - 收到用户消息时触发
- [x] `message_sent` - 发送响应消息时触发
- [x] `before_tool_call` - 工具调用前触发
- [x] `after_tool_call` - 工具调用后触发

**完成时间**: 2026-03-06
**测试**: 4 tests, 100% pass

---

### Phase 3.1 - LLM 监控钩子 ✅
- [x] `before_prompt_build` - 在 buildSystemPrompt() 中触发
- [x] `llm_input` - 在 callAI() 调用前触发
- [x] `llm_output` - 在 callAI() 响应后触发

**完成时间**: 2026-03-06
**测试**: 4 tests, 100% pass

---

### Phase 3.2 - 上下文压缩钩子 ✅
- [x] `before_compaction` - 上下文压缩前触发
- [x] `after_compaction` - 压缩完成后触发

**完成时间**: 2026-03-06
**测试**: 3 tests, 100% pass

---

### Phase 3.3 - Agent & Session 生命周期钩子 ✅
- [x] `before_agent_start` - Agent 启动时触发
- [x] `agent_end` - Agent 结束时触发
- [x] `session_start` - 会话开始时触发
- [x] `session_end` - 会话结束时触发

**完成时间**: 2026-03-06
**测试**: 4 tests, 100% pass

---

## 🔴 高优先级（建议立即实施）

### 1. 剩余核心钩子（预计 0.5 天）

#### 模型解析钩子
- [ ] `before_model_resolve` - 模型解析前触发（Modifying）

**实现位置**: `src/agent/tools.ts` 或模型选择逻辑

**价值**: 插件可以动态选择模型

#### 重置钩子
- [ ] `before_reset` - Agent 重置前触发（Void）

**实现位置**: `src/agent/index.ts` - `clearHistory()` 方法

**价值**: 监控上下文重置

---

### 2. 同步持久化钩子（预计 0.5 天）

- [ ] `before_message_write` - 消息写入前（同步）
- [ ] `tool_result_persist` - 工具结果持久化（同步）

**实现位置**:
- `src/session/index.ts` - 消息保存
- `src/agent/index.ts` - 工具结果处理

**价值**: 插件可以修改持久化数据，实现加密、压缩等

---

## 🟡 中优先级（建议后续实施）

### 3. HTTP 路由集成（预计 1 天）

**任务**: 将插件的 `httpRoutes` 注册到 Express/Fastify

**实现位置**: 新建 `src/plugins/http-router.ts`

**代码示例**:
```typescript
export function registerPluginRoutes(app: Express, registry: PluginRegistry) {
  for (const [pluginId, routes] of registry.httpRoutes.entries()) {
    for (const route of routes) {
      const fullPath = `/plugins/${pluginId}${route.path}`;
      app[route.method](fullPath, async (req, res) => {
        try {
          const result = await route.handler(req);
          res.json(result);
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });
    }
  }
}
```

**价值**: 插件可以暴露 HTTP API

---

### 4. Runtime 配置集成（预计 0.5 天）

**任务**: 将 `runtime.config` 传递给插件

**实现位置**: `src/plugins/loader/index.ts` - `loadPlugins()`

**代码示例**:
```typescript
const runtime = createPluginRuntimeShim(options.runtimeOptions || {});
// 确保 runtime.config 可用
runtime.config = {
  get: (key: string) => process.env[key] || config[key],
  set: (key: string, value: any) => { config[key] = value; },
};
```

**价值**: 插件可以访问和修改配置

---

### 5. Sub-Agent 钩子（预计 1 天）

- [ ] `subagent_spawning` - Sub-Agent 生成时（Modifying）
- [ ] `subagent_spawned` - Sub-Agent 启动后（Void）
- [ ] `subagent_delivery_target` - Sub-Agent 结果传递（Modifying）
- [ ] `subagent_ended` - Sub-Agent 结束（Void）

**实现位置**: `src/subagent/` - SubagentManager

**价值**: 监控和管理子 Agent 生命周期

---

### 6. CLI 命令集成（预计 0.5 天）

**任务**: 将插件的 `commands` 注册到 Commander

**实现位置**: 新建 `src/plugins/cli-integration.ts`

**代码示例**:
```typescript
export function registerPluginCommands(program: Command, registry: PluginRegistry) {
  for (const [pluginId, commands] of registry.commands.entries()) {
    for (const cmd of commands) {
      const command = program
        .command(`plugin:${cmd.name}`)
        .description(cmd.description);

      for (const arg of cmd.arguments) {
        command.argument(arg.name, arg.description);
      }

      command.action(async (...args) => {
        await cmd.handler(args);
      });
    }
  }
}
```

**价值**: 插件可以扩展 CLI，如 `beeclaw plugin:weather forecast`

---

## 🟢 低优先级（可选实施）

### 7. Channel Runtime 适配器（预计 2-3 天）

**任务**: 实现 25 个 Channel Runtime 适配器

**当前状态**: 只有 Proxy stubs

**需要实现**:
1. `text` - 文本适配器
2. `reply` - 回复适配器
3. `routing` - 路由适配器
4. `discord` - Discord 适配器
5. `telegram` - Telegram 适配器
6. `slack` - Slack 适配器
7. `lark` - Lark/Feishu 适配器
8. `matrix` - Matrix 适配器
9. `whatsapp` - WhatsApp 适配器
10. `messenger` - Facebook Messenger 适配器
... (还有 15 个)

**实现位置**: `src/plugins/runtime-shim/channel/`

**价值**: 支持第三方通讯平台插件

**建议**: 按需实现，优先实现 Feishu 适配器（已部分支持）

---

### 8. Provider Plugin 支持（预计 1 天）

**任务**: 实现 Provider Runtime

**实现位置**: `src/plugins/runtime-shim/provider.ts`

**代码示例**:
```typescript
export function createProviderRuntime(): ProviderRuntime {
  return {
    registerModel: (model) => {
      // 注册自定义模型
    },
    callModel: async (params) => {
      // 调用自定义模型
    },
    // ...
  };
}
```

**价值**: 插件可以提供自定义 AI 模型

---

### 9. Gateway 支持（预计 0.5 天）

- [ ] `gateway_start` - Gateway 启动时
- [ ] `gateway_stop` - Gateway 停止时

**实现位置**: `src/bot.ts` - Gateway 启动/停止

**价值**: 监控网关生命周期（如果使用 Gateway 架构）

---

### 10. SDK 模块映射扩展（预计 0.5 天）

**任务**: 添加更多 SDK 模块映射

**实现位置**: `src/plugins/loader/index.ts` - `createConfiguredJiti()`

**当前映射**:
- `openclaw/plugin-sdk` ✅
- `openclaw/plugin-sdk/core` ✅

**需要添加**:
- `openclaw/plugin-sdk/channel`
- `openclaw/plugin-sdk/provider`
- `openclaw/plugin-sdk/gateway`
- `openclaw/plugin-sdk/storage`
- `openclaw/plugin-sdk/logger`

**价值**: 完整的 OpenClaw SDK 兼容性

---

## 📊 统计

### 钩子实现进度

| 类别 | 已实现 | 总计 | 进度 |
|------|--------|------|------|
| **Agent 生命周期** | 2 | 2 | ✅ 100% |
| **消息处理** | 3 | 3 | ✅ 100% |
| **工具调用** | 2 | 2 | ✅ 100% |
| **LLM 监控** | 3 | 3 | ✅ 100% |
| **上下文管理** | 2 | 2 | ✅ 100% |
| **会话管理** | 2 | 2 | ✅ 100% |
| **持久化** | 0 | 1 | 📋 0% |
| **Sub-Agent** | 0 | 4 | 📋 0% |
| **Gateway** | 0 | 2 | 📋 0% |
| **模型解析** | 0 | 1 | 📋 0% |
| **重置** | 0 | 1 | 📋 0% |
| **总计** | **13** | **25** | **52%** |

### 功能模块进度

| 模块 | 状态 | 完成度 |
|------|------|--------|
| **钩子系统** | ✅ 核心完成 | 52% |
| **工具注册** | ✅ 完成 | 100% |
| **插件加载** | ✅ 完成 | 100% |
| **配置管理** | ✅ 完成 | 100% |
| **HTTP 路由** | 📋 待实施 | 0% |
| **CLI 集成** | 📋 待实施 | 0% |
| **Runtime 扩展** | 🔄 部分完成 | 40% |

---

## 💡 推荐实施顺序

### 🎯 立即可用（无需实施）
**当前状态**: 核心监控功能 100% 完成
**建议**: 先使用现有功能，收集实际需求

---

### 第一轮（可选，0.5-1 天）
1. **剩余核心钩子** - `before_model_resolve`, `before_reset`
2. **同步持久化钩子** - `before_message_write`, `tool_result_persist`

**价值**: 完成所有高优先级钩子

---

### 第二轮（可选，1-2 天）
3. **HTTP 路由集成** - 插件暴露 HTTP API
4. **Runtime 配置集成** - 插件访问配置
5. **CLI 命令集成** - 插件扩展 CLI

**价值**: 完善插件系统能力

---

### 第三轮（按需）
6. **Sub-Agent 钩子** - 如果使用 Sub-Agent 系统
7. **Channel Runtime** - 按需实现通讯平台
8. **Provider Plugin** - 如果需要自定义模型
9. **Gateway 钩子** - 如果使用 Gateway 架构

**价值**: 特定场景增强

---

## 🚫 暂不实施的任务

以下任务**不建议实施**，除非有明确需求：

1. **Channel Runtime 25 个适配器** - 工作量巨大，建议按需实现
2. **Sub-Agent 钩子** - Beeclaw 的 Sub-Agent 系统可能不兼容 OpenClaw
3. **Gateway 钩子** - Beeclaw 可能不使用 Gateway 架构

---

## 📝 代码质量改进

### 测试覆盖
- [x] 核心插件系统测试（10 tests）
- [x] 钩子集成测试（4 tests）
- [x] 工具集成测试（4 tests）
- [x] 压缩钩子测试（3 tests）
- [x] 生命周期钩子测试（4 tests）
- [ ] HTTP 路由测试（待实施）
- [ ] CLI 命令测试（待实施）
- [ ] 性能测试
- [ ] 错误处理测试

### 文档完善
- [x] Phase 3 文档（4 份）
- [x] 实现总结文档
- [x] 使用示例
- [ ] API 文档生成
- [ ] 插件开发指南
- [ ] 最佳实践文档
- [ ] 故障排查指南

---

## 🎊 当前可用功能

**核心功能已完成** ✅，可以立即使用：

✅ 插件加载和发现
✅ 工具注册和执行
✅ **13 个钩子触发**（核心监控 100%）
✅ 配置管理
✅ 自动加载
✅ Jiti 运行时加载
✅ 测试覆盖（25 tests）

**立即可用的场景**:
1. 监控插件（性能、使用统计）
2. 日志插件（审计、调试）
3. 工具插件（扩展功能）
4. 修改插件（提示词优化、内容过滤）

**建议**: 先使用当前功能，根据实际需求再实施后续 TODO。

---

## 📈 优先级决策矩阵

| 任务 | 价值 | 工作量 | 优先级 | 建议 |
|------|------|--------|--------|------|
| **剩余核心钩子** | 高 | 低 | 🔴 高 | 立即实施 |
| **同步持久化钩子** | 中 | 低 | 🔴 高 | 立即实施 |
| **HTTP 路由** | 高 | 中 | 🟡 中 | 有需求时实施 |
| **Runtime 配置** | 中 | 低 | 🟡 中 | 有需求时实施 |
| **CLI 集成** | 中 | 低 | 🟡 中 | 有需求时实施 |
| **Sub-Agent 钩子** | 中 | 中 | 🟢 低 | 使用 Sub-Agent 时实施 |
| **Channel Runtime** | 低 | 高 | 🟢 低 | 按需实施 |
| **Provider Plugin** | 低 | 中 | 🟢 低 | 需要自定义模型时实施 |

---

**最后更新**: 2026-03-06
**Phase 3.3 完成时间**: 2026-03-06
**总 TODO**: 37 项（从 49 项减少）
**高优先级**: 4 项
**核心监控**: ✅ 100% 完成

**推荐行动**: 投入生产使用，根据实际需求决定后续开发
