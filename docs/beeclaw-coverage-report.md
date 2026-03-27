# Beeclaw 单测覆盖率报告

> 生成时间：2026-03-27 | 工具：vitest 4.1.2 + @vitest/coverage-v8

## 总览

| 指标 | 覆盖率 | 评级 |
|------|--------|------|
| **Statements** | 61.34% | 🟡 |
| **Branches** | 50.94% | 🟠 |
| **Functions** | 67.48% | 🟡 |
| **Lines** | 62.04% | 🟡 |

**测试执行统计**：

| 指标 | 数量 |
|------|------|
| 测试文件总数 | 310 |
| 通过 | 308 |
| 跳过 | 2 |
| 测试用例总数 | 4376 |
| 通过 | 4293 |
| 跳过 | 82 |
| Todo | 1 |

---

## 模块覆盖率明细

### 覆盖率等级说明

| 图标 | 等级 | Lines 覆盖率 |
|------|------|-------------|
| 🟢 | 优秀 | ≥ 80% |
| 🟡 | 良好 | 60% ~ 79% |
| 🟠 | 需改进 | 40% ~ 59% |
| 🔴 | 不足 | < 40% |

### Adapter 层

| 模块 | Stmts% | Branch% | Funcs% | Lines% | 等级 |
|------|--------|---------|--------|--------|------|
| adapter/feishu | 79.81 | 76.47 | 80.92 | 80.28 | 🟢 |
| adapter/cli | 45.93 | 40.62 | 47.82 | 46.42 | 🟠 |
| adapter/mcp | 24.89 | 17.85 | 26.82 | 25.53 | 🔴 |
| adapter/plugins | 0 | 0 | 0 | 0 | 🔴 |

### App 层

| 模块 | Stmts% | Branch% | Funcs% | Lines% | 等级 |
|------|--------|---------|--------|--------|------|
| app/dispatcher | 49.07 | 34.37 | 60 | 50.98 | 🟠 |
| app/routes | 10.91 | 5.82 | 40 | 10.98 | 🔴 |
| app (root) | 19.69 | 11.55 | 22.5 | 19.92 | 🔴 |

### Domain 层

| 模块 | Stmts% | Branch% | Funcs% | Lines% | 等级 |
|------|--------|---------|--------|--------|------|
| domain/agent/goal | 92.47 | 79.61 | 100 | 94.20 | 🟢 |
| domain/extraction | 71.68 | 64.75 | 64.7 | 72.38 | 🟡 |
| domain/proactive | 69.12 | 60.06 | 80.82 | 70.40 | 🟡 |
| domain/memory | 62.70 | 53.73 | 68.35 | 62.90 | 🟡 |
| domain/ports | 65.38 | 64.28 | 50 | 64.00 | 🟡 |
| domain/search | 62.02 | 52.69 | 76.59 | 62.05 | 🟡 |
| domain/subagent | 62.25 | 49.92 | 68.71 | 62.62 | 🟡 |
| domain/sandbox | 56.25 | 43 | 61.66 | 58.80 | 🟠 |
| domain/skills | 56.40 | 45.69 | 61.71 | 57.04 | 🟠 |
| domain/agent (core) | 54.55 | 43.64 | 71.38 | 54.92 | 🟠 |
| domain/tools | 52.78 | 41.53 | 56.48 | 53.56 | 🟠 |
| domain/session | 52.47 | 40 | 52.63 | 52.35 | 🟠 |

### Infra 层

| 模块 | Stmts% | Branch% | Funcs% | Lines% | 等级 |
|------|--------|---------|--------|--------|------|
| infra/cache | 100 | 100 | 100 | 100 | 🟢 |
| infra/entry | 100 | 100 | 100 | 100 | 🟢 |
| infra/ai | 94.08 | 81.94 | 93.93 | 93.95 | 🟢 |
| infra/queue | 91.58 | 80.95 | 100 | 91.42 | 🟢 |
| infra/utils | 90.16 | 91.04 | 77.41 | 91.27 | 🟢 |
| infra/resilience | 81.27 | 71.39 | 85.84 | 82.89 | 🟢 |
| infra/db | 81.53 | 85.18 | 57.89 | 82.53 | 🟢 |
| infra/config | 59.83 | 50 | 70.66 | 60.21 | 🟡 |

### Types 层

| 模块 | Stmts% | Branch% | Funcs% | Lines% | 等级 |
|------|--------|---------|--------|--------|------|
| types | 47.36 | 0 | 71.42 | 48.14 | 🟠 |

---

## 覆盖率分布

```
🟢 优秀 (≥80%):  8 个模块  — infra/cache, infra/entry, infra/ai, infra/queue,
                              infra/utils, infra/resilience, infra/db,
                              domain/agent/goal

🟡 良好 (60-79%): 8 个模块  — adapter/feishu, domain/extraction, domain/proactive,
                              domain/memory, domain/ports, domain/search,
                              domain/subagent, infra/config

🟠 需改进 (40-59%): 8 个模块 — adapter/cli, app/dispatcher, domain/sandbox,
                              domain/skills, domain/agent(core), domain/tools,
                              domain/session, types

🔴 不足 (<40%):   4 个模块  — adapter/mcp, adapter/plugins, app(root), app/routes
```

---

## 覆盖率薄弱区分析与改进建议

### 🔴 高优先级（覆盖率 < 40%）

| 模块 | 当前Lines% | 问题分析 | 改进建议 |
|------|-----------|---------|---------|
| **adapter/plugins** | 0% | 源码通过 jiti 动态加载插件，vitest 环境下 `discover()` 路径解析失败，导致被 mock 断链后无法覆盖 | 1) 拆分纯逻辑函数（manifest 解析、权限校验）独立测试 2) 为 loader 编写集成测试绑定固定 fixture 路径 |
| **app/routes** | 10.98% | 路由 handler 依赖完整的 Hono 上下文和队列服务 | 1) 提取路由逻辑到独立 service 函数 2) 使用 `app.request()` 做端到端路由测试 |
| **app (root)** | 19.92% | `index.ts` 和 `onboarding.ts` 包含大量启动编排逻辑 | 补充 bootstrap 流程的集成测试，mock 外部依赖 |
| **adapter/mcp** | 25.53% | MCP SDK 在 Node ESM 下导入失败，大量代码被 mock 跳过 | 1) 为 `McpExecutor` 核心逻辑补充纯函数测试 2) 隔离 SDK 调用层 |

### 🟠 中优先级（覆盖率 40-59%）

| 模块 | 当前Lines% | 改进建议 |
|------|-----------|---------|
| **domain/session** | 52.35% | 补充 session 生命周期测试（创建→消息→压缩→恢复） |
| **domain/tools** | 53.56% | 为 `isCommandSafe`、`weather` 等工具函数补充边界测试 |
| **domain/agent (core)** | 54.92% | 补充 agent 主循环、token budget 管理的 mock 场景测试 |
| **domain/skills** | 57.04% | 补充 `SkillStore` CRUD 和 `LLMMatcher` 匹配逻辑测试 |
| **domain/sandbox** | 58.80% | 补充 Docker provider 测试和 pool 管理测试 |

### 🟡 持续关注（覆盖率 60-79%）

这些模块覆盖率达到合理水平，可优先关注 **branch 覆盖率偏低** 的场景：

- `domain/memory`（branch 53.73%）— 补充动态注入的边界判断分支
- `domain/subagent`（branch 49.92%）— 补充子 agent 编排的异常分支
- `infra/config`（branch 50%）— 补充 env 变量解析的异常路径

---

## 运行覆盖率报告

```bash
# 安装覆盖率依赖
pnpm add -D @vitest/coverage-v8

# 运行测试并生成覆盖率
npx vitest run --coverage

# 生成 HTML 格式报告
npx vitest run --coverage --coverage.reporter=html
# 报告目录: ./coverage/
```
