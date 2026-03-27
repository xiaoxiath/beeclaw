# Chart Rendering Debug Guide

## 问题描述
`create_chart` 工具调用成功，返回了图表数据，但图表没有渲染到飞书消息中。

## 调试步骤

### 1. 检查工具返回值
调用 `create_chart` 工具后，检查返回值是否包含 `_contentBlock: true` 标记：

```json
{
  "success": true,
  "data": {
    "type": "chart_data",
    "chartType": "bar",
    "data": [...]
  },
  "_contentBlock": true  // ← 这个标记很重要
}
```

### 2. 查看日志输出

#### Agent 日志
如果工具返回了正确的数据，应该看到：

```
[Agent] 🎨 Tool create_chart returned content block, triggering onContentBlock callback
[Agent] Content block: {
  "type": "chart_data",
  "chartType": "bar",
  ...
}
```

如果看到警告：

```
[Agent] ⚠️ Tool create_chart has _contentBlock but missing success or data
```

说明返回值格式有问题。

#### Session 日志
如果 `onContentBlock` 回调被正确调用，应该看到：

```
[Session] 📦 Received content block: {
  "type": "chart_data",
  ...
}
```

### 3. 检查 StreamingController

如果日志显示内容块被接收，但图表仍然没有渲染，可能是 `StreamingController` 的问题。

检查 `StreamingController.pushContent()` 是否正确处理 `chart_data` 类型的块。

## 常见问题

### 问题 1: _contentBlock 标记缺失

**原因**: 工具返回值没有 `_contentBlock: true` 标记

**解决**: 确保工具返回格式正确：

```typescript
return {
  success: true,
  data: chartBlock,
  _contentBlock: true,  // ← 必须有这个标记
};
```

### 问题 2: onContentBlock 回调未触发

**原因**: Agent 没有检测到 `_contentBlock` 标记

**解决**: 检查 agent 中的检测逻辑：

```typescript
if (result._contentBlock && result.success && result.data) {
  options?.onContentBlock?.(result.data);
}
```

### 问题 3: StreamingController 不支持图表

**原因**: `pushContent()` 方法不支持 `chart_data` 类型

**解决**: 检查 `StreamingController` 的实现，确保支持所有内容块类型。

## 测试方法

### 测试脚本
```typescript
// 调用 create_chart 工具
const result = await executeCreateChart({
  chartType: 'bar',
  data: [
    { name: 'A', value: 100 },
    { name: 'B', value: 200 },
    { name: 'C', value: 150 },
  ],
  title: 'Test Chart',
});

console.log('Result:', result);
console.log('Has _contentBlock:', result._contentBlock);
console.log('Has success:', result.success);
console.log('Has data:', !!result.data);
```

### 期望输出
```
Result: {
  success: true,
  data: {
    type: 'chart_data',
    chartType: 'bar',
    data: [...],
    title: 'Test Chart'
  },
  _contentBlock: true
}
Has _contentBlock: true
Has success: true
Has data: true
```

## 修复检查清单

- [ ] 工具返回 `_contentBlock: true` 标记
- [ ] 工具返回 `success: true`
- [ ] 工具返回 `data` 字段包含图表数据
- [ ] Agent 检测逻辑正确（`result._contentBlock && result.success && result.data`）
- [ ] Agent 调用 `onContentBlock` 回调
- [ ] Session 传递 `onContentBlock` 回调
- [ ] StreamingController 支持 `chart_data` 类型
- [ ] MessageRenderer 处理 `chart_data` 块
- [ ] ChartElement 正确创建飞书 Card V2 格式

## 相关文件

- `src/domain/tools/builtin.ts` - create_chart 工具定义
- `src/domain/agent/index.ts` - Agent 工具执行和内容块检测
- `src/domain/session/index.ts` - Session 和 StreamingController 集成
- `src/adapter/feishu/card-v2/streaming-controller.ts` - StreamingController 实现
- `src/adapter/feishu/card-v2/message-renderer.ts` - 消息渲染器
- `src/adapter/feishu/card-v2/types/elements.ts` - ChartElement 定义
