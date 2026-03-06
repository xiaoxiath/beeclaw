# Beeclaw 文档重组计划

## 当前问题

### 1. 文档冗余
- **Phase 相关文档** (12个，~120K): 都是开发过程记录，散落在多个文件中
- **PM2 相关文档** (4个，~21K): 重复内容较多
- **Feishu 插件文档** (3个，~34K): 内容有重叠
- **Proactive 相关文档** (3个，~28K): 应该合并为一个完整指南
- **Tools 相关文档** (3个，~31K): simplification 相关是历史记录

### 2. 文档分类不清晰
- 开发记录文档 (phase*, *-complete.md) 混在用户文档中
- 架构设计文档和用户指南混在一起
- 缺少清晰的目标受众划分

### 3. 过时内容
- `remaining-todos.md` 和 `remaining-todos-final.md` - 开发过程中的临时文件
- `refactoring-summary.md`, `job-handler-refactoring.md` - 重构记录
- `logging-enhancement-update.md` - 更新记录
- `jiti-analysis.md` - 技术分析

---

## 重组方案

### 新的文档结构

```
docs/
├── README.md                          # 文档首页 (index.md重命名)
│
├── 用户指南/
│   ├── getting-started.md             # 快速开始 (保留)
│   ├── cli-reference.md               # CLI 参考 (保留)
│   ├── configuration.md               # 配置指南 (保留)
│   ├── feishu-integration.md          # 飞书集成 (整合插件内容)
│   ├── tools-reference.md             # 工具参考 (保留)
│   ├── memory-system.md               # 记忆系统 (memory-design.md重命名)
│   ├── proactive-system.md            # 主动系统 (合并3个proactive文档)
│   └── notification-usage-guide.md    # 通知使用指南 (保留)
│
├── 架构文档/
│   ├── architecture.md                # 系统架构 (保留)
│   ├── plugin-system.md               # 插件系统 (合并OpenClaw插件文档)
│   ├── error-handling.md              # 错误处理 (保留)
│   ├── timeout-config.md              # 超时配置 (保留)
│   ├── logging-guide.md               # 日志指南 (保留)
│   └── performance-optimization.md    # 性能优化 (保留)
│
├── 部署运维/
│   ├── pm2-deployment.md              # PM2 部署 (合并4个PM2文档)
│   └── session-recovery-guide.md      # 会话恢复 (保留)
│
└── archive/                           # 归档目录
    ├── development/                   # 开发记录
    │   ├── phase1/                   # Phase 1 相关
    │   │   ├── phase1-complete.md
    │   │   └── phase1-implementation-complete.md
    │   ├── phase2/                   # Phase 2 相关
    │   │   └── phase2-integration-complete.md
    │   ├── phase3/                   # Phase 3 相关 (10个文档)
    │   │   ├── PHASE3-COMPLETE.md
    │   │   ├── phase3-summary.md
    │   │   ├── phase3-final-summary.md
    │   │   ├── phase3-llm-hooks-implementation.md
    │   │   ├── phase3.1-llm-hooks-complete.md
    │   │   ├── phase3.2-agent-lifecycle-hooks-complete.md
    │   │   ├── phase3.3-agent-session-lifecycle-hooks-complete.md
    │   │   ├── phase3.3-implementation-summary.md
    │   │   ├── phase3.4-3.5-complete.md
    │   │   └── phase3-hooks-integration-complete.md
    │   ├── plugin-system/            # 插件系统开发记录
    │   │   ├── plugin-system-complete-summary.md
    │   │   └── plugin-system-final-summary.md
    │   └── refactoring/              # 重构记录
    │       ├── refactoring-summary.md
    │       ├── job-handler-refactoring.md
    │       ├── tools-simplification-complete.md
    │       └── tools-simplification-plan.md
    └── analysis/                      # 技术分析
        ├── jiti-analysis.md
        ├── logging-enhancement-update.md
        ├── remaining-todos.md
        ├── remaining-todos-final.md
        ├── openclaw-extends.md
        └── openclaw-plugin-integration-design.md
```

---

## 具体操作

### 1. 合并 PM2 相关文档 (4 → 1)

**目标**: `docs/部署运维/pm2-deployment.md`

**源文档**:
- `PM2-GUIDE.md` (5.6K)
- `PM2_DAEMON_SETUP.md` (5.4K)
- `pm2-daemon-guide.md` (6.5K)
- `pm2-quick-reference.md` (4.6K)

**合并策略**:
1. 以 `PM2-GUIDE.md` 为基础
2. 从 `pm2-daemon-guide.md` 补充 daemon 模式内容
3. 从 `PM2_DAEMON_SETUP.md` 补充配置细节
4. 将 `pm2-quick-reference.md` 作为快速参考附录

---

### 2. 合并 Feishu 插件文档 (3 → 整合到 1)

**目标**: 整合到 `docs/用户指南/feishu-integration.md`

**源文档**:
- `feishu-integration.md` (2.6K) - 基础集成
- `feishu-plugin-usage-guide.md` (8.9K) - 插件使用
- `feishu-plugin-integration-guide.md` (14K) - 开发指南
- `feishu-official-plugin-integration.md` (11K) - 官方插件

**合并策略**:
1. 保留 `feishu-integration.md` 作为基础
2. 添加"插件使用"章节 (来自 usage-guide)
3. 添加"高级配置"章节 (来自 official-plugin-integration)
4. 将开发指南部分移到 `docs/架构文档/plugin-system.md`

---

### 3. 合并 Proactive 相关文档 (3 → 1)

**目标**: `docs/用户指南/proactive-system.md`

**源文档**:
- `proactive-capabilities-guide.md` (18K) - 完整指南
- `proactive-chat-examples.md` (6.7K) - 示例
- `proactive-quick-reference.md` (3.5K) - 快速参考

**合并策略**:
1. 以 `proactive-capabilities-guide.md` 为主体
2. 将 `proactive-chat-examples.md` 的示例整合到相应章节
3. 将 `proactive-quick-reference.md` 作为附录

---

### 4. 合并 OpenClaw 插件文档 (2 → 1)

**目标**: `docs/架构文档/plugin-system.md`

**源文档**:
- `openclaw-extends.md` (59K) - 扩展说明
- `openclaw-plugin-integration-design.md` (63K) - 设计文档

**合并策略**:
1. 提取核心架构设计
2. 移除重复的 OpenClaw 原始文档内容
3. 保留 Beeclaw 特定的实现说明
4. 整合飞书插件开发指南

---

### 5. 归档 Phase 文档 (12 → archive/)

**操作**:
1. 创建 `docs/archive/development/phase1/`, `phase2/`, `phase3/` 目录
2. 移动所有 phase 相关文档到对应目录
3. 创建 `PHASE_SUMMARY.md` 作为索引

---

### 6. 归档其他开发文档

**移至 `docs/archive/`**:
- `refactoring-summary.md` → `development/refactoring/`
- `job-handler-refactoring.md` → `development/refactoring/`
- `tools-simplification-*.md` → `development/refactoring/`
- `jiti-analysis.md` → `analysis/`
- `logging-enhancement-update.md` → `analysis/`
- `remaining-todos*.md` → `analysis/`
- `ONBOARDING.md` → `analysis/` (已过时的入职文档)
- `scheduled-skill-execution.md` → `analysis/` (已整合到 proactive)

---

### 7. 重命名和清理

**重命名**:
- `index.md` → `README.md`
- `memory-design.md` → `memory-system.md`

**删除**:
- 无 (所有文档都有价值，只是需要归档)

---

## 新文档内容大纲

### 1. `pm2-deployment.md` 大纲

```markdown
# PM2 部署指南

## 快速开始
- 安装 PM2
- 基本启动命令

## Daemon 模式
- 启动守护进程
- 定时任务配置
- 后台调度

## 配置参考
- ecosystem.config.cjs 详解
- 环境变量

## 运维操作
- 查看状态
- 查看日志
- 重启和停止
- 监控

## 快速参考
- 常用命令列表
```

### 2. `proactive-system.md` 大纲

```markdown
# 主动系统指南

## 概述
- 什么是主动系统
- 核心功能

## 定时任务
- schedule_once 工具
- 任务类型
- 配置方法

## 主动聊天
- llm_proactive_chat 任务
- 触发时机
- 个性化内容

## 通知推送
- notification_push 工具
- 渠道选择

## 使用场景 (6个示例)
- 每日问候
- 会议提醒
- 目标追踪
- 事件提醒
- 天气预警
- 个性化建议

## 快速参考
- 工具列表
- 常见配置
```

### 3. `plugin-system.md` 大纲

```markdown
# 插件系统架构

## 概述
- OpenClaw 兼容性
- 插件类型

## 架构设计
- 插件加载器
- Hook Runner
- 类型系统

## 开发指南
- 创建插件
- 注册工具
- 监听钩子

## 飞书插件示例
- 插件结构
- 工具实现
- 钩子监听

## API 参考
- OpenClawPluginApi
- PluginRuntime
- Hook 类型

## 部署和测试
- 本地开发
- 生产部署
```

---

## 实施步骤

### Phase 1: 创建目录结构
```bash
mkdir -p docs/用户指南
mkdir -p docs/架构文档
mkdir -p docs/部署运维
mkdir -p docs/archive/development/phase1
mkdir -p docs/archive/development/phase2
mkdir -p docs/archive/development/phase3
mkdir -p docs/archive/development/plugin-system
mkdir -p docs/archive/development/refactoring
mkdir -p docs/archive/analysis
```

### Phase 2: 移动文档到归档
```bash
# Phase 1
mv docs/phase1-*.md docs/archive/development/phase1/

# Phase 2
mv docs/phase2-*.md docs/archive/development/phase2/

# Phase 3
mv docs/PHASE3-COMPLETE.md docs/archive/development/phase3/
mv docs/phase3-*.md docs/archive/development/phase3/

# Plugin system
mv docs/plugin-system-*.md docs/archive/development/plugin-system/

# Refactoring
mv docs/refactoring-*.md docs/archive/development/refactoring/
mv docs/job-handler-*.md docs/archive/development/refactoring/
mv docs/tools-simplification-*.md docs/archive/development/refactoring/

# Analysis
mv docs/jiti-analysis.md docs/archive/analysis/
mv docs/logging-enhancement-*.md docs/archive/analysis/
mv docs/remaining-todos*.md docs/archive/analysis/
mv docs/openclaw-*.md docs/archive/analysis/
mv docs/ONBOARDING.md docs/archive/analysis/
mv docs/scheduled-skill-execution.md docs/archive/analysis/
```

### Phase 3: 合并文档
1. 手动合并 PM2 文档
2. 整合 Feishu 插件内容
3. 合并 Proactive 文档
4. 创建 Plugin System 文档

### Phase 4: 重组用户文档
```bash
mv docs/getting-started.md docs/用户指南/
mv docs/cli-reference.md docs/用户指南/
mv docs/configuration.md docs/用户指南/
mv docs/feishu-integration.md docs/用户指南/
mv docs/tools-reference.md docs/用户指南/
mv docs/notification-usage-guide.md docs/用户指南/

mv docs/architecture.md docs/架构文档/
mv docs/error-handling.md docs/架构文档/
mv docs/timeout-config.md docs/架构文档/
mv docs/logging-guide.md docs/架构文档/
mv docs/performance-optimization.md docs/架构文档/

mv docs/session-recovery-guide.md docs/部署运维/
```

### Phase 5: 重命名和清理
```bash
mv docs/index.md docs/README.md
mv docs/用户指南/memory-design.md docs/用户指南/memory-system.md
```

### Phase 6: 更新文档索引
- 更新 `docs/README.md` 的链接
- 创建 `docs/archive/README.md` 说明归档内容
- 更新 `CLAUDE.md` 中的文档引用

---

## 预期效果

### 文档数量
- **当前**: 54 个文档 (docs/)
- **重组后**: ~20 个核心文档 + archive/

### 空间优化
- **当前**: ~600K 文档
- **重组后**: ~200K 核心文档 + ~400K 归档

### 用户体验
- ✅ 清晰的分类 (用户指南/架构/运维)
- ✅ 无冗余内容
- ✅ 易于查找
- ✅ 保留历史记录 (archive/)

### 维护成本
- ✅ 减少重复维护
- ✅ 明确文档职责
- ✅ 易于更新

---

## 风险和注意事项

1. **链接失效**: 需要更新所有内部链接
2. **Git 历史**: 移动文件会保留历史，但可能影响 blame
3. **用户习惯**: 熟悉旧结构的用户需要适应
4. **CLAUDE.md**: 需要同步更新 CLAUDE.md 中的文档引用

---

## 下一步

1. ✅ 创建重组计划 (本文档)
2. ⏸️ 执行文件移动和归档
3. ⏸️ 合并需要合并的文档
4. ⏸️ 更新所有链接
5. ⏸️ 测试文档完整性
6. ⏸️ 提交并推送

---

**预计工作量**: 2-3 小时
**优先级**: 中等 (不影响功能，但改善可维护性)
