# 记忆系统

> Beeclaw 的智能记忆存储和检索系统

## 概述

Beeclaw 的记忆系统基于文件系统，提供持久化存储和智能检索能力。

## 核心特性

- **持久化存储**: JSONL 格式存储在 `data/memory/`
- **Fact 分类**（`memory_record` 接受的 enum，源头 `src/domain/memory/tools.ts`）: `user`、`preferences`、`events`、`investments`、`lessons`
- **目录结构**: `data/memory/` 下混合 markdown / JSONL（按子目录组织）+ SQLite vector index 用于语义搜索
- **智能检索**: 基于重要性评分（recency, frequency, relevance）
- **自动压缩**: 旧对话自动摘要以节省空间

## 记忆类型

### 1. Conversations (对话)
记录用户与 AI 的对话历史
```
data/memory/conversations/default.jsonl
```

### 2. Facts (事实)
存储重要的事实和知识
```
data/memory/facts/preferences.md
data/memory/facts/lessons.md
```

### 3. Decisions (决策)
记录重要的决策和理由
```
data/memory/decisions/2026-03-19-architecture-choice.md
```

### 4. Skills (技能)
技能相关的记忆
```
data/memory/skills/
```

## 工具接口

### memory_ls
列出记忆目录内容
```bash
memory_ls(path: "facts")
```

### memory_grep
搜索记忆内容
```bash
memory_grep(query: "用户偏好", path: "facts")
```

### memory_read
读取记忆文件
```bash
memory_read(path: "facts/preferences.md")
```

### memory_write
写入记忆文件
```bash
memory_write(path: "facts/new-fact.md", content: "...", mode: "overwrite")
```

### memory_record
记录新事实（`category` 必须是合法 enum）
```bash
memory_record(category: "lessons", fact: "用户喜欢简洁的回复")
# 合法 category: user, preferences, events, investments, lessons
```

### memory_search / memory_semantic_search
基于关键词或向量的检索：
```bash
memory_search(query: "用户偏好")             # 关键词匹配 + i18n 同义词扩展
memory_semantic_search(query: "用户偏好", topK: 5)  # 嵌入向量相似度
```

### 其他工具（场景化）
- `memory_compress` — 触发分层压缩
- `memory_score` / `memory_dedupe` — 评分与去重
- `memory_knowledge_create` — 沉淀知识条目
- `memory_index` — 重建索引

## 配置

在 `beeclaw.json` 中配置：
```json
{
  "memory": {
    "enabled": true,
    "path": "./data/memory",
    "loadCoreMemory": true,
    "compression": {
      "enabled": true,
      "threshold": 0.8
    }
  }
}
```

## 最佳实践

1. **定期清理**: 使用 `memory_ls` 和 `memory_grep` 查看记忆内容
2. **分类存储**: 将不同类型的知识存入对应分类
3. **合理压缩**: 配置压缩阈值以平衡性能和完整性
4. **备份重要记忆**: 定期备份 `data/memory/` 目录

## 相关文档

- [技能系统](./skill-system.md)
- [配置指南](../configuration.md)
