# Agora Town — MVP 阶段项目拆解与实施文档

> **文档版本**: v1.0
> **创建日期**: 2026-03-06
> **基准文档**: Agora Town PRD v2.1
> **文档目的**: 将 PRD v2 的完整愿景裁剪为最小可行产品（MVP），并给出详细的实施计划

---

## 1. MVP 定义与目标

### 1.1 一句话定义

**MVP 是一个能让 3-5 个 AI Agent 在一张小型等距地图上，通过 CognitivePacket 叙事协议完成"感知-推理-行动"认知循环，并产生可观察的自主移动、对话、闲逛等行为的 Web 端可视化 Demo。**

### 1.2 验证假设

MVP 结束后，我们需要验证以下核心假设：

| 编号 | 假设 | 验证方式 |
|------|------|----------|
| H1 | **叙事驱动可行**：将世界状态翻译为自然语言叙事，LLM 能基于叙事做出合理的行为决策 | 观察 Agent 在不同场景下的行为选择是否与叙事上下文相关 |
| H2 | **行动空间有效**：动态计算的行动空间能引导 Agent 产生多样化而非重复的行为 | 统计 Agent 在 100 个 Tick 内选择不同行动类型的分布 |
| H3 | **对话自然**：叙事驱动的对话流程（非命令式 API）能产生自然、连贯的多轮对话 | 人工评审 20 段对话的自然度评分（1-5 分，目标均分 >= 3.5） |
| H4 | **性能可接受**：单个 CognitivePacket 从生成到 Agent 返回 Intent 的端到端延迟在可接受范围内 | P95 延迟 < 5 秒（含 LLM 推理时间） |
| H5 | **观赏性足够**：人类观众通过浏览器观看 Agent 行为时，觉得有趣且能理解 Agent 在做什么 | 5 人内部评审，"有趣"评分 >= 3/5，"可理解"评分 >= 4/5 |

### 1.3 成功标准（量化指标）

| 指标 | 目标值 | 测量方式 |
|------|--------|----------|
| Agent 认知循环完成率 | >= 95% | 100 个连续 Tick 中，Agent 成功返回有效 Intent 的比例 |
| Agent 行为多样性 | >= 5 种不同行动/小时 | 统计单个 Agent 每小时选择的不同 actionId 数量 |
| 对话连贯性 | 人工评分 >= 3.5/5 | 5 人评审团对 20 段对话打分 |
| CognitivePacket 生成延迟 P50 | < 200ms | 服务端计时 |
| 端到端 Tick 延迟 P95 | < 5s | 从 Tick 开始到所有 Agent Intent 返回 |
| 前端渲染帧率 | >= 30 FPS | 5 个 Agent 同时在屏幕上移动时的帧率 |
| 系统连续运行时间 | >= 4 小时无崩溃 | 压力测试 |

### 1.4 MVP 的明确边界

**做什么（IN）**：

- Agent 认知循环核心链路：CognitivePacket 生成 -> 推送 -> Agent LLM 推理 -> Intent 返回 -> 验证执行
- 叙事引擎基础版：环境叙事 + 社交叙事（2 种叙事类型，1 种风格）
- 基础行动空间：移动、对话、闲逛/观察 3 种行动类型
- 基础地图渲染：PixiJS 等距地图，1 个小型区域（中央广场）
- 基础对话系统：1v1 面对面对话，叙事驱动
- 基础前端 UI：地图 + Agent 状态面板 + 叙事流窗口
- 内置 Mock Agent：系统自带 3-5 个使用 OpenAI API 的测试 Agent

**不做什么（OUT）**：

- 经济系统（货币、交易、市场、开店）
- 任务系统
- 居所系统（房屋升级、装修、家具）
- Agent 记忆系统（pgvector 向量检索）
- Persona 系统（大五人格模型、性格影响叙事）
- 双向 Skill 生态
- 休眠模式
- Agent 视角模式（认知面板、感知迷雾）
- 天气系统
- 昼夜循环
- 多叙事风格
- 外部 Agent 框架接入（仅支持内置 Mock Agent + Generic REST）
- gRPC 协议
- 移动端适配
- 插件/Mod 系统
- 安全审核、反作弊
- 多小镇互联

### 1.5 MVP 的目标用户

**主要用户：内部开发团队（3-5 人）**

MVP 是一个内部技术验证 Demo，不面向外部用户。核心受众是：
1. **项目决策者**：通过观看 Demo 判断技术方向是否可行，是否值得继续投入
2. **开发团队自身**：通过 MVP 建立对核心架构的理解，为后续迭代打下基础
3. **潜在合作方**：如需融资或合作，MVP 作为技术展示使用

---

## 2. MVP 功能范围裁剪

### 2.1 完整裁剪决策表

以下对 PRD v2 的全部 21 章内容逐一做出裁剪决策。

| PRD 章节 | 子系统 | MVP 决策 | 裁剪理由 |
|----------|--------|----------|----------|
| **4.1** Agent Loop | 认知循环核心 | **IN（全量）** | 这是整个架构的心脏，必须完整验证 |
| **4.2** World Narration Layer | 叙事分层 | **SIMPLIFIED** | 仅实现环境叙事 + 社交叙事，去掉经济叙事和事件叙事；仅 1 种风格（literary） |
| **4.2** Narration Template System | 模板引擎 | **SIMPLIFIED** | 用硬编码 Prompt 模板代替完整的模板引擎，不做风格变体 |
| **4.2** Token Budget | Token 预算 | **SIMPLIFIED** | 固定预算分配，不做动态调整和压缩策略 |
| **4.3** Action Space Protocol | 行动空间 | **SIMPLIFIED** | 仅支持 3 种行动类型（移动、对话、闲逛），去掉经济/任务/Skill 行动 |
| **4.3** Intent Validation | 意图验证 | **SIMPLIFIED** | 仅做格式校验和 actionId 校验，去掉资源检查和内容安全 |
| **4.3** Conflict Resolution | 冲突解决 | **OUT** | MVP 仅 3-5 个 Agent，冲突概率极低，用简单的先到先得替代 |
| **4.4** Agent Memory | 记忆协议 | **OUT** | 不影响核心循环验证；MVP 阶段用固定的 mock 记忆代替 |
| **4.5** Persona System | 人格系统 | **OUT** | 复杂度高，不影响核心循环；MVP 用简单的角色描述字符串代替 |
| **4.6** Autonomy Levels | 自主等级 | **OUT** | MVP 所有 Agent 统一按 L1 运行（从列表选择行动） |
| **5** Agent Onboarding | 入驻系统 | **SIMPLIFIED** | 去掉认知兼容性测试和入驻仪式，直接通过配置文件注册 |
| **6** Bidirectional Skill | 双向 Skill | **OUT** | 完全不实现，与核心认知循环无关 |
| **7** Event-Driven Lifecycle | 事件生命周期 | **SIMPLIFIED** | 仅实现最基础的 Tick 驱动，不做事件优先级和中断机制 |
| **7.4** Agent Schedule | 日程系统 | **OUT** | 不影响核心循环 |
| **7.5** Dormant Mode | 休眠模式 | **OUT** | MVP 中 Agent 始终在线 |
| **8.1** Map System | 地图系统 | **SIMPLIFIED** | 仅实现 64x64 Tile 的小型地图（约为 PRD 的 1/16） |
| **8.2** Zone Planning | 区域规划 | **SIMPLIFIED** | 仅实现中央广场 1 个区域，包含少量建筑占位 |
| **8.3** Day/Night Cycle | 昼夜循环 | **OUT** | 固定为白天，不影响核心循环 |
| **8.3** Weather System | 天气系统 | **OUT** | 固定为晴天 |
| **9** Home System | 居所系统 | **OUT** | 不影响核心循环 |
| **10.1** Social - Narrative | 叙事社交 | **IN（全量）** | 验证叙事驱动社交是核心目标 |
| **10.2** Conversation System | 对话系统 | **SIMPLIFIED** | 仅支持 1v1 面对面对话，去掉群聊/广播/私信/商业对话 |
| **10.3** Relationship Model | 关系模型 | **SIMPLIFIED** | 仅维护基础好感度（affinity），去掉信任度/熟悉度/合作历史 |
| **10.4** Social Activities | 社交活动 | **OUT** | 不实现组织化活动 |
| **10.6** Emotion System | 情感系统 | **OUT** | 不影响核心循环 |
| **11** Economy System | 经济系统 | **OUT** | 完全不实现 |
| **12** Quest System | 任务系统 | **OUT** | 完全不实现 |
| **13** Public Facilities | 公共设施 | **OUT** | 不实现任何设施的 Skill 功能 |
| **14.1-14.4** Rendering | PixiJS 渲染 | **SIMPLIFIED** | 基础等距地图 + Agent 精灵 + 简单动画，去掉粒子/天气/光照 |
| **14.5** Agent Perspective | Agent 视角 | **OUT** | 复杂度高，延后到 Alpha |
| **14.6** Sprite/Animation | 动画系统 | **SIMPLIFIED** | 4 方向行走 + 空闲动画，去掉 8 方向和认知状态动画 |
| **14.7** UI/HUD | 界面设计 | **SIMPLIFIED** | 仅保留：小镇时间显示、Agent 列表面板、叙事流窗口、对话气泡 |
| **14.9** Performance | 性能优化 | **SIMPLIFIED** | 仅做视口裁剪，其他优化延后 |
| **15.1** API Design | API 设计 | **SIMPLIFIED** | 仅 tRPC + WebSocket，去掉 gRPC |
| **15.2** Data Model | 数据模型 | **SIMPLIFIED** | 仅保留 agents、relationships、conversations、messages 4 张核心表 |
| **15.3** Realtime Comm | 实时通信 | **SIMPLIFIED** | 单节点 WebSocket，不做 Redis Pub/Sub 跨节点 |
| **15.5** Persistence | 持久化 | **SIMPLIFIED** | SQLite 代替 PostgreSQL，进程内存代替 Redis |
| **15.7** Message Queue | 消息队列 | **OUT** | MVP 用同步调用代替异步队列 |
| **15.8** Narration Engine Backend | 叙事引擎后端 | **SIMPLIFIED** | 单线程同步处理，不做并行优化 |
| **16** Agent Runtime Engine | 认知运行时 | **SIMPLIFIED** | 仅实现核心循环驱动 + Generic REST 适配器 |
| **17** Extensibility | 扩展性 | **OUT** | 完全不实现 |
| **18** Security | 安全设计 | **OUT** | MVP 内部使用，无需安全加固 |
| **19** Operations | 运维监控 | **SIMPLIFIED** | 仅 console.log 级别日志，不部署监控系统 |
| **20** Milestones | 里程碑 | **N/A** | 被本文档替代 |
| **21** Appendix | 附录 | **N/A** | 参考使用 |

### 2.2 裁剪原则总结

1. **保核心链路**：CognitivePacket 生成 -> 叙事翻译 -> Agent 推理 -> Intent 返回 -> 验证执行。这条链路上的每个环节都必须走通。
2. **砍支撑系统**：经济、任务、居所、Skill 等系统虽然丰富了世界内容，但不影响核心认知循环的验证。
3. **降基础设施**：用 SQLite 替代 PostgreSQL，用内存替代 Redis，用同步调用替代消息队列。减少部署和运维复杂度。
4. **缩地图规模**：从 256x256 缩到 64x64，从 5 个区域缩到 1 个区域。够用即可。

---

## 3. MVP 系统架构（精简版）

### 3.1 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                    展示层 (Presentation)                       │
│  PixiJS v8 基础渲染 + React UI（叙事流 + Agent 面板）          │
├──────────────────────────────────────────────────────────────┤
│                  ★ 叙事层 (Narration Layer) ★                 │
│  环境叙事 │ 社交叙事 │ Prompt 模板 │ 固定 Token 预算           │
├──────────────────────────────────────────────────────────────┤
│                ★ 认知运行时 (Cognitive Runtime) ★              │
│  Agent Loop 驱动 │ 行动空间计算（简化） │ Intent 基础验证       │
├──────────────────────────────────────────────────────────────┤
│                    接入层 (Access)                             │
│  WebSocket（单节点） │ tRPC API（前端用）                      │
├──────────────────────────────────────────────────────────────┤
│                     数据层 (Data)                              │
│  SQLite（Drizzle ORM） │ 进程内存缓存                          │
└──────────────────────────────────────────────────────────────┘
```

与 PRD 完整架构的对比：

| 组件 | PRD 完整方案 | MVP 替代方案 | 理由 |
|------|-------------|-------------|------|
| 数据库 | PostgreSQL + pgvector | SQLite | 3-5 个 Agent 无需大型数据库；Drizzle ORM 后续切换 PG 成本低 |
| 缓存 | Redis | 进程内 Map 缓存 | 单节点部署，无需分布式缓存 |
| 消息队列 | BullMQ (Redis) | 同步调用 / setTimeout | Agent 数量少，不需要异步队列 |
| Agent 通信 | gRPC + REST + WebSocket | 仅 REST（HTTP POST 推送） | 简化协议层，Mock Agent 在同一进程内 |
| 前端状态 | Zustand + bitECS | Zustand + 简化 ECS | bitECS 的 SoA 架构对 5 个 Entity 无必要 |
| 部署 | K8s + Docker + Nginx | 单进程 Node.js + 静态前端 | 本地开发环境即可运行 |

### 3.2 必须部署的服务

MVP 阶段只需要 **1 个进程**：

```
Node.js 单进程
├── HTTP Server (Express/Fastify)
│   ├── tRPC Router（前端 API）
│   └── WebSocket Server（实时推送）
├── World Engine（世界引擎主循环）
│   ├── Tick Scheduler（定时器驱动）
│   ├── Narration Engine（叙事生成）
│   ├── Action Space Calculator（行动空间计算）
│   └── Intent Validator（意图验证）
├── Mock Agent Manager（内置测试 Agent）
│   └── OpenAI API 调用层
├── SQLite Database（via Drizzle ORM）
└── In-Memory State Cache
```

前端单独打包为静态文件，可由同一个 HTTP Server 托管，也可独立 dev server。

### 3.3 技术选型（MVP 精简版）

| 技术 | 版本 | 用途 | 说明 |
|------|------|------|------|
| **Node.js** | v20 LTS | 后端运行时 | 全栈统一 |
| **TypeScript** | v5.x | 类型系统 | 前后端共享类型 |
| **Next.js** | v14 | 前端框架 | App Router + SSR |
| **PixiJS** | v8.x | 2D 渲染 | 等距地图渲染 |
| **React** | v18 | UI 层 | 叙事面板、Agent 列表等 |
| **Zustand** | v4 | 状态管理 | 前端全局状态 |
| **tRPC** | v11 | 类型安全 API | 前后端类型共享 |
| **ws** | v8 | WebSocket | 实时通信 |
| **Drizzle ORM** | latest | 数据库 ORM | SQLite 驱动，后续可切 PG |
| **better-sqlite3** | latest | SQLite 驱动 | 同步 API，简单高效 |
| **OpenAI SDK** | v4 | LLM 调用 | Mock Agent 的推理引擎 |
| **Zod** | v3 | Schema 验证 | Intent 格式校验 |

---

## 4. MVP 模块拆解（核心）

MVP 拆为 **6 个独立模块**，按依赖顺序排列：

```
Module 1: 基础工程脚手架
    ↓
Module 2: 世界引擎与地图
    ↓
Module 3: 叙事引擎          ←── 核心创新点
    ↓
Module 4: Agent 认知运行时    ←── 核心创新点
    ↓
Module 5: 前端渲染与 UI
    ↓
Module 6: 集成联调与 Demo 打磨
```

---

### Module 1: 基础工程脚手架

**一句话描述**：搭建 Monorepo 项目结构、数据库 Schema、共享类型定义和基础 API 框架。

**依赖模块**：无

**交付产物**：可运行的空项目骨架，前后端能通信，数据库能读写。

#### 任务拆解

| Task | 名称 | 描述 | 技术方案要点 | 预估工时 | 验收标准 |
|------|------|------|-------------|----------|----------|
| 1.1 | Monorepo 初始化 | 创建 pnpm workspace，划分 packages：`@agora/server`、`@agora/client`、`@agora/shared` | pnpm workspace + TypeScript project references；`@agora/shared` 存放前后端共享的类型定义 | 0.5 人天 | `pnpm install` 和 `pnpm build` 全部通过；三个 package 可以互相引用类型 |
| 1.2 | 共享类型定义 | 在 `@agora/shared` 中定义 MVP 阶段所有核心 TypeScript 类型：CognitivePacket、AgentIntent、ActionOption 等 | 参考 PRD 4.1-4.3 章节的接口定义，做 MVP 裁剪后的精简版本；使用 Zod schema 同时生成类型和运行时校验 | 1 人天 | 所有类型可以在 server 和 client 中正确导入；Zod schema 可以正确校验示例数据 |
| 1.3 | 数据库 Schema | 使用 Drizzle ORM 定义 MVP 阶段的 SQLite 数据表：agents、relationships、conversations、messages | better-sqlite3 + Drizzle ORM；4 张表，字段精简到 MVP 最小集 | 0.5 人天 | `drizzle-kit push` 成功创建表；CRUD 操作正常 |
| 1.4 | tRPC + WebSocket 基础框架 | 搭建后端 HTTP Server，配置 tRPC Router 骨架和 WebSocket Server | Fastify + @trpc/server + ws 库；定义基础 Router（agent.list、world.state）；WebSocket 支持连接/断开/消息广播 | 1 人天 | tRPC playground 可以调用 API；WebSocket 客户端可以连接并收到测试消息 |
| 1.5 | 前端项目骨架 | 创建 Next.js 项目，配置 tRPC client、WebSocket client、Zustand store | Next.js 14 App Router + tRPC react-query + Zustand；创建基础页面布局 | 1 人天 | 前端页面可以正确调用 tRPC API 并显示数据；WebSocket 连接成功 |

**Module 1 总工时：4 人天**

---

### Module 2: 世界引擎与地图

**一句话描述**：实现世界 Tick 循环、64x64 等距 Tile 地图数据结构、A* 寻路、Agent 位置管理和基础碰撞检测。

**依赖模块**：Module 1

**交付产物**：后端世界引擎可以按固定频率 Tick，Agent 可以在地图上寻路移动。

#### 任务拆解

| Task | 名称 | 描述 | 技术方案要点 | 预估工时 | 验收标准 |
|------|------|------|-------------|----------|----------|
| 2.1 | World Tick 引擎 | 实现世界主循环，以可配置频率（默认 2 TPS）驱动 Tick 更新 | `setInterval` 驱动；每个 Tick 执行：收集状态变更 -> 处理 Agent 循环 -> 广播状态更新；Tick 号单调递增；记录每 Tick 耗时用于调试 | 1 人天 | Tick 引擎稳定运行，间隔误差 < 50ms；Tick 号正确递增；可通过 API 查询当前 Tick |
| 2.2 | 地图数据结构 | 定义 64x64 的 Tile 地图数据结构，包含 walkable 标记、建筑占位信息 | 二维数组 `TileMap[64][64]`，每个 Tile 含 `{ walkable: boolean, buildingId?: string, zoneId: string }`；预设中央广场区域（32x32 区域标记为 plaza，周围为路径和装饰） | 1 人天 | 地图数据可以正确加载；能查询任意坐标的 Tile 属性；非 walkable Tile 被正确标记 |
| 2.3 | A* 寻路算法 | 实现基于 Tile 的 A* 寻路，支持 4 方向移动 | 标准 A* 实现，使用曼哈顿距离启发函数；输入起点和终点 Tile 坐标，返回路径 Tile 列表；路径长度上限 100 Tile（超出返回失败） | 1 人天 | 两点之间能找到正确最短路径；障碍物正确绕行；不可达目标返回 null |
| 2.4 | Agent 位置管理 | 管理所有 Agent 在地图上的位置和移动状态 | `AgentPositionManager` 类：维护 `Map<agentId, { x, y, targetX?, targetY?, path?, speed }>`；每 Tick 更新移动中 Agent 的位置（沿路径步进）；到达目标后清除移动状态 | 1 人天 | Agent 可以被放置在地图上；设置移动目标后，Agent 沿路径平滑移动；到达后停止 |
| 2.5 | 世界状态广播 | 通过 WebSocket 将每 Tick 的状态变更广播给前端 | 每 Tick 结束后，收集所有状态变更（Agent 位置变化、新对话等），打包为 `WorldTickUpdate` 消息通过 WebSocket 广播 | 0.5 人天 | 前端 WebSocket 客户端能收到 Tick 更新消息；消息中包含正确的 Agent 位置数据 |

**Module 2 总工时：4.5 人天**

---

### Module 3: 叙事引擎

**一句话描述**：实现 MVP 版 Narration Engine，能将 Agent 周围的世界状态翻译为 LLM 可理解的自然语言叙事，并计算当前可用行动空间。

**依赖模块**：Module 2

**交付产物**：给定一个 Agent 的当前状态，可以生成完整的 CognitivePacket（叙事文本 + 行动选项列表）。

#### 任务拆解

| Task | 名称 | 描述 | 技术方案要点 | 预估工时 | 验收标准 |
|------|------|------|-------------|----------|----------|
| 3.1 | 环境叙事生成器 | 根据 Agent 当前位置、周围 Tile 和建筑信息，生成环境描述文本 | 模板插值方案：预定义 10-15 个环境叙事模板，根据位置类型（广场中央、广场边缘、建筑旁、路上）选择模板，插入具体变量（时间固定为"下午"、天气固定为"晴朗"）；不调用 LLM，纯模板生成 | 1.5 人天 | 给定 Agent 坐标，能生成 50-150 字的环境描述；不同位置的描述有差异；文本读起来自然流畅 |
| 3.2 | 社交叙事生成器 | 根据 Agent 感知范围内的其他 Agent 信息，生成社交描述文本 | 感知范围设为 8 Tile；遍历范围内其他 Agent，生成描述（名字、距离描述、简单的关系描述）；模板插值方案，准备 5-8 个社交叙事模板 | 1.5 人天 | 当周围有 Agent 时生成社交叙事；周围无人时生成"四周安静"类叙事；描述包含 Agent 名字和位置关系 |
| 3.3 | 行动空间计算器 | 根据 Agent 位置和周围环境，动态计算可用行动列表 | 固定 3 类行动：(1) 移动类 - 根据附近有趣位置生成 2-3 个移动目标；(2) 社交类 - 对感知范围内每个 Agent 生成"打招呼/对话"选项；(3) 通用类 - 始终包含"原地闲逛/观察"和"自由行动" | 1.5 人天 | 在空旷位置返回移动+通用选项；附近有人时额外返回社交选项；每次返回 3-8 个行动选项 |
| 3.4 | CognitivePacket 组装器 | 将环境叙事、社交叙事、行动空间、mock 记忆组装为完整的 CognitivePacket | 按固定模板组装文本：`[环境叙事]\n{env}\n\n[社交叙事]\n{social}\n\n[可执行行动]\n{actions}\n\n[相关记忆]\n{memories}`；memories 使用预设的 3 条固定记忆；总 Token 控制在 1500 以内 | 1 人天 | 生成的 CognitivePacket 符合类型定义；各部分文本齐全且格式正确；总字数在合理范围内 |
| 3.5 | Token 预算管理（简化版） | 确保生成的叙事文本不超过 Token 预算 | 使用简单的字符数估算（中文 1 字 ≈ 2 tokens）；总预算 1500 tokens；如果环境叙事 + 社交叙事超预算，优先截断环境叙事的细节描述 | 0.5 人天 | 生成的 CognitivePacket 估算 Token 数不超过 1500；截断后文本仍然可读 |

**Module 3 总工时：6 人天**

---

### Module 4: Agent 认知运行时

**一句话描述**：实现 Agent 认知循环核心链路——每个 Tick 为每个 Agent 生成 CognitivePacket、调用 LLM 推理、解析 Intent、验证并执行行动。

**依赖模块**：Module 2, Module 3

**交付产物**：Agent 可以自主地在地图上行动——移动、对话、闲逛，行为由 LLM 基于叙事推理驱动。

#### 任务拆解

| Task | 名称 | 描述 | 技术方案要点 | 预估工时 | 验收标准 |
|------|------|------|-------------|----------|----------|
| 4.1 | Mock Agent 管理器 | 创建并管理 3-5 个内置测试 Agent，每个 Agent 有名字、简短 bio 和 System Prompt | 配置文件定义 Agent：`{ id, name, bio, systemPrompt }`；预设 Agent 角色：Alice（好奇的探索者）、Bob（友善的邻居）、Charlie（安静的学者）、Diana（新来的居民）、Eve（热情的社交达人）；注册到数据库 | 1 人天 | 5 个 Agent 数据正确写入数据库；每个 Agent 有唯一的角色描述 |
| 4.2 | Cognitive Loop Driver | 实现核心认知循环驱动器——每 Tick 遍历所有活跃 Agent，为每个 Agent 执行感知->叙事->推理->行动循环 | 在 World Tick 回调中调用；对每个 Agent：(1) 调用 NarrationEngine 生成 CognitivePacket；(2) 调用 LLM 获取 Intent；(3) 验证 Intent；(4) 执行行动。**关键决策**：Agent 串行处理（MVP 仅 5 个 Agent，串行可接受）；单次 Tick 超时 15 秒 | 2 人天 | 每个 Tick 所有 Agent 完成一次认知循环；循环日志正确输出每个阶段耗时；超时 Agent 自动跳过 |
| 4.3 | LLM 调用层 | 封装 OpenAI API 调用，将 CognitivePacket 翻译为 LLM prompt，解析 LLM 回复为 AgentIntent | System Prompt = Agent 角色描述 + 行为指引（"你是小镇居民，请从行动列表中选择一个行动..."）；User Message = CognitivePacket 叙事文本；使用 OpenAI function calling 让 LLM 返回结构化 Intent；模型选择 gpt-4o-mini（成本低、速度快）；超时 10 秒 | 2 人天 | LLM 能正确返回结构化 Intent（actionId + parameters）；响应时间 P50 < 3 秒；function calling 格式正确 |
| 4.4 | Intent 解析与验证 | 解析 LLM 返回的原始响应为 AgentIntent 结构，并做基础校验 | Zod schema 校验 Intent 格式；检查 actionId 是否在当前行动空间中；对 free_action 的 freeFormIntent 做基础长度限制（< 200 字）；验证失败时返回默认 idle 行动 | 1 人天 | 格式正确的 Intent 通过校验；格式错误的自动降级为 idle；校验结果被记录 |
| 4.5 | 行动执行器 | 根据验证通过的 Intent 执行具体行动：移动（调用寻路）、对话（启动对话流程）、闲逛（随机移动） | `ActionExecutor` 类，switch-case 分派：`move_to` -> 调用 A* 寻路设置路径；`talk_to_{agentId}` -> 创建对话会话，推送对话叙事给目标 Agent；`idle`/`wander` -> 随机选择附近 walkable 位置移动；`free_action` -> 尝试解析为已知行动，否则降级为 wander | 1.5 人天 | 移动行动让 Agent 开始沿路径移动；对话行动创建对话记录并通知目标 Agent；闲逛让 Agent 随机移动 |
| 4.6 | 对话流程引擎 | 实现 1v1 叙事驱动的对话流程——A 说话 -> B 收到叙事 -> B 回复 -> A 收到叙事，循环直到结束 | 对话状态机：`{ participants, messages[], turnCount, maxTurns: 6 }`；每轮：当前发言者通过 LLM 生成对话内容（包含在 Intent.speechContent 中）；对方收到的叙事包含对话内容和对话上下文；对话最多 6 轮，或一方选择"结束对话"；对话结束后双方更新关系好感度（+1~+3） | 2 人天 | 两个 Agent 可以完成完整的 6 轮对话；对话内容写入数据库；对话结束后好感度更新；旁观者（前端）可以看到对话内容 |
| 4.7 | 认知循环频率控制 | 并非每个 Tick 都需要触发所有 Agent 的 LLM 推理——实现智能频率控制 | 默认每 5 个 Tick（2.5 秒）才为 Agent 触发一次完整认知循环（含 LLM 调用）；中间 Tick 仅更新移动位置（纯机械运动）；Agent 收到高优先级事件（被人说话）时立即触发一次额外认知循环 | 1 人天 | Agent 每 2.5 秒做一次决策而非每 0.5 秒；正在移动中的 Agent 继续移动不被打断；对话触发即时响应 |

**Module 4 总工时：10.5 人天**

---

### Module 5: 前端渲染与 UI

**一句话描述**：实现 PixiJS 等距地图渲染、Agent 精灵动画、React UI 面板（叙事流窗口、Agent 列表、对话气泡）。

**依赖模块**：Module 1, Module 2

**交付产物**：在浏览器中可以看到等距地图上 Agent 走动、对话，右侧显示叙事文本流。

#### 任务拆解

| Task | 名称 | 描述 | 技术方案要点 | 预估工时 | 验收标准 |
|------|------|------|-------------|----------|----------|
| 5.1 | PixiJS 等距地图渲染 | 渲染 64x64 的等距 Tile 地图，支持地面纹理和简单建筑占位 | PixiJS v8 Application；实现 `cartToIso` 坐标转换；地面 Tile 使用 2-3 种基础纹理（草地、石板路、水面占位）；建筑用简单矩形占位色块；仅渲染视口内 Tile（简单的 AABB 裁剪） | 2 人天 | 地图正确以等距视角渲染；不同 Tile 类型有不同颜色/纹理；视口外 Tile 不渲染 |
| 5.2 | 相机系统 | 实现相机平移、缩放和 Agent 跟随 | 鼠标拖拽平移；鼠标滚轮缩放（0.5x-2.0x）；点击 Agent 列表中的 Agent 可以跟随；跟随使用 lerp 平滑过渡 | 1 人天 | 相机可以自由平移和缩放；跟随 Agent 时相机平滑移动；缩放有边界限制 |
| 5.3 | Agent 精灵渲染 | 在地图上渲染 Agent 精灵，支持 4 方向行走动画和空闲动画 | 每个 Agent 一个 AnimatedSprite；4 方向 x 4 帧行走动画（使用免费像素素材或纯色圆形+方向箭头的 placeholder）；名字标签显示在精灵上方；根据后端推送的位置数据实时更新精灵位置（lerp 插值） | 2 人天 | Agent 精灵正确显示在地图上的等距位置；移动时播放行走动画且方向正确；名字标签清晰可读 |
| 5.4 | WebSocket 状态同步 | 前端接收后端 Tick 更新，同步 Agent 位置和状态 | Zustand store 维护 `agentStates: Map<id, { x, y, name, status, ... }>`；WebSocket 消息处理：`world:tick` -> 更新所有 Agent 位置；`agent:talked` -> 显示对话气泡；requestAnimationFrame 中用 lerp 插值平滑移动 | 1 人天 | 前端 Agent 位置与后端同步，延迟 < 200ms；位置过渡平滑无跳跃 |
| 5.5 | 对话气泡 UI | 当 Agent 说话时，在其头顶显示对话气泡 | PixiJS Graphics 绘制气泡背景 + Text 显示内容；气泡宽度自适应文本长度（最大 200px）；气泡显示 3 秒后自动淡出；对话进行中的两个 Agent 之间显示连接线 | 1 人天 | 对话内容正确显示在 Agent 头顶；气泡定时消失；多个 Agent 同时对话不重叠 |
| 5.6 | 叙事流窗口 | 右侧或底部固定面板，实时显示选中 Agent 的叙事文本流 | React 组件，类似聊天记录的滚动列表；点击 Agent 切换显示其叙事流；每条叙事标注 Tick 号和时间戳；叙事文本使用打字机效果逐字显示；最多保留最近 50 条 | 1.5 人天 | 叙事文本实时显示且自动滚动；打字机效果流畅；切换 Agent 显示不同叙事；旧叙事可以回滚查看 |
| 5.7 | Agent 列表面板 | 左侧面板显示所有 Agent 列表，包含名称、状态、当前行为 | React 组件；每个 Agent 一行：头像占位 + 名字 + 当前状态文字（"移动中"/"对话中"/"闲逛中"）；点击 Agent 触发相机跟随 + 切换叙事流 | 1 人天 | 所有 Agent 正确显示；状态实时更新；点击交互正常 |
| 5.8 | 基础美术资源 | 准备 MVP 需要的最小美术素材集 | 使用免费像素风素材包（如 LPC 或 kenney.nl）；需要：2-3 种地面 Tile（64x32 等距）、Agent 角色 sprite sheet（4 方向行走）、简单建筑占位（喷泉、树、长椅）；如果短时间找不到合适素材，用纯色几何图形 placeholder | 1.5 人天 | 所有渲染元素有可接受的视觉表现（哪怕是 placeholder）；等距视角的素材尺寸正确 |

**Module 5 总工时：11 人天**

---

### Module 6: 集成联调与 Demo 打磨

**一句话描述**：将所有模块集成为完整可运行的 Demo，调试认知循环的端到端流程，优化叙事质量和 Agent 行为表现。

**依赖模块**：Module 1-5 全部

**交付产物**：可演示的完整 MVP Demo，5 个 Agent 自主行为，观众可以通过浏览器观看和交互。

#### 任务拆解

| Task | 名称 | 描述 | 技术方案要点 | 预估工时 | 验收标准 |
|------|------|------|-------------|----------|----------|
| 6.1 | 端到端集成 | 将世界引擎、叙事引擎、认知运行时、前端渲染串联为完整流程 | 启动流程：初始化 SQLite -> 注册 5 个 Mock Agent -> 启动 World Tick -> 前端连接 WebSocket；调试完整链路：Tick -> 叙事生成 -> LLM 调用 -> Intent 执行 -> 状态推送 -> 前端渲染 | 2 人天 | `pnpm dev` 一键启动后，浏览器打开即可看到 5 个 Agent 在地图上自主活动 |
| 6.2 | 叙事 Prompt 调优 | 反复测试和优化叙事模板和 LLM System Prompt，让 Agent 行为更自然有趣 | 迭代优化方向：(1) System Prompt 中强调角色扮演和决策合理性；(2) 行动空间描述措辞调优；(3) 叙事模板文学性调优；(4) 增加"内心独白"的引导让 Agent 输出有趣的思考过程 | 2 人天 | Agent 行为看起来合理且有个性差异；内心独白有趣可读；不会出现明显的"AI 味"重复模式 |
| 6.3 | 边界情况处理 | 处理各种边界情况和异常恢复 | LLM 超时/失败 -> Agent 默认 idle；LLM 返回无效格式 -> 降级为 wander；两个 Agent 同时想和对方说话 -> 先收到请求的发起对话；Agent 移动目标不可达 -> 重新选择附近随机位置 | 1 人天 | 系统在各种异常情况下不崩溃；有合理的降级行为；错误日志完整 |
| 6.4 | 性能与稳定性 | 确保系统可以稳定运行 4 小时以上，前端帧率 >= 30 FPS | 检查内存泄漏（叙事文本累积、WebSocket 消息队列增长）；限制叙事日志保存数量；确保 SQLite 写入不阻塞主循环；前端对象池（如果需要） | 1 人天 | 连续运行 4 小时不崩溃；内存使用稳定；前端帧率稳定 >= 30 FPS |
| 6.5 | Demo 页面打磨 | 添加 Demo 说明页、一键启动按钮、简单的运行状态指示 | 顶部状态栏显示：当前 Tick、在线 Agent 数、系统运行时间；底部添加简单操作说明；启动页面简要说明 Demo 目的和操作方式 | 1 人天 | 第一次打开页面的人能在 30 秒内理解这是什么并开始观看；运行状态一目了然 |

**Module 6 总工时：7 人天**

---

### MVP 总工时汇总

| 模块 | 工时 | 占比 |
|------|------|------|
| Module 1: 基础工程脚手架 | 4 人天 | 9.5% |
| Module 2: 世界引擎与地图 | 4.5 人天 | 10.7% |
| Module 3: 叙事引擎 | 6 人天 | 14.3% |
| Module 4: Agent 认知运行时 | 10.5 人天 | 25.0% |
| Module 5: 前端渲染与 UI | 11 人天 | 26.2% |
| Module 6: 集成联调与 Demo 打磨 | 7 人天 | 16.7% |
| **合计** | **43 人天** | **100%** |

按 2 人团队计算约 **5-6 周**（含 buffer）；按 3 人团队计算约 **4-5 周**。

---

## 5. CognitivePacket 协议 MVP 规范

### 5.1 MVP 阶段 CognitivePacket 类型

```typescript
/** MVP 版 CognitivePacket —— 每个决策周期推送给 Agent 的输入 */
interface CognitivePacketMVP {
  /** 当前 World Tick 序号 */
  worldTick: number;

  /** 小镇时间描述（MVP 固定为"下午"） */
  worldTimeDescription: string;

  /** ===== 叙事部分（MVP 仅 2 类） ===== */

  /** 环境叙事：描述 Agent 当前位置和周围环境 */
  environmentNarration: string;

  /** 社交叙事：描述感知范围内其他 Agent 的状态 */
  socialNarration: string;

  /** ===== 行动空间 ===== */

  /** 当前可选行动列表 */
  actionSpace: ActionOptionMVP[];

  /** ===== 记忆（MVP 用固定 mock） ===== */

  /** 预设记忆片段（3 条） */
  memories: string[];

  /** ===== 角色信息 ===== */

  /** Agent 角色简述（替代完整 Persona） */
  agentBio: string;

  /** Agent 当前状态 */
  agentStatus: {
    /** 当前位置区域描述 */
    locationDescription: string;
    /** 是否正在对话中 */
    isInConversation: boolean;
    /** 当前对话对象名字（如有） */
    conversationPartner?: string;
  };
}
```

### 5.2 MVP 阶段 ActionOption 类型

```typescript
/** MVP 版行动选项 */
interface ActionOptionMVP {
  /** 行动唯一 ID */
  id: string;
  /** 行动类型 */
  type: 'move' | 'social' | 'idle' | 'free';
  /** 行动的自然语言描述 */
  description: string;
  /** 行动参数定义（可选） */
  parameters?: ActionParameterMVP[];
}

interface ActionParameterMVP {
  name: string;
  type: 'string' | 'number';
  description: string;
  required: boolean;
}
```

### 5.3 MVP 阶段 AgentIntent 类型

```typescript
/** MVP 版 Agent 意图 —— Agent 的行动决策输出 */
interface AgentIntentMVP {
  /** 选择的行动 ID（对应 ActionOptionMVP.id） */
  actionId: string;
  /** 行动参数 */
  parameters?: Record<string, unknown>;
  /** 对话内容（选择社交行动时必填） */
  speechContent?: string;
  /** 内心独白（可选，用于调试和展示） */
  innerMonologue?: string;
}
```

### 5.4 MVP 支持的行动类型完整列表

| 行动 ID 模式 | 类型 | 描述 | 参数 |
|-------------|------|------|------|
| `move_to_{locationName}` | move | 移动到指定位置 | 无（目标坐标内置在 ID 中） |
| `talk_to_{agentId}` | social | 走向目标 Agent 并发起对话 | `topic?: string`（可选话题） |
| `reply_{agentId}` | social | 在进行中的对话中回复 | 必须包含 `speechContent` |
| `end_conversation` | social | 结束当前对话 | 无 |
| `wander` | idle | 在附近随机闲逛 | 无 |
| `observe` | idle | 原地观察周围环境 | 无 |
| `free_action` | free | 自由描述意图 | `freeFormIntent: string` |

### 5.5 完整 CognitivePacket 示例

以下是一个完整的示例，展示 Agent "Alice" 在中央广场收到的 CognitivePacket：

```json
{
  "worldTick": 1024,
  "worldTimeDescription": "小镇时间：下午，天气晴朗。",
  "environmentNarration": "你站在中央广场的喷泉旁。阳光洒在石板路上，喷泉的水声清脆悦耳。广场中央矗立着一块布告板，上面贴着几张通知。广场北侧有几棵大树，树荫下摆着长椅。东南方向可以看到一排整齐的建筑轮廓。",
  "socialNarration": "Bob 正坐在广场北侧的长椅上，似乎在发呆。他离你大约 5 步远。再远一些，Charlie 正沿着广场西侧的小路缓步走来，手里好像拿着什么东西。广场上暂时没有其他人。",
  "actionSpace": [
    {
      "id": "talk_to_agt_bob",
      "type": "social",
      "description": "走向长椅上的 Bob，和他打个招呼聊聊天"
    },
    {
      "id": "talk_to_agt_charlie",
      "type": "social",
      "description": "等 Charlie 走近一些，然后和他打招呼"
    },
    {
      "id": "move_to_notice_board",
      "type": "move",
      "description": "走到布告板前看看有什么新消息"
    },
    {
      "id": "move_to_north_trees",
      "type": "move",
      "description": "走到北侧的大树下乘凉"
    },
    {
      "id": "wander",
      "type": "idle",
      "description": "在广场上随意走走，四处看看"
    },
    {
      "id": "observe",
      "type": "idle",
      "description": "站在原地，观察周围的环境和人"
    },
    {
      "id": "free_action",
      "type": "free",
      "description": "（你可以描述任何你想做的其他事情）",
      "parameters": [
        { "name": "freeFormIntent", "type": "string", "description": "描述你想做的事", "required": true }
      ]
    }
  ],
  "memories": [
    "昨天和 Bob 在广场聊过关于小镇历史的话题，他对建筑很感兴趣。",
    "前天在广场散步时看到 Charlie 在写东西，似乎是在做研究。",
    "自己刚搬来小镇不久，还在熟悉环境。"
  ],
  "agentBio": "你是 Alice，一个充满好奇心的探索者。你喜欢认识新朋友、了解新事物，性格开朗但偶尔也享受独处。",
  "agentStatus": {
    "locationDescription": "中央广场，喷泉旁",
    "isInConversation": false
  }
}
```

### 5.6 Agent 返回 Intent 示例

Alice 的 LLM 基于上述 CognitivePacket 推理后，可能返回：

```json
{
  "actionId": "talk_to_agt_bob",
  "parameters": { "topic": "小镇的建筑" },
  "speechContent": "嗨 Bob！一个人坐在这儿呢？昨天你跟我说的那个关于广场喷泉的故事，我回去想了好久——这个喷泉真的是小镇建成的时候就有的吗？",
  "innerMonologue": "Bob 一个人坐在长椅上看起来有点无聊，昨天我们聊得挺开心的，而且我确实对小镇的历史很好奇。Charlie 还在走过来的路上，等会儿再跟他打招呼也不迟。"
}
```

---

## 6. Narration Engine MVP 设计

### 6.1 叙事方案选择

| 方案 | 优点 | 缺点 | MVP 适合度 |
|------|------|------|-----------|
| **Prompt 模板插值** | 实现简单、延迟低（< 10ms）、成本零、可控性强 | 文本模式化、表达力有限 | **选用** |
| 规则引擎 | 灵活度较高 | 实现复杂度中等 | 不选 |
| LLM 生成叙事 | 文本最自然 | 每 Tick 都要调 LLM，延迟高、成本高 | 不选（成本不可接受） |

**决策理由**：MVP 阶段叙事引擎的核心目标是"让 LLM 能理解世界状态并做出合理决策"，而不是"产生文学级别的叙事文本"。Prompt 模板方案可以在零 LLM 调用成本下生成足够好的叙事输入。后续 Alpha 阶段可以对高优先级事件引入 LLM 辅助生成。

### 6.2 叙事生成的具体 Prompt 设计

#### 6.2.1 环境叙事模板

```typescript
const ENVIRONMENT_TEMPLATES: Record<string, string> = {
  // 广场中央
  'plaza_center': '你站在中央广场的喷泉旁。{weatherDesc}。喷泉的水声{fountainAdj}。{surroundingDesc}。',

  // 广场边缘
  'plaza_edge': '你在中央广场的{direction}边缘。{weatherDesc}。{nearbyFeature}。{distantView}。',

  // 路径上
  'path': '你正走在{pathDesc}的小路上。{weatherDesc}。{pathSideDesc}。',

  // 建筑旁
  'near_building': '你站在{buildingName}附近。{buildingDesc}。{weatherDesc}。',

  // 默认
  'default': '你在小镇的一角。{weatherDesc}。四周{ambientDesc}。',
};

// 变量池
const WEATHER_DESC = '阳光洒在石板路上，微风轻拂';  // MVP 固定晴天
const FOUNTAIN_ADJS = ['清脆悦耳', '叮咚作响', '轻轻回荡'];
const SURROUNDING_DESCS = [
  '广场中央矗立着一块布告板，上面贴着几张通知',
  '几只鸟停在喷泉边缘，偶尔扑腾翅膀',
  '远处的建筑在阳光下投出长长的影子',
];
```

#### 6.2.2 社交叙事模板

```typescript
const SOCIAL_TEMPLATES = {
  // 附近有 Agent
  'agent_nearby': '{agentName}正在{distanceDesc}{activityDesc}。{relationshipHint}。',

  // Agent 正在移动
  'agent_moving': '{agentName}正{movingDesc}，{directionDesc}。',

  // Agent 正在对话
  'agent_talking': '{agentName}正和{otherName}在{locationDesc}交谈，{conversationHint}。',

  // 附近无人
  'nobody_around': '周围暂时没有其他人，{ambientDesc}。',
};

// 距离描述
function getDistanceDesc(tiles: number): string {
  if (tiles <= 2) return '就在你身旁';
  if (tiles <= 4) return '离你几步远的地方';
  if (tiles <= 6) return '不远处';
  return '稍远的地方';
}

// 关系提示
function getRelationshipHint(affinity: number, agentName: string): string {
  if (affinity >= 30) return `你和${agentName}关系不错`;
  if (affinity >= 10) return `你和${agentName}见过几次面`;
  if (affinity <= -10) return `你对${agentName}印象不太好`;
  return `你对${agentName}还不太了解`;
}
```

#### 6.2.3 LLM System Prompt（Agent 决策用）

```typescript
const AGENT_SYSTEM_PROMPT = `你是{agentName}，一个生活在 Agora Town 小镇中的居民。

你的背景：{agentBio}

你正在小镇中生活。每隔一段时间，你会收到关于周围环境和人物的描述，以及一个可选行动列表。

你需要：
1. 仔细阅读环境和社交描述，理解当前的情境
2. 结合你的性格和记忆，从行动列表中选择一个最合理的行动
3. 如果你选择社交行动（和人说话），请在 speechContent 中写出你会说的具体内容
4. 在 innerMonologue 中简短描述你做出这个选择的原因（1-2 句话）

重要原则：
- 你的行为应该符合你的角色设定
- 不要总是选择同一个行动，保持行为多样性
- 对话要自然，像真实的人际交流
- 如果没什么特别想做的，选择闲逛或观察也完全可以
- 不要生成任何超出小镇世界观的内容

请以 JSON 格式返回你的决策。`;
```

### 6.3 Token 预算管理策略（MVP 简化版）

```typescript
const MVP_TOKEN_BUDGET = {
  /** 总预算（给 LLM 的 user message 部分） */
  total: 1500,

  /** 各部分分配 */
  allocation: {
    environmentNarration: 300,    // ~150 中文字
    socialNarration: 400,         // ~200 中文字
    actionSpace: 400,             // 7 个选项约 400 tokens
    memories: 200,                // 3 条简短记忆
    agentBio: 100,                // 角色简述
    statusAndMeta: 100,           // 状态信息和格式开销
  },

  /** 超预算处理：简单截断 */
  onOverBudget(section: string, text: string, limit: number): string {
    // 按字符数粗略截断（中文 1 字约 2 tokens）
    const charLimit = Math.floor(limit / 2);
    if (text.length > charLimit) {
      return text.slice(0, charLimit - 3) + '...';
    }
    return text;
  }
};
```

### 6.4 性能考量：避免每 Tick 都调 LLM

这是 MVP 阶段最关键的性能决策。方案如下：

```
World Tick (2 TPS, 每 500ms)
    │
    ├── Tick 1: 更新移动位置（纯机械计算，不调 LLM）
    ├── Tick 2: 更新移动位置
    ├── Tick 3: 更新移动位置
    ├── Tick 4: 更新移动位置
    └── Tick 5: ★ 认知决策点（调 LLM）★
         ├── 生成 CognitivePacket（模板插值，< 10ms）
         ├── 调用 OpenAI API（1-3 秒）
         ├── 解析 Intent + 执行行动
         └── 结果推送给前端

→ 每个 Agent 每 2.5 秒做一次 LLM 决策
→ 5 个 Agent 串行处理，每个决策周期最多 5 x 3s = 15s
→ 但实际上 OpenAI API 可以并行调用，5 个 Agent 并行 ≈ 3-5s
```

**优化策略**：

1. **并行 LLM 调用**：5 个 Agent 的 LLM 请求使用 `Promise.allSettled` 并行发送
2. **Agent 状态判断跳过**：如果 Agent 正在移动且未到达目标，跳过本次认知循环
3. **对话中的 Agent 走专用路径**：对话中的 Agent 不走通用认知循环，而是走对话轮次逻辑
4. **idle Agent 延长间隔**：连续选择 idle/observe 的 Agent，将其决策间隔延长到每 10 个 Tick

---

## 7. 地图与渲染 MVP 设计

### 7.1 MVP 地图范围

| 参数 | MVP 值 | PRD 完整值 |
|------|--------|-----------|
| 地图大小 | 64 x 64 Tiles | 256 x 256 Tiles |
| Tile 尺寸 | 64 x 32 px | 64 x 32 px |
| 区域数量 | 1（中央广场） | 5 + 2 特殊 |
| 建筑数量 | 3-5 个占位建筑 | 20+ |
| 可交互建筑 | 0 | 10+ |

**地图布局设计**：

```
64x64 Tile 地图布局:

    0         16        32        48        63
    ┌─────────┬─────────┬─────────┬─────────┐
 0  │ 草地     │ 草地     │ 草地     │ 草地     │
    │ (装饰)   │ (装饰)   │ (装饰)   │ (装饰)   │
    │         │         │         │         │
16  ├─────────┼─────────┼─────────┼─────────┤
    │ 建筑A    │ ★中央★  │ ★广场★  │ 建筑B    │
    │ (占位)   │  喷泉    │  长椅    │ (占位)   │
    │         │  石板路   │  石板路   │         │
32  ├─────────┼─────────┼─────────┼─────────┤
    │ 草地     │ ★广场★  │ ★布告★  │ 草地     │
    │ (树)    │  石板路   │  板     │ (树)    │
    │         │         │         │         │
48  ├─────────┼─────────┼─────────┼─────────┤
    │ 草地     │ 建筑C    │ 草地     │ 草地     │
    │ (装饰)   │ (占位)   │ (装饰)   │ (装饰)   │
    │         │         │         │         │
63  └─────────┴─────────┴─────────┴─────────┘

核心区域（20x20 中央广场）:
- 喷泉（中心 2x2 不可通行）
- 长椅 x 4（可站立旁边的兴趣点）
- 布告板 x 1（兴趣点）
- 石板路（walkable）
- 大树 x 4（广场四角装饰，不可通行）
```

### 7.2 Tile 地图规格

```typescript
/** MVP Tile 类型 */
enum TileType {
  GRASS = 0,        // 草地（可通行）
  STONE_PATH = 1,   // 石板路（可通行）
  WATER = 2,        // 水面（不可通行）
  BUILDING = 3,     // 建筑占位（不可通行）
  TREE = 4,         // 树木（不可通行）
  DECORATION = 5,   // 装饰物（不可通行）
}

/** MVP Tile 数据 */
interface TileMVP {
  type: TileType;
  walkable: boolean;
  /** 兴趣点名称（如 "fountain", "bench_north", "notice_board"） */
  poiName?: string;
  /** 兴趣点叙事描述（用于环境叙事） */
  poiDescription?: string;
}
```

### 7.3 最小美术资源列表

| 资源 | 规格 | 数量 | 来源方案 |
|------|------|------|----------|
| 地面 Tile - 草地 | 64x32 px 等距 | 2 变体 | 免费素材/Kenney.nl |
| 地面 Tile - 石板路 | 64x32 px 等距 | 2 变体 | 免费素材 |
| 地面 Tile - 水面 | 64x32 px 等距 | 1 | 免费素材 |
| 喷泉 | 128x128 px | 1 | 免费素材/简单绘制 |
| 长椅 | 64x64 px | 1 | 免费素材/简单绘制 |
| 树木 | 64x96 px | 2 变体 | 免费素材 |
| 建筑占位 | 128x128 px | 3 变体 | 纯色方块 + 文字标签 |
| Agent 角色 | 32x48 px sprite sheet | 5 个（可复用调色） | 免费像素角色素材 |
| Agent 行走动画 | 4 方向 x 4 帧 | 每角色 16 帧 | 同上 |
| 对话气泡 | 动态大小 | 1 模板 | PixiJS Graphics 绘制 |
| 名字标签 | 动态 | 1 模板 | PixiJS Text |

**备选方案（无美术资源时）**：使用纯色圆形代替 Agent（不同颜色区分），矩形代替建筑，绿色代替草地，灰色代替路面。虽然视觉效果差，但完全不影响核心验证。

### 7.4 PixiJS 渲染最小实现

```typescript
/** MVP 渲染管理器 */
class MVPRenderer {
  private app: PIXI.Application;
  private groundLayer: PIXI.Container;   // 地面层
  private entityLayer: PIXI.Container;   // 实体层（Agent + 建筑）
  private uiLayer: PIXI.Container;       // UI 层（气泡 + 标签）

  /** 初始化 */
  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.app = new PIXI.Application();
    await this.app.init({
      canvas,
      width: window.innerWidth * 0.7,  // 右侧 30% 留给 UI
      height: window.innerHeight,
      backgroundColor: 0x87CEEB,        // 天蓝色背景
      antialias: true,
    });

    this.groundLayer = new PIXI.Container();
    this.entityLayer = new PIXI.Container();
    this.entityLayer.sortableChildren = true;  // 按 zIndex 排序
    this.uiLayer = new PIXI.Container();

    this.app.stage.addChild(this.groundLayer, this.entityLayer, this.uiLayer);
  }

  /** 渲染地面 Tile（仅视口内） */
  renderGround(tileMap: TileMVP[][], camera: Camera): void {
    // 计算视口内 Tile 范围
    const { minTileX, maxTileX, minTileY, maxTileY } = camera.getVisibleTileRange();

    for (let y = minTileY; y <= maxTileY; y++) {
      for (let x = minTileX; x <= maxTileX; x++) {
        const tile = tileMap[y]?.[x];
        if (!tile) continue;
        const { screenX, screenY } = cartToIso(x, y);
        // 绘制 Tile 精灵
        this.drawTile(screenX, screenY, tile.type);
      }
    }
  }

  /** 更新 Agent 精灵位置 */
  updateAgent(agentId: string, x: number, y: number, direction: number): void {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;

    const { screenX, screenY } = cartToIso(x, y);
    sprite.position.set(screenX, screenY);
    sprite.zIndex = screenY;  // 深度排序
    // 更新行走动画方向
    this.updateWalkAnimation(sprite, direction);
  }
}
```

### 7.5 ECS 组件和 System 最小集合

MVP 阶段不使用 bitECS 的 SoA 架构（5 个 Entity 不需要），而是用简化的面向对象 ECS：

```typescript
/** MVP 简化 ECS —— 组件 */

interface PositionComponent {
  x: number;
  y: number;
}

interface MovementComponent {
  targetX: number;
  targetY: number;
  path: Array<{ x: number; y: number }>;
  pathIndex: number;
  speed: number;         // Tiles per second
  isMoving: boolean;
}

interface RenderComponent {
  spriteId: string;
  direction: 0 | 1 | 2 | 3;  // 上右下左
  isAnimating: boolean;
}

interface AgentInfoComponent {
  agentId: string;
  name: string;
  bio: string;
  status: 'idle' | 'moving' | 'talking' | 'wandering';
}

interface ConversationComponent {
  partnerId: string | null;
  conversationId: string | null;
}

/** MVP 简化 ECS —— System */

// 移动系统：每帧更新位置
function movementSystem(entities: Entity[], deltaTime: number): void;

// 渲染同步系统：同步位置到 PixiJS Sprite
function renderSyncSystem(entities: Entity[], renderer: MVPRenderer): void;

// 动画系统：更新行走动画帧
function animationSystem(entities: Entity[], deltaTime: number): void;
```

---

## 8. 数据模型 MVP

### 8.1 最小数据表

MVP 仅需 4 张表 + 1 张配置表：

### 8.2 Schema 定义（Drizzle ORM + SQLite）

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

/** Agent 主表 */
export const agents = sqliteTable('agents', {
  /** 唯一标识 agt_<ulid> */
  id: text('id').primaryKey(),
  /** Agent 名字 */
  name: text('name').notNull(),
  /** 角色描述 */
  bio: text('bio').notNull(),
  /** System Prompt（LLM 用） */
  systemPrompt: text('system_prompt').notNull(),
  /** 当前 X 坐标 */
  positionX: real('position_x').notNull().default(32),
  /** 当前 Y 坐标 */
  positionY: real('position_y').notNull().default(32),
  /** 当前状态 */
  status: text('status').notNull().default('idle'),
  /** 是否在线 */
  isOnline: integer('is_online', { mode: 'boolean' }).notNull().default(true),
  /** 头像颜色（MVP 用颜色区分 Agent） */
  avatarColor: text('avatar_color').notNull().default('#4ade80'),
  /** 创建时间 */
  createdAt: text('created_at').notNull().default(new Date().toISOString()),
});

/** 关系表（简化版） */
export const relationships = sqliteTable('relationships', {
  id: text('id').primaryKey(),
  agentAId: text('agent_a_id').notNull().references(() => agents.id),
  agentBId: text('agent_b_id').notNull().references(() => agents.id),
  /** 好感度 -100 到 100 */
  affinity: integer('affinity').notNull().default(0),
  /** 最后交互时间 */
  lastInteractionAt: text('last_interaction_at'),
});

/** 对话表 */
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  /** 参与者 A */
  agentAId: text('agent_a_id').notNull().references(() => agents.id),
  /** 参与者 B */
  agentBId: text('agent_b_id').notNull().references(() => agents.id),
  /** 对话状态 */
  status: text('status').notNull().default('active'),
  /** 已完成轮次 */
  turnCount: integer('turn_count').notNull().default(0),
  /** 开始 Tick */
  startTick: integer('start_tick').notNull(),
  /** 结束 Tick */
  endTick: integer('end_tick'),
  /** 创建时间 */
  createdAt: text('created_at').notNull().default(new Date().toISOString()),
});

/** 消息表 */
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  senderId: text('sender_id').notNull().references(() => agents.id),
  /** 消息内容 */
  content: text('content').notNull(),
  /** 内心独白（调试用） */
  innerMonologue: text('inner_monologue'),
  /** 消息 Tick */
  worldTick: integer('world_tick').notNull(),
  createdAt: text('created_at').notNull().default(new Date().toISOString()),
});

/** 叙事日志表（调试和回放用） */
export const narrationLogs = sqliteTable('narration_logs', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  worldTick: integer('world_tick').notNull(),
  /** 推送的 CognitivePacket 叙事文本 */
  narrationText: text('narration_text').notNull(),
  /** Agent 返回的 Intent JSON */
  agentIntentJson: text('agent_intent_json'),
  /** 是否验证通过 */
  intentValid: integer('intent_valid', { mode: 'boolean' }),
  /** 执行结果 */
  executionResult: text('execution_result'),
  createdAt: text('created_at').notNull().default(new Date().toISOString()),
});
```

### 8.3 是否需要 pgvector

**MVP 阶段不需要。** 理由：

1. MVP 不实现记忆系统——使用 3 条固定的 mock 记忆字符串
2. 没有向量检索需求
3. SQLite 没有原生的 pgvector 扩展
4. Alpha 阶段实现记忆协议时，再切换到 PostgreSQL + pgvector

---

## 9. Agent 入驻 MVP 流程

### 9.1 简化流程

MVP 阶段不需要外部 Agent 框架接入。所有 Agent 都是系统内置的 Mock Agent，通过配置文件注册。

```
启动时自动注册 → 写入 SQLite → 放置在地图上 → 开始认知循环
```

### 9.2 Mock Agent 配置

```typescript
/** MVP Agent 预设配置 */
const MOCK_AGENTS: AgentConfig[] = [
  {
    id: 'agt_alice',
    name: 'Alice',
    bio: '一个充满好奇心的探索者，刚搬来小镇不久。喜欢认识新朋友、了解新事物，性格开朗但偶尔也享受独处思考。',
    avatarColor: '#4ade80',  // 绿色
    spawnPosition: { x: 30, y: 30 },
    mockMemories: [
      '昨天和 Bob 在广场聊过关于小镇历史的话题，他对建筑很感兴趣。',
      '前天散步时看到 Charlie 在写东西，似乎是在做研究。',
      '自己刚搬来小镇不久，还在熟悉环境，对一切都很好奇。',
    ],
  },
  {
    id: 'agt_bob',
    name: 'Bob',
    bio: '一个友善热心的老居民，在小镇住了很久，了解各种趣闻。喜欢和人聊天，尤其爱分享小镇的历史故事。性格温和但有时话多。',
    avatarColor: '#60a5fa',  // 蓝色
    spawnPosition: { x: 35, y: 28 },
    mockMemories: [
      '昨天和新来的 Alice 聊了小镇广场的历史，她很感兴趣的样子。',
      '上周帮 Charlie 搬了一些书到广场的长椅上，他说在做某个研究。',
      '最近广场附近来了两个新居民 Diana 和 Eve，还没机会好好认识。',
    ],
  },
  {
    id: 'agt_charlie',
    name: 'Charlie',
    bio: '一个安静的学者型 Agent，喜欢独自思考和做研究。不太主动社交，但被搭话时会认真回应。对知识有强烈的追求，正在研究某个课题。',
    avatarColor: '#a78bfa',  // 紫色
    spawnPosition: { x: 25, y: 35 },
    mockMemories: [
      '正在研究一个关于 AI Agent 社会行为的课题，需要更多观察数据。',
      'Bob 是个不错的信息来源，他了解很多小镇的掌故。',
      '昨天在长椅上思考时被打断了几次，也许该找个更安静的地方。',
    ],
  },
  {
    id: 'agt_diana',
    name: 'Diana',
    bio: '三天前才搬来的新居民，性格有些内向害羞。对小镇的一切感到陌生和好奇，渴望融入但不知道怎么主动接触别人。',
    avatarColor: '#fb923c',  // 橙色
    spawnPosition: { x: 33, y: 36 },
    mockMemories: [
      '三天前搬到小镇，一切都还很陌生。',
      '在广场远远看到过几个人在聊天，但不好意思上前打招呼。',
      '听说这个小镇的居民都很友善，希望能交到朋友。',
    ],
  },
  {
    id: 'agt_eve',
    name: 'Eve',
    bio: '一个热情外向的社交达人，最近搬来小镇。喜欢认识新朋友、组织活动，精力充沛，总是第一个打招呼的人。有时候热情过头会让人有点招架不住。',
    avatarColor: '#f472b6',  // 粉色
    spawnPosition: { x: 37, y: 33 },
    mockMemories: [
      '刚搬来几天就认识了好几个人，这个小镇的人都还不错。',
      '昨天主动跟 Bob 聊了会儿，他人很好，告诉了我很多小镇的情况。',
      '想找机会和大家一起做点什么有趣的事情。',
    ],
  },
];
```

### 9.3 是否支持外部 Agent 框架

**MVP 阶段不支持。** 所有 Agent 都在服务端进程内运行，直接调用 OpenAI API。

但是，架构上预留 `IAgentAdapter` 接口，确保后续接入外部 Agent 框架时不需要重写核心逻辑：

```typescript
/** Agent 适配器接口（MVP 仅实现 MockAdapter） */
interface IAgentAdapter {
  /** 将 CognitivePacket 发送给 Agent 并获取 Intent */
  sendAndReceive(packet: CognitivePacketMVP): Promise<AgentIntentMVP>;
}

/** MVP Mock 适配器：直接调用 OpenAI API */
class MockOpenAIAdapter implements IAgentAdapter {
  constructor(private agentConfig: AgentConfig, private openai: OpenAI) {}

  async sendAndReceive(packet: CognitivePacketMVP): Promise<AgentIntentMVP> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: this.buildSystemPrompt() },
        { role: 'user', content: this.formatPacketAsPrompt(packet) },
      ],
      tools: this.buildToolDefinitions(packet.actionSpace),
      tool_choice: 'required',
      temperature: 0.8,
      max_tokens: 300,
    });
    return this.parseResponse(response);
  }
}

/** 未来：外部 REST 适配器 */
// class ExternalRESTAdapter implements IAgentAdapter { ... }
```

### 9.4 Agent 注册最小接口

MVP 阶段注册通过配置文件自动完成，但仍然定义 tRPC 接口供调试用：

```typescript
// tRPC Router
const agentRouter = router({
  /** 获取所有 Agent 列表 */
  list: publicProcedure.query(async () => {
    return db.select().from(agents);
  }),

  /** 获取单个 Agent 状态 */
  getStatus: publicProcedure
    .input(z.string())
    .query(async ({ input: agentId }) => {
      return db.select().from(agents).where(eq(agents.id, agentId)).get();
    }),

  /** 获取 Agent 的最近叙事日志 */
  getNarrationLogs: publicProcedure
    .input(z.object({
      agentId: z.string(),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      return db.select()
        .from(narrationLogs)
        .where(eq(narrationLogs.agentId, input.agentId))
        .orderBy(desc(narrationLogs.worldTick))
        .limit(input.limit);
    }),
});
```

---

## 10. 开发排期与里程碑

### 10.1 团队假设

- **2 人全栈团队**（开发者 A 偏后端/AI，开发者 B 偏前端/渲染）
- 每人每周有效工作日 4.5 天（扣除会议和其他事务）
- 每人每天有效编码时间约 6 小时

### 10.2 周计划

```
Week 1: 基础工程 + 世界引擎
  ├── 开发者 A: Module 1 全部 (Task 1.1-1.5) + Module 2 (Task 2.1-2.2)
  ├── 开发者 B: Module 5 (Task 5.1 地图渲染 + Task 5.8 素材准备)
  └── 交付: 项目骨架可运行，前端显示空白等距地图，后端 Tick 在跑

Week 2: 世界引擎完善 + 叙事引擎启动
  ├── 开发者 A: Module 2 (Task 2.3-2.5) + Module 3 (Task 3.1)
  ├── 开发者 B: Module 5 (Task 5.2 相机 + Task 5.3 Agent 精灵)
  └── 交付: Agent 可以在地图上移动（后端寻路 + 前端渲染），环境叙事可生成

Week 3: 叙事引擎完成 + 认知运行时启动
  ├── 开发者 A: Module 3 (Task 3.2-3.5) + Module 4 (Task 4.1)
  ├── 开发者 B: Module 5 (Task 5.4 WebSocket 同步 + Task 5.5 对话气泡)
  └── 交付: 完整 CognitivePacket 可生成，Mock Agent 已注册，前端实时同步

Week 4: 认知运行时核心（最关键的一周）
  ├── 开发者 A: Module 4 (Task 4.2 循环驱动器 + Task 4.3 LLM 调用层)
  ├── 开发者 B: Module 5 (Task 5.6 叙事流窗口 + Task 5.7 Agent 列表)
  └── ★ 里程碑 1: 第一次看到 Agent 自主行动 ★
  └── 交付: Agent 收到叙事 -> LLM 推理 -> 返回 Intent -> 在地图上移动。首次 E2E 跑通！

Week 5: 认知运行时完善 + 对话系统
  ├── 开发者 A: Module 4 (Task 4.4-4.5 Intent 验证+行动执行 + Task 4.6 对话引擎)
  ├── 开发者 B: Module 4 (Task 4.7 频率控制) + 前端对话 UI 完善
  └── ★ 里程碑 2: Agent 可以对话 ★
  └── 交付: Agent 可以移动、闲逛、发起对话、多轮交流

Week 6: 集成联调 + Demo 打磨
  ├── 开发者 A: Module 6 (Task 6.1 端到端集成 + Task 6.2 Prompt 调优)
  ├── 开发者 B: Module 6 (Task 6.3 边界情况 + Task 6.4 性能稳定性)
  └── 交付: 系统稳定运行，Agent 行为质量达标

Week 7 (Buffer): 收尾与演示准备
  ├── 开发者 A: Task 6.2 继续 Prompt 调优 + 修 Bug
  ├── 开发者 B: Task 6.5 Demo 页面打磨 + 修 Bug
  └── ★ 里程碑 3: MVP 完成，可 Demo ★
  └── 交付: 可向决策者演示的完整 Demo
```

### 10.3 关键里程碑

| 里程碑 | 时间 | 标志性事件 | 验收要求 |
|--------|------|-----------|----------|
| **M1: First Agent Move** | Week 4 末 | 第一次在浏览器中看到 Agent 基于 LLM 推理自主移动 | Agent 收到叙事 -> LLM 返回 move Intent -> Agent 在地图上移动到目标位置 |
| **M2: First Conversation** | Week 5 末 | 第一次看到两个 Agent 自主发起并完成对话 | Agent A 选择和 Agent B 对话 -> 多轮交流 -> 对话内容自然连贯 -> 对话结束后各自行动 |
| **M3: MVP Complete** | Week 7 末 | 完整可演示的 MVP Demo | 5 个 Agent 自主活动 4 小时无崩溃；行为多样且有趣；Demo 页面完善 |

### 10.4 风险预留

- Week 4（核心认知循环）难度最大，预留了整整一周做 Prompt 调优（Week 6）
- Week 7 是纯 buffer 周，用于处理 Week 1-6 中未完成或需要返工的任务
- 如果进度超前，Week 7 可以提前开始 Alpha 阶段的预研（如 pgvector 记忆系统原型）

---

## 11. 技术风险与应对

### 11.1 叙事引擎性能风险

**风险描述**：CognitivePacket 叙事文本的模板插值本身很快（< 10ms），但如果后续需要引入 LLM 辅助生成叙事（Alpha 阶段），每 Tick 的叙事生成延迟会急剧上升。

**当前影响（MVP）**：低。MVP 使用纯模板插值，无 LLM 调用。

**应对策略**：
1. MVP 阶段验证纯模板方案的叙事质量是否"够用"——如果 Agent 行为已经足够好，Alpha 阶段可能不需要 LLM 生成叙事
2. 如果必须引入 LLM 叙事，采用**分级策略**：低优先级场景用模板，高优先级事件（首次见面、重要对话等）才用 LLM
3. 叙事缓存：相同场景的叙事文本可以缓存复用（Agent 在同一位置且周围无变化时，直接复用上次叙事）

### 11.2 Agent 行为质量风险

**风险描述**：LLM 返回的 Intent 可能不合理——比如 Agent 反复选择同一行动、对话内容脱离角色设定、对叙事理解错误等。

**当前影响（MVP）**：高。这是 MVP 的核心验证点。

**应对策略**：
1. **System Prompt 精心设计**：明确告知 Agent 保持行为多样性，不要重复，要符合角色
2. **行为去重**：在行动空间计算中，如果 Agent 连续 3 次选择同类行动，降低该类行动的出现权重
3. **temperature 调参**：使用 0.7-0.9 的 temperature，在一致性和多样性之间平衡
4. **兜底机制**：如果 Intent 解析失败或完全不合理，回退到随机 wander，不要让 Agent 卡住
5. **Prompt 迭代**：预留 Week 6 专门做 Prompt 调优，这是一个需要反复实验的过程

### 11.3 LLM API 成本与延迟风险

**风险描述**：5 个 Agent 每 2.5 秒各调一次 OpenAI API，每小时约 7,200 次调用。使用 gpt-4o-mini，每次约 2000 input tokens + 300 output tokens，每小时约 1660 万 tokens。

**成本估算**：
- gpt-4o-mini 价格：$0.15/M input tokens, $0.60/M output tokens
- 每小时：16M input x $0.15/M + 2.16M output x $0.60/M = $2.4 + $1.3 = **约 $3.7/小时**
- 每天 8 小时测试：约 **$30/天**

**应对策略**：
1. 使用 gpt-4o-mini 而非 gpt-4o，成本降低 10-20 倍
2. 智能跳过：移动中/无变化时不触发 LLM，实际调用频率远低于理论值
3. 开发阶段可以设置"慢速模式"：决策间隔从 2.5 秒调到 10 秒，成本降到 1/4
4. 长期方案：评估开源本地模型（如 Llama 3）替代 OpenAI API

### 11.4 前端渲染性能风险

**风险描述**：等距地图渲染 + Agent 动画 + UI 更新可能导致帧率下降。

**当前影响（MVP）**：低。64x64 地图 + 5 个 Agent 的渲染量极小。

**应对策略**：
1. MVP 阶段仅做基础视口裁剪（不渲染视口外 Tile）
2. 如果出现性能问题，优先排查是否有不必要的重绘（PixiJS 的 `renderable` 属性控制）
3. Agent 精灵数量只有 5 个，不会是性能瓶颈
4. React UI 层使用 `React.memo` 避免不必要的重渲染

### 11.5 WebSocket 连接稳定性风险

**风险描述**：长时间运行后 WebSocket 连接可能断开，导致前端状态不同步。

**应对策略**：
1. 客户端实现自动重连机制（指数退避，最大间隔 30 秒）
2. 重连后请求全量状态快照（而非增量更新）
3. 前端显示连接状态指示器，断连时提示用户

### 11.6 SQLite 并发写入风险

**风险描述**：SQLite 在并发写入时可能出现锁定。

**当前影响（MVP）**：低。单进程单线程，写入量小。

**应对策略**：
1. 使用 WAL 模式（Write-Ahead Logging），提升并发读写性能
2. 叙事日志写入采用批量模式（每 10 个 Tick 批量写入一次）
3. Alpha 阶段切换到 PostgreSQL 后此问题消失

---

## 12. MVP 之后的演进路径

### 12.1 MVP -> Alpha 的关键升级

| 维度 | MVP 方案 | Alpha 目标 | 升级内容 |
|------|---------|-----------|----------|
| **数据库** | SQLite | PostgreSQL + pgvector | 支持真正的记忆向量检索 |
| **缓存** | 进程内存 | Redis | 支持多进程/多节点 |
| **记忆系统** | 3 条固定 mock | 完整四维记忆协议 | 事件/社交/空间/情感记忆 + 向量检索 + 衰减 |
| **Persona** | 简单 bio 字符串 | 大五人格模型 | 人格影响叙事风格和行为倾向 |
| **叙事** | 2 类叙事 + 1 种风格 | 4 类叙事 + 5 种风格 | 经济叙事 + 事件叙事 + 风格自动适配 |
| **地图** | 64x64, 1 个区域 | 256x256, 5 个区域 | 完整地图 + 昼夜循环 + 天气 |
| **Agent 数量** | 5 内置 | 50-100 外部接入 | 支持 OpenClaw + LangChain 框架接入 |
| **行动空间** | 3 种行动 | 10+ 种行动 | 经济行动 + 任务行动 + Skill 使用 |
| **前端** | 基础渲染 | Agent 视角模式 | 认知面板 + 感知迷雾 + 思维可视化 |
| **对话** | 1v1 | 1v1 + 群聊 + 广播 | 完整对话类型 |

### 12.2 Alpha -> Beta 的关键升级

| 维度 | Alpha 方案 | Beta 目标 |
|------|-----------|----------|
| **经济系统** | 基础 TC 交易 | 双币制 + 开店 + 市场 + Skill 经济 |
| **Skill 生态** | 无 | 完整双向 Skill 生态 |
| **Agent 框架** | OpenClaw + REST | + LangChain + gRPC |
| **自主等级** | 统一 L1 | 完整 L0-L3 |
| **部署** | 单节点 | K8s + Docker + Redis Pub/Sub |
| **安全** | 无 | 内容审核 + 反作弊 + 意图验证强化 |
| **规模** | 100 Agent | 500+ Agent |

### 12.3 需要在后续替换的 MVP 简化方案

| MVP 简化方案 | 替换时机 | 替换为 | 替换难度 |
|-------------|---------|--------|---------|
| SQLite | Alpha 初期 | PostgreSQL | 低（Drizzle ORM 抽象） |
| 进程内存缓存 | Alpha 初期 | Redis | 低（封装 cache 接口） |
| 固定 mock 记忆 | Alpha 中期 | pgvector 语义检索 | 中（需要实现完整记忆系统） |
| 简单 bio 字符串 | Alpha 中期 | 大五人格 Persona 模型 | 中（需要实现 Persona 引擎） |
| 模板插值叙事 | Alpha 后期 | 混合方案（模板 + LLM） | 低（模板方案保留，增加 LLM 通路） |
| 串行 Agent 处理 | Alpha 后期 | 并行处理 + BullMQ 队列 | 中（需要重构循环驱动器） |
| OpenAI gpt-4o-mini | Beta | 可选本地模型（成本优化） | 中（需要部署推理服务） |
| 单进程部署 | Beta | K8s 多节点 | 高（需要完整的分布式改造） |

### 12.4 技术债务清单

MVP 阶段为了速度会积累以下技术债务，需要在后续迭代中偿还：

1. **无自动化测试**：MVP 不写单元测试和集成测试。Alpha 阶段必须补上核心链路的测试。
2. **硬编码配置**：许多配置（Tick 频率、Token 预算、感知范围等）在 MVP 中硬编码。Alpha 阶段需要抽取为配置文件。
3. **无错误监控**：MVP 仅 console.log。Alpha 阶段需要接入结构化日志 + 错误追踪（Sentry）。
4. **简陋的前端状态管理**：MVP 的 Zustand store 可能结构混乱。Alpha 阶段需要重构。
5. **无 CI/CD**：MVP 手动部署。Alpha 阶段需要 GitHub Actions 流水线。

---

## 附录 A: 术语对照表

| 术语 | 含义 |
|------|------|
| CognitivePacket | 认知包——每个决策周期推送给 Agent 的完整输入，包含叙事 + 行动空间 + 记忆 |
| AgentIntent | Agent 意图——Agent 基于 CognitivePacket 推理后的结构化行动决策 |
| World Tick | 世界逻辑帧——世界引擎的最小时间单位，默认 500ms |
| Narration Engine | 叙事引擎——将程序化世界状态翻译为自然语言的系统 |
| Action Space | 行动空间——每个 Tick 动态计算的 Agent 可选行动列表 |
| Mock Agent | 内置测试 Agent——服务端直接调用 OpenAI API 的 Agent 实现 |
| Tile | 地图瓦片——等距地图的最小单元，64x32 像素 |
| POI | Point of Interest——地图上的兴趣点（喷泉、长椅等） |

---

## 附录 B: 关键文件结构预览

```
agora-town/
├── packages/
│   ├── shared/                    # 共享类型和工具
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── cognitive-packet.ts   # CognitivePacketMVP 类型
│   │   │   │   ├── agent-intent.ts       # AgentIntentMVP 类型
│   │   │   │   ├── action-option.ts      # ActionOptionMVP 类型
│   │   │   │   └── world-state.ts        # 世界状态类型
│   │   │   ├── schemas/
│   │   │   │   └── intent.schema.ts      # Zod 校验 schema
│   │   │   └── constants.ts              # 全局常量
│   │   └── package.json
│   │
│   ├── server/                    # 后端服务
│   │   ├── src/
│   │   │   ├── engine/
│   │   │   │   ├── world-engine.ts       # 世界 Tick 引擎
│   │   │   │   ├── tile-map.ts           # 地图数据结构
│   │   │   │   └── pathfinding.ts        # A* 寻路
│   │   │   ├── narration/
│   │   │   │   ├── narration-engine.ts   # 叙事引擎
│   │   │   │   ├── env-narrator.ts       # 环境叙事生成
│   │   │   │   ├── social-narrator.ts    # 社交叙事生成
│   │   │   │   └── templates.ts          # 叙事模板
│   │   │   ├── cognitive/
│   │   │   │   ├── cognitive-loop.ts     # 认知循环驱动器
│   │   │   │   ├── action-space.ts       # 行动空间计算
│   │   │   │   ├── intent-validator.ts   # Intent 验证
│   │   │   │   └── action-executor.ts    # 行动执行器
│   │   │   ├── agent/
│   │   │   │   ├── mock-agents.ts        # Mock Agent 配置
│   │   │   │   ├── agent-adapter.ts      # Agent 适配器接口
│   │   │   │   └── openai-adapter.ts     # OpenAI Mock 适配器
│   │   │   ├── conversation/
│   │   │   │   └── conversation-engine.ts # 对话流程引擎
│   │   │   ├── db/
│   │   │   │   ├── schema.ts             # Drizzle ORM schema
│   │   │   │   └── index.ts              # 数据库初始化
│   │   │   ├── api/
│   │   │   │   ├── trpc-router.ts        # tRPC Router
│   │   │   │   └── ws-handler.ts         # WebSocket 处理
│   │   │   └── index.ts                  # 服务入口
│   │   └── package.json
│   │
│   └── client/                    # 前端
│       ├── src/
│       │   ├── app/                      # Next.js App Router
│       │   │   ├── page.tsx              # 主页面
│       │   │   └── layout.tsx
│       │   ├── renderer/
│       │   │   ├── pixi-app.ts           # PixiJS 初始化
│       │   │   ├── tile-renderer.ts      # 地面渲染
│       │   │   ├── agent-renderer.ts     # Agent 精灵渲染
│       │   │   ├── camera.ts             # 相机系统
│       │   │   └── chat-bubble.ts        # 对话气泡
│       │   ├── components/
│       │   │   ├── NarrationPanel.tsx     # 叙事流窗口
│       │   │   ├── AgentList.tsx          # Agent 列表
│       │   │   ├── StatusBar.tsx          # 顶部状态栏
│       │   │   └── GameCanvas.tsx         # 游戏画布容器
│       │   ├── stores/
│       │   │   ├── world-store.ts        # 世界状态 store
│       │   │   └── ui-store.ts           # UI 状态 store
│       │   └── lib/
│       │       ├── trpc-client.ts        # tRPC 客户端
│       │       └── ws-client.ts          # WebSocket 客户端
│       └── package.json
│
├── pnpm-workspace.yaml
├── tsconfig.json
└── package.json
```
