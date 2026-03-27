# Shared Skill Resources

This directory contains code and assets shared across multiple skills to avoid duplication.

## `office/`

Shared Office document processing utilities (Python). Used by:

- `skills/docx/` — Word document processing
- `skills/pptx/` — PowerPoint presentation processing
- `skills/xlsx/` — Excel spreadsheet processing

Each of those skills links to this shared copy via symlink:

```
skills/{docx,pptx,xlsx}/scripts/office -> ../../_shared/office
```

### History

Prior to this consolidation the identical `office/` directory was duplicated
in all three skill directories (~22,500 lines x 3 copies). Consolidated on
2026-03-24 as part of the P2 architecture governance cleanup.

---

## SKILL.md 模板规范

每个 skill 目录下必须包含一个 `SKILL.md` 文件，该文件使用 YAML frontmatter 定义技能的元数据。以下是标准字段定义：

### 标准字段

| 字段 | 必填/推荐 | 类型 | 说明 |
|------|----------|------|------|
| `name` | **必填** | string | 技能的唯一标识符，应与目录名一致，使用 kebab-case（如 `baidu-search`） |
| `description` | **必填** | string | 技能的详细描述，包含功能说明和触发条件。agent 通过此字段匹配用户意图 |
| `version` | 推荐 | string | 语义化版本号（如 `1.0.0`），用于追踪技能迭代 |
| `license` | 推荐 | string | 许可证信息（如 `MIT`、`Proprietary`，或 `Complete terms in LICENSE.txt`） |
| `tags` | 推荐 | list | 分类标签列表，便于技能检索和分组（如 `[search, web, api]`） |
| `triggers` | 推荐 | object | 触发条件定义，支持 `when_user_mentions`（关键词列表）和 `when_tool_is_called`（工具名称） |

### 可选字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `homepage` | string | 技能相关的主页或文档链接 |
| `maturity` | string | 成熟度级别：`experimental`、`beta`、`mature` |
| `metadata` | object | 扩展元数据（如 openclaw 配置、环境变量要求等） |
| `argument-hint` | string | 命令行参数提示（如 `<module> <command> [args]`） |
| `user-invocable` | boolean | 是否可由用户直接调用 |
| `allowed-tools` | string | 允许使用的工具列表 |

### 模板示例

```yaml
---
name: my-skill-name
description: >-
  技能的详细描述。说明功能、适用场景和触发条件。
  当用户提到 X、Y、Z 时触发此技能。
version: 1.0.0
license: MIT
tags: [category1, category2]
triggers:
  - when_user_mentions: [keyword1, keyword2, keyword3]
---
```

### 注意事项

- `name` 必须与技能目录名完全一致
- `description` 应包含足够的触发关键词，便于 agent 匹配用户意图
- frontmatter 必须以 `---` 开头和结尾
- YAML 字符串中包含特殊字符（如冒号、引号）时，使用 `>-` 或引号包裹
- `metadata` 中的 JSON 对象需要符合合法 JSON 语法
