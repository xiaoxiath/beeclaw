# 文档归档

本目录包含 Beeclaw 开发过程中的历史文档和被新文档替代的旧版文档。

---

## 目录结构

### development/ — 开发记录

| 子目录 | 说明 |
|--------|------|
| `phase1/` | Phase 1 — OpenClaw 插件兼容层基础实现 |
| `phase2/` | Phase 2 — 插件加载器集成 |
| `phase3/` | Phase 3 — Hook 系统实现 (22/25 hooks) |
| `plugin-system/` | 插件系统开发总结 |
| `refactoring/` | 系统重构和工具简化 |
| `subagent-phases/` | 子代理 Phase 2-5 实现记录 |
| `webui-phase3-complete.md` | Web UI Phase 3 完成报告 |
| `webui-phase4-complete.md` | Web UI Phase 4 完成报告 |
| `webui-auth.md` | Web UI 认证指南（已合并） |
| `webui-current-status.md` | Web UI 历史状态报告 |
| `architecture-upgrade-verification.md` | 架构升级验证报告 |
| `sqlite-test-results.md` | SQLite 集成测试结果 |

### analysis/ — 技术分析

| 文档 | 说明 |
|------|------|
| `openclaw-extends.md` | OpenClaw 扩展分析 |
| `openclaw-plugin-integration-design.md` | 插件集成设计方案 |
| `feishu-official-plugin-integration.md` | 飞书官方插件集成 |
| `feishu-plugin-integration-guide.md` | 飞书插件集成指南 |
| `jiti-analysis.md` | Jiti 运行时分析 |
| `logging-enhancement-update.md` | 日志增强更新 |
| `scheduled-skill-execution.md` | 定时技能执行（已整合到主动系统） |
| `remaining-todos.md` | 历史 TODO 列表 |
| `ONBOARDING.md` | 入职文档（已过时） |

### superseded/ — 被替代的文档

这些文档已被新文档合并或替代：

| 旧文档 | 替代为 |
|--------|--------|
| `error-handling-design.md` | [错误处理](../guide/error-handling.md) |
| `error-handling-guide.md` | [错误处理](../guide/error-handling.md) |
| `timeout-configuration.md` | [超时配置](../operations/timeout-config.md) |
| `smart-timeout-config.md` | [超时配置](../operations/timeout-config.md) |
| `smart-timeout-design.md` | [超时配置](../operations/timeout-config.md) |
| `dynamic-context-implementation.md` | [上下文管理](../design/context-management.md) |
| `dynamic-context-recommendations.md` | [上下文管理](../design/context-management.md) |
| `smart-context-management.md` | [上下文管理](../design/context-management.md) |
| `smart-features.md` | [上下文管理](../design/context-management.md) |
| `quick-start-configuration.md` | [配置指南](../configuration.md) |
| `user-configuration.md` | [配置指南](../configuration.md) |
| `unified-session-design.md` | [统一会话架构](../design/unified-session.md) |
| `unify-cli-bot-architecture.md` | [统一会话架构](../design/unified-session.md) |
| `self-evolution-system.md` | [自进化系统](../future/self-evolution.md)（去重） |
| `skill-evolution-analysis.md` | [技能进化分析](../future/skill-evolution.md)（去重） |
| `TODO.md` | 过时的 TODO 列表 |
| `recovery-fix-test-plan.md` | 测试方案，功能已稳定 |

### archive/ 根目录 — 临时文档

| 文档 | 说明 |
|------|------|
| `beeclaw-update.md` | 项目深度分析报告（一次性） |

---

## 使用建议

- **新贡献者**：查看 `development/` 了解系统演进历史
- **维护者**：查看 `analysis/` 了解历史技术决策
- **调试**：查看 `refactoring/` 和 `subagent-phases/` 了解模块变化

---

## 返回

→ [当前文档体系](../README.md)
