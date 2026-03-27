# Beeclaw 代码审查报告

> **审查日期**: 2026-03-24  
> **项目版本**: v2.1.3  
> **审查范围**: 全仓库 753 文件，约 110,000 行 TypeScript 代码  
> **审查维度**: 死代码、冗余功能、架构问题、功能 Bug、安全漏洞、代码质量

---

## 一、项目概述

Beeclaw 是一个基于 **Bun + TypeScript** 构建的可进化 AI 助手平台，支持 CLI、飞书 Bot 和 Web UI 三端接入。核心能力包括多 Provider 适配（OpenAI/Anthropic/DeepSeek 等）、记忆系统、技能系统、子代理编排、插件系统、沙箱执行、MCP 协议集成。

项目采用 Clean Architecture 分层：`entries/` → `app/` → `domain/` → `infra/`，并有 `adapter/` 适配器层。

---

## 二、问题总览

| 严重级别 | 数量 | 说明 |
|---------|------|------|
| **P0 - 安全/阻断** | 7 | Shell 注入、路径遍历、敏感信息泄露、编译错误等 |
| **P1 - 功能/架构** | 15 | 分层违规、功能 Bug、上帝对象等 |
| **P2 - 中等缺陷** | 20+ | 并发 Bug、缓存泄漏、冗余实现等 |
| **P3 - 代码质量** | 30+ | 魔法数字、硬编码、命名问题、调试代码残留等 |
| **死代码** | 12+ | 未使用的模块、空数组导出、桩函数等 |
| **冗余实现** | 8+ | 重复的缓存/工具函数/校验系统等 |

---

## 三、P0 问题（必须立即修复）

### P0-1: Shell 注入漏洞 — `executeClaudeCode()`
- **文件**: `src/domain/tools/builtin.ts`
- **问题**: 将用户 prompt 用单引号包裹后传入 shell 命令 `claude -p '...'`。prompt 中包含单引号可突破引号执行任意命令。
- **修复**: 使用 `Bun.spawn(['claude', '-p', prompt])` 数组形式，避免 shell 解释。

### P0-2: 路径遍历漏洞 — `isPathAllowed()`
- **文件**: `src/domain/tools/builtin.ts`
- **问题**: 使用 `resolved.startsWith(dir)` 检查路径。`/home/user` 允许目录会误匹配 `/home/username-evil/`。
- **修复**: 改为 `resolved === dir || resolved.startsWith(dir + path.sep)`。

### P0-3: 敏感信息泄露到日志
- **文件**: `src/adapter/feishu/card-callback-handler.ts`
- **问题**: 调试日志输出 `fullData: JSON.stringify(rawData, null, 2)`，包含完整回调数据（含用户信息）。
- **修复**: 移除 fullData 日志，或仅记录 action_type 和 action_tag。

### P0-4: `buildPostContent` 标题解析偏移
- **文件**: `src/adapter/feishu/send.ts`
- **问题**: `### ` 是 4 字符（含空格），但 `line.substring(3)` 只截取 3 字符，导致标题前多出空格。
- **修复**: 修正 substring 偏移量。

### P0-5: 引用未定义的 `LLMTiersConfigSchema`
- **文件**: `src/infra/config/schema.ts`
- **问题**: 文件末尾引用了未定义的 `LLMTiersConfigSchema`，导致编译错误。
- **修复**: 添加缺失的 schema 定义或移除引用。

### P0-6: `QueryClient` 双重创建导致配置失效
- **文件**: `src/adapter/web/client/main.tsx` + `App.tsx`
- **问题**: 两处各自创建 `QueryClient`，嵌套的 Provider 导致外层配置被覆盖。
- **修复**: 仅在 `main.tsx` 创建，通过 props 传入 `App`。

### P0-7: CI `continue-on-error: true` 使守门失效
- **文件**: `.github/workflows/ci.yml`
- **问题**: lint 和 build job 设置 `continue-on-error: true`，即使失败 CI 仍显示绿色。
- **修复**: 移除 `continue-on-error`。

---

## 四、P1 问题（短期内必须修复）

### P1-1: Domain 层反向依赖 Adapter 层 [最严重架构问题]
- `domain/agent/index.ts` → `adapter/mcp`, `adapter/plugins`
- `domain/session/index.ts` → `adapter/feishu`
- `domain/subagent/registry.ts` → `adapter/plugins`
- **影响**: 模块无法独立复用，违反依赖倒置原则。

### P1-2: Infra 层反向依赖 Domain 层
- `infra/db/store.ts` 导入 7 个 domain 层模块（MemoryStore、GoalStore 等）
- `infra/config/schema.ts` 导入 `domain/sandbox/types`
- **修复**: `infra/db/store.ts` 本质是初始化编排器，应移至 app 层。

### P1-3: Extraction Category 名称不匹配
- `extraction/types.ts` 枚举值用单数（`preference`），`extractor.ts` LLM prompt 用复数（`preferences`）
- **影响**: LLM 返回的类别可能不被识别，提取结果丢失。

### P1-4: Proactive `taskType` Zod Schema 缺失 `self_evolution`
- `proactive/tools.ts` 工具描述包含 `self_evolution`，但 Zod 验证不包含
- **影响**: AI 生成的 `self_evolution` 任务调用会被 Zod 拒绝。

### P1-5: `pushToFeishu()` 中 `feishuChatId` 传递链断裂
- `pusher.ts` 将 `feishuChatId` 作为顶层字段，但下游从 `metadata.feishuChatId` 读取
- **影响**: 飞书推送找不到 chatId，消息丢失。

### P1-6: Agent God Object — 2334 行
- `agent/index.ts` 承担对话管理、工具调度、上下文、流式输出、恢复、HITL 等所有职责。
- **建议**: 拆分为 ConversationManager、ToolOrchestrator、ContextWindowManager。

### P1-7: `builtin.ts` 巨型单文件 — 2613 行
- 所有 25+ 工具的定义和执行器在一个文件中。Phase 4 拆分尝试失败（categories 导出空数组）。

### P1-8: `app/index.ts` 上帝模块 — 864 行
- `initApp()` 单体初始化函数，全局单例模式（`getAgent()`, `getProvider()` 等）。

### P1-9: Schema 与 Example 严重不一致
- `beeclaw.schema.json` 缺失 15+ 个在 `beeclaw.example.json` 中使用的字段。
- `search` 字段结构完全不同（扁平 vs 嵌套）。
- `web.port` 类型冲突（integer vs string）。

### P1-10: `createCardBody` 无效 Zod 类型访问
- `card-v2/types/card.ts` 使用 `ElementSchema['_type'][]` 不是有效的 Zod 访问方式。

---

## 五、死代码清单

| 文件 | 类型 | 对 Beeclaw 的价值 | 建议 |
|------|------|-------------------|------|
| `agent/tool-dispatcher.ts` | Phase 4 骨架 | **有价值** — 工具调度拆分方向正确 | 完成实现并接入 |
| `agent/token-estimator.ts` | 增强 token 估算 | **有价值** — 比 context.ts 的估算更精确 | 替换 context.ts 的估算 |
| `agent/prompt-budget.ts` | 动态 Prompt 预算 | **有价值** — Layer-Priority 系统设计好 | 替换硬编码 prompt 拼接 |
| `agent/skill-runner.ts` | Phase 4 骨架 | **有价值** — 技能执行拆分方向正确 | 完成实现并接入 |
| `tools/categories/research-tools.ts` | 空数组导出 | **有价值** — 拆分方向正确 | 完成迁移或删除 |
| `tools/categories/file-tools.ts` | 空数组导出 | 同上 | 同上 |
| `tools/categories/code-tools.ts` | 空数组导出 | 同上 | 同上 |
| `session/proactive-steps.ts` | 4/5 步骤空实现 | 低价值 | 删除或标记 TODO |
| `proactive/triggers.ts` `_updatePatternTrigger()` | 空函数 | 低价值 | 删除 |
| `tools/builtin.ts` `_ResearchFinding` | 未用接口 | 无价值 | 删除 |
| `web/client/DirectoryTree.tsx` | 死组件 | 无价值 | 删除 |
| `clipboardy` npm 依赖 | 零引用 | 无价值 | 从 package.json 移除 |

---

## 六、冗余功能清单

| 冗余项 | 位置 | 建议 |
|--------|------|------|
| 双重 Token 估算 | `context.ts` vs `token-estimator.ts` | 统一使用 `token-estimator.ts` |
| 双重 Session 管理 | `session/service.ts` vs `session/index.ts` | 删除 `service.ts` |
| 双重 TTL 缓存 | `search/orchestrator.ts` vs `finance/orchestrator.ts` | 提取公共 `TTLCache` |
| 双重 `readStream()` | `local.ts` vs `docker.ts` | 提取共享工具函数 |
| 双重校验引擎 | `ajv`（plugins）vs `zod`（全局） | 统一到 Zod |
| 双重 `sanitizeForCard` | `card.ts`/`hitl-renderer.ts`/`message-renderer.ts` | 提取共享函数 |
| 双重 HookRunner | `hooks/runner.ts` vs `hook-runner/index.ts` | 迁移到新版，删除旧版 |
| 双重 PM2 配置 | `ecosystem.config.cjs` vs `ecosystem.flexible.cjs` | 合并为一份 |

---

## 七、架构问题汇总

### 7.1 分层违规
```
domain/ ──×──> adapter/     ← 最严重，6+ 处直接导入
infra/  ──×──> domain/      ← 3+ 处反向依赖
infra/  ──×──> app/         ← entry/types.ts 引用 app 层
```

### 7.2 全局单例泛滥
- `cache`, `adapterRegistry`, `pluginRegistry`, `tieredLLMRouter`, `taskManager`, `feishuWSClient`, `_db/_sqlite` 等
- 导致测试隔离困难、热重载不可靠、并发安全性差

### 7.3 配置系统三源不一致
- `beeclaw.schema.json`（JSON Schema）
- `src/infra/config/schema.ts`（Zod Schema）
- `beeclaw.example.json`（示例配置）
- 三者字段集合不同，应从 Zod schema 自动生成 JSON Schema（使用 `zod-to-json-schema`）。

---

## 八、安全问题汇总

| # | 问题 | 严重性 | 位置 |
|---|------|--------|------|
| 1 | Shell 注入 | P0 | `tools/builtin.ts` `executeClaudeCode()` |
| 2 | 路径遍历 | P0 | `tools/builtin.ts` `isPathAllowed()` |
| 3 | 敏感信息日志泄露 | P0 | `feishu/card-callback-handler.ts` |
| 4 | Docker 文件 I/O 绕过隔离 | P2 | `sandbox/providers/docker.ts` |
| 5 | 沙箱命令阻止列表可绕过 | P2 | `sandbox/providers/local.ts` |
| 6 | FileLock TOCTOU 竞态 | P2 | `memory/store.ts` |
| 7 | OAuth token 仅内存缓存 | P3 | `feishu/oauth.ts` |

---

## 九、功能 Bug 汇总

| # | Bug | 严重性 | 位置 |
|---|-----|--------|------|
| 1 | Extraction category 单复数不匹配 | P1 | `extraction/extractor.ts` vs `types.ts` |
| 2 | `feishuChatId` 传递链断裂 | P1 | `proactive/pusher.ts` |
| 3 | `taskType` Zod 缺失 `self_evolution` | P1 | `proactive/tools.ts` |
| 4 | `buildPostContent` 偏移量错误 | P0 | `feishu/send.ts` |
| 5 | DAG 调度器缺少环检测 | P2 | `subagent/scheduler.ts` |
| 6 | Recovery 模块死循环保护缺失 | P2 | `session/recovery.ts` |
| 7 | Finance `request._limit` 字段名错误 | P2 | `finance/providers/eastmoney.ts` |
| 8 | L3 压缩失败无最终 fallback | P2 | `memory/compression.ts` |
| 9 | Deep Research Semaphore 无超时 | P2 | `search/research/deep-research-v2.ts` |
| 10 | `compare()` 使用宽松相等 | P3 | `proactive/triggers.ts` |
| 11 | Session queue 内存泄漏 | P3 | `session/index.ts` |
| 12 | Finance 缓存无大小限制 | P3 | `finance/orchestrator.ts` |

---

## 十、CI/CD 与工程实践问题

| 问题 | 建议 |
|------|------|
| CI lint/build `continue-on-error: true` | 移除，恢复守门作用 |
| CI 无依赖缓存 | 添加 `actions/cache` 缓存 Bun 依赖 |
| 无覆盖率报告 | 添加覆盖率检查和报告 |
| 无循环依赖检测 | 在 CI 中运行 `madge --circular` |
| ESLint 8 已 EOL | 升级到 ESLint 9 + flat config |
| `ts-prune` 已废弃 | 替换为 `knip` |
| 版本号硬编码在多处 | 统一从 package.json 读取 |
| `@types/dockerode` 有但 `dockerode` 缺失 | 添加到 dependencies 或标记为可选 |
| `skills-lock.json` 仅锁定 1/25+ skill | 完善锁定机制或移除 |

---

## 十一、修复优先级矩阵

### 立即修复（P0，本次 Patch 包含）
1. Shell 注入修复
2. 路径遍历修复
3. 敏感信息日志修复
4. 标题解析偏移修复
5. CI continue-on-error 修复
6. QueryClient 双重创建修复
7. LLMTiersConfigSchema 引用修复

### 短期修复（P1，本次 Patch 包含）
8. Extraction category 名称统一
9. Proactive taskType enum 修复
10. feishuChatId 传递链修复
11. Finance `_limit` 字段修复
12. DAG 环检测添加
13. FileLock 原子操作修复
14. 死依赖 `clipboardy` 移除
15. 死代码清理（空数组导出、`_ResearchFinding` 等）

### 中期建议（不在本次 Patch 中）
- 架构分层重构（domain/adapter 解耦）
- God Object 拆分
- 全局单例替换为依赖注入
- Schema 系统统一
