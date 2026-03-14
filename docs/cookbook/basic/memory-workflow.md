# 记忆管理工作流

> 20分钟掌握记忆系统的高效使用

## 场景

你是一个知识工作者，每天会接触大量信息：会议记录、学习笔记、项目进展、灵感想法等。传统的笔记工具难以检索，信息分散。你希望有一个智能的记忆系统，能够：

1. **自动分类**：将信息分为动态事实和稳定知识
2. **快速检索**：通过关键词秒级找到相关信息
3. **智能压缩**：自动归档旧记忆，保持系统轻量
4. **关联推理**：AI 能理解记忆间的联系

## 目标

- ✅ 理解 facts vs knowledge 的区别
- ✅ 掌握记忆记录和检索工具
- ✅ 学会关键词索引优化
- ✅ 实现记忆自动压缩

## 前置条件

- [ ] 已完成 [快速开始](../../getting-started.md)
- [ ] 理解 [记忆系统设计](../../guide/memory-system.md) 基础
- [ ] CLI 模式已启动

---

## 步骤

### 步骤 1：理解记忆分层

Beeclaw 的记忆系统采用双层存储：

| 目录 | 内容类型 | 更新频率 | 示例 |
|------|----------|----------|------|
| `facts/` | 动态数据 | 日/周级 | 近期事件、投资持仓、经验教训 |
| `knowledge/` | 稳定信息 | 月/年级 | 家庭、职业、财务概况 |

**判断标准**：
- ❓ 这个信息多久变一次？ → 日/周 → `facts/`，月/年 → `knowledge/`
- ❓ 如果丢失，多久能重新收集？ → 难收集 → `knowledge/`，易收集 → `facts/`

---

### 步骤 2：记录动态事实（Facts）

#### 场景 1：记录近期事件

```bash
> 记录一下：今天参加了季度规划会议，确定了Q2的3个核心目标

AI 会使用 memory_record 工具...
```

**AI 执行**:
```typescript
memory_record({
  category: "events",
  fact: "2026-03-14: 参加季度规划会议，确定Q2核心目标：1) 用户增长20% 2) 性能优化30% 3) 新功能上线"
})
```

**验证**:
```bash
> /memory read facts/events.md
```

**预期输出**:
```markdown
# 近期事件

## 2026-03-14
- 参加季度规划会议，确定Q2核心目标：
  1. 用户增长20%
  2. 性能优化30%
  3. 新功能上线

## 2026-03-12
- 完成了用户调研报告
...
```

---

#### 场景 2：记录经验教训

```bash
> 记录一个教训：今天因为没做数据备份，浪费了2小时恢复数据
```

**AI 执行**:
```typescript
memory_record({
  category: "lessons",
  fact: "定期备份很重要！2026-03-14: 因未备份导致数据丢失，耗时2小时恢复"
})
```

---

#### 场景 3：记录用户偏好

```bash
> 我喜欢简洁的代码风格，不喜欢过度工程化
```

**AI 执行**:
```typescript
memory_record({
  category: "preferences",
  fact: "代码风格偏好：简洁、直接、避免过度抽象"
})
```

---

### 步骤 3：创建知识文件（Knowledge）

#### 场景 1：创建职业知识

```bash
> 我在互联网公司工作，职位是高级前端工程师，主要技术栈是 React + TypeScript
```

**AI 思考**: 这是稳定知识，应存入 `knowledge/career.md`

**AI 执行**:
```typescript
memory_write({
  file: "knowledge/career.md",
  content: `# 职业信息

## 当前职位
- 公司：互联网公司
- 职位：高级前端工程师
- 技术栈：React, TypeScript, Node.js

## 工作经验
[待补充]

## 职业规划
[待补充]
`,
  mode: "overwrite"
})
```

---

#### 场景 2：使用模板创建知识

```bash
> 创建一个健康档案，记录我的健康信息
```

**AI 执行**:
```typescript
memory_knowledge_create({
  category: "health"
})
```

**输出**:
```
✓ 创建知识文件: knowledge/health.md

使用预置模板:
# 健康信息

## 基本状况
- 年龄：
- 身高：
- 体重：

## 健康习惯
- 运动频率：
- 饮食偏好：

## 医疗记录
[待补充]
```

---

### 步骤 4：关键词索引搜索

#### 构建索引

首次使用或大量更新后，重建索引：

```bash
> /memory index
```

**输出**:
```
✓ 索引重建完成
  - 扫描文件: 15
  - 提取关键词: 89
  - 耗时: 0.8s
```

---

#### 搜索记忆

**场景 1：搜索所有关于"投资"的记忆**

```bash
> 搜索记忆中关于投资的内容
```

**AI 执行**:
```typescript
memory_search({
  query: "投资",
  scope: "all"
})
```

**输出**:
```
找到 3 个匹配:

📄 facts/investments.md (分数: 0.95)
   匹配关键词: 投资, 股票, 基金

📄 knowledge/finance.md (分数: 0.82)
   匹配关键词: 投资, 财务

📄 facts/events.md (分数: 0.71)
   匹配关键词: 投资, 期权

是否需要查看详细内容？
```

---

**场景 2：仅在 facts 中搜索**

```bash
> 在 facts 中搜索"会议"
```

**AI 执行**:
```typescript
memory_search({
  query: "会议",
  scope: "facts"
})
```

---

### 步骤 5：全文搜索（精确匹配）

当需要精确匹配字符串时，使用 `memory_grep`：

```bash
> 搜索包含"裁员补偿"的记忆
```

**AI 执行**:
```typescript
memory_grep({
  query: "裁员补偿",
  path: "all"
})
```

**输出**:
```
facts/events.md:23: 公司宣布裁员补偿方案：N+3
facts/lessons.md:7: 了解裁员补偿的谈判技巧
```

---

### 步骤 6：记忆压缩

记忆系统会自动压缩旧对话，但你也可以手动触发：

```bash
> /memory compress --dry-run
```

**输出**:
```
压缩预览（试运行模式）:

可压缩文件: 12
预计节省空间: 38KB
最早记录: 2026-02-01
最晚记录: 2026-03-07

压缩策略: 7天前的对话将被摘要

示例:
  原: [100行对话记录]
  压缩后: 用户讨论了React性能优化，重点关注了虚拟列表和懒加载实现 (3行)
```

**执行压缩**:
```bash
> /memory compress
```

**输出**:
```
✓ 压缩完成
  - 压缩文件: 12
  - 节省空间: 38KB
  - 压缩率: 62%
  - 耗时: 3.2s

压缩日志: data/memory/compression-log.json
```

---

### 步骤 7：记忆去重

定期检测重复记忆：

```bash
> /memory dedupe
```

**输出**:
```
检测到 2 组重复记忆:

组 1 (相似度: 0.92):
  - facts/preferences.md:15: 我喜欢简洁的代码
  - facts/preferences.md:23: 我偏爱简洁的代码风格

组 2 (相似度: 0.88):
  - facts/lessons.md:7: 定期备份很重要
  - facts/events.md:34: 完成了数据备份

是否合并重复项？(y/n)
```

---

## 完整工作流示例

### 场景：每天结束时的记忆整理

**输入**:
```bash
> 整理今天的记忆：
1. 参加了团队周会，讨论了项目进度
2. 学到了React 19的新特性：Actions和useOptimistic
3. 发现了一个性能问题：列表渲染太慢
4. 偏好：喜欢用TDD的方式开发
```

**AI 执行流程**:

```typescript
// 1. 分类并记录事实
memory_record({
  category: "events",
  fact: "2026-03-14: 参加团队周会，讨论项目进度"
})

memory_record({
  category: "lessons",
  fact: "React 19新特性：Actions用于表单提交，useOptimistic用于乐观更新"
})

memory_record({
  category: "events",
  fact: "发现性能问题：列表渲染慢，需优化虚拟列表"
})

memory_record({
  category: "preferences",
  fact: "开发偏好：TDD（测试驱动开发）"
})

// 2. 更新索引
memory_index()

// 3. 检查重复
memory_dedupe({ threshold: 0.85 })
```

**输出**:
```
✓ 记忆已记录到 facts/
  - events.md: +2 条
  - lessons.md: +1 条
  - preferences.md: +1 条

✓ 索引已更新（新增关键词: 12）

✓ 未检测到重复记忆
```

---

## 验证

### 功能验证

- [ ] 能记录不同类型的事实
- [ ] 能创建和编辑知识文件
- [ ] 关键词搜索能找到相关记忆
- [ ] 全文搜索能精确匹配
- [ ] 记忆压缩能节省空间
- [ ] 去重能识别相似内容

### 边界测试

**测试 1：搜索不存在的内容**
```bash
> 搜索"量子物理"
```
**预期**: 返回空结果，不报错

**测试 2：记录超大内容**
```bash
> 记录以下内容：[10000字文章]
```
**预期**: 自动截断或提示压缩

**测试 3：写入只读文件**
```bash
> /memory write SOUL.md "修改人格"
```
**预期**: 权限拒绝（SOUL.md 是只读文件）

---

## 常见问题

### Q1: facts 和 knowledge 的边界不清晰怎么办？

**A**: 使用"变化频率"判断：
- **facts**: 每周/每月都可能变（项目进展、投资组合）
- **knowledge**: 半年/一年才变一次（家庭、职业）

如果实在不确定，先放 `facts/`，稳定后再迁移到 `knowledge/`。

### Q2: 关键词索引不准确怎么办？

**A**:
1. 手动重建索引：`/memory index`
2. 检查文件编码（应为 UTF-8）
3. 确保内容格式规范（使用 Markdown 标题）

### Q3: 记忆压缩会丢失信息吗？

**A**: 不会。压缩使用 AI 摘要，保留核心信息：
- **原**: 100 行对话
- **压缩**: 3-5 行摘要
- **原文**: 仍保存在 `archive/` 目录，可随时查看

### Q4: 如何备份记忆？

**A**:
```bash
# 方式 1: 手动复制
cp -r data/memory/ backup/memory-$(date +%Y%m%d)/

# 方式 2: Git 版本控制
cd data/memory && git add . && git commit -m "Backup"

# 方式 3: 云同步（推荐）
# 将 data/memory/ 目录同步到云盘
```

### Q5: 如何迁移记忆到新机器？

**A**:
```bash
# 旧机器
tar -czf beeclaw-memory.tar.gz data/memory/

# 新机器
tar -xzf beeclaw-memory.tar.gz
/memory index  # 重建索引
```

---

## 进阶拓展

### 1. 自定义记忆分类

创建新的 facts 子分类：

```bash
> 创建一个"阅读"分类，记录我的读书笔记

AI 会创建 facts/reading.md...
```

### 2. 记忆关联推理

利用 AI 理解记忆间的联系：

```bash
> 分析我的"投资"和"职业"记忆之间的关联
```

AI 会：
1. 搜索相关记忆
2. 分析时间线和因果关系
3. 生成洞察报告

### 3. 自动化记忆收集

配置插件，自动记录特定事件：

```typescript
// 插件 Hook: 每次代码提交后
onGitCommit((commit) => {
  memory_record({
    category: "events",
    fact: `代码提交: ${commit.message}`
  });
});
```

---

## 下一步

- **[深度研究任务](./research-task.md)** - 使用网络工具扩展知识
- **[目标跟踪系统](../advanced/goal-tracking.md)** - 结合记忆追踪目标
- **[插件开发全流程](../advanced/plugin-development.md)** - 自动化记忆收集

---

**预计完成时间**: 20分钟
**难度**: ⭐
**标签**: 记忆系统、知识管理、索引
