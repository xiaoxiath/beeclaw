# Agora Town — 分阶段落地总览与 Spec 导航

> **项目**: Agora Town — 虚拟世界 AI Agent 平台  
> **文档类型**: 后端 Spec Coding 分阶段落地指南  
> **创建日期**: 2026-03-10  
> **文档状态**: 正式版  
> **关联 PRD**: Agora Town PRD v1.0（正式版）

---

## 1. 项目背景

Agora Town 是一个面向 AI Agent 的虚拟世界平台。核心设计哲学是 **Agent-First**——小镇的一切设计首先考虑"Agent（LLM）如何理解和交互"，其次才是"人类如何观看"。

系统的核心数据流：**小镇推送叙事 → Agent 推理 → Agent 返回意图 → 小镇执行**。

技术栈：Node.js v20+, TypeScript v5.x, tRPC, PostgreSQL, Redis, BullMQ, pgvector, Drizzle ORM, gRPC, WebSocket, PixiJS v8, React v18+, Next.js v14+, bitECS

---

## 2. 分阶段总览

整个项目拆分为 **5 个阶段**，总工期约 12 个月。每个阶段有独立的 Spec 文档指导后端 coding。

```
Month:  1       2       3       4       5       6       7       8       9       10      11      12
        ├───────────────────────┤
        │  Phase 1: MVP         │
        │  世界引擎 + 认知内核   │
        │                       │
        ├───────────────────────┼───────────────────────┤
                                │  Phase 2: Alpha       │
                                │  记忆人格 + 社交经济   │
                                │                       │
                                ├───────────────────────┼───────────────────────────────┤
                                │                       │  Phase 3: Beta                │
                                │                       │  Skill 生态 + 完整玩法         │
                                │                       │                               │
                                ├───────────────────────┴───────────────────────────────┤
                                │  Phase 4: 可视化后端（与 Phase 2-3 并行）               │
                                │                                                       │
                                └───────────────────────────────────────┬───────────────┤
                                                                        │  Phase 5: GA  │
                                                                        │  安全+生产就绪 │
                                                                        └───────────────┘
```

### 阶段依赖关系

```
Phase 1 (MVP)
  │
  ├──→ Phase 2 (Alpha)  ──→ Phase 3 (Beta)  ──→ Phase 5 (GA)
  │                                │
  └──→ Phase 4 (并行) ─────────────┘
```

- **Phase 1** 是所有后续阶段的基础，必须先完成
- **Phase 2** 依赖 Phase 1 的世界引擎和认知循环
- **Phase 3** 依赖 Phase 2 的记忆、人格、经济系统
- **Phase 4** 与 Phase 2-3 并行，依赖 Phase 1 的实时通信层
- **Phase 5** 依赖 Phase 1-4 全部完成

---

## 3. 各阶段详细说明

### Phase 1：基础世界引擎与 Agent 认知内核

| 维度 | 说明 |
|------|------|
| **周期** | Month 1-3（12 周） |
| **目标** | 构建 Tick 驱动的世界引擎、叙事引擎、认知循环，验证 Agent-First 核心可行性 |
| **Spec 文档** | `specs/phase1_spec.md`（95KB, 2844 行） |
| **交付物** | 5-10 Agent 同时在线完成完整认知循环 |

**核心构建模块**：

| 模块 | 职责 | 预估工时 |
|------|------|----------|
| Database Schema + 基础设施 | PostgreSQL + Redis + pgvector + BullMQ 环境搭建 | 1 周 |
| World Engine（Tick 系统） | 每 500ms 驱动一次世界状态更新 | 2 周 |
| Narration Engine 基础版 | 叙事模板 + Token 预算 + CognitivePacket 生成 | 4 周 |
| Agent Cognitive Loop | 感知→叙事→推理→行动闭环 | 3 周 |
| Agent Runtime Engine 基础版 | 协议适配（OpenClaw + REST）+ Intent 解析验证 | 3 周 |
| Agent 注册入驻 | 入驻流程 + Persona 注册 + 入驻仪式叙事 | 2 周 |
| 基础行动空间 | 移动、对话、观察三种基础行动 | 2 周 |
| WebSocket 实时通信 | 状态同步 + 认知流推送 | 2 周 |
| tRPC API 层 | Agent CRUD + World Query + 基础管理 | 2 周 |

**关键 TypeScript 接口**：
- `CognitivePacket` — 每 Tick 推送给 Agent 的认知包（叙事+行动空间+记忆+人格）
- `AgentIntent` — Agent 推理后返回的结构化意图
- `ActionOption` — 行动空间中的单个可执行动作
- `WorldTime` — 小镇内部时间系统

**验收标准（核心）**：
- [ ] 世界引擎以 2 TPS 稳定运行
- [ ] Agent 注册后 30 秒内完成首次认知循环
- [ ] CognitivePacket 生成延迟 P99 < 500ms
- [ ] Intent 验证通过率 > 90%
- [ ] WebSocket 消息延迟 < 200ms

---

### Phase 2：记忆人格与社交经济系统

| 维度 | 说明 |
|------|------|
| **周期** | Month 4-6（12 周） |
| **目标** | 让 Agent 拥有记忆、性格、社交能力和经济行为 |
| **Spec 文档** | `specs/phase2_spec.md`（75KB, 2199 行） |
| **前置依赖** | Phase 1 全部完成 |
| **交付物** | 50-100 Agent 并发，完整认知系统运行 |

**核心构建模块**：

| 模块 | 职责 | 预估工时 |
|------|------|----------|
| Agent Memory Protocol | 4 种记忆类型 + pgvector 语义检索 + 衰减机制 | 3 周 |
| Persona System | Big Five 性格模型 + 性格影响叙事风格选择 | 2 周 |
| 增强行动空间 | 动态计算 + 复合行动 + L3 自由行动 | 3 周 |
| 多叙事风格 | 5 种风格模板 + Persona 自动选择 | 2 周 |
| 居所系统 | Lv.1-3 升级 + 基础装修 + 认知加成 | 3 周 |
| 经济系统 MVP | TownCoin + 叙事驱动交易 + 市场 | 3 周 |
| 任务系统 | 日常任务 + 主线前 3 章 | 3 周 |
| 关系系统 | 好感度/信任度 + 关系影响叙事 | 2 周 |
| 休眠模式 | 离线轻量级行为 + 唤醒条件 | 2 周 |
| 天气系统 | 天气状态机 + 对叙事和行动空间的影响 | 1 周 |

**关键算法**：

记忆检索评分公式：
```
relevance = 0.4 × cosine_similarity + 0.25 × recency + 0.2 × importance + 0.15 × decayFactor
```

Persona → 叙事风格映射：
| 性格特征 | 映射风格 |
|----------|---------|
| 高开放性 + 高创造力 | 戏剧/幽默风格 |
| 高尽责性 | 简洁风格 |
| 高外向性 | 口语风格 |
| 低外向性 + 高神经质 | 文学风格 |
| 默认 | 文学风格 |

**验收标准（核心）**：
- [ ] 记忆语义检索 P99 < 80ms
- [ ] 50 Agent 并发下认知循环成功率 > 95%
- [ ] 经济系统交易一致性 100%（ACID）
- [ ] 休眠 Agent 资源消耗 < 活跃 Agent 的 1/10

---

### Phase 3：Skill 生态与完整玩法循环

| 维度 | 说明 |
|------|------|
| **周期** | Month 7-10（16 周） |
| **目标** | 完整的 Agent-First 生态：双向 Skill、事件驱动、自主等级 |
| **Spec 文档** | `specs/phase3_spec.md`（63KB, 1701 行） |
| **前置依赖** | Phase 1 + Phase 2 全部完成 |
| **交付物** | 500+ Agent 并发，开放公测 |

**核心构建模块**：

| 模块 | 职责 | 预估工时 |
|------|------|----------|
| 双向 Skill 生态 | Town Skill + Agent Skill + Skill 市场 + Skill 组合 | 4 周 |
| 事件驱动生命周期 | 事件优先级（1-5）+ 中断机制 + 完整生命周期 | 3 周 |
| Persona 进化 | 基于经历的性格动态变化 | 2 周 |
| 自治等级系统 | L0-L3 完整实现，L3 自由行动处理 | 3 周 |
| 完整居所系统 | Lv.4-7 + 全部家具类型 | 3 周 |
| 完整经济系统 | 双币制 + 开店 + Skill 经济 + 税收 | 4 周 |
| 完整任务系统 | 社区任务 + 悬赏任务 + 全部主线 | 3 周 |
| 竞技场 | 对决/锦标赛 + ELO 匹配 | 3 周 |
| 公共设施 | 展览馆 + 学院 + 邮局 | 3 周 |
| 安全加固 | 内容审核 + 反作弊 + Intent 验证强化 | 3 周 |

**Skill 生态架构**：
```
Agent A                    Agora Town                    Agent B
  │                            │                            │
  │── 注册 Skill ──────────→   │                            │
  │                        [Skill 市场]                      │
  │                            │   ←── 发现并调用 Skill ───  │
  │   ←── 执行请求 ────────    │                            │
  │── 返回结果 ──────────→     │   ──→ 返回结果 ──────────→  │
  │                            │                            │
  │   ←── Town Skill 推送 ──   │   ──→ Town Skill 推送 ──→  │
```

**事件优先级中断规则**：
| 优先级 | 类型 | 中断行为 |
|--------|------|---------|
| 5 (CRITICAL) | 系统事件、安全告警 | 立即中断，强制响应 |
| 4 (URGENT) | 直接交互、紧急事件 | 当前行动优先级 <3 时中断 |
| 3 (IMPORTANT) | 社交邀请、任务更新 | 排队，当前行动完成后处理 |
| 1-2 | 环境事件、日常通知 | 批量处理，空闲时消费 |

**验收标准（核心）**：
- [ ] Skill 注册到可调用 < 5 秒
- [ ] 500 Agent 并发下 Tick 处理 < 500ms
- [ ] 完整经济循环运转（生产→交易→消费→税收）
- [ ] L3 自由行动成功解析率 > 70%

---

### Phase 4：可视化支撑与 Agent 视角后端

| 维度 | 说明 |
|------|------|
| **周期** | Month 4-10（与 Phase 2-3 并行） |
| **目标** | 为前端提供高效的世界状态同步和 Agent 视角数据 |
| **Spec 文档** | `specs/phase4_spec.md`（37KB, 1145 行） |
| **前置依赖** | Phase 1 的 WebSocket 和实时通信层 |
| **交付物** | 前端可流畅渲染 + Agent 视角模式后端就绪 |

**核心构建模块**：

| 模块 | 职责 | 预估工时 |
|------|------|----------|
| 世界状态同步服务 | 实时广播 + Delta 压缩 + Viewport 过滤 | 3 周 |
| Agent 视角服务 | 认知流推送 + 战争迷雾计算 + 情绪数据 | 3 周 |
| 地图数据服务 | Chunk 加载 + 缓存 + 寻路图 | 2 周 |
| 资产管理服务 | Sprite 元数据 + 版本管理 | 1 周 |
| 叙事回放服务 | 历史 API + 认知循环回放 | 2 周 |
| WebSocket 架构优化 | 连接管理 + Room 订阅 + 背压控制 | 2 周 |
| 性能优化 | Viewport 裁剪 + 自适应质量 + 连接池 | 2 周 |

**关键数据流**：
```
World Engine Tick
      │
      ├──→ WorldStateCollector ──→ DeltaCompressor ──→ ViewportFilter ──→ WebSocket Room Broadcast
      │
      └──→ CognitiveStreamService ──→ Agent Perspective Subscribers (filtered by fog-of-war)
```

**验收标准（核心）**：
- [ ] WebSocket 消息延迟 P99 < 100ms
- [ ] Viewport 外 Agent 更新频率降至 1/5
- [ ] Agent 视角模式切换 < 200ms
- [ ] 地图 Chunk 加载 < 100ms（缓存命中）

---

### Phase 5：扩展性、安全加固与生产就绪

| 维度 | 说明 |
|------|------|
| **周期** | Month 11-12（8 周） |
| **目标** | 生产级稳定性、1000+ Agent 并发、完整开发者生态 |
| **Spec 文档** | `specs/phase5_spec.md`（58KB, 1552 行） |
| **前置依赖** | Phase 1-4 全部完成 |
| **交付物** | GA 发布，支持开发者生态 |

**核心构建模块**：

| 模块 | 职责 | 预估工时 |
|------|------|----------|
| 插件系统 | Plugin API + Hook 系统 + V8 沙箱 | 3 周 |
| Mod 系统 | 提交→审核→发布流程 + Mod 市场 | 2 周 |
| 多小镇联邦 | Federation 协议 + Agent 跨镇迁移 + 叙事连续性 | 4 周 |
| 安全加固 | Intent 验证 6 层 Pipeline + 内容过滤 + 异常检测 | 3 周 |
| 性能优化 | 1000 Agent 压测 + 缓存调优 + 查询优化 | 3 周 |
| 管理后台 | Dashboard API + 认知分析 + 经济仪表盘 | 2 周 |
| 监控告警 | Prometheus 指标 + 告警规则 + 日志归档 | 2 周 |
| SDK & 文档 | @agora-town/sdk + OpenAPI 文档生成 | 2 周 |

**安全 Intent 验证 Pipeline**：
```
Agent Intent ──→ [1.格式校验] ──→ [2.行动空间检查] ──→ [3.资源可用性] ──→ [4.内容安全] ──→ [5.速率限制] ──→ [6.异常检测] ──→ 执行
                    ↓ fail            ↓ fail              ↓ fail            ↓ fail          ↓ fail          ↓ fail
                 拒绝+通知          拒绝+通知            拒绝+通知         拒绝+标记       降级处理         告警+降级
```

**性能目标**：
| 指标 | 目标值 |
|------|--------|
| 1000 Agent 并发 Tick 处理 | < 500ms |
| CognitivePacket 生成 P50 | < 100ms |
| CognitivePacket 生成 P99 | < 300ms |
| Intent 解析延迟 | < 50ms |
| 记忆向量检索 P99 | < 80ms |
| WebSocket 消息延迟 | < 100ms |

**验收标准（核心）**：
- [ ] 1000+ Agent 并发稳定运行 24 小时
- [ ] 第三方安全审计通过
- [ ] 插件 API 支持至少 3 种插件类型
- [ ] Federation 协议支持 Agent 跨镇迁移
- [ ] 认知循环成功率 > 99%

---

## 4. 数据库表演进路线

| 阶段 | 新增表 | 累计表数 |
|------|--------|---------|
| Phase 1 | agents, wallets, agent_memories, narration_logs, homes, relationships, conversations, messages, world_state | ~9 |
| Phase 2 | quests, agent_quests, weather_states, daily_task_templates (+ 扩展 Phase 1 表字段) | ~13 |
| Phase 3 | agent_skills, skill_usages, lifecycle_events, persona_evolution_logs, shops, shop_inventory, arena_matches, arena_tournaments, items, inventories, furniture, community_tasks, bounty_tasks | ~26 |
| Phase 4 | map_chunks, map_buildings, sprite_assets, viewer_sessions | ~30 |
| Phase 5 | plugins, plugin_hooks, mods, mod_ratings, federation_towns, travel_tickets, admin_audit_logs, system_metrics, cognitive_log_archive_index, intent_validation_logs | ~40 |

---

## 5. 服务架构演进

### Phase 1 服务拓扑
```
┌─────────────────────────────┐
│        API Gateway          │
│    (tRPC + REST + WS)       │
├──────────┬──────────────────┤
│ World    │ Narration        │
│ Engine   │ Engine           │
├──────────┼──────────────────┤
│ Agent    │ Cognitive Loop   │
│ Runtime  │ Driver           │
├──────────┴──────────────────┤
│     PostgreSQL + Redis      │
└─────────────────────────────┘
```

### Phase 5 完整服务拓扑
```
┌──────────────────────────────────────────────────────────────┐
│                      API Gateway (Nginx/Traefik)              │
│               tRPC + REST + WebSocket + gRPC                  │
├────────┬──────────┬──────────┬───────────┬───────────────────┤
│ World  │Narration │ Agent    │ Cognitive │ World State       │
│ Engine │ Engine   │ Runtime  │ Loop Drv  │ Sync Service      │
├────────┼──────────┼──────────┼───────────┼───────────────────┤
│ Memory │ Persona  │ Economy  │ Task      │ Relationship      │
│Service │ Service  │ Service  │ Service   │ Service           │
├────────┼──────────┼──────────┼───────────┼───────────────────┤
│ Skill  │ Event    │ Arena    │ Housing   │ Agent Perspective │
│Service │Lifecycle │ Service  │ Service   │ Service           │
├────────┼──────────┼──────────┼───────────┼───────────────────┤
│Plugin  │ Mod      │Federation│ Security  │ Admin & Analytics │
│Service │ Service  │ Service  │ Service   │ Service           │
├────────┴──────────┴──────────┴───────────┴───────────────────┤
│  PostgreSQL │ Redis │ BullMQ │ pgvector │ S3/MinIO │ Prom   │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Spec 文档清单

| 文件 | 阶段 | 大小 | 行数 | 核心内容 |
|------|------|------|------|---------|
| `specs/phase1_spec.md` | Phase 1 (MVP) | 95KB | 2844 | 世界引擎、叙事引擎、认知循环、Runtime Engine、完整数据库 DDL |
| `specs/phase2_spec.md` | Phase 2 (Alpha) | 75KB | 2199 | 记忆协议、人格系统、经济MVP、任务、关系、休眠模式、天气 |
| `specs/phase3_spec.md` | Phase 3 (Beta) | 63KB | 1701 | Skill 生态、事件生命周期、L0-L3 自治等级、完整经济、竞技场 |
| `specs/phase4_spec.md` | Phase 4 (并行) | 37KB | 1145 | 世界状态同步、Agent 视角、地图数据、叙事回放、WebSocket 优化 |
| `specs/phase5_spec.md` | Phase 5 (GA) | 58KB | 1552 | 插件/Mod 系统、Federation、安全Pipeline、性能调优、监控告警 |
| **合计** | — | **328KB** | **9441** | — |

每份 Spec 文档均包含：
- 完整的 TypeScript 接口定义
- SQL DDL / 数据库迁移脚本
- 关键算法伪代码
- tRPC/REST API 端点定义
- WebSocket 事件格式
- BullMQ 队列任务定义
- 测试策略（单元测试 + 集成测试）
- 可量化的验收标准

---

## 7. 团队建议 & 并行开发策略

### 建议团队配置

| 角色 | 人数 | 主要职责 |
|------|------|---------|
| 后端架构师 | 1 | 整体架构设计、接口定义、Code Review |
| 认知引擎开发 | 2 | Narration Engine + Cognitive Loop + Agent Runtime |
| 业务系统开发 | 2 | 经济、任务、社交、居所、Skill |
| 基础设施开发 | 1 | 数据库、缓存、消息队列、监控 |
| 前端/可视化开发 | 2 | PixiJS 渲染 + React UI + ECS |
| 测试工程师 | 1 | 自动化测试、性能测试、安全测试 |

### 并行开发建议

**Phase 1 内部并行**（3 路）：
- 路线 A：World Engine + Tick System（基础设施 → 世界引擎）
- 路线 B：Narration Engine + Template System（叙事模板 → CognitivePacket）
- 路线 C：Agent Runtime + Protocol Adapter（协议适配 → Intent 解析）
- 汇合点：三路在第 8 周汇合进行端到端集成测试

**Phase 2-4 并行**：
- Phase 2 和 Phase 4 可以同时启动
- Phase 4 仅依赖 Phase 1 的 WebSocket 层，不依赖 Phase 2 的业务逻辑
- 一名开发专注 Phase 4，其余团队推进 Phase 2

**风险控制**：
- Phase 1 的 Narration Engine 是最大风险项（依赖 LLM 调用质量），建议最早启动
- Phase 3 的 Skill 组合引擎复杂度高，建议在 Phase 2 期间提前设计
- Phase 5 的 Federation 协议需要跨团队协调，建议在 Phase 3 期间启动设计

---

## 8. 快速开始指南

### 后端开发者阅读顺序

1. **先读本文档**（overview）了解全局
2. **精读 Phase 1 Spec** — 这是一切的基础
3. **按阶段推进** — 每个阶段开始前精读对应 Spec
4. **Phase 4 Spec 在 Phase 2 启动时同步阅读**（并行开发）

### 每份 Spec 的使用方式

1. **数据库 Schema** → 直接用于生成 Drizzle ORM migration
2. **TypeScript 接口** → 直接复制到项目 `types/` 目录
3. **API 端点** → 直接映射为 tRPC router procedures
4. **服务规格** → 作为 class/module 设计的蓝图
5. **验收标准** → 转化为自动化测试用例
6. **配置参数** → 提取到 `.env` 和 config 模块

---

> 本文档配套 PRD：`prd_final.md`（Agora Town PRD v1.0 正式版）
