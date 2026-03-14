# Beeclaw 文档地图

> 可视化导航，快速找到你需要的文档

---

## 🗺️ 文档全景图

```mermaid
graph TD
    Home[🏠 首页] --> Start{选择路径}

    Start -->|新手| A1[📖 快速开始]
    Start -->|进阶| A2[📚 学习路径]
    Start -->|开发| A3[🔧 开发指南]

    A1 --> B1[安装配置]
    A1 --> B2[基本使用]
    A1 --> B3[第一个技能]

    A2 --> C1[基础功能]
    A2 --> C2[高级特性]
    A2 --> C3[架构设计]

    C1 --> D1[记忆系统]
    C1 --> D2[技能系统]
    C1 --> D3[工具参考]

    C2 --> E1[子代理系统]
    C2 --> E2[插件系统]
    C2 --> E3[主动调度]

    C3 --> F1[系统架构]
    C3 --> F2[上下文管理]
    C3 --> F3[弹性设计]

    D1 --> G1[记忆管理工作流]
    D2 --> G2[创建第一个技能]
    D3 --> G3[深度研究任务]

    E1 --> H1[子代理编排]
    E2 --> H2[插件开发]
    E3 --> H3[主动调度系统]

    A3 --> I1[CLAUDE.md]
    I1 --> I2[测试指南]
    I1 --> I3[代码规范]

    style Home fill:#4A90E2
    style Start fill:#7ED321
    style A1 fill:#F5A623
    style A2 fill:#F5A623
    style A3 fill:#F5A623
```

---

## 🎯 按场景导航

### 场景 1：我是新手，想快速上手

```mermaid
graph LR
    A[开始] --> B[README]
    B --> C[快速开始]
    C --> D[学习路径]
    D --> E[创建第一个技能]
    E --> F[✅ 上手完成]

    style A fill:#E8F5E9
    style F fill:#4CAF50
```

**预计时间**: 1 小时

**学习路径**:
1. [README](../README.md) - 了解项目（5分钟）
2. [快速开始](./getting-started.md) - 安装配置（15分钟）
3. [学习路径](./learning-paths.md) - 选择路径（5分钟）
4. [创建第一个技能](./cookbook/basic/first-skill.md) - 实战练习（15分钟）
5. [记忆管理工作流](./cookbook/basic/memory-workflow.md) - 深入理解（20分钟）

---

### 场景 2：我想深度研究某个主题

```mermaid
graph LR
    A[研究需求] --> B{选择方式}

    B -->|简单| C[web_search]
    B -->|复杂| D[deep_research]

    C --> E[查看结果]
    D --> F[生成报告]

    E --> G[保存笔记]
    F --> G

    G --> H[记忆系统]

    style A fill:#E3F2FD
    style H fill:#2196F3
```

**推荐文档**:
1. [深度研究任务](./cookbook/basic/research-task.md) - 学习研究工具
2. [工具参考 - 网络工具](./references/tools.md#网络工具) - API 文档
3. [记忆管理工作流](./cookbook/basic/memory-workflow.md) - 保存研究结果

---

### 场景 3：我要部署到生产环境

```mermaid
graph TD
    A[部署准备] --> B[配置优化]
    B --> C[PM2 部署]
    C --> D[监控日志]
    D --> E[性能优化]
    E --> F[✅ 生产就绪]

    style A fill:#FFF3E0
    style F fill:#FF9800
```

**推荐文档**:
1. [配置指南](./configuration.md) - 生产配置
2. [PM2 部署](./operations/deployment.md) - 部署流程
3. [日志指南](./operations/logging.md) - 日志管理
4. [性能优化](./operations/performance.md) - 性能调优
5. [故障排查](./troubleshooting/) - 问题诊断

---

### 场景 4：我要开发插件或二次开发

```mermaid
graph TD
    A[开发准备] --> B[理解架构]
    B --> C[学习 Hook]
    C --> D[开发插件]
    D --> E[测试发布]
    E --> F[✅ 开发完成]

    style A fill:#F3E5F5
    style F fill:#9C27B0
```

**推荐文档**:
1. [开发指南 (CLAUDE.md)](../CLAUDE.md) - 开发规范
2. [系统架构](./architecture.md) - 架构设计
3. [插件系统](./guide/plugin-system.md) - 插件机制
4. [插件开发全流程](./cookbook/advanced/plugin-development.md) - 实战案例

---

## 📂 按文档类型导航

### 📖 入门文档（必读）

| 文档 | 用途 | 时间 |
|------|------|------|
| [README](../README.md) | 项目概览 | 5分钟 |
| [快速开始](./getting-started.md) | 安装配置 | 15分钟 |
| [学习路径](./learning-paths.md) | 学习指南 | 10分钟 |
| [配置指南](./configuration.md) | 详细配置 | 20分钟 |

---

### 📚 用户指南（按功能）

#### 核心系统

```mermaid
graph LR
    A[记忆系统] --> B[技能系统]
    B --> C[子代理系统]
    C --> D[插件系统]
```

| 文档 | 说明 |
|------|------|
| [记忆系统](./guide/memory-system.md) | 文件系统 + 索引的知识存储 |
| [技能系统](./guide/skill-system.md) | 可复用的提示词模块 |
| [子代理系统](./guide/subagent-system.md) | 并行任务执行和 DAG 编排 |
| [插件系统](./guide/plugin-system.md) | OpenClaw 兼容插件 |

#### 高级功能

| 文档 | 说明 |
|------|------|
| [主动系统](./guide/proactive-system.md) | 定时任务、主动通知 |
| [会话恢复](./guide/session-recovery.md) | 重启后恢复对话 |
| [错误处理](./guide/error-handling.md) | 错误分类和重试 |
| [通知系统](./guide/notification.md) | CLI 和飞书通知 |

#### 集成

| 文档 | 说明 |
|------|------|
| [飞书集成](./guide/feishu-integration.md) | Bot 配置和 Card V2 |
| [Web UI](./guide/web-ui.md) | Web 界面使用 |

---

### 🏗️ 架构设计（深入理解）

```mermaid
graph TD
    A[系统架构] --> B[上下文管理]
    A --> C[弹性设计]
    A --> D[统一会话]

    B --> E[Token 预算]
    B --> F[智能压缩]

    C --> G[熔断器]
    C --> H[重试机制]
```

| 文档 | 说明 |
|------|------|
| [系统架构](./architecture.md) | 核心架构设计 |
| [上下文管理](./design/context-management.md) | Token 预算和压缩 |
| [统一会话](./design/unified-session.md) | CLI/Bot 统一管理 |
| [弹性设计](./design/resilience.md) | 熔断、重试、降级 |

---

### 📚 参考文档（查阅）

| 文档 | 内容 |
|------|------|
| [CLI 参考](./references/cli.md) | 所有命令和斜杠命令 |
| [工具参考](./references/tools.md) | 40+ 工具的完整 API |

---

### 🎯 实战案例（动手练习）

#### 基础案例

| 案例 | 难度 | 时间 | 学习重点 |
|------|------|------|---------|
| [创建第一个技能](./cookbook/basic/first-skill.md) | ⭐ | 15分钟 | 技能系统 |
| [记忆管理工作流](./cookbook/basic/memory-workflow.md) | ⭐ | 20分钟 | 记忆系统 |
| [深度研究任务](./cookbook/basic/research-task.md) | ⭐⭐ | 25分钟 | 网络工具 |

#### 进阶案例

| 案例 | 难度 | 时间 | 学习重点 |
|------|------|------|---------|
| [子代理编排](./cookbook/advanced/subagent-orchestration.md) | ⭐⭐⭐ | 40分钟 | 并行执行 |
| [插件开发](./cookbook/advanced/plugin-development.md) | ⭐⭐⭐ | 60分钟 | Hook 机制 |
| [主动调度](./cookbook/advanced/proactive-scheduling.md) | ⭐⭐ | 30分钟 | 定时任务 |

#### 集成案例

| 案例 | 难度 | 时间 | 学习重点 |
|------|------|------|---------|
| [飞书 Bot 部署](./cookbook/integration/feishu-bot-deploy.md) | ⭐⭐ | 45分钟 | Bot 集成 |

---

### 🔧 运维文档（生产部署）

```mermaid
graph LR
    A[部署准备] --> B[PM2 部署]
    B --> C[监控日志]
    C --> D[性能优化]
    D --> E[故障排查]
```

| 文档 | 说明 |
|------|------|
| [PM2 部署](./operations/deployment.md) | 生产环境部署 |
| [性能优化](./operations/performance.md) | 响应延迟优化 |
| [日志指南](./operations/logging.md) | 日志配置和排查 |
| [超时配置](./operations/timeout-config.md) | 智能超时设置 |

---

### 🔍 故障排查（问题诊断）

| 文档 | 说明 |
|------|------|
| [故障排查手册](./troubleshooting/) | 系统化诊断流程 |
| [启动问题](./troubleshooting/startup-issues.md) | API Key、依赖、端口 |
| [记忆系统问题](./troubleshooting/memory-issues.md) | 索引、搜索、权限 |
| [飞书集成问题](./troubleshooting/feishu-issues.md) | 连接、消息、权限 |
| [性能问题](./troubleshooting/performance-issues.md) | 延迟、内存、Token |

---

## 🔗 快速跳转

### 我想了解...

- **如何安装？** → [快速开始](./getting-started.md)
- **如何配置？** → [配置指南](./configuration.md)
- **有什么功能？** → [学习路径](./learning-paths.md)
- **工具怎么用？** → [工具参考](./references/tools.md)
- **如何开发插件？** → [插件开发](./cookbook/advanced/plugin-development.md)
- **如何部署？** → [PM2 部署](./operations/deployment.md)
- **遇到问题？** → [故障排查](./troubleshooting/)

### 我想查看...

- **API 文档** → [工具参考](./references/tools.md)
- **CLI 命令** → [CLI 参考](./references/cli.md)
- **架构设计** → [系统架构](./architecture.md)
- **实战案例** → [Cookbook](./cookbook/)
- **变更历史** → [CHANGELOG](./CHANGELOG.md)
- **写作规范** → [STYLE_GUIDE](./STYLE_GUIDE.md)

---

## 📊 文档统计

| 类型 | 数量 | 总行数 |
|------|------|--------|
| **入门文档** | 4 | ~800 |
| **用户指南** | 11 | ~2500 |
| **架构设计** | 7 | ~1500 |
| **参考文档** | 2 | ~1500 |
| **实战案例** | 6 | ~1800 |
| **运维文档** | 4 | ~800 |
| **故障排查** | 5 | ~600 |
| **总计** | **39** | **~9500** |

---

## 🎨 文档关系图

```mermaid
graph TD
    subgraph 入门
        A1[README]
        A2[快速开始]
        A3[学习路径]
    end

    subgraph 核心
        B1[记忆系统]
        B2[技能系统]
        B3[子代理系统]
        B4[插件系统]
    end

    subgraph 高级
        C1[上下文管理]
        C2[弹性设计]
        C3[主动系统]
    end

    subgraph 集成
        D1[飞书集成]
        D2[Web UI]
    end

    subgraph 运维
        E1[PM2 部署]
        E2[性能优化]
        E3[故障排查]
    end

    A1 --> A2
    A2 --> A3
    A3 --> B1
    A3 --> B2

    B1 --> B3
    B2 --> B4

    B3 --> C1
    B4 --> C2

    C1 --> C3
    C2 --> C3

    C3 --> D1
    C3 --> D2

    D1 --> E1
    D2 --> E1
    E1 --> E2
    E2 --> E3
```

---

## 💡 使用建议

### 新手用户

1. **第一周**: 完成入门文档 + 2 个基础案例
2. **第二周**: 学习核心系统 + 1 个进阶案例
3. **第三周**: 尝试集成和部署

### 开发者

1. **Day 1**: 阅读 CLAUDE.md + 架构文档
2. **Day 2**: 学习插件系统
3. **Day 3**: 开发第一个插件

### 运维工程师

1. **准备阶段**: 阅读部署和配置文档
2. **部署阶段**: 按照部署指南操作
3. **运维阶段**: 监控日志 + 故障排查

---

**最后更新**: 2026-03-14
**版本**: v1.0.0
