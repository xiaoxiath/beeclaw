# 飞书工具架构设计

## 设计理念

采用**分层架构**，平衡性能、灵活性和可维护性：

```
┌─────────────────────────────────────────────────┐
│                   用户请求                        │
└────────────────┬────────────────────────────────┘
                 │
         ┌───────┴───────┐
         │  AI Agent     │
         │  (Tool Selection)
         └───────┬───────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
┌─────────┐ ┌─────────┐ ┌─────────────┐
│ 内置工具 │ │ 内置工具 │ │ Skill 工具  │
│ (高频)  │ │ (高频)  │ │  (低频)     │
└─────────┘ └─────────┘ └─────────────┘
    │            │            │
    ▼            ▼            ▼
┌─────────────────────┐ ┌──────────────┐
│   飞书 API Client    │ │  CLI 工具    │
│  (直接调用，高性能)   │ │ (进程调用)   │
└─────────────────────┘ └──────────────┘
```

## 分层策略

### Layer 1: 核心层（内置工具）- 高频使用

**工具列表**：
- ✅ 日历工具（10 个）：查询/创建/更新事件
- ✅ 文档工具（8 个）：读取/编辑文档
- ✅ 多维表格（10 个）：查询/创建记录
- ✅ 云文档（10 个）：上传/下载文件

**为什么内置？**
1. **性能敏感**：每次节省 100-500ms（进程启动开销）
2. **高频使用**：用户每天可能调用数十次
3. **需要熔断器**：API 失败时自动熔断保护
4. **结果压缩**：大结果集需要智能压缩
5. **工具选择优化**：semantic tool selector 需要分析工具定义

**性能数据**：

| 操作 | 内置工具 | CLI 工具 | 性能差异 |
|------|---------|---------|----------|
| 日历查询 | ~200ms | ~500ms | **快 2.5x** |
| 文档读取 | ~300ms | ~700ms | **快 2.3x** |
| 多维表格查询 | ~250ms | ~600ms | **快 2.4x** |

### Layer 2: 扩展层（Skill 工具）- 低频/小众

**工具列表**：
- 📦 知识库管理（创建/删除空间）
- 📦 权限管理（设置文档权限）
- 📦 审批流程（创建/查询审批）
- 📦 自定义扩展（用户自定义功能）

**为什么用 Skill？**
1. **低频使用**：用户可能每月才用一次
2. **可选安装**：不是所有人都需要
3. **独立更新**：不影响 beeclaw 核心
4. **灵活扩展**：用户可以自定义

**实现方式**：
```typescript
// skills/feishu-extended/SKILL.md
---
name: feishu-extended
description: 飞书扩展工具集
---

## 工具示例

### 创建知识库
\`\`\`bash
bun scripts/wiki/create-space.ts "产品文档"
\`\`\`
```

## 性能优化

### 1. 内置工具优化

**熔断器保护**：
```typescript
// src/domain/agent/index.ts
const needsCircuitBreaker = name.startsWith('feishu_');
```

**结果压缩**：
```typescript
// 大结果集自动压缩
if (estimateTokens(result) > threshold) {
  result = await compressToolResult(result);
}
```

**工具选择优化**：
```typescript
// Semantic tool selector 预先分析工具定义
const selectedTools = await semanticSelector.selectTools(
  userQuery,
  allTools
);
```

### 2. Skill 工具优化

**懒加载**：
```typescript
// 只有使用时才加载 skill
const skill = await skillStore.get('feishu-extended');
```

**结果缓存**：
```typescript
// 缓存 CLI 工具输出
const cacheKey = `feishu-extended:${toolName}:${hashParams(params)}`;
const cached = await cache.get(cacheKey);
```

## 扩展性设计

### 1. 添加新的内置工具

**步骤**：
1. 在 `src/adapter/feishu/tools/` 中实现
2. 添加到 `getAllTools()`
3. 在 `executeCalendarTool()` 等函数中添加执行逻辑

**示例**：
```typescript
// src/adapter/feishu/tools/calendar.ts
export async function createRecurringEvent(...) {
  const response = await client.calendar.calendarEvent.create({
    // ...
  });
  return response.data;
}

// 添加工具定义
export const calendarToolDefinitions = {
  // ...
  feishu_calendar_recurring_event: {
    name: 'feishu_calendar_recurring_event',
    description: 'Create a recurring calendar event',
    parameters: { /* ... */ }
  }
};

// 添加执行逻辑
// src/domain/agent/index.ts
case 'feishu_calendar_recurring_event':
  result = await createRecurringEvent(client, params);
  break;
```

### 2. 添加新的 Skill 工具

**步骤**：
1. 在 `skills/feishu-extended/scripts/` 中创建脚本
2. 在 SKILL.md 中描述工具
3. 用户可选安装

**示例**：
```bash
# 1. 创建脚本
cat > skills/feishu-extended/scripts/approval/create.ts << 'EOF'
#!/usr/bin/env bun
import { Client } from '@larksuiteoapi/node-sdk';

const approvalCode = process.argv[2];
const client = new Client({ /* ... */ });

const result = await client.approval.instance.create({
  approval_code: approvalCode,
  // ...
});

console.log(JSON.stringify(result));
EOF

# 2. 在 SKILL.md 中描述
echo "### feishu_approval_create
创建审批实例..." >> skills/feishu-extended/SKILL.md
```

## 迁移路径

### 从内置迁移到 Skill

如果发现某个工具使用频率降低，可以迁移到 Skill：

```bash
# 1. 移动代码
mv src/adapter/feishu/tools/wiki.ts \
   skills/feishu-extended/scripts/wiki/

# 2. 改造为 CLI 工具
# (添加命令行参数解析、JSON 输出等)

# 3. 从内置工具列表移除
# (编辑 src/domain/agent/tools.ts)

# 4. 更新文档
```

### 从 Skill 迁移到内置

如果发现某个 Skill 工具使用频率变高，可以迁移到内置：

```bash
# 1. 将 CLI 工具改造为函数调用
# 2. 添加到 src/adapter/feishu/tools/
# 3. 注册到 getAllTools()
# 4. 更新文档
```

## 最佳实践

### 1. 判断工具应该在哪一层

**决策树**：
```
这个工具是否高频使用？（每天 > 5 次）
├─ 是 → 内置工具
└─ 否
    └─ 这个工具是否需要熔断器/重试？
        ├─ 是 → 内置工具
        └─ 否
            └─ 这个工具是否需要访问 session/memory？
                ├─ 是 → 内置工具
                └─ 否 → Skill 工具
```

### 2. 性能监控

**添加性能指标**：
```typescript
import { performance } from 'perf_hooks';

const start = performance.now();
const result = await executeCalendarTool(client, name, params);
const duration = performance.now() - start;

logger.info('Tool execution', {
  tool: name,
  duration: `${duration.toFixed(2)}ms`,
  layer: 'builtin'
});
```

### 3. A/B 测试

**对比内置 vs Skill**：
```typescript
// 在 beeclaw.json 中配置
{
  "feishu": {
    "useSkillForWiki": true  // 实验性使用 Skill
  }
}

// 在代码中
if (config.feishu.useSkillForWiki && name.startsWith('feishu_wiki')) {
  // 使用 Skill
  return await executeSkillTool('feishu-extended', name, params);
} else {
  // 使用内置
  return await executeWikiTool(client, name, params);
}
```

## 总结

### 推荐方案：混合架构 ✅

- **核心工具（28 个）**：内置，追求性能
  - 日历、文档、多维表格、云文档
- **扩展工具（20+ 个）**：Skill 封装，追求灵活
  - 知识库、权限、审批、自定义

### 不推荐：全部内置 ❌

- 代码耦合严重
- 维护成本高
- beeclaw 包体积大

### 不推荐：全部 Skill ❌

- 性能差 2-3 倍
- 失去熔断器、压缩等高级特性
- 用户体验下降

---

**下一步**：
1. ✅ 保持现状（核心工具已内置）
2. ✅ 创建 `feishu-extended` skill（扩展工具）
3. ✅ 监控使用频率，动态调整分层
4. ✅ 收集用户反馈，持续优化

**参考文档**：
- [飞书工具配置指南](./feishu-tools-setup.md)
- [Skill 系统文档](./guide/skill-system.md)
- [性能优化指南](./operations/performance.md)
