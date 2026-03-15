# 飞书工具删除建议

## 快速决策

### 推荐方案：部分删除 ✅

**删除**（~500 行代码）：
```
❌ src/adapter/feishu/tools/calendar.ts     (217 行，简化版)
❌ src/adapter/feishu/tools/docx.ts         (~100 行，简化版)
❌ src/adapter/feishu/tools/bitable.ts      (~100 行，简化版)
❌ src/adapter/feishu/tools/user-info.ts    (~100 行，简化版)
```

**保留**（高频 + 性能优）：
```
✅ src/adapter/feishu/tools/drive.ts        (12 个工具，~100ms)
✅ src/adapter/feishu/tools/wiki.ts         (11 个工具，~100ms)
```

## 理由

| 维度 | 内置工具 | 技能 | 推荐 |
|------|---------|------|------|
| **Drive/Wiki（高频）** | ~100ms ⚡ | ~500ms 🐢 | **保留内置** |
| **其他功能（低频）** | 简化/无 ❌ | 完整 ✅ | **使用技能** |

### 性能影响对比

```
高频操作（每天 10+ 次）：
  内置工具：⚡ 100ms（即时响应）
  技能：    🐢 500ms（可感知延迟）

低频操作（每天 <1 次）：
  内置工具：❌ 功能不全（如日历缺参与人）
  技能：    ✅ 功能完整 + 500ms 延迟可接受
```

## 实施步骤

### 1. 删除文件（~30 秒）

```bash
cd /Users/tanghao/workspace/beeclaw
rm src/adapter/feishu/tools/calendar.ts
rm src/adapter/feishu/tools/docx.ts
rm src/adapter/feishu/tools/bitable.ts
rm src/adapter/feishu/tools/user-info.ts
```

### 2. 更新导出（~1 分钟）

编辑 `src/adapter/feishu/index.ts`，删除这些行：

```typescript
// ❌ 删除这些导出
export { executeCalendarTool, calendarToolDefinitions } from './tools/calendar';
export type { FeishuCalendar, FeishuEvent } from './tools/calendar';

export { executeDocxTool, docxToolDefinitions } from './tools/docx';
export type { BlockCreateRequest, TextContent, FeishuBlock } from './tools/docx';

export { executeBitableTool, bitableToolDefinitions } from './tools/bitable';
export type { FeishuBitable, FeishuTable, FeishuField, FeishuRecord } from './tools/bitable';

export { executeUserInfoTool, userInfoToolDefinitions } from './tools/user-info';
```

### 3. 更新工具执行器（~2 分钟）

编辑 `src/domain/agent/index.ts`，删除这些分支（约 20 行）：

```typescript
// ❌ 删除这些分支
if (name.startsWith('feishu_calendar_')) {
  result = await executeCalendarTool(cliRunner, name, params, userContext);
  await handleAuthRequired(result);
} else if (name.startsWith('feishu_docx_')) {
  result = await executeDocxTool(cliRunner, name, params);
} else if (name.startsWith('feishu_bitable_')) {
  result = await executeBitableTool(cliRunner, name, params);
} else if (name.startsWith('feishu_get_')) {
  result = await executeUserInfoTool(cliRunner, name, params, userContext);
}
```

### 4. 更新工具定义（~1 分钟）

编辑 `src/domain/agent/tools.ts`，删除这些导入和引用：

```typescript
// ❌ 删除导入
import {
  driveToolDefinitions,
  wikiToolDefinitions,
  calendarToolDefinitions,    // ← 删除
  docxToolDefinitions,         // ← 删除
  bitableToolDefinitions,      // ← 删除
  userInfoToolDefinitions,     // ← 删除
} from '../../adapter/feishu';

// ❌ 从数组中删除
export function getAllToolsForAI(): OpenAITool[] {
  return [
    ...memoryTools,
    ...skillTools,
    ...builtinTools,
    ...driveToolDefinitions,      // ← 保留
    ...wikiToolDefinitions,       // ← 保留
    // ...calendarToolDefinitions,  // ← 删除
    // ...docxToolDefinitions,      // ← 删除
    // ...bitableToolDefinitions,   // ← 删除
    // ...userInfoToolDefinitions,  // ← 删除
  ];
}
```

### 5. 测试（~2 分钟）

```bash
# 测试启动
bun run cli

# 测试 Drive/Wiki（应该快）
你: 列出云空间文件

# 测试其他功能（应该提示使用技能）
你: 列出我的日历
AI: [应该调用 feishu-cli-toolkit 技能]
```

## 最终架构

```
用户请求
   ↓
AI Agent
   ├─ Drive/Wiki？
   │  └─ 内置工具（快 ~100ms）⚡
   │
   └─ 其他功能？
      └─ feishu-cli-toolkit 技能（完整 ~500ms）✅
```

## 如果你想全部删除

如果你更看重极简架构，也可以全部删除：

```bash
# 删除所有工具
rm src/adapter/feishu/tools/*.ts

# 只保留 cli-runner.ts 和 cli-types.ts
```

**优点**：
- ✅ 架构最简
- ✅ 维护成本最低
- ✅ 功能最完整（技能 100% 覆盖）

**缺点**：
- ❌ Drive/Wiki 慢 5x（100ms → 500ms）
- ❌ 高频操作体验变差

## 我的推荐

**选择方案 B（部分删除）**，因为：

1. **平衡性最好**：高频操作快，低频功能全
2. **代码简化明显**：删除 ~500 行，保留核心
3. **用户体验最优**：常用操作保持即时响应
4. **维护成本适中**：只需维护 Drive/Wiki

**时间成本**：~5 分钟完成
**收益**：代码 -500 行，功能 +100%，维护 -50%

---

需要我帮你执行删除吗？
