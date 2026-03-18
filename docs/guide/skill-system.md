# 技能系统

> 可复用、可进化的技能管理

## 概述

技能系统允许 Beeclaw 学习和进化新能力。每个技能是一个 Markdown 文件，包含提示词、示例和元数据。

## 技能结构

```
skills/
├── productivity/
│   ├── WEEKLY-REPORT.md
│   └── TASK-TRACKING.md
├── research/
│   └── DEEP-RESEARCH.md
└── feishu-extended/
    └── SKILL.md
```

## 技能格式

```markdown
---
name: weekly-report
description: 生成周报
maturity: growing
tags: [productivity, reporting]
created: 2026-03-19
---

# 周报生成技能

## 目标
帮助用户自动生成周报

## 触发条件
用户说："帮我写周报" 或 "生成周报"

## 执行步骤
1. 收集本周完成的任务
2. 整理关键成果
3. 生成结构化周报

## 示例
...
```

## 技能成熟度

- **seed**: 初始想法，需要完善
- **growing**: 正在发展中，基本可用
- **mature**: 成熟稳定，广泛使用
- **deprecated**: 已废弃，不推荐使用

## 工具接口

### skill_list
列出所有技能
```bash
skill_list(maturity?: "seed" | "growing" | "mature" | "deprecated")
```

### skill_get
获取技能详情
```bash
skill_get(name: "weekly-report")
```

### skill_ensure
创建或更新技能
```bash
skill_ensure(name: "my-skill", description: "...", content: "...", maturity: "seed")
```

### skill_delete
删除技能
```bash
skill_delete(name: "my-skill")
```

### skill_search
搜索技能
```bash
skill_search(query: "报告")
```

### skill_maturity
更新技能成熟度
```bash
skill_maturity(name: "my-skill", maturity: "growing")
```

## 技能进化

Beeclaw 可以根据使用情况自动进化技能：
1. 记录技能使用反馈
2. 分析成功率
3. 优化提示词
4. 更新成熟度

## 最佳实践

1. **清晰的触发条件**: 让 AI 容易识别何时使用技能
2. **详细的步骤**: 提供明确的执行指南
3. **丰富的示例**: 帮助 AI 理解预期输出
4. **定期维护**: 根据使用情况更新技能

## 相关文档

- [记忆系统](./memory-system.md)
- [插件系统](./plugin-system.md)
