# Beeclaw 代码审查修复 Patch 集

> **目标仓库**: https://github.com/xiaoxiath/beeclaw  
> **基准版本**: `main` 分支 (v0.2.1)  
> **生成日期**: 2026-03-23  
> **Patch 总数**: 5 个阶段  
> **总修改量**: ~240KB patch, 涉及 50+ 文件

---

## 快速使用

```bash
# 1. 克隆仓库
git clone https://github.com/xiaoxiath/beeclaw.git
cd beeclaw

# 2. 按顺序应用 patch（每个 patch 独立于 main，可单独应用）
git apply patches/phase1-p0-security.patch
git apply patches/phase2-p1-stability.patch
git apply patches/phase3-architecture-cleanup.patch
git apply patches/phase4-god-object-split.patch
git apply patches/phase5-subsystem-improvements.patch

# 或者，创建独立分支逐阶段 review
git checkout -b review/phase1 && git apply ../phase1-p0-security.patch && git add -A && git commit -m "Phase 1"
```

> **注意**: 5 个 patch 均基于 `main` 独立生成，可单独应用。如果需要全部应用，建议按顺序逐个合并以解决可能的交叉修改冲突。

---

## Patch 清单

### Phase 1: P0 安全与功能修复 (`phase1-p0-security.patch`)

| 修改文件 | 修复内容 |
|----------|---------|
| `src/domain/tools/builtin.ts` | **[安全]** 将 `new Function()` (等同 eval) 替换为 `Bun.spawn` 子进程沙箱执行，添加 `safeCodeExecute()` 函数，限制执行环境变量，强制超时控制 |
| `src/domain/agent/index.ts` | **[功能]** `chatStream()` 补齐与 `chat()` 一致的并行工具执行 (`Promise.all` 批处理)、循环检测 (`loopDetector`)、Hook 集成 (`hookRunner.runBeforeToolCall`) |
| `src/entries/cli.ts` | **[Bug]** 将不存在的 `shutdown.on()` 替换为 `shutdown.register()`；将 `setupSignalHandlers()` 替换为 `installSignalHandlers()` |
| `src/adapter/feishu/card.ts` | **[安全]** 实现 `sanitizeForCard()` 输入清理函数，应用于 4 处 `[CR-Sec]` 标记位置 (title, markdown, content, items) |
| `src/adapter/feishu/card-v2/message-renderer.ts` | **[安全]** 实现 `sanitizeCardInput()` 并应用于 `renderErrorCard()` |
| `src/adapter/feishu/card-v2/hitl-renderer.ts` | **[安全]** 实现 `sanitizeForCard()` 并应用于确认卡片和用户输入卡片的所有用户可控字段 |
| `src/domain/tools/builtin.ts` | **[类型安全]** 添加 11 个 Zod schema 和 `validateStateParams<T>()` 辅助函数，替换所有 state tool 的 `as` 强转为运行时校验 |

**风险等级**: P0 — 立即修复  
**影响范围**: 安全漏洞堵塞、流式模式功能对齐、运行时错误修复

---

### Phase 2: P1 数据安全与稳定性 (`phase2-p1-stability.patch`)

| 修改文件 | 修复内容 |
|----------|---------|
| `src/domain/proactive/scheduler.ts` | **[数据安全]** `saveStorage()` 的 `writeFileSync` → `writeFileAtomic`，防止崩溃时文件损坏 |
| `src/domain/memory/store.ts` | **[数据安全]** `ensureFactFiles()` 的 `writeFileSync` → `atomicWriteFileSync`；**[Bug]** `parseConversationFile` 使用 `statSync(filePath).mtime` 替代 `new Date()` |
| `src/domain/session/index.ts` | **[竞态]** 在 `_sendProactiveMessageInternal` 处理新消息前 `await` pending 的压缩 Promise，防止上下文不一致 |
| `src/app/gateway-service.ts` | **[内存泄漏]** 为 `rateLimitStore` 添加每 5 分钟清理过期条目的 `setInterval` |
| `src/infra/config/hot-reload.ts` | **[Bug]** 添加 `deepEqual()` 递归比较函数，替换 `!==` 引用比较 |
| `src/domain/tools/builtin.ts` | **[类型]** 清理 `as any` → `as string` (chart params) |
| `src/domain/session/index.ts` | **[类型]** 移除不必要的 `as any`，添加 `blockedTools` 类型定义 |
| `src/domain/agent/index.ts` | **[类型]** 移除 `createAgent` 调用中的 `as any` |

**风险等级**: P1 — 1-2 周内修复  
**影响范围**: 防止数据损坏、消除内存泄漏、修复逻辑错误

---

### Phase 3: 架构清理 (`phase3-architecture-cleanup.patch`)

| 修改文件 | 修复内容 |
|----------|---------|
| `src/infra/observability/provider-errors.ts` | **[去重]** 移除独立熔断器实现，委托给 `CircuitBreakerRegistry` |
| `src/infra/utils/parallel-tool-executor.ts` | **[去重]** 修复导入路径，使用统一熔断器和字符串状态 |
| `src/infra/utils/index.ts` | **[去重]** 添加共享 `deepMerge()` 和 `cosineSimilarity()` 函数 |
| 6 个配置文件 | **[去重]** 移除 6 处独立的 `deepMerge` 实现，统一导入 |
| 6 个 domain 文件 | **[去重]** 移除 6 处独立的 `cosineSimilarity` 实现，统一导入 |
| `src/cli.ts` (1831 行) | **[删除]** 移除遗留 CLI 入口（已被 `entries/cli.ts` + `adapter/cli/` 替代）|
| `src/domain/subagent/state-tools.ts` | **[去重]** 转换为兼容性 shim，re-export `state-tools-consolidated.ts` |
| `src/infra/observability/errors.ts` | **[清理]** 移除 4 个 `@deprecated` 函数 (177 行)，保留 `BeeclawError` 类 |

**减少代码量**: ~2852 行删除  
**风险等级**: P2 — 2-4 周  
**影响范围**: 消除重复实现、降低维护成本、统一技术栈

---

### Phase 4: God Object 拆分 (`phase4-god-object-split.patch`)

| 新增/修改文件 | 内容 |
|--------------|------|
| `src/domain/agent/tool-dispatcher.ts` | **[新增]** `ToolDispatcher` 类 — 工具派发、并行批处理、循环检测、Hook 集成 |
| `src/domain/agent/token-budget.ts` | **[新增]** `TokenBudgetManager` 类 — Token 预算计算、上下文裁剪、压缩管理 |
| `src/domain/agent/skill-runner.ts` | **[新增]** `SkillRunner` 类 — Skill 匹配、输出验证、重试、使用追踪 |
| `src/domain/agent/index.ts` | **[修改]** Agent 类引用 3 个新模块，re-export 保持向后兼容 |
| `src/domain/tools/categories/research-tools.ts` | **[新增]** 研究类工具定义 |
| `src/domain/tools/categories/file-tools.ts` | **[新增]** 文件操作工具定义 |
| `src/domain/tools/categories/code-tools.ts` | **[新增]** 代码执行工具定义 |
| `src/domain/tools/categories/state-tools.ts` | **[新增]** 状态管理工具定义 |
| `src/domain/tools/categories/memory-tools.ts` | **[新增]** 记忆相关工具定义 |
| `src/domain/tools/builtin.ts` | **[修改]** 添加 `getAllCategoryTools()` 聚合函数 |
| `src/domain/skills/parser.ts` | **[新增]** `SkillParser` — SKILL.md 文件解析 |
| `src/domain/skills/cache.ts` | **[新增]** `SkillCache` — LRU 缓存管理 |
| `src/domain/skills/watcher.ts` | **[新增]** `SkillWatcher` — 文件监听与自动重载 |
| `src/domain/session/proactive-steps.ts` | **[新增]** 拆分 600 行方法为 5 个聚焦函数 |

**设计原则**:
- 单一职责 (SRP) — 每个类/模块只有一个变更理由
- 向后兼容 — 所有原有导出通过 index.ts re-export 保持不变
- 依赖注入 — 新模块通过构造函数接收依赖

**风险等级**: P3 — 4-8 周  
**影响范围**: 提升可维护性、可测试性、代码可读性

---

### Phase 5: 子系统完善 (`phase5-subsystem-improvements.patch`)

| 修改文件 | 修复内容 |
|----------|---------|
| `src/domain/proactive/scheduler.ts` | **[性能]** 用 `matchField()`/`matchesCron()` 替换逐分钟迭代的 `parseField()`；**[日志]** `console.log` → 结构化 `logger` |
| `src/domain/sandbox/tools.ts` | **[Bug]** 修复 `_pathMapper` 解构错误 (2处) |
| `src/domain/proactive/pusher.ts` | **[类型]** 添加 `PusherChannel`/`StorageChannel` 类型和映射函数，消除 `as` 强转 |
| `src/adapter/mcp/client.ts` | **[Bug]** 工具名分隔符从单下划线改为双下划线，用 `indexOf('__')` 替代 `split('_')` 防止 serverId 含 `_` 时误拆 |
| `src/domain/search/orchestrator.ts` | **[Bug]** 用 `AggregateError` 替代仅抛第一个错误，区分"无结果"和"全部崩溃" |
| `src/domain/memory/embedding.ts` | **[Bug]** 增强 OpenAI→Ollama 回退警告，标注维度不匹配 (1536-d vs 768-d) |
| `src/domain/subagent/state.ts` | **[资源泄漏]** 添加 `dispose()` 方法清理 `setInterval` |
| `ecosystem.flexible.cjs` | **[配置]** `src/bot.ts` → `src/entries/bot.ts` |
| `tailwind.config.js` | **[配置]** `src/web/client/` → `src/adapter/web/client/` |
| `src/domain/agent/index.ts` | **[日志]** 84 处 `console.log` → `logger.debug`/`logger.info` |

**风险等级**: P2-P3  
**影响范围**: 性能优化、配置修正、资源泄漏修复、日志标准化

---

## 修改统计

| Phase | 文件数 | 新增行 | 删除行 | Patch 大小 |
|-------|--------|--------|--------|-----------|
| Phase 1 | 6 | 420 | 198 | 36 KB |
| Phase 2 | 7 | 60 | 10 | 12 KB |
| Phase 3 | 19 | 154 | 2852 | 112 KB |
| Phase 4 | 18 | 853 | 0 | 40 KB |
| Phase 5 | 10 | ~300 | ~200 | 40 KB |
| **合计** | **~50** | **~1787** | **~3260** | **~240 KB** |

---

## 关键决策说明

### 1. code_execute 沙箱策略
选择 `Bun.spawn` 子进程隔离而非 `vm2`，原因:
- Bun 原生支持，零额外依赖
- 进程级隔离比 VM 上下文隔离更安全
- 可配置 timeout、环境变量白名单
- 与项目现有 sandbox 模块设计一致

### 2. Patch 独立性设计
5 个 patch 均基于 `main` 独立生成（非增量），这样:
- 团队可以选择性应用任意 phase
- Code review 粒度更细
- 回滚某个 phase 不影响其他

### 3. God Object 拆分的向后兼容
所有拆分均保留原有导出接口:
- 新模块通过 `index.ts` re-export
- 调用方无需修改 import 路径
- 可在后续迭代中逐步迁移到直接导入新模块

### 4. 架构清理的保守策略
对于存疑的删除（如 Card V1、extraction 系统），采取:
- 添加 `@deprecated` 注释而非直接删除
- 转换为 shim/re-export 保持兼容
- 在 PR description 中标注需要团队确认的决策点

---

## 后续建议

1. **测试覆盖**: 应用 patch 后运行 `bun test` 验证，重点关注 Phase 1 (安全) 和 Phase 2 (数据安全) 的修改
2. **渐进合并**: 建议按 Phase 顺序逐个 PR 合并，每个 PR 单独 review
3. **E2E 测试**: `tests/e2e/` 目前为空，建议补充覆盖 code_execute 沙箱、流式聊天、主动消息等关键路径
4. **ESLint 升级**: 应用 patch 后将 `@typescript-eslint/no-explicit-any` 从 `warn` 提升至 `error`
5. **依赖清理**: 检查 `@anthropic-ai/sdk` 在 dependencies 和 devDependencies 中的重复
