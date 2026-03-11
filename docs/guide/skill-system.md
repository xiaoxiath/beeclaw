# 技能系统

Beeclaw 的技能系统提供可复用的知识和流程模块，让 Agent 通过学习和创建技能来持续进化。

---

## 概述

技能（Skill）是 Beeclaw 的核心概念之一——一组打包好的知识、流程和工具调用模板，Agent 可以在合适的场景下自动调用。

### 核心特性

| 特性 | 说明 |
|------|------|
| **自动匹配** | 基于用户意图自动选择合适的技能 |
| **可创建** | Agent 可以根据对话经验创建新技能 |
| **可进化** | 技能通过使用反馈不断优化 |
| **可组合** | 技能间可以互相调用和组合 |
| **可评估** | 内置评估机制量化技能质量 |

---

## 技能结构

每个技能是一个独立目录，位于 `data/memory/skills/` 下：

```
skills/
├── my-skill/
│   ├── SKILL.md              # 技能定义（必需）
│   ├── scripts/              # 辅助脚本
│   │   └── helper.sh
│   ├── references/           # 参考资料
│   │   └── api-doc.md
│   ├── evals/                # 评估用例
│   │   └── test-cases.json
│   └── assets/               # 资源文件
│       └── template.txt
```

### SKILL.md 格式

```markdown
# My Skill

## Description
一句话描述技能的用途。

## Triggers
- 当用户说"帮我做 X"时
- 当需要处理 Y 类型的任务时

## Steps
1. 首先执行 A 操作
2. 然后执行 B 操作
3. 最后汇总结果

## Examples
### 输入
用户: 帮我做 X
### 输出
好的，我来帮你处理...

## Notes
- 注意事项 1
- 注意事项 2
```

---

## 技能工具

### 查询类

| 工具 | 说明 |
|------|------|
| `skill_list` | 列出所有已有技能 |
| `skill_get` | 获取技能详细内容（Agent 加载技能后按其步骤执行） |
| `skill_search` | 按关键词搜索技能 |
| `skill_maturity` | 查看技能成熟度评估 |
| `skill_structure` | 查看技能目录结构 |
| `skill_evals_get` | 获取技能评估数据 |
| `skill_resource_read` | 读取技能关联的参考资源 |

### 管理类

| 工具 | 说明 |
|------|------|
| `skill_create` | 创建新技能 |
| `skill_update` | 更新已有技能 |
| `skill_delete` | 删除技能 |
| `skill_ensure` | 确保技能存在（不存在则触发创建流程） |
| `skill_record` | 记录技能使用结果（成功/失败） |
| `skill_evals_set` | 设置技能评估数据 |
| `skill_resource_write` | 写入技能参考资源 |
| `skill_workspace_create` | 创建技能工作空间 |

---

## 技能创建流程

### 自动创建

当 Agent 检测到重复性任务模式时，可以自动创建技能：

1. **意图检测**：通过 `skill_ensure` 检查是否已有匹配技能
2. **触发创建**：如果不存在，加载内置 `skill-creator` 技能
3. **设计技能**：按 skill-creator 流程设计 SKILL.md
4. **测试验证**：创建评估用例并运行
5. **持久保存**：写入到技能目录

### 手动创建

```
> /skill create my-new-skill
```

或通过对话：

```
用户: 帮我创建一个技能，用于每天早上发送天气报告
Agent: 好的，我来为你创建这个技能...
       [调用 skill_create]
```

---

## 技能进化

### 成熟度模型

技能通过使用反馈逐步进化：

| 阶段 | 使用次数 | 成功率 | 特征 |
|------|----------|--------|------|
| **Draft** | 0-2 | - | 刚创建，未经验证 |
| **Testing** | 3-10 | < 80% | 使用中，收集反馈 |
| **Stable** | 10+ | ≥ 80% | 稳定可靠 |
| **Mature** | 30+ | ≥ 90% | 经过充分验证 |

### 反馈记录

每次技能被使用后，Agent 通过 `skill_record` 记录执行结果：

```typescript
skill_record({
  name: "weather-report",
  success: true,
  context: "用户请求天气报告，技能正确执行"
})
```

失败记录会触发反思机制，自动分析失败原因并建议改进。

---

## 内置技能

Beeclaw 附带一组内置技能（位于项目 `skills/` 目录）：

| 技能 | 用途 |
|------|------|
| `skill-creator` | 创建新技能的元技能 |
| `beeclaw-reflection` | Agent 自我反思 |
| `beeclaw-preference-learning` | 学习用户偏好 |
| `doc-coauthoring` | 文档协作 |
| `mcp-builder` | 构建 MCP 服务器 |
| `web-artifacts-builder` | Web 应用构建 |
| `pdf` | PDF 处理 |
| `pptx` | PPT 生成 |
| `xlsx` | Excel 处理 |
| `frontend-design` | 前端设计 |
| `canvas-design` | Canvas 画图 |

---

## 相关文档

- [工具参考](../references/tools.md) — 所有工具的详细参数
- [记忆系统](./memory-system.md) — 技能依赖的记忆基础
- [子代理系统](./subagent-system.md) — 技能与子代理的协作
