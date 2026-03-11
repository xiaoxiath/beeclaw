# Feishu Card V2 功能

## 概述

Beeclaw 支持 Feishu Card Schema 2.0，提供流式消息更新和增强的用户体验。

## 功能特性

- **实时进度反馈** - 用户可以看到 agent 推理步骤
- **可折叠工具面板** - 工具调用显示在可展开/折叠的面板中
- **富 Markdown 渲染** - 正确的代码高亮、表格和列表
- **流式更新** - 卡片在 agent 处理请求时实时更新

## 架构

1. **ContentBlock** (`src/types/content-block.ts`)
   - 统一的消息块类型：ToolUseBlock, TextBlock, ImageBlock

2. **Card V2 Types** (`src/adapter/feishu/card-v2/types/`)
   - Card Schema 2.0 类型定义

3. **StreamingMessageController** (`src/adapter/feishu/card-v2/streaming-controller.ts`)
   - 管理流式消息生命周期
   - 防抖更新（500ms）

4. **MessageCardRenderer** (`src/adapter/feishu/card-v2/message-renderer.ts`)
   - 渲染 ContentBlocks 到 Card JSON

## 配置

在 `beeclaw.json` 中启用：
```json
{
  "feishu": {
    "enabled": true,
    "useCardV2": true
  }
}
```

## 相关文档

- 实现详情：见 git history
- 配置参考：`docs/feishu-card-v2-config.md`（已归档）
