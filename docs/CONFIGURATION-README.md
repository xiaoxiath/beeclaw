# Beeclaw 配置文档索引

> **最新版本**: v6 Final
> **最后更新**: 2026-03-17

---

## 📚 文档导航

### 新手必读

| 文档 | 说明 | 阅读时间 |
|------|------|----------|
| [configuration.md](./configuration.md) | **配置指南（入口）** | 5 分钟 |
| [CONFIGURATION-FINAL.md](./CONFIGURATION-FINAL.md) | **v6 完整配置详解** | 10 分钟 |

### 进阶阅读

| 文档 | 说明 | 阅读时间 |
|------|------|----------|
| [CONFIGURATION-CONCEPTS.md](./CONFIGURATION-CONCEPTS.md) | 核心概念说明（roles/router/agent） | 8 分钟 |
| [CONFIGURATION-SIMPLIFICATION.md](./CONFIGURATION-SIMPLIFICATION.md) | 配置简化历程（v1→v6） | 6 分钟 |
| [CONFIGURATION-V5-DESIGN.md](./CONFIGURATION-V5-DESIGN.md) | v5 设计文档（历史参考） | 10 分钟 |

### 迁移指南

| 文档 | 说明 | 适用场景 |
|------|------|----------|
| [CONFIGURATION-MIGRATION-GUIDE.md](./CONFIGURATION-MIGRATION-GUIDE.md) | 版本迁移指南 | 从旧版本升级 |

---

## 🎯 快速选择

### 我是新手，从哪里开始？

1. **5 分钟快速开始** → [configuration.md](./configuration.md)
2. **理解配置结构** → [CONFIGURATION-FINAL.md](./CONFIGURATION-FINAL.md)
3. **查看完整示例** → [../beeclaw.example.json](../beeclaw.example.json)

### 我有旧版本配置，如何迁移？

1. **阅读迁移指南** → [CONFIGURATION-MIGRATION-GUIDE.md](./CONFIGURATION-MIGRATION-GUIDE.md)
2. **参考新配置** → [../beeclaw.example.json](../beeclaw.example.json)
3. **验证配置** → `bun run config:validate`

### 我想理解设计理念

1. **核心概念** → [CONFIGURATION-CONCEPTS.md](./CONFIGURATION-CONCEPTS.md)
2. **简化历程** → [CONFIGURATION-SIMPLIFICATION.md](./CONFIGURATION-SIMPLIFICATION.md)
3. **设计文档** → [CONFIGURATION-V5-DESIGN.md](./CONFIGURATION-V5-DESIGN.md)

---

## 📋 配置文件

| 文件 | 说明 |
|------|------|
| [beeclaw.json](../beeclaw.json) | **主配置文件（当前使用）** |
| [beeclaw.example.json](../beeclaw.example.json) | **完整配置示例** |
| [beeclaw.schema.json](../beeclaw.schema.json) | JSON Schema 验证 |

---

## 🔑 v6 核心概念

```
providers  → 提供 API 访问和模型信息
roles      → 定义模型使用场景（可复用）
llmRouter  → 自动路由优化（可选）
agent      → 用户实体（单个）
```

**配置行数**: ~55 行（完整功能）

---

## 📊 配置简化历程

| 版本 | 行数 | 字段数 | 主要改进 |
|------|------|--------|----------|
| v1 | 200+ | 20+ | 初始版本 |
| v2 | 150 | 18 | 环境变量支持 |
| v3 | 120 | 15 | 参数简化 |
| v4 | 93 | 12 | 三层配置 |
| v5 | 72 | 10 | 移除冗余字段 |
| **v6** | **55** | **8** | **agents → agent** |

**总简化**: **72%** ✅

---

## 🚀 优势

- ✅ **简洁** - 55 行配置覆盖所有功能
- ✅ **清晰** - 职责明确，引用关系清楚
- ✅ **灵活** - 支持多 Provider，参数覆盖
- ✅ **易用** - 学习曲线平缓，配置简单

---

## 💡 获取帮助

- **配置问题** → [configuration.md](./configuration.md)
- **概念疑问** → [CONFIGURATION-CONCEPTS.md](./CONFIGURATION-CONCEPTS.md)
- **完整示例** → [../beeclaw.example.json](../beeclaw.example.json)
- **Schema 验证** → [../beeclaw.schema.json](../beeclaw.schema.json)

---

**这是 v6 最终配置方案！** 🎉
