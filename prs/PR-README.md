# Beeclaw Code Review — 全量修复 PR

## 概述

本 PR 基于对 beeclaw 全仓库（431 个 .ts 文件）的深度代码审查，修复了 **27 个明确问题**，删除了 **13,553 行**冗余/死代码，涉及 **39 个文件**。

| 指标 | 数据 |
|------|------|
| **修改文件数** | 39 |
| **新增行数** | 92 |
| **删除行数** | 13,553 |
| **修复 P0-Critical** | 8 个 |
| **修复 P1-High** | 4 个 |
| **删除死代码文件** | 21 个 |
| **清理冗余文档** | 8 个 |

---

## Patch 文件说明

提供 **分阶段 patch**（可独立应用）和 **合并 patch**（一次性应用全部修复）两种方式。

### 分阶段应用（推荐，便于 Code Review）

```bash
# Phase 1: P0 Critical 修复（8个安全/崩溃/阻断性问题）
git apply phase1-p0-critical.patch

# Phase 2: P1 Bug 修复（4个高优先级缺陷）
git apply phase2-p1-bugfixes.patch

# Phase 3: 死代码清理（9个无引用文件，3,665行）
git apply phase3-dead-code-removal.patch

# Phase 4: P2/P3 清理（死代码模块 + 冗余文档 + 版本号修复）
git apply phase4-p2p3-cleanup.patch
```

### 一次性应用

```bash
git apply beeclaw-full-review-fixes.patch
```

---

## Phase 1: P0-Critical 修复（8 项）

> **必须立即合入** — 涉及运行时崩溃、安全漏洞、核心功能失效

| # | 文件 | 修复内容 |
|---|------|---------|
| P0-01 | `src/domain/search/orchestrator.ts:273` | **运行时崩溃**：fallback catch 块引用未定义变量 `query`，修复为 `request.query` |
| P0-02 | `src/domain/sandbox/providers/docker.ts` | **Provider 不可用**：`private alive` 与 `get alive()` 同名冲突导致无限递归，重命名为 `_alive` |
| P0-03 | `src/domain/sandbox/providers/local.ts` | 同上，同样的字段/getter 命名冲突 |
| P0-04 | `src/domain/agent/goal/store.ts` | **安全漏洞**：goalId 直接拼接文件路径，存在路径穿越攻击。添加 `sanitizeId()` 方法过滤 `../` 等危险字符 |
| P0-05 | `src/app/index.ts:37` | **重复导入**：`callAI` 从同一模块导入两次，删除重复行 |
| P0-06 | `src/app/gateway-service.ts:51` | **进程无法退出**：裸 `setInterval` 无 `unref()`，添加 `cleanupTimer.unref()` |
| P0-07 | `beeclaw.example.json:153` | **JSON 语法错误**：缺少逗号，新用户无法正常启动 |
| P0-08 | `src/app/dispatcher/index.ts:329` | **过期锁永不释放**：`isNull(...) === false` 是 JS 对象与布尔值比较（永远为 false），修复为 `isNotNull(...)` |

---

## Phase 2: P1-High Bug 修复（4 项）

| # | 文件 | 修复内容 |
|---|------|---------|
| P1-01 | `src/domain/proactive/tools.ts:13-14` | **重复 import**：`getTaskManager` 和 `pushNotification` 各导入两次，删除重复行 |
| P1-02 | `src/domain/proactive/types.ts` | **类型缺失**：`self_evolution` 在 tools.ts 的 Zod schema 中存在但 `ProactiveTaskType` union 中缺失，补充类型并同步所有 Zod enum |
| P1-03 | `src/infra/cache/index.ts` | **内存泄漏**：`MemoryCache` 无大小限制，长时间运行内存无限增长。添加 `maxSize`(默认 10000) + LRU 淘汰策略 |
| P1-04 | `src/domain/agent/fast-llm-judge.ts` | **类型不匹配**：返回对象设置 `fromCache: false` 但接口未声明该字段，补充 `fromCache?: boolean` |

---

## Phase 3: 死代码清理（9 个文件，3,665 行）

> 所有文件均通过 `grep -r` 确认在 `src/` 目录内零外部导入

| # | 文件 | 行数 | 说明 |
|---|------|------|------|
| 1 | `src/domain/memory/embedding.ts` | 227 | 被 `embeddings.ts`（复数）取代 |
| 2 | `src/domain/memory/conversation-parser.ts` | 394 | 独立模块，从未被引用 |
| 3 | `src/domain/memory/dedup-config.ts` | 611 | 未引用，且 import 语句误置于注释块内（自身也有 bug） |
| 4 | `src/domain/memory/summary-engine.ts` | 514 | 独立模块，从未被引用 |
| 5 | `src/domain/session/recommender.ts` | 224 | 独立模块，从未被引用 |
| 6 | `src/domain/skills/triggers.ts` | 506 | 独立模块，从未被引用 |
| 7 | `src/domain/agent/compression/integration-examples.ts` | 318 | 纯示例代码 |
| 8 | `src/domain/agent/resilience-integration.ts` | 341 | 独立模块，从未被引用 |
| 9 | `src/domain/subagent/subagent-types-patch.ts` | 530 | 原型代码，从未被引用 |

---

## Phase 4: P2/P3 清理（21 个文件，~9,900 行）

### P2 级别

| # | 类型 | 文件/目录 | 说明 |
|---|------|----------|------|
| P2-01 | 死代码删除 | `src/domain/search/research/` 5 个文件 | Deep Research V1 全部模块（2,622行），已被 `deep-research-v2.ts` 完全取代 |
| P2-02 | 死代码删除 | `src/domain/agent/graduated-compressor.ts` | 被 `tiered-compressor.ts` 取代（482行） |
| P2-03 | 配置修复 | `package.json` | 版本号从 `0.2.1` 更新为 `2.1.3`，与 CHANGELOG.md 一致 |
| P2-04 | 标记待接入 | `src/domain/agent/tool-result-guard.ts` | 高价值模块（防止超大 tool 结果撑爆上下文），添加 TODO 标记待接入 |
| P2-05 | 标记待接入 | `src/domain/agent/prompt-template.ts` | 高价值模块（统一 prompt 管理），添加 TODO 标记待接入 |

### P3 级别

| # | 类型 | 文件/目录 | 说明 |
|---|------|----------|------|
| P3-01 | 文档清理 | `docs/projects/agora-town/` (3 文件) | 死项目概念文档，零代码实现 |
| P3-02 | 文档清理 | `prs/` (6 文件) | 已合并到 main 的 phase1-5 patch 文件和 README |

---

## 未在本 PR 中修复的问题（建议后续处理）

以下是审查中发现但修复范围过大、需要独立 PR 的架构性问题：

### God Object 拆分（建议独立 PR）

| 文件 | 行数 | 建议拆分方案 |
|------|------|------------|
| `src/domain/tools/builtin.ts` | 2,613 | 按 tool category 拆分为 `tools/categories/{name}/schema.ts` + `executor.ts` |
| `src/domain/agent/index.ts` | 2,245 | 抽取 `ChatEngine`（统一 chat/chatStream）、`ToolCallHandler`、`ContextBuilder` |
| `src/domain/skills/store.ts` | 1,722 | 拆分为 `SkillCRUD` + `SkillMatcher` + `SkillEvolution` |
| `src/domain/session/index.ts` | 1,719 | 拆分为 `SessionStore` + `SessionRecovery` + `SessionCompression` |

### 双系统统一（建议独立 PR）

| 冗余对 | 说明 |
|--------|------|
| 双 Hook Runner | `adapter/plugins/hook-runner/` vs `adapter/plugins/hooks/runner.ts`，API 不兼容 |
| 四套错误分类 | `error-handler.ts` / `errors.ts` / `provider-errors.ts` / `unified-retry.ts` |
| 双日志系统 | `logger.ts` (基础) vs `metrics.ts` (StructuredLogger) |
| 双任务调度 | `TaskDispatcher` vs `Bunqueue` |

### 架构改善（建议独立 PR）

- 引入 DI Container 替换全局可变状态（`app/index.ts` 十余个模块级 `let` 变量）
- `initApp()` 阶段化拆分（当前 ~450 行平铺）
- 补全 `beeclaw.schema.json` 缺失模块定义（memory/mcp/hooks/search）
- 补充 `dockerode` 运行时依赖（当前仅有 `@types/dockerode`）

---

## 验证步骤

```bash
# 1. 应用 patch
git apply beeclaw-full-review-fixes.patch

# 2. TypeScript 类型检查
bun run tsc --noEmit

# 3. 运行测试
bun test

# 4. Lint 检查
bun run lint
```

---

## 风险评估

| 阶段 | 风险等级 | 说明 |
|------|---------|------|
| Phase 1 (P0) | **低** | 纯 bug 修复，不改变架构；GoalStore sanitize 是新增防护 |
| Phase 2 (P1) | **低** | 删除重复导入 + 补充类型 + 添加缓存上限 |
| Phase 3 (死代码) | **极低** | 纯删除无引用文件 |
| Phase 4 (P2/P3) | **低** | 死代码删除 + 版本号对齐 + TODO 标记 + 文档清理 |

所有修改均为保守修复，不引入新功能、不改变现有 API、不修改公共接口。
