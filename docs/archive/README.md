# 文档归档

本目录包含 Beeclaw 开发过程中的历史文档，用于记录和参考。

---

## 目录结构

### development/ - 开发记录

#### phase1/
Phase 1 实现记录 - OpenClaw 插件兼容层基础实现
- `phase1-complete.md` - Phase 1 完成总结
- `phase1-implementation-complete.md` - 完整实现记录

#### phase2/
Phase 2 实现记录 - 插件加载器集成
- `phase2-integration-complete.md` - Phase 2 集成完成

#### phase3/
Phase 3 实现记录 - Hook 系统完整实现 (22/25 hooks)
- `PHASE3-COMPLETE.md` - Phase 3 总览
- `phase3-summary.md` - 阶段总结
- `phase3-final-summary.md` - 最终总结
- `phase3-llm-hooks-implementation.md` - LLM 钩子实现
- `phase3.1-llm-hooks-complete.md` - LLM 钩子完成
- `phase3.2-agent-lifecycle-hooks-complete.md` - Agent 生命周期钩子
- `phase3.3-agent-session-lifecycle-hooks-complete.md` - Session 生命周期钩子
- `phase3.3-implementation-summary.md` - 实现摘要
- `phase3.4-3.5-complete.md` - Sub-Agent 钩子完成
- `phase3-hooks-integration-complete.md` - 钩子集成完成

#### plugin-system/
插件系统开发记录
- `plugin-system-complete-summary.md` - 插件系统总结
- `plugin-system-final-summary.md` - 最终总结

#### refactoring/
重构和优化记录
- `refactoring-summary.md` - 重构总结
- `job-handler-refactoring.md` - Job Handler 重构
- `tools-simplification-complete.md` - 工具简化完成
- `tools-simplification-plan.md` - 工具简化计划

---

### analysis/ - 技术分析

#### 插件系统分析
- `openclaw-extends.md` - OpenClaw 扩展分析 (59K)
- `openclaw-plugin-integration-design.md` - 插件集成设计 (63K)

#### 技术调研
- `jiti-analysis.md` - Jiti 运行时分析
- `logging-enhancement-update.md` - 日志增强更新

#### 开发过程
- `ONBOARDING.md` - 入职文档 (已过时)
- `remaining-todos.md` - 剩余 TODO 列表
- `remaining-todos-final.md` - 最终 TODO 列表
- `scheduled-skill-execution.md` - 定时技能执行 (已整合到 proactive)

---

## 归档原则

1. **开发记录**: Phase 1-3 的所有实现记录
2. **技术分析**: 深度技术调研和分析文档
3. **重构记录**: 系统重构和优化的历史
4. **过时文档**: 被新文档替代的旧文档

---

## 使用建议

- **新贡献者**: 查看 phase 文档了解系统演进历史
- **维护者**: 参考 analysis/ 中的技术决策
- **调试**: 查看重构记录了解系统变化

---

## 相关文档

- 当前文档体系: `../README.md`
- 架构文档: `../architecture.md`
- 插件系统: `../plugin-system.md` (待创建)
