# 子代理编排

> 40分钟掌握并行任务执行和 DAG 编排

## 场景

你需要完成一个复杂的市场分析任务，包含多个独立子任务：

1. **技术调研** - 搜索最新技术趋势
2. **竞品分析** - 收集竞品信息
3. **用户反馈** - 抓取用户评价
4. **数据整合** - 综合生成报告

传统串行执行需要 15 分钟，使用子代理并行执行可缩短到 5 分钟。

## 目标

- ✅ 理解子代理系统架构
- ✅ 掌握 `spawn_subagent` 单个子代理
- ✅ 掌握 `spawn_parallel` 并行子代理
- ✅ 理解 DAG 任务编排

## 前置条件

- [ ] 已完成 [快速开始](../../getting-started.md)
- [ ] 理解 [系统架构](../../architecture.md) 基础
- [ ] 配置了搜索 API

---

## 步骤

### 步骤 1：理解子代理架构

```
┌─────────────────────────────────────────────────┐
│            Orchestrator Agent                    │
│      (主代理 - 任务分解、调度、聚合)               │
└────────────────┬────────────────────────────────┘
                 │
    ┌────────────┼────────────┬────────────┐
    ▼            ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
│Research│  │ Memory │  │ Skill  │  │  Code  │
│Subagent│  │Subagent│  │Subagent│  │Subagent│
└────────┘  └────────┘  └────────┘  └────────┘
    │            │            │            │
    └────────────┴────────────┴────────────┘
                      │
                      ▼
            ┌──────────────────┐
            │  Shared State    │
            │  (任务状态/结果)  │
            └──────────────────┘
```

**子代理类型**:

| 类型 | 职责 | 可用工具 |
|------|------|----------|
| `research` | 搜索、调研、信息收集 | web_search, web_fetch, memory_read |
| `memory` | 记忆读写、知识管理 | memory_read, memory_write, keyword_* |
| `skill` | 技能创建、执行、评估 | skill_* tools |
| `code` | 代码生成、文件操作 | file_*, shell |
| `general` | 通用任务 | 所有工具 |

---

### 步骤 2：单个子代理（基础）

#### 场景：搜索技术趋势

```bash
> 使用子代理搜索"2024年 React 技术趋势"
```

**AI 执行**:
```typescript
spawn_subagent({
  type: "research",
  task: "搜索并总结 2024年 React 技术趋势，重点关注新特性、性能优化、生态工具",
  context: "用户是前端开发者，偏好 TypeScript",
  timeout: 60000
})
```

**执行过程**:
```
🔄 启动子代理 (research)...

子代理思考:
1. 分析任务: 需要搜索 React 趋势
2. 选择工具: web_search + web_fetch
3. 执行搜索: "React 19 features", "React performance 2024"
4. 抓取内容: 3 篇权威文章
5. 生成总结: 提取关键信息

✓ 子代理完成 (耗时: 25s)
```

**输出**:
```markdown
# 2024年 React 技术趋势

## 核心更新

### React 19 新特性
1. **Server Components** - 服务端组件稳定版
2. **useOptimistic** - 乐观更新 Hook
3. **useFormStatus** - 表单状态管理
4. **Actions** - 统一的表单提交方案

### 性能优化
1. **编译器优化** - React Compiler 自动 memoization
2. **Suspense 增强** - 更细粒度的加载控制
3. **并发渲染** - useTransition 性能提升

### 生态工具
1. **Next.js 14** - App Router 稳定
2. **Vite 5** - 更快的构建速度
3. **React Query 5** - 数据获取优化

## TypeScript 支持
- 类型推断改进
- 新增类型安全的 Actions

## 学习建议
1. 掌握 Server Components
2. 实践 React Compiler
3. 升级到 Next.js 14
```

---

### 步骤 3：并行子代理（进阶）

#### 场景：并行执行多个独立任务

```bash
> 并行执行以下任务：
1. 搜索 React 19 新特性
2. 搜索 Vue 3.4 更新
3. 从记忆中读取前端技术栈偏好
```

**AI 执行**:
```typescript
spawn_parallel({
  tasks: [
    {
      type: "research",
      task: "搜索 React 19 新特性和改进"
    },
    {
      type: "research",
      task: "搜索 Vue 3.4 更新内容"
    },
    {
      type: "memory",
      task: "读取用户的前端技术栈偏好"
    }
  ],
  maxParallelism: 3
})
```

**执行过程**:
```
🔄 启动并行子代理 (3个)...

┌─ 子代理 1 (research) ───────────────┐
│ 任务: React 19 新特性               │
│ 状态: 运行中...                      │
└──────────────────────────────────────┘

┌─ 子代理 2 (research) ───────────────┐
│ 任务: Vue 3.4 更新                  │
│ 状态: 运行中...                      │
└──────────────────────────────────────┘

┌─ 子代理 3 (memory) ─────────────────┐
│ 任务: 读取技术栈偏好                 │
│ 状态: ✅ 完成 (5s)                   │
│ 结果: 用户偏好 React + TypeScript    │
└──────────────────────────────────────┘

[等待其他子代理完成...]

┌─ 子代理 1 (research) ───────────────┐
│ 状态: ✅ 完成 (28s)                  │
│ 结果: React 19 新特性总结            │
└──────────────────────────────────────┘

┌─ 子代理 2 (research) ───────────────┐
│ 状态: ✅ 完成 (32s)                  │
│ 结果: Vue 3.4 更新总结               │
└──────────────────────────────────────┘

✓ 所有子代理完成
总耗时: 32s (并行执行，节省 50% 时间)
```

**输出**:
```markdown
# 并行研究结果汇总

## React 19 新特性
[子代理 1 的输出...]

## Vue 3.4 更新
[子代理 2 的输出...]

## 用户技术栈偏好
[子代理 3 的输出...]
```

---

### 步骤 4：DAG 任务编排（高级）

#### 场景：复杂的市场分析任务

任务依赖关系：
```
   [任务 1] 搜索技术趋势
       ↓
   [任务 2] 搜索竞品信息  [任务 3] 抓取用户评价
       ↓                      ↓
   [任务 4] 分析技术优势   [任务 5] 分析用户痛点
              ↘            ↙
            [任务 6] 生成综合报告
```

**手动执行**:

```bash
> 执行市场分析任务，按依赖关系编排
```

**AI 执行流程**:

```typescript
// 阶段 1: 独立任务
spawn_parallel({
  tasks: [
    { type: "research", task: "搜索 React 生态技术趋势" }
  ]
})

// 阶段 2: 依赖任务
spawn_parallel({
  tasks: [
    {
      type: "research",
      task: "搜索 Vue、Angular 竞品信息",
      context: "基于任务1的趋势分析"
    },
    {
      type: "research",
      task: "抓取 Reddit、Hacker News 用户评价",
      context: "关注 React 相关讨论"
    }
  ]
})

// 阶段 3: 聚合任务
spawn_subagent({
  type: "general",
  task: "综合前面的研究结果，生成市场分析报告"
})
```

**自动 DAG 编排**（未来功能）:

```typescript
spawn_dag({
  tasks: [
    {
      id: "trend_research",
      type: "research",
      task: "搜索技术趋势"
    },
    {
      id: "competitor_analysis",
      type: "research",
      task: "搜索竞品信息",
      dependsOn: ["trend_research"]
    },
    {
      id: "user_feedback",
      type: "research",
      task: "抓取用户评价",
      dependsOn: ["trend_research"]
    },
    {
      id: "final_report",
      type: "general",
      task: "生成综合报告",
      dependsOn: ["competitor_analysis", "user_feedback"]
    }
  ]
})
```

---

### 步骤 5：共享状态通信

子代理之间通过共享状态传递数据：

#### 场景：多步骤数据处理

```bash
> 执行数据分析任务：
1. 子代理 1 搜索数据
2. 子代理 2 清洗数据
3. 子代理 3 生成报告
```

**AI 执行**:

```typescript
// 子代理 1: 搜索数据
spawn_subagent({
  type: "research",
  task: "搜索电动汽车销量数据，存储到共享状态",
  onComplete: (result) => {
    state_set({
      key: "market:ev:sales_data",
      value: result.data,
      ttl: 3600000
    });
  }
});

// 子代理 2: 清洗数据（依赖子代理 1）
spawn_subagent({
  type: "code",
  task: "从共享状态读取数据并清洗",
  context: "读取 state:market:ev:sales_data",
  onComplete: (result) => {
    state_set({
      key: "market:ev:cleaned_data",
      value: result.cleaned
    });
  }
});

// 子代理 3: 生成报告（依赖子代理 2）
spawn_subagent({
  type: "general",
  task: "基于清洗后的数据生成报告",
  context: "读取 state:market:ev:cleaned_data"
});
```

---

## 完整工作流示例

### 场景：产品竞品分析

**输入**:
```bash
> 对"Notion vs Obsidian vs Roam Research"进行竞品分析

分析维度：
1. 功能对比
2. 定价策略
3. 用户评价
4. 技术架构
5. 市场定位

生成对比报告并保存。
```

**AI 完整执行**:

```typescript
// 步骤 1: 并行收集信息
const [notion, obsidian, roam] = await spawn_parallel({
  tasks: [
    {
      type: "research",
      task: "深度研究 Notion: 功能、定价、用户评价"
    },
    {
      type: "research",
      task: "深度研究 Obsidian: 功能、定价、用户评价"
    },
    {
      type: "research",
      task: "深度研究 Roam Research: 功能、定价、用户评价"
    }
  ],
  maxParallelism: 3
});

// 步骤 2: 对比分析
const comparison = await spawn_subagent({
  type: "general",
  task: "对比三个产品的功能、定价、用户评价",
  context: `${notion}\n\n${obsidian}\n\n${roam}`
});

// 步骤 3: 生成报告
const report = await spawn_subagent({
  type: "code",
  task: "生成 Markdown 格式的对比报告",
  context: comparison
});

// 步骤 4: 保存文件
await file_write({
  path: "reports/product-comparison.md",
  content: report
});
```

**输出**:
```
✓ 竞品分析完成

耗时: 3分 20秒
- 信息收集: 2分 15秒 (并行)
- 对比分析: 40秒
- 报告生成: 25秒

报告已保存: reports/product-comparison.md
```

---

## 验证

### 功能验证

- [ ] 单个子代理能成功执行
- [ ] 并行子代理能同时运行
- [ ] 共享状态能正确传递数据
- [ ] 子代理超时能正确处理

### 边界测试

**测试 1：子代理超时**
```bash
> 启动一个耗时的搜索任务，设置 10 秒超时
```
**预期**: 10 秒后超时，返回部分结果或错误

**测试 2：并行数限制**
```bash
> 同时启动 10 个子代理
```
**预期**: 最多 `maxParallelism` 个并行，其余排队

**测试 3：依赖循环**
```bash
> 创建任务 A 依赖 B，B 依赖 A
```
**预期**: 检测到循环依赖，报错

---

## 常见问题

### Q1: 子代理与主代理的区别？

**A**:

| 特性 | 主代理 | 子代理 |
|------|--------|--------|
| **生命周期** | 长期运行 | 任务完成后销毁 |
| **上下文** | 完整会话历史 | 仅任务相关 |
| **工具访问** | 所有工具 | 类型限制的工具集 |
| **并行性** | 单一主线程 | 可并行执行 |

### Q2: 如何选择子代理类型？

**A**: 根据任务性质：

```typescript
// 搜索、调研 → research
{ type: "research", task: "搜索..." }

// 记忆操作 → memory
{ type: "memory", task: "读取..." }

// 代码生成 → code
{ type: "code", task: "编写脚本..." }

// 复杂任务 → general
{ type: "general", task: "综合分析..." }
```

### Q3: 子代理能访问主代理的记忆吗？

**A**: 默认不能，但可以通过 `context` 参数传递：

```typescript
spawn_subagent({
  type: "research",
  task: "基于用户偏好搜索",
  context: "用户偏好: React, TypeScript, 函数式编程"  // 手动传递
})
```

未来版本将支持自动共享记忆上下文。

### Q4: 并行子代理有数量限制吗？

**A**: 有，由配置控制：

```json
{
  "subagent": {
    "maxParallelism": 3,  // 默认 3 个并行
    "defaultTimeout": 180000
  }
}
```

超过限制的任务会排队等待。

### Q5: 子代理失败会影响其他子代理吗？

**A**: 不会。每个子代理独立运行：

```typescript
spawn_parallel({
  tasks: [task1, task2, task3]
})

// 即使 task1 失败，task2 和 task3 仍会继续
// 失败的任务会在结果中标记
```

---

## 进阶拓展

### 1. 子代理 + 记忆系统

自动记录子代理执行结果：

```typescript
spawn_subagent({
  type: "research",
  task: "搜索...",
  autoRecord: true,  // 自动记录到记忆
  category: "research"
})
```

### 2. 子代理 + 目标系统

关联目标进度：

```typescript
spawn_subagent({
  type: "research",
  task: "完成市场调研",
  goalId: "goal_xxx",  // 关联目标
  onProgress: (percent) => {
    goal_add_progress({
      goalId: "goal_xxx",
      progressDelta: percent
    });
  }
});
```

### 3. 子代理插件扩展

开发自定义子代理类型：

```typescript
// 插件中定义
registerSubagentType({
  type: "data_analysis",
  allowedTools: ["python", "matplotlib", "pandas"],
  systemPrompt: "你是数据分析专家..."
});
```

---

## 下一步

- **[插件开发全流程](./plugin-development.md)** - 开发自定义子代理类型
- **[主动调度系统](./proactive-scheduling.md)** - 定期执行子代理任务
- **[目标跟踪系统](./goal-tracking.md)** - 关联目标进度

---

**预计完成时间**: 40分钟
**难度**: ⭐⭐⭐
**标签**: 子代理、并行执行、DAG编排
