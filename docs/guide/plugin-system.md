# 插件系统

> OpenClaw 兼容的插件架构

## 概述

Beeclaw 支持 OpenClaw 兼容的插件系统，允许通过 Hook 机制扩展和定制行为。

## 插件结构

```
plugins/
├── my-plugin/
│   ├── plugin.json       # 插件清单
│   ├── index.ts          # 插件实现
│   └── README.md         # 插件文档
```

## plugin.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My custom plugin",
  "hooks": [
    "onToolCall",
    "onAgentMessage"
  ],
  "tools": ["custom_tool"]
}
```

## Hook 系统

### 可用 Hooks

- `onToolCall` - 工具调用前/后
- `onAgentMessage` - 代理消息处理
- `onMemoryRecord` - 记忆记录时
- `onSkillExecute` - 技能执行时

### Hook 示例

```typescript
export async function onToolCall(context: ToolCallContext) {
  const { toolName, params } = context;

  // 前置处理
  logger.info(`Tool called: ${toolName}`);

  // 执行工具
  const result = await context.next();

  // 后置处理
  logger.info(`Tool result: ${result}`);

  return result;
}
```

## 配置

在 `beeclaw.json` 中配置：

```json
{
  "plugins": {
    "enabled": true,
    "discoveryPaths": [
      "./plugins",
      "~/.beeclaw/plugins"
    ]
  }
}
```

## 最佳实践

1. **命名规范**: 使用小写 + 连字符
2. **版本管理**: 遵循语义化版本
3. **错误处理**: 优雅处理 Hook 错误
4. **文档完善**: 提供清晰的 README

## 相关文档

- [技能系统](./skill-system.md)
- [子代理系统](./subagent-system.md)
