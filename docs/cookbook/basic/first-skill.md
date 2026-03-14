# 创建第一个技能

> 15分钟学会创建和执行自定义技能

## 场景

你希望 Beeclaw 能帮你自动生成每周的工作周报，包含本周完成的工作、遇到的问题和下周计划。通过创建一个技能，你可以一键生成结构化的周报。

## 目标

- ✅ 理解技能系统的 YAML frontmatter
- ✅ 创建一个简单的技能文件
- ✅ 测试技能执行
- ✅ 理解技能的成熟度分级

## 前置条件

- [ ] 已完成 [快速开始](../../getting-started.md)
- [ ] 理解 [记忆系统基础](../../guide/memory-system.md)
- [ ] CLI 模式已启动

---

## 步骤

### 步骤 1：理解技能结构

技能文件采用 Markdown + YAML frontmatter 格式：

```yaml
---
name: 技能名称
description: 技能描述
maturity: seed | growing | mature | deprecated
version: 1.0.0
created: 2026-03-14
tags: [tag1, tag2]
---

# 技能内容

这里是技能的具体提示词...
```

**成熟度说明**：

| 级别 | 说明 | 特征 |
|------|------|------|
| `seed` | 初创 | 刚创建，需要验证 |
| `growing` | 成长 | 基本可用，持续优化 |
| `mature` | 成熟 | 稳定可靠，广泛使用 |
| `deprecated` | 废弃 | 不推荐使用 |

---

### 步骤 2：创建技能文件

#### 方式 1：通过 CLI 创建（推荐）

```bash
> /skill create productivity weekly-report
```

系统会自动创建 `skills/productivity/WEEKLY-REPORT.md` 并打开编辑器。

#### 方式 2：手动创建

```bash
# 创建目录
mkdir -p skills/productivity

# 创建文件
nano skills/productivity/WEEKLY-REPORT.md
```

---

### 步骤 3：编写技能内容

将以下内容写入 `skills/productivity/WEEKLY-REPORT.md`：

```yaml
---
name: Weekly Report Generator
description: 自动生成每周工作周报
maturity: seed
version: 1.0.0
created: 2026-03-14
tags: [productivity, report, automation]
---

# 周报生成技能

你是一个专业的工作周报生成助手。请根据用户提供的信息，生成结构清晰、重点突出的周报。

## 输入要求

用户应提供以下信息（可选）：
- 本周完成的主要工作
- 遇到的问题和挑战
- 下周计划
- 其他备注

## 输出格式

请按以下格式生成周报：

```markdown
# 工作周报（YYYY-MM-DD ~ YYYY-MM-DD）

## 📋 本周完成

1. **[工作项 1]**
   - 详情...
   - 成果...

2. **[工作项 2]**
   - 详情...

## ⚠️ 遇到的问题

- **问题 1**: 描述 + 解决方案
- **问题 2**: 描述 + 当前状态

## 🎯 下周计划

1. [ ] 计划项 1
2. [ ] 计划项 2

## 💡 思考与总结

[对本周工作的反思和总结]

---
*生成时间: YYYY-MM-DD HH:mm*
```

## 生成原则

1. **简洁明了**: 避免冗长，突出重点
2. **数据驱动**: 尽量包含量化成果
3. **问题导向**: 明确问题和解决方案
4. **前瞻性**: 下周计划具体可执行
5. **专业语气**: 使用职场化表达
```

保存文件。

---

### 步骤 4：验证技能创建

```bash
> /skill list
```

**预期输出**:
```
技能列表 (1):

📁 productivity/
  └─ weekly-report (seed) - 自动生成每周工作周报
```

```bash
> /skill get productivity/weekly-report
```

**预期输出**: 显示完整的技能内容

---

### 步骤 5：执行技能

#### 方式 1：通过命令

```bash
> /skill execute productivity/weekly-report
```

系统会提示你输入本周的工作信息。

#### 方式 2：直接对话

```bash
> 请使用 weekly-report 技能帮我生成周报

本周我完成了以下工作：
1. 完成了用户认证模块的开发
2. 修复了3个bug
3. 参加了2次团队会议

遇到的问题：
- 数据库查询性能问题，已优化索引解决

下周计划：
1. 开始开发权限管理模块
2. 编写单元测试
```

**预期输出**:
```markdown
# 工作周报（2026-03-08 ~ 2026-03-14）

## 📋 本周完成

1. **用户认证模块开发**
   - 完成了登录、注册、密码重置功能
   - 集成了 JWT 认证机制
   - 通过了功能测试

2. **Bug 修复**
   - 修复了3个线上bug
   - 提升了系统稳定性

3. **团队协作**
   - 参加了2次技术评审会议
   - 完成了代码审查任务

## ⚠️ 遇到的问题

- **数据库查询性能问题**
  - 问题: 查询响应时间过长（>2s）
  - 解决: 优化了索引，响应时间降至 <200ms
  - 状态: ✅ 已解决

## 🎯 下周计划

1. [ ] 开发权限管理模块（RBAC）
2. [ ] 编写单元测试（目标覆盖率 >80%）
3. [ ] 更新技术文档

## 💡 思考与总结

本周在开发新功能的同时，注重了代码质量和性能优化。下周将继续推进核心功能开发，同时加强测试覆盖率。

---
*生成时间: 2026-03-14 16:30*
```

---

### 步骤 6：优化技能（可选）

如果生成的周报不符合预期，可以更新技能：

```bash
> /skill update productivity/weekly-report
```

修改提示词，例如：
- 添加更多输出格式选项
- 调整语气风格
- 增加特定字段

更新后，成熟度可以升级为 `growing`。

---

## 完整代码

完整技能文件：[WEEKLY-REPORT.md](../../../skills/productivity/WEEKLY-REPORT.md)

---

## 验证

### 功能验证

- [ ] 技能创建成功，出现在技能列表
- [ ] `/skill get` 能查看完整内容
- [ ] 执行技能能生成预期格式的周报
- [ ] 输出内容结构清晰、专业

### 边界测试

**测试 1：缺少输入信息**
```bash
> 请使用 weekly-report 技能
```

**预期**: 技能应提示用户提供必要信息

**测试 2：输入大量文本**
```bash
> 请使用 weekly-report 技能
[粘贴100行工作记录]
```

**预期**: 技能应能处理并提炼关键信息

---

## 常见问题

### Q1: 技能文件应该放在哪里？

**A**: 技能文件位于 `skills/` 目录下，按分类组织：
```
skills/
├── productivity/
│   └── WEEKLY-REPORT.md
├── coding/
│   └── CODE-REVIEW.md
└── research/
    └── DEEP-DIVE.md
```

### Q2: 技能名称有什么规范？

**A**:
- 文件名：大写 + 连字符（如 `WEEKLY-REPORT.md`）
- 分类：小写（如 `productivity/`）
- 技能 ID：`分类/名称`（如 `productivity/weekly-report`）

### Q3: 如何删除技能？

**A**:
```bash
> /skill delete productivity/weekly-report
```

或直接删除文件：
```bash
rm skills/productivity/WEEKLY-REPORT.md
```

### Q4: 技能可以调用工具吗？

**A**: 可以！技能的提示词可以指示 AI 使用工具。例如：

```markdown
---
name: Smart Report
---

生成报告前，请先使用 `memory_search` 搜索用户的工作记录，然后生成周报。
```

### Q5: 如何共享技能？

**A**: 技能文件是纯文本，可以通过以下方式共享：
- Git 仓库
- 复制文件内容
- 导出为 JSON（未来功能）

---

## 进阶拓展

### 1. 添加参数化

让技能支持自定义参数：

```yaml
---
name: Weekly Report Generator
parameters:
  - name: format
    type: string
    default: standard
    options: [standard, detailed, simple]
  - name: includeMetrics
    type: boolean
    default: true
---

# 周报生成技能

{{#if includeMetrics}}
请包含量化指标...
{{/if}}

{{#eq format "detailed"}}
使用详细格式...
{{/eq}}
```

### 2. 集成记忆系统

自动从记忆中提取工作记录：

```markdown
---
name: Smart Weekly Report
---

生成周报前：
1. 使用 `memory_search("本周工作")` 搜索相关记录
2. 使用 `goal_list` 获取目标进度
3. 综合信息生成周报
```

### 3. 定时执行

配置定时任务，每周五自动生成：

```json
{
  "proactive": {
    "schedules": [{
      "id": "weekly-report",
      "cron": "0 17 * * 5",
      "action": "skill_execute",
      "params": {
        "skillId": "productivity/weekly-report"
      }
    }]
  }
}
```

---

## 下一步

- **[记忆管理工作流](./memory-workflow.md)** - 学习如何管理记忆数据
- **[主动调度系统](../advanced/proactive-scheduling.md)** - 学习定时任务配置
- **[插件开发全流程](../advanced/plugin-development.md)** - 开发更强大的扩展

---

**预计完成时间**: 15分钟
**难度**: ⭐
**标签**: 技能系统、自动化、周报
