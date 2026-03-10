# Phase 5: 扩展性、安全加固与生产就绪 — 后端技术规格文档

> **项目**: Agora Town  
> **阶段**: Phase 5 (Month 11-12, GA)  
> **版本**: v1.0.0  
> **状态**: Draft  
> **前置依赖**: Phase 1 (核心认知循环), Phase 2 (经济与社交), Phase 3 (叙事引擎), Phase 4 (高级认知与实时交互)

---

## 目录

1. [概述](#1-概述)
2. [Plugin Service — 插件服务](#2-plugin-service--插件服务)
3. [Mod Service — 模组服务](#3-mod-service--模组服务)
4. [Federation Service — 多镇联邦服务](#4-federation-service--多镇联邦服务)
5. [Security Service — 安全服务](#5-security-service--安全服务)
6. [Performance Optimization — 性能优化](#6-performance-optimization--性能优化)
7. [Admin Service — 管理后台服务](#7-admin-service--管理后台服务)
8. [Monitoring & Alerting — 监控与告警](#8-monitoring--alerting--监控与告警)
9. [SDK & Documentation — 开发者 SDK 与文档](#9-sdk--documentation--开发者-sdk-与文档)
10. [Database Migrations — 数据库迁移](#10-database-migrations--数据库迁移)
11. [API Endpoints](#11-api-endpoints)
12. [Testing Strategy — 测试策略](#12-testing-strategy--测试策略)
13. [Acceptance Criteria — 验收标准](#13-acceptance-criteria--验收标准)

---

## 1. 概述

Phase 5 是 Agora Town 正式发布 (GA) 前的最终阶段。本阶段不引入新的核心游戏机制，而是聚焦于三个生产就绪目标：

**可扩展性 (Extensibility)**：通过 Plugin System 和 Mod Support，允许第三方开发者和社区用户在不修改核心代码的前提下扩展镇子功能——包括叙事风格、人格模板、游戏玩法和外部集成。Multi-Town Federation 协议则打通多个独立镇子实例之间的 Agent 迁移与数据互通，为平台化运营奠定基础。

**安全加固 (Security Hardening)**：建立完整的威胁模型与多层防御体系。重点防御 Prompt Injection、Action Space Escape、Token Budget Abuse、Memory Poisoning 等 LLM 应用特有的攻击面。同时完成第三方安全审计前的所有准备工作，确保意图验证管线 (Intent Validation Pipeline) 覆盖格式校验、权限校验、资源校验、内容安全和异常检测全链路。

**生产就绪 (Production Readiness)**：在 1000+ Agent 并发规模下达成严格的性能指标——World Tick < 500ms、CognitivePacket 生成 P99 < 300ms、数据库查询 P99 < 50ms。配套的 Admin Dashboard、Monitoring & Alerting 体系以及全链路日志回放能力，确保运维团队对系统状态拥有完全的可观测性。

**交付里程碑**:

| 周次 | 交付物 |
|------|--------|
| W1-W2 | Plugin Service 核心 + 安全审计准备 |
| W3-W4 | Mod Service + Federation Protocol |
| W5-W6 | 性能优化 + 压力测试 |
| W7-W8 | Admin Dashboard + 监控告警 + SDK + GA 发布 |

---

## 2. Plugin Service — 插件服务

### 2.1 核心接口定义

Plugin Service 是 Agora Town 扩展能力的基石。每个插件必须实现 `TownPlugin` 接口，并声明其所需的 hook 类型和权限范围：

```typescript
interface TownPlugin {
  id: string;                  // 唯一标识, 格式: "vendor.pluginName"
  name: string;                // 显示名称
  version: string;             // 语义化版本 (semver)
  hooks: {
    onWorldTick?: (tick: number) => Promise<void>;
    onAgentAction?: (agentId: string, action: AgentIntent) => Promise<void>;
    onNarrationGenerate?: (context: NarrationContext) => Promise<string>;
    registerNarrationTemplates?: () => NarrationTemplate[];
    registerTownSkills?: () => TownSkill[];
    registerItems?: () => ItemDefinition[];
  };
  permissions: PluginPermission[];
  sandboxConfig: SandboxConfig;
}

type PluginPermission =
  | 'read:agents'
  | 'read:world'
  | 'write:narration'
  | 'write:items'
  | 'write:skills'
  | 'read:economy'
  | 'write:economy'
  | 'network:outbound';

interface SandboxConfig {
  maxCpuMs: number;            // 单次 hook 调用最大 CPU 时间 (ms)
  maxMemoryMb: number;         // 最大内存占用 (MB)
  maxNetworkRequests: number;  // 每分钟最大外部网络请求数
  allowedDomains: string[];    // 允许访问的外部域名白名单
  timeout: number;             // hook 调用超时 (ms)
}
```

### 2.2 插件类型

| 类型 | 描述 | 可用 Hooks | 典型示例 |
|------|------|-----------|---------|
| Narration Plugin | 扩展叙事模板与风格 | `onNarrationGenerate`, `registerNarrationTemplates` | "武侠风叙事"、"赛博朋克风叙事" |
| Persona Plugin | 预制人格模板 | `registerTownSkills` | "画家人格"、"商人人格" |
| Gameplay Plugin | 新物品、技能、任务类型 | `registerItems`, `registerTownSkills`, `onAgentAction` | "钓鱼系统"、"炼金术" |
| Integration Plugin | 外部服务对接 | `onWorldTick`, `onAgentAction` | "天气 API 同步"、"Discord 消息桥接" |

### 2.3 插件生命周期

```typescript
// PluginService 核心接口
interface PluginService {
  // 注册与加载
  register(manifest: PluginManifest): Promise<PluginRegistration>;
  load(pluginId: string): Promise<void>;
  unload(pluginId: string): Promise<void>;
  
  // 状态管理
  enable(pluginId: string): Promise<void>;
  disable(pluginId: string): Promise<void>;
  getStatus(pluginId: string): PluginStatus;
  
  // Hook 调度
  dispatchHook<T extends keyof TownPlugin['hooks']>(
    hookName: T,
    ...args: Parameters<NonNullable<TownPlugin['hooks'][T]>>
  ): Promise<void>;
  
  // 依赖解析
  resolveDependencies(pluginId: string): DependencyGraph;
}

enum PluginStatus {
  REGISTERED = 'registered',
  LOADING = 'loading',
  ACTIVE = 'active',
  DISABLED = 'disabled',
  ERROR = 'error',
  UNLOADED = 'unloaded',
}
```

生命周期状态流转: `REGISTERED → LOADING → ACTIVE ⇄ DISABLED → UNLOADED`。当插件在 hook 执行中抛出未捕获异常或超出 sandbox 资源限制时，自动转入 `ERROR` 状态并触发 `disable` 流程。

### 2.4 Hook 调度机制

所有 hook 按 `priority` 字段升序执行（数值越小优先级越高）。同一 hook 类型可以有多个插件注册，调度器按优先级链式调用。对于 `onNarrationGenerate` 类 hook，后序插件可以修改前序插件的输出，形成管线 (pipeline) 模式。

```typescript
interface HookDispatcher {
  // 注册 hook 处理器
  registerHandler(
    pluginId: string,
    hookName: string,
    handler: Function,
    priority: number
  ): void;

  // 按优先级链式执行所有处理器
  async dispatch(hookName: string, context: HookContext): Promise<HookResult> {
    const handlers = this.getHandlersByPriority(hookName);
    let result = context.initialValue;
    
    for (const handler of handlers) {
      const sandboxedResult = await this.sandboxExecutor.run(
        handler.pluginId,
        handler.fn,
        result,
        handler.sandboxConfig
      );
      result = sandboxedResult;
    }
    return result;
  }
}
```

### 2.5 沙箱执行环境

每个插件在隔离的 V8 Isolate 中执行（基于 `isolated-vm` 或类似方案），确保：

- **CPU 隔离**: 每次 hook 调用有严格的 CPU 时间上限（默认 100ms），超时立即终止。
- **内存隔离**: 每个插件独立的堆内存上限（默认 64MB），超出立即 OOM 终止。
- **网络隔离**: 插件无法直接发起网络请求，需通过 `PluginNetworkProxy` 代理，且仅允许访问 `allowedDomains` 白名单内的域名。
- **数据库隔离**: 插件不能直接访问数据库。所有数据读写通过 `PluginDataAPI` 抽象层进行，该层内置权限校验和速率限制。

```typescript
interface SandboxExecutor {
  run<T>(
    pluginId: string,
    fn: (...args: any[]) => T,
    args: any[],
    config: SandboxConfig
  ): Promise<T>;
  
  terminate(pluginId: string): void;
  getResourceUsage(pluginId: string): ResourceUsageReport;
}
```

---

## 3. Mod Service — 模组服务

### 3.1 Mod 与 Plugin 的关系

Mod 本质上是用户创建的 Plugin，通过 Mod Workshop 进行分发。与官方 Plugin 的区别在于：Mod 需要经过内容审核流程，且运行时的 sandbox 限制更为严格。

### 3.2 Mod 提交与审核流程

```
开发者提交 Mod → 自动化检查 → 人工审核 → 审核通过 → 发布到 Marketplace
                    ↓                ↓
               自动化拒绝         人工拒绝 (附拒绝理由)
```

自动化检查项:

| 检查项 | 说明 |
|--------|------|
| Manifest 格式校验 | 检查 `mod.json` 是否符合 JSON Schema |
| 权限声明审计 | 检查 `permissions` 是否声明了非必要的高危权限 |
| 静态代码扫描 | 检测恶意模式（eval、动态 import、prototype pollution） |
| 资源体积限制 | Mod 包总大小 < 10MB |
| 依赖安全检查 | 不允许引入外部 npm 依赖，仅允许使用 Mod SDK 提供的 API |

```typescript
interface ModService {
  // 提交
  submitMod(authorId: string, modPackage: Buffer): Promise<ModSubmission>;
  
  // 审核
  getReviewQueue(): Promise<ModSubmission[]>;
  approveMod(modId: string, reviewerId: string): Promise<void>;
  rejectMod(modId: string, reviewerId: string, reason: string): Promise<void>;
  
  // 分发
  publishMod(modId: string): Promise<void>;
  unpublishMod(modId: string): Promise<void>;
  
  // Marketplace
  searchMods(query: ModSearchQuery): Promise<ModSearchResult>;
  installMod(townId: string, modId: string): Promise<void>;
  uninstallMod(townId: string, modId: string): Promise<void>;
  rateMod(userId: string, modId: string, rating: number, review?: string): Promise<void>;
}

interface ModSearchQuery {
  keyword?: string;
  type?: PluginType;
  sortBy: 'downloads' | 'rating' | 'newest';
  page: number;
  pageSize: number;
}
```

### 3.3 Mod Marketplace

Marketplace 为用户提供 Mod 的浏览、搜索、安装和评价能力。每个 Mod 详情页展示：名称、作者、版本、描述、截图、评分、下载量、权限声明和变更日志。

Mod 的沙箱限制比官方 Plugin 更加严格：

| 资源 | 官方 Plugin | 社区 Mod |
|------|------------|---------|
| CPU (每次 hook) | 100ms | 50ms |
| 内存 | 64MB | 32MB |
| 网络请求/min | 60 | 0 (禁止) |
| 可用 Hook 类型 | 全部 | `registerNarrationTemplates`, `registerItems`, `registerTownSkills` |

---

## 4. Federation Service — 多镇联邦服务

### 4.1 联邦协议

Federation Service 允许多个独立部署的 Agora Town 实例组成联邦网络，实现 Agent 的跨镇迁移。每个镇子在联邦中是对等节点，通过签名验证确保通信安全。

```typescript
interface FederationProtocol {
  // 镇子发现
  discoverTowns(): Promise<TownInfo[]>;
  
  // Agent 迁移
  requestTravel(agentId: string, targetTownId: string): Promise<TravelTicket>;
  transferAgent(ticket: TravelTicket, agentData: AgentExportData): Promise<void>;
  receiveAgent(agentData: AgentExportData): Promise<string>;
  
  // 数据可移植性
  exportAgentData(agentId: string): AgentExportData;
  importAgentData(data: AgentExportData): Promise<void>;
}

interface TownInfo {
  id: string;
  name: string;
  endpoint: string;          // 联邦 API 基础 URL
  publicKey: string;         // Ed25519 公钥, 用于签名验证
  population: number;        // 当前 Agent 数量
  maxPopulation: number;     // 人口上限
  theme: string;             // 镇子主题描述
  version: string;           // Agora Town 版本
  status: 'online' | 'maintenance' | 'offline';
}

interface TravelTicket {
  id: string;
  agentId: string;
  fromTownId: string;
  toTownId: string;
  issuedAt: number;          // Unix timestamp
  expiresAt: number;         // 有效期 30 分钟
  signature: string;         // 源镇签名
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'expired';
}
```

### 4.2 Agent 数据导出与导入

Agent 跨镇迁移时，携带经过精简的核心数据集。完整的记忆库不会全部迁移——仅保留按 importance 排序的 Top 50 核心记忆，以控制数据传输体积和目标镇的存储负担。

```typescript
interface AgentExportData {
  persona: AgentPersona;                  // 完整人格定义
  coreMemories: AgentMemory[];            // Top 50 核心记忆 (by importance)
  inventory: InventoryItem[];             // 背包物品
  currency: {
    townCoin: number;                     // TC 余额
    starDust: number;                     // 星尘余额
  };
  relationships: RelationshipSummary[];   // 关系摘要 (非完整对话历史)
  skills: AgentSkillSummary[];            // 技能摘要
  reputation: number;                     // 声望值
  originTownId: string;                   // 来源镇子 ID
  exportVersion: string;                  // 导出格式版本号
  signature: string;                      // 源镇签名, 防篡改
}

interface RelationshipSummary {
  targetAgentName: string;     // 对方名称 (非 ID, 跨镇无意义)
  closeness: number;           // 亲密度
  sentiment: string;           // 情感基调摘要
  lastInteraction: string;     // 最后一次交互的简短描述
}
```

### 4.3 联邦叙事连续性

Agent 抵达新镇子时，Narration Engine 自动生成 "旅行到达" 叙事，将 Agent 的到来融入当地叙事线：

1. **出发叙事**: 在源镇生成 "Agent 踏上旅途" 的叙事段落，其他 Agent 可感知到该 Agent 的离开。
2. **到达叙事**: 在目标镇生成 "远方旅人到来" 的叙事段落，包含对 Agent 来源和特征的描述。
3. **记忆转化**: 来自源镇的关系记忆被标记为 "distant_memory" 类型，在认知循环中以较低权重参与决策，但不会被遗忘——这确保了 Agent 的人格连续性。

```typescript
interface FederationNarrationService {
  generateDepartureNarration(agent: AgentExportData, targetTown: TownInfo): Promise<string>;
  generateArrivalNarration(agent: AgentExportData, localTown: TownInfo): Promise<string>;
  convertMemoriesToDistant(memories: AgentMemory[]): AgentMemory[];
}
```

### 4.4 迁移流程时序

```
源镇                                    目标镇
 │                                        │
 │  1. requestTravel(agentId, targetId)    │
 │ ─────────────────────────────────────> │
 │         2. TravelTicket (signed)        │
 │ <───────────────────────────────────── │
 │                                        │
 │  3. exportAgentData(agentId)            │
 │  4. generateDepartureNarration()        │
 │  5. Agent 在源镇进入 "traveling" 状态    │
 │                                        │
 │  6. transferAgent(ticket, agentData)    │
 │ ─────────────────────────────────────> │
 │         7. 验证签名 + ticket 有效性      │
 │         8. importAgentData()            │
 │         9. generateArrivalNarration()   │
 │        10. receiveAgent → new agentId   │
 │ <───────────────────────────────────── │
 │ 11. 标记源镇 Agent 为 "migrated"        │
 │                                        │
```

---

## 5. Security Service — 安全服务

### 5.1 威胁模型

| 威胁 | 风险等级 | 攻击面 | 防御策略 |
|------|---------|--------|---------|
| Prompt Injection via Intent | 高 | Agent speech/monologue 字段嵌入恶意指令 | 多层意图验证管线: 格式 → 权限 → 资源 → 内容安全 |
| Action Space Escape | 高 | 提交不在当前 action space 中的 actionId | 严格 actionId 白名单校验，对比计算后的 action space |
| Token Budget Abuse | 中 | 恶意构造超长输入消耗 token 预算 | 硬截断 + 计费告警 + 自动降级 |
| Memory Poisoning | 中 | 通过对话向其他 Agent 注入恶意记忆 | 记忆内容消毒 + importance 分数验证（突变检测） |
| Skill Malicious Code | 中 | 用户自定义 Skill 执行恶意代码 | V8 Isolate 沙箱 + CPU/内存/网络限制 |
| Federation Data Tampering | 高 | 篡改跨镇传输的 Agent 数据 | Ed25519 数字签名 + 数据完整性校验 |
| Replay Attack | 中 | 重放已过期的 TravelTicket | Ticket 唯一 ID + 过期时间 + 已使用标记 |

### 5.2 Intent Validation Pipeline

每条 AgentIntent 在被 World Tick Processor 执行前，必须通过完整的六级验证管线。任何一级未通过，Intent 即被拒绝并记录审计日志。

```typescript
interface IntentValidationPipeline {
  validate(intent: AgentIntent, context: ValidationContext): Promise<ValidationResult>;
}

interface ValidationContext {
  agent: AgentState;
  currentActionSpace: ActionSpace;
  worldState: WorldState;
  rateLimitCounters: RateLimitState;
  behaviorBaseline: BehaviorBaseline;
}

interface ValidationResult {
  valid: boolean;
  failedStage?: ValidationStage;
  reason?: string;
  severity?: 'info' | 'warning' | 'critical';
}

enum ValidationStage {
  FORMAT = 'format',                    // Level 1: JSON Schema 格式校验
  ACTION_SPACE = 'action_space',        // Level 2: actionId 在当前 action space 中
  RESOURCE = 'resource',                // Level 3: 资源充足 (货币、物品、体力)
  CONTENT_SAFETY = 'content_safety',    // Level 4: 语音/独白内容安全
  RATE_LIMIT = 'rate_limit',            // Level 5: 频率限制
  ANOMALY = 'anomaly',                  // Level 6: 行为异常检测
}
```

各级验证详细说明：

**Level 1 — 格式校验**: 使用 `ajv` 对 AgentIntent JSON 进行 Schema 验证。确保所有必要字段存在且类型正确。

**Level 2 — Action Space 成员校验**: 验证 `intent.actionId` 是否属于该 Agent 当前 World Tick 计算出的 ActionSpace。这是防御 Action Space Escape 攻击的核心机制。

**Level 3 — 资源可用性校验**: 检查 Agent 是否拥有执行该 action 所需的全部资源（TC、物品、体力值等）。防止超额消费和重复提交。

**Level 4 — 内容安全过滤**: 对 `speech` 和 `monologue` 字段进行内容安全审查。使用关键词过滤 + LLM 辅助判断双机制，拦截有害内容和 Prompt Injection 尝试。

**Level 5 — 频率限制**: 每个 Agent 每分钟最多提交 30 条 Intent。超出部分直接丢弃。防止单个 Agent 通过高频提交消耗系统资源。

**Level 6 — 异常检测**: 基于 Agent 的历史行为基线，检测突然的行为模式变化。例如：一个长期友善的 Agent 突然发送大量攻击性内容，或一个贫穷的 Agent 突然尝试大额交易。触发异常告警时不直接拒绝，而是标记为 `warning` 并通知管理员。

### 5.3 内容安全过滤器

```typescript
interface ContentSafetyFilter {
  // 主检查方法
  check(content: string, context: SafetyContext): Promise<SafetyCheckResult>;
  
  // 多层过滤
  keywordFilter(content: string): FilterResult;        // 关键词黑名单 (< 1ms)
  patternFilter(content: string): FilterResult;         // 正则模式匹配 (< 5ms)
  llmSafetyCheck(content: string): Promise<FilterResult>; // LLM 辅助判断 (< 100ms)
  promptInjectionDetector(content: string): Promise<FilterResult>; // 注入检测 (< 50ms)
}

interface SafetyCheckResult {
  safe: boolean;
  violations: SafetyViolation[];
  confidence: number;          // 0.0 - 1.0
  processingTimeMs: number;
}
```

### 5.4 第三方安全审计准备

审计前需完成的清单：

- [ ] 所有 API 端点认证/鉴权覆盖率 100%
- [ ] 完整的 Intent Validation Pipeline 单元测试和集成测试
- [ ] Prompt Injection 测试用例库（至少 200 条已知攻击模式）
- [ ] 沙箱逃逸测试用例
- [ ] 联邦协议签名验证的边界条件测试
- [ ] 日志审计追踪完整性验证
- [ ] 敏感数据加密存储确认（API keys、签名私钥）

---

## 6. Performance Optimization — 性能优化

### 6.1 性能目标

| 指标 | 目标值 | 测量条件 |
|------|--------|---------|
| World Tick 处理时间 | < 500ms | 1000 Agent 并发 |
| CognitivePacket 生成 (P50) | < 100ms | 含叙事模板渲染 |
| CognitivePacket 生成 (P99) | < 300ms | 含叙事模板渲染 |
| Agent Intent 解析 | < 50ms | 含六级验证管线 |
| Memory 向量检索 (P99) | < 80ms | pgvector HNSW 索引 |
| WebSocket 消息延迟 | < 100ms | 端到端 (服务端处理 + 网络) |
| 数据库查询 (P99) | < 50ms | 含连接池等待时间 |

### 6.2 缓存策略

```typescript
interface CacheStrategy {
  // 叙事模板缓存 — 管理员更新时失效
  narrationTemplateCache: {
    type: 'redis';
    ttl: 3600;                 // 1 小时
    invalidateOn: 'admin_template_update';
    keyPattern: 'nrt:{templateId}:{version}';
  };

  // Action Space 缓存 — 位置/状态变化时失效
  actionSpaceCache: {
    type: 'redis';
    ttl: 60;                   // 1 分钟 (World Tick 周期内有效)
    invalidateOn: 'agent_position_change | agent_state_change';
    keyPattern: 'as:{agentId}:{tick}';
  };

  // Agent 认知上下文缓存 — 每个 Tick 开始时预加载
  cognitiveContextCache: {
    type: 'in-memory';         // 进程内缓存, 减少 Redis RTT
    ttl: 30;                   // 30 秒
    maxSize: 2000;             // LRU, 最多缓存 2000 Agent 的上下文
    keyPattern: 'ctx:{agentId}';
  };

  // Plugin Hook 结果缓存 — 幂等 hook 可缓存
  pluginHookCache: {
    type: 'redis';
    ttl: 300;                  // 5 分钟
    invalidateOn: 'plugin_config_update';
    keyPattern: 'phk:{pluginId}:{hookName}:{inputHash}';
  };
}
```

### 6.3 数据库查询优化

**pgvector 索引调优**:

```sql
-- 向量数量 < 100K 时使用 IVFFlat (构建快, 查询略慢)
CREATE INDEX idx_memories_embedding_ivfflat
ON agent_memories USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- 向量数量 > 100K 时切换到 HNSW (构建慢, 查询快)
CREATE INDEX idx_memories_embedding_hnsw
ON agent_memories USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 200);

-- 设置运行时探测参数
SET ivfflat.probes = 10;       -- IVFFlat 查询时探测的 list 数量
SET hnsw.ef_search = 100;      -- HNSW 查询时的搜索宽度
```

**连接池配置**:

```typescript
const poolConfig = {
  min: 10,                              // 最小连接数
  max: process.env.CPU_CORES * 2,       // 最大连接数 = CPU 核心数 × 2
  idleTimeoutMillis: 30000,             // 空闲连接超时 30s
  connectionTimeoutMillis: 5000,        // 建连超时 5s
  maxWaitingClients: 100,               // 等待队列上限
  statementTimeout: 10000,              // 查询超时 10s
};
```

**高频查询优化**:

```sql
-- 批量获取 Agent 状态 (World Tick 核心查询)
-- 使用 ANY 替代 IN, 避免查询计划缓存失效
SELECT id, position, energy, status, last_action_tick
FROM agents
WHERE id = ANY($1::uuid[])
  AND status = 'active';

-- 为 World Tick 创建部分索引
CREATE INDEX idx_agents_active ON agents (id, position, energy)
WHERE status = 'active';

-- 经济事务批量插入 (使用 UNNEST 替代多行 INSERT)
INSERT INTO transactions (from_agent_id, to_agent_id, amount, type, tick)
SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::int[], $4::text[], $5::int[]);
```

### 6.4 认知循环并行化

```typescript
async function processWorldTick(tick: number, agents: Agent[]): Promise<TickResult> {
  // 阶段 1: 并行生成所有 Agent 的 CognitivePacket
  const packetResults = await Promise.allSettled(
    agents.map(agent => generateCognitivePacket(agent, tick))
  );

  // 阶段 2: 并行收集所有 Agent 的 Intent
  const intentResults = await Promise.allSettled(
    packetResults
      .filter(r => r.status === 'fulfilled')
      .map(r => collectAgentIntent(r.value))
  );

  // 阶段 3: 串行执行 Intent 验证和世界状态更新 (需要一致性)
  const validatedIntents = await validateIntentsBatch(intentResults);
  const worldUpdate = await applyWorldUpdate(validatedIntents, tick);

  // 阶段 4: 并行生成叙事
  const narrationResults = await Promise.allSettled(
    worldUpdate.events.map(event => generateNarration(event))
  );

  return aggregateTickResult(tick, packetResults, intentResults, narrationResults);
}
```

### 6.5 Redis Pipeline 优化

```typescript
async function bulkCacheUpdate(agentStates: AgentState[]): Promise<void> {
  const pipeline = redis.pipeline();
  
  for (const state of agentStates) {
    pipeline.hset(`agent:${state.id}`, {
      position: JSON.stringify(state.position),
      energy: state.energy,
      status: state.status,
    });
    pipeline.expire(`agent:${state.id}`, 120);
  }
  
  // 单次网络往返完成所有写入
  await pipeline.exec();
}
```

### 6.6 压力测试计划

| 测试场景 | Agent 数量 | 持续时间 | 关注指标 |
|----------|-----------|---------|---------|
| 基准测试 | 100 | 10 min | 建立性能基线 |
| 线性增长 | 100 → 1000 (每 5min +100) | 50 min | 拐点检测 |
| 峰值压力 | 1000 | 30 min | P99 延迟、错误率 |
| 持久稳定 | 500 | 4 hours | 内存泄漏、GC 暂停 |
| 突发高峰 | 200 → 1000 → 200 (瞬时) | 15 min | 恢复时间 |
| 极端场景 | 2000 | 10 min | 优雅降级验证 |

---

## 7. Admin Service — 管理后台服务

### 7.1 Dashboard API 设计

```typescript
interface AdminDashboardService {
  // 实时概览
  getRealtimeOverview(): Promise<{
    totalAgents: number;
    activeAgents: number;
    dormantAgents: number;
    offlineAgents: number;
    currentTick: number;
    uptime: number;
  }>;

  // 认知循环指标
  getCognitiveMetrics(timeRange: TimeRange): Promise<{
    cognitiveLoopSuccessRate: number;      // 认知循环成功率
    intentValidationPassRate: number;       // 意图验证通过率
    avgCognitivePacketLatencyMs: number;    // 平均 CognitivePacket 生成延迟
    avgNarrationLatencyMs: number;          // 平均叙事生成延迟
    intentRejectionBreakdown: Record<ValidationStage, number>; // 各级拒绝分布
  }>;

  // 经济指标
  getEconomyMetrics(timeRange: TimeRange): Promise<{
    totalTCInCirculation: number;           // 流通中的 TC 总量
    transactionVolume: number;              // 交易量
    inflationRate: number;                  // 通胀率 (与初始发行量比)
    giniCoefficient: number;               // 基尼系数 (财富分配)
    topAgentsByWealth: AgentSummary[];      // 财富 Top 10
    topAgentsByReputation: AgentSummary[];  // 声望 Top 10
    topAgentsByConnections: AgentSummary[]; // 社交 Top 10
  }>;

  // 系统健康
  getSystemHealth(): Promise<{
    cpuUsagePercent: number;
    memoryUsageMb: number;
    dbConnectionPoolUsage: number;          // 连接池利用率
    redisMemoryUsageMb: number;
    messageQueueDepth: number;              // 消息队列积压深度
    wsConnectionCount: number;              // WebSocket 连接数
  }>;

  // Plugin / Mod 管理
  getPluginStatus(): Promise<PluginStatusReport[]>;
  getModReviewQueue(): Promise<ModSubmission[]>;
  
  // 审计日志
  getAuditLogs(query: AuditLogQuery): Promise<PaginatedResult<AuditLog>>;
}
```

### 7.2 分析查询

```sql
-- 认知循环成功率 (过去 1 小时, 按 5 分钟聚合)
SELECT
  date_trunc('5 minutes', created_at) AS bucket,
  COUNT(*) FILTER (WHERE status = 'success') * 100.0 / COUNT(*) AS success_rate,
  AVG(processing_time_ms) AS avg_latency_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY processing_time_ms) AS p99_latency_ms
FROM cognitive_loop_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY bucket
ORDER BY bucket;

-- 经济 — 基尼系数计算
WITH agent_wealth AS (
  SELECT agent_id, balance AS wealth
  FROM agent_wallets
  WHERE currency_type = 'town_coin'
  ORDER BY balance
),
ranked AS (
  SELECT wealth, ROW_NUMBER() OVER (ORDER BY wealth) AS rank, COUNT(*) OVER () AS n
  FROM agent_wealth
)
SELECT
  1 - 2.0 * SUM(wealth * (n - rank + 0.5)) / (n * SUM(wealth)) AS gini_coefficient
FROM ranked;

-- 意图验证拒绝分布
SELECT
  failed_stage,
  COUNT(*) AS rejection_count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () AS percentage
FROM intent_validation_logs
WHERE valid = false
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY failed_stage
ORDER BY rejection_count DESC;
```

### 7.3 认知循环回放

Narration Log Replay 功能允许管理员完整回放某个 Agent 在特定时间段内的全部认知循环过程，用于调试和问题排查。

```typescript
interface CognitiveReplayService {
  // 获取指定 Agent 在时间范围内的全部认知循环日志
  getReplayTimeline(
    agentId: string,
    startTick: number,
    endTick: number
  ): Promise<CognitiveReplayEntry[]>;

  // 单次认知循环详情
  getTickDetail(agentId: string, tick: number): Promise<{
    cognitivePacket: CognitivePacket;       // 输入: 完整的认知包
    llmPrompt: string;                       // 发送给 LLM 的完整 prompt
    llmResponse: string;                     // LLM 原始返回
    parsedIntent: AgentIntent;               // 解析后的意图
    validationResult: ValidationResult;      // 验证结果
    worldEffect: WorldEffect;                // 世界状态变更
    narrationOutput: string;                 // 生成的叙事文本
    timings: Record<string, number>;         // 各阶段耗时 (ms)
  }>;
}

interface CognitiveReplayEntry {
  tick: number;
  timestamp: string;
  agentId: string;
  actionId: string;
  success: boolean;
  totalLatencyMs: number;
  summary: string;                 // 单行摘要 (e.g., "spoke to AgentB about trade")
}
```

---

## 8. Monitoring & Alerting — 监控与告警

### 8.1 指标采集

所有服务通过 Prometheus client 暴露指标，由 Prometheus Server 定期 scrape。关键指标分为四类：

**业务指标 (Business Metrics)**:
- `agora_agents_total{status}` — Agent 总数 (按状态分组)
- `agora_cognitive_loop_duration_seconds` — 认知循环耗时 (histogram)
- `agora_intent_validation_total{stage,result}` — 意图验证结果计数
- `agora_narration_generation_duration_seconds` — 叙事生成耗时 (histogram)
- `agora_transactions_total{type}` — 经济交易计数

**系统指标 (System Metrics)**:
- `agora_db_pool_active_connections` — 数据库活跃连接数
- `agora_db_pool_waiting_count` — 数据库等待队列长度
- `agora_redis_memory_bytes` — Redis 内存占用
- `agora_ws_connections_total` — WebSocket 连接数
- `agora_message_queue_depth` — 消息队列深度

**Plugin 指标 (Plugin Metrics)**:
- `agora_plugin_hook_duration_seconds{pluginId,hookName}` — Hook 执行耗时
- `agora_plugin_sandbox_cpu_seconds{pluginId}` — 沙箱 CPU 消耗
- `agora_plugin_sandbox_memory_bytes{pluginId}` — 沙箱内存占用
- `agora_plugin_errors_total{pluginId,errorType}` — 插件错误计数

**Federation 指标 (Federation Metrics)**:
- `agora_federation_travel_requests_total{status}` — 跨镇迁移请求计数
- `agora_federation_transfer_duration_seconds` — 迁移完成耗时
- `agora_federation_peer_health{townId}` — 联邦节点健康状态

### 8.2 告警规则

```yaml
# prometheus-alerts.yml
groups:
  - name: agora_critical
    rules:
      - alert: CognitiveLoopSuccessRateLow
        expr: |
          rate(agora_cognitive_loop_total{result="success"}[5m])
          / rate(agora_cognitive_loop_total[5m]) < 0.95
        for: 3m
        labels:
          severity: critical
        annotations:
          summary: "认知循环成功率低于 95%"
          description: "过去 5 分钟认知循环成功率 {{ $value | humanizePercentage }}"

      - alert: IntentValidationPassRateLow
        expr: |
          rate(agora_intent_validation_total{result="pass"}[5m])
          / rate(agora_intent_validation_total[5m]) < 0.80
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "意图验证通过率低于 80%"

      - alert: NarrationLatencyHigh
        expr: |
          histogram_quantile(0.99,
            rate(agora_narration_generation_duration_seconds_bucket[5m])
          ) > 0.2
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "叙事生成 P99 延迟超过 200ms"

      - alert: DBConnectionPoolSaturated
        expr: |
          agora_db_pool_active_connections
          / agora_db_pool_max_connections > 0.80
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "数据库连接池利用率超过 80%"

      - alert: TokenConsumptionOverBudget
        expr: |
          rate(agora_token_consumption_total[1h])
          / agora_token_budget_per_hour > 1.20
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Token 消耗超过预算 120%"

      - alert: MemoryVectorIndexLatencyHigh
        expr: |
          histogram_quantile(0.99,
            rate(agora_memory_vector_retrieval_duration_seconds_bucket[5m])
          ) > 0.1
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "记忆向量检索 P99 延迟超过 100ms"

      - alert: NarrationEngineThroughputLow
        expr: |
          rate(agora_narration_generation_total[1m])
          < agora_agents_total{status="active"} * 2
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "叙事引擎吞吐量低于活跃 Agent 数 × 2/秒"
```

### 8.3 日志体系

| 日志类型 | 内容 | 存储方案 | 保留策略 |
|----------|------|---------|---------|
| Access Log | API 调用、认证事件、请求/响应元数据 | ELK Stack (Elasticsearch + Logstash + Kibana) | 热数据 90 天 |
| Cognitive Log | CognitivePacket、Intent、验证结果、叙事输出 | PostgreSQL (热) + S3 Archive (冷) | 30 天热 + 1 年冷 |
| Transaction Log | 所有经济事件（交易、工资、市场买卖） | PostgreSQL | 永久保留 |
| Audit Log | 管理员操作、安全事件、Plugin 状态变更 | PostgreSQL | 1 年 |
| Federation Log | 跨镇迁移请求、Agent 传输记录 | PostgreSQL | 1 年 |

Cognitive Log 的冷热分离方案：

```typescript
// 每日定时任务: 将超过 30 天的 Cognitive Log 归档到 S3
interface CognitiveLogArchiver {
  archiveOldLogs(olderThanDays: number): Promise<ArchiveResult>;
  restoreFromArchive(agentId: string, dateRange: DateRange): Promise<CognitiveLog[]>;
}

// 归档后在 PostgreSQL 中保留摘要索引, 支持按 agentId + tick 快速定位 S3 对象
// CREATE TABLE cognitive_log_archive_index (
//   agent_id UUID,
//   tick_range INT4RANGE,
//   s3_key TEXT,
//   archived_at TIMESTAMPTZ
// );
```

---

## 9. SDK & Documentation — 开发者 SDK 与文档

### 9.1 SDK 结构

```
@agora-town/sdk
├── core/
│   ├── plugin.ts          # TownPlugin 接口 + 基类
│   ├── hooks.ts           # Hook 类型定义
│   └── types.ts           # 公共类型 (AgentIntent, CognitivePacket 等)
├── mod/
│   ├── mod-builder.ts     # Mod 构建工具
│   ├── mod-validator.ts   # 本地验证器 (模拟审核检查)
│   └── mod-packager.ts    # 打包为 .agoramod 格式
├── federation/
│   ├── protocol.ts        # FederationProtocol 接口
│   └── agent-export.ts    # AgentExportData 序列化/反序列化
├── testing/
│   ├── mock-town.ts       # 模拟镇子环境 (用于插件本地测试)
│   ├── mock-agent.ts      # 模拟 Agent
│   └── test-harness.ts    # 测试框架
└── cli/
    ├── init.ts            # agora init <plugin-name>
    ├── dev.ts             # agora dev (热重载本地开发服务)
    ├── validate.ts        # agora validate (本地校验)
    ├── package.ts         # agora package (打包)
    └── publish.ts         # agora publish (提交到 Mod Workshop)
```

### 9.2 API 文档自动生成

API 文档基于 OpenAPI 3.0 规范自动生成，源头为代码中的 TSDoc 注释和路由装饰器。

```typescript
// 使用装饰器标注 API 端点, 自动生成 OpenAPI spec
@ApiEndpoint({
  method: 'POST',
  path: '/api/v1/plugins/{pluginId}/enable',
  summary: '启用指定插件',
  tags: ['Plugin Management'],
  auth: 'admin',
})
@ApiParam('pluginId', { type: 'string', format: 'uuid', description: '插件 ID' })
@ApiResponse(200, { description: '插件已启用', schema: PluginStatusResponse })
@ApiResponse(404, { description: '插件不存在' })
@ApiResponse(409, { description: '插件存在未解决的依赖冲突' })
async enablePlugin(pluginId: string): Promise<PluginStatusResponse> {
  // ...
}
```

### 9.3 CognitivePacket 协议规范

作为开发者文档核心的 CognitivePacket Protocol Spec，详细描述认知包的完整结构、各字段语义、版本兼容性规则。该规范以 JSON Schema + Markdown 形式发布，供第三方插件开发者参考。

```typescript
/**
 * CognitivePacket Protocol v1.0
 * 
 * CognitivePacket 是 Agora Town 认知循环的核心数据结构。
 * 每个 World Tick, 系统为每个活跃 Agent 构建一个 CognitivePacket,
 * 作为 LLM 推理的输入上下文。
 */
interface CognitivePacketSpec {
  version: '1.0';
  agentId: string;
  tick: number;
  
  // --- 感知层 ---
  perception: {
    location: LocationContext;           // 当前位置及可见区域描述
    nearbyAgents: AgentPerception[];     // 附近 Agent 的可见信息
    nearbyObjects: ObjectPerception[];   // 附近物体/建筑
    recentEvents: EventPerception[];     // 最近发生的事件
    timeOfDay: string;                   // 镇子内的时间 (dawn/morning/afternoon/dusk/night)
    weather: string;                     // 天气状态
  };
  
  // --- 记忆层 ---
  memory: {
    relevantMemories: MemoryEntry[];     // 基于当前情境检索的相关记忆 (max 10)
    recentConversations: ConversationEntry[]; // 最近对话 (max 5)
    activeGoals: GoalEntry[];            // 当前活跃目标
    emotionalState: EmotionalState;      // 情绪状态
  };
  
  // --- 行动层 ---
  actionSpace: {
    availableActions: ActionDefinition[]; // 当前可执行的动作列表
    constraints: string[];               // 当前约束条件 (体力不足, 商店关门等)
  };
  
  // --- 叙事层 ---
  narration: {
    currentNarrative: string;            // 当前叙事上下文摘要
    activeStorylines: string[];          // 参与中的故事线
  };
}
```

---

## 10. Database Migrations — 数据库迁移

### 10.1 新增表

```sql
-- ========================================
-- Phase 5: 插件系统
-- ========================================

CREATE TABLE plugins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL,
  vendor VARCHAR(64) NOT NULL,
  version VARCHAR(32) NOT NULL,
  type VARCHAR(32) NOT NULL CHECK (type IN ('narration', 'persona', 'gameplay', 'integration')),
  config JSONB NOT NULL DEFAULT '{}',
  sandbox_config JSONB NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'loading', 'active', 'disabled', 'error', 'unloaded')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor, name, version)
);

CREATE TABLE plugin_hooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id UUID NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  hook_type VARCHAR(64) NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plugin_id, hook_type)
);

CREATE INDEX idx_plugin_hooks_type_priority ON plugin_hooks (hook_type, priority)
  WHERE is_active = true;

-- ========================================
-- Phase 5: Mod 系统
-- ========================================

CREATE TABLE mods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  version VARCHAR(32) NOT NULL,
  type VARCHAR(32) NOT NULL CHECK (type IN ('narration', 'persona', 'gameplay')),
  package_url TEXT,                      -- S3 存储地址
  package_size_bytes INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected', 'published', 'unpublished')),
  review_notes TEXT,
  reviewer_id UUID,
  download_count INTEGER NOT NULL DEFAULT 0,
  avg_rating NUMERIC(3, 2) DEFAULT 0.00,
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  UNIQUE (author_id, name, version)
);

CREATE INDEX idx_mods_status ON mods (status);
CREATE INDEX idx_mods_published ON mods (type, avg_rating DESC, download_count DESC)
  WHERE status = 'published';

CREATE TABLE mod_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mod_id UUID NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mod_id, user_id)
);

CREATE TABLE town_installed_mods (
  town_id UUID NOT NULL,
  mod_id UUID NOT NULL REFERENCES mods(id),
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  config JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (town_id, mod_id)
);

-- ========================================
-- Phase 5: 多镇联邦
-- ========================================

CREATE TABLE federation_towns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL,
  endpoint TEXT NOT NULL,
  public_key TEXT NOT NULL,               -- Ed25519 公钥 (Base64)
  population INTEGER NOT NULL DEFAULT 0,
  max_population INTEGER NOT NULL DEFAULT 1000,
  theme TEXT,
  agora_version VARCHAR(32),
  status VARCHAR(20) NOT NULL DEFAULT 'online'
    CHECK (status IN ('online', 'maintenance', 'offline', 'banned')),
  last_heartbeat_at TIMESTAMPTZ,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE travel_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  from_town_id UUID NOT NULL,
  to_town_id UUID NOT NULL REFERENCES federation_towns(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'completed', 'expired')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  signature TEXT NOT NULL,                -- 源镇 Ed25519 签名
  agent_export_data JSONB,               -- 迁移时的 Agent 快照
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_travel_tickets_agent ON travel_tickets (agent_id, status);
CREATE INDEX idx_travel_tickets_pending ON travel_tickets (expires_at)
  WHERE status = 'pending';

-- ========================================
-- Phase 5: 管理审计与系统指标
-- ========================================

CREATE TABLE admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32),               -- 'plugin', 'mod', 'agent', 'federation', 'config'
  target_id UUID,
  details JSONB NOT NULL DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_admin ON admin_audit_logs (admin_id, created_at DESC);
CREATE INDEX idx_audit_logs_target ON admin_audit_logs (target_type, target_id, created_at DESC);

CREATE TABLE system_metrics (
  timestamp TIMESTAMPTZ NOT NULL,
  metric_name VARCHAR(128) NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL,
  labels JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (timestamp, metric_name)
);

-- 使用 TimescaleDB 扩展优化时序数据查询 (如果可用)
-- SELECT create_hypertable('system_metrics', 'timestamp');

CREATE TABLE cognitive_log_archive_index (
  agent_id UUID NOT NULL,
  tick_start INTEGER NOT NULL,
  tick_end INTEGER NOT NULL,
  s3_key TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, tick_start)
);

-- ========================================
-- Phase 5: 意图验证日志
-- ========================================

CREATE TABLE intent_validation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  tick INTEGER NOT NULL,
  action_id VARCHAR(64) NOT NULL,
  valid BOOLEAN NOT NULL,
  failed_stage VARCHAR(32),
  reason TEXT,
  severity VARCHAR(10),
  processing_time_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_intent_validation_agent_tick ON intent_validation_logs (agent_id, tick);
CREATE INDEX idx_intent_validation_failed ON intent_validation_logs (failed_stage, created_at DESC)
  WHERE valid = false;
```

---

## 11. API Endpoints

### 11.1 Plugin Management API

| Method | Path | 描述 | Auth |
|--------|------|------|------|
| `GET` | `/api/v1/plugins` | 获取全部插件列表 | Admin |
| `POST` | `/api/v1/plugins` | 注册新插件 | Admin |
| `GET` | `/api/v1/plugins/:id` | 获取插件详情 | Admin |
| `POST` | `/api/v1/plugins/:id/enable` | 启用插件 | Admin |
| `POST` | `/api/v1/plugins/:id/disable` | 禁用插件 | Admin |
| `DELETE` | `/api/v1/plugins/:id` | 卸载并删除插件 | Admin |
| `GET` | `/api/v1/plugins/:id/hooks` | 获取插件注册的 hooks | Admin |
| `GET` | `/api/v1/plugins/:id/metrics` | 获取插件资源消耗指标 | Admin |

### 11.2 Mod Marketplace API

| Method | Path | 描述 | Auth |
|--------|------|------|------|
| `POST` | `/api/v1/mods/submit` | 提交 Mod 审核 | User |
| `GET` | `/api/v1/mods/marketplace` | 搜索已发布的 Mods | Public |
| `GET` | `/api/v1/mods/:id` | Mod 详情 | Public |
| `POST` | `/api/v1/mods/:id/install` | 安装 Mod 到当前镇子 | Admin |
| `DELETE` | `/api/v1/mods/:id/install` | 卸载 Mod | Admin |
| `POST` | `/api/v1/mods/:id/rate` | 评分 + 评价 | User |
| `GET` | `/api/v1/mods/review-queue` | 获取审核队列 | Admin |
| `POST` | `/api/v1/mods/:id/approve` | 审核通过 | Admin |
| `POST` | `/api/v1/mods/:id/reject` | 审核拒绝 | Admin |

### 11.3 Federation API

| Method | Path | 描述 | Auth |
|--------|------|------|------|
| `GET` | `/api/v1/federation/towns` | 发现联邦内的镇子 | Public |
| `POST` | `/api/v1/federation/towns` | 注册新镇子到联邦 | Federation |
| `POST` | `/api/v1/federation/travel/request` | 请求跨镇旅行 | Internal |
| `POST` | `/api/v1/federation/travel/transfer` | 传输 Agent 数据 | Federation |
| `POST` | `/api/v1/federation/travel/receive` | 接收 Agent 数据 | Federation |
| `GET` | `/api/v1/federation/travel/:ticketId` | 查询旅行票据状态 | Internal |
| `POST` | `/api/v1/federation/heartbeat` | 联邦心跳 | Federation |

**Auth 说明**:
- `Federation`: 使用 Ed25519 签名的镇子间互信认证
- `Internal`: 仅限同镇内部服务调用
- `Admin`: 管理员 JWT Token
- `User`: 用户 JWT Token

### 11.4 Admin Dashboard API

| Method | Path | 描述 | Auth |
|--------|------|------|------|
| `GET` | `/api/v1/admin/overview` | 实时概览数据 | Admin |
| `GET` | `/api/v1/admin/cognitive-metrics` | 认知循环指标 | Admin |
| `GET` | `/api/v1/admin/economy-metrics` | 经济指标 | Admin |
| `GET` | `/api/v1/admin/system-health` | 系统健康状态 | Admin |
| `GET` | `/api/v1/admin/audit-logs` | 审计日志查询 | Admin |
| `GET` | `/api/v1/admin/replay/:agentId` | 认知循环回放时间线 | Admin |
| `GET` | `/api/v1/admin/replay/:agentId/:tick` | 单次认知循环详情 | Admin |

### 11.5 Monitoring API

| Method | Path | 描述 | Auth |
|--------|------|------|------|
| `GET` | `/metrics` | Prometheus 指标端点 | Internal |
| `GET` | `/health` | 健康检查 (liveness) | Public |
| `GET` | `/ready` | 就绪检查 (readiness) | Public |

---

## 12. Testing Strategy — 测试策略

### 12.1 单元测试与集成测试

| 模块 | 测试类型 | 关键用例 |
|------|---------|---------|
| Intent Validation Pipeline | 单元测试 | 每级验证的通过/拒绝场景，边界值 |
| Plugin Sandbox | 集成测试 | CPU 超限终止、内存超限 OOM、网络隔离验证 |
| Federation Protocol | 集成测试 | 签名验证、过期 Ticket 拒绝、数据完整性 |
| Content Safety Filter | 单元测试 | 200+ 已知 Prompt Injection 模式库 |
| Mod Submission Pipeline | 集成测试 | 自动化检查通过/拒绝、审核流程完整性 |
| Admin Analytics Queries | 集成测试 | 大数据量下查询正确性和性能 |

### 12.2 压力测试 (k6 脚本)

```javascript
// k6-stress-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const cognitiveLatency = new Trend('cognitive_packet_latency');
const intentLatency = new Trend('intent_validation_latency');
const errorRate = new Rate('error_rate');

export const options = {
  scenarios: {
    // 场景 1: 线性增长到 1000 Agent
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m', target: 200 },
        { duration: '5m', target: 500 },
        { duration: '5m', target: 1000 },
        { duration: '10m', target: 1000 },   // 峰值保持
        { duration: '5m', target: 0 },        // 冷却
      ],
    },
    // 场景 2: 突发高峰
    spike: {
      executor: 'ramping-vus',
      startVUs: 200,
      startTime: '35m',
      stages: [
        { duration: '30s', target: 1000 },    // 瞬时拉满
        { duration: '5m', target: 1000 },
        { duration: '30s', target: 200 },     // 瞬时回落
      ],
    },
  },
  thresholds: {
    'cognitive_packet_latency': ['p(99) < 300'],
    'intent_validation_latency': ['p(99) < 50'],
    'error_rate': ['rate < 0.05'],            // 错误率 < 5%
    'http_req_duration': ['p(99) < 500'],
  },
};

export default function () {
  // 模拟单个 Agent 的认知循环
  const agentId = `agent-${__VU}`;
  
  // 1. 获取 CognitivePacket
  const packetStart = Date.now();
  const packetRes = http.get(
    `${__ENV.BASE_URL}/api/v1/agents/${agentId}/cognitive-packet`
  );
  cognitiveLatency.add(Date.now() - packetStart);
  check(packetRes, { 'packet status 200': (r) => r.status === 200 });

  // 2. 提交 Intent
  const intentStart = Date.now();
  const intentRes = http.post(
    `${__ENV.BASE_URL}/api/v1/agents/${agentId}/intent`,
    JSON.stringify({
      actionId: 'speak',
      parameters: { message: `Hello from ${agentId}` },
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  intentLatency.add(Date.now() - intentStart);
  check(intentRes, { 'intent status 200': (r) => r.status === 200 });

  errorRate.add(packetRes.status !== 200 || intentRes.status !== 200);
  
  sleep(1); // 模拟 1 秒一个 tick
}
```

### 12.3 安全渗透测试

| 测试类别 | 测试内容 | 工具/方法 |
|----------|---------|----------|
| Prompt Injection | 在 speech/monologue 中注入 system prompt 覆盖指令 | 自研测试集 (200+ 模式) |
| Action Space Escape | 提交不在 action space 中的 actionId | 自动化 fuzzing |
| Token Budget Attack | 构造超长 context 消耗 token 预算 | 自定义 payload |
| Memory Poisoning | 通过对话注入误导性记忆 | 手工测试 + 自动化验证 |
| Sandbox Escape | 尝试从 Plugin 沙箱逃逸 (prototype pollution, eval) | 安全专家手工测试 |
| Federation Spoofing | 伪造联邦签名、重放 TravelTicket | 自定义脚本 |
| API 认证绕过 | 未授权访问 Admin/Federation API | OWASP ZAP |
| SQL Injection | 所有数据库查询参数化检查 | sqlmap + 代码审计 |

### 12.4 混沌工程

```typescript
interface ChaosExperiments {
  // 数据库故障
  'db-connection-drop': {
    description: '随机断开 50% 数据库连接';
    expectedBehavior: '系统自动重连, 请求短暂排队后恢复';
    verifyMetric: '错误率 < 5%, 恢复时间 < 30s';
  };

  // Redis 故障
  'redis-latency-injection': {
    description: '注入 500ms Redis 延迟';
    expectedBehavior: '缓存降级为直接 DB 查询, 延迟上升但不报错';
    verifyMetric: 'P99 < 1000ms, 错误率 = 0%';
  };

  // LLM API 故障
  'llm-timeout': {
    description: 'LLM API 超时 (100% 请求)';
    expectedBehavior: 'Agent 进入 dormant 状态, 认知循环暂停, 系统不崩溃';
    verifyMetric: '无 5xx 错误, 认知循环优雅降级';
  };

  // 联邦节点故障
  'federation-peer-offline': {
    description: '联邦节点突然下线';
    expectedBehavior: '进行中的迁移标记为 failed, Ticket 过期自动清理';
    verifyMetric: '无数据丢失, Agent 回退到源镇';
  };

  // 突发流量
  'traffic-spike': {
    description: '10 秒内 WebSocket 连接从 100 跳到 2000';
    expectedBehavior: '连接限流, 超出部分优雅拒绝 (429)';
    verifyMetric: '已连接用户不受影响';
  };
}
```

---

## 13. Acceptance Criteria — 验收标准

### 13.1 功能验收

| 编号 | 验收项 | 验证方法 | 通过标准 |
|------|--------|---------|---------|
| AC-5.01 | Plugin 生命周期完整 | 集成测试 | register → load → enable → disable → unload 全流程成功 |
| AC-5.02 | Plugin 沙箱隔离有效 | 安全测试 | CPU/内存超限自动终止，无沙箱逃逸 |
| AC-5.03 | Mod 提交审核流程 | E2E 测试 | 提交 → 自动检查 → 人工审核 → 发布 全流程 < 24h |
| AC-5.04 | Mod Marketplace 功能完整 | E2E 测试 | 搜索、安装、卸载、评分功能正常 |
| AC-5.05 | 跨镇 Agent 迁移成功 | 集成测试 | Agent 迁移后 persona + 核心记忆 + 背包完整 |
| AC-5.06 | 联邦叙事连续性 | 手工验证 | 出发/到达叙事自然、记忆正确标记为 distant |
| AC-5.07 | Intent Validation 六级管线 | 单元测试 + 渗透测试 | 每级验证均有通过/拒绝测试用例，0 逃逸 |
| AC-5.08 | Prompt Injection 防御 | 安全测试 | 200+ 已知攻击模式全部拦截 |
| AC-5.09 | Admin Dashboard 数据准确 | 集成测试 | 各指标与实际数据偏差 < 1% |
| AC-5.10 | 认知循环回放完整 | 手工验证 | 可回放任意 Agent 任意 Tick 的完整认知过程 |

### 13.2 性能验收

| 编号 | 验收项 | 验证方法 | 通过标准 |
|------|--------|---------|---------|
| AC-5.11 | 1000 Agent 并发 | k6 压力测试 | World Tick < 500ms, 持续 30 分钟无降级 |
| AC-5.12 | CognitivePacket P99 | k6 压力测试 | < 300ms (1000 Agent 并发下) |
| AC-5.13 | 数据库查询 P99 | 压力测试 + 慢查询日志 | < 50ms |
| AC-5.14 | 向量检索 P99 | 基准测试 (100K+ 向量) | < 80ms |
| AC-5.15 | WebSocket 延迟 | 端到端测试 | < 100ms |
| AC-5.16 | 4 小时持久稳定 | 持久压力测试 | 无内存泄漏 (RSS 增长 < 10%), 无 GC 长暂停 (> 100ms) |
| AC-5.17 | 突发流量恢复 | 突发测试 | 恢复至正常延迟 < 60s |

### 13.3 安全验收

| 编号 | 验收项 | 验证方法 | 通过标准 |
|------|--------|---------|---------|
| AC-5.18 | 第三方安全审计 | 外部审计报告 | 无 Critical / High 级别未修复漏洞 |
| AC-5.19 | API 认证覆盖率 | 代码审计 | 100% 端点有正确的认证/鉴权 |
| AC-5.20 | SQL 注入防御 | sqlmap 扫描 | 0 发现 |
| AC-5.21 | 联邦签名验证 | 集成测试 | 伪造签名 100% 拒绝 |
| AC-5.22 | 数据加密 | 配置审计 | 敏感字段 AES-256 加密存储, TLS 1.3 传输加密 |

### 13.4 运维验收

| 编号 | 验收项 | 验证方法 | 通过标准 |
|------|--------|---------|---------|
| AC-5.23 | 告警覆盖率 | 配置审查 | 所有关键指标有告警规则 |
| AC-5.24 | 日志完整性 | E2E 追踪 | 任意请求可通过 traceId 追踪完整链路 |
| AC-5.25 | 混沌工程通过 | 混沌实验 | 所有 5 个实验场景均通过 |
| AC-5.26 | SDK 文档完整 | 开发者试用 | 新开发者可在 2 小时内完成第一个 Plugin 开发 |
| AC-5.27 | API 文档自动生成 | CI 流水线 | OpenAPI spec 与代码同步, 无过期端点 |

---

## 附录 A: 依赖的 Phase 1-4 核心接口

本文档中引用的以下接口定义于之前阶段的规格文档中：

- `AgentIntent` — Phase 1: 认知循环核心
- `CognitivePacket` — Phase 1: 认知循环核心
- `ActionSpace` — Phase 1: 行动空间计算
- `NarrationContext` / `NarrationTemplate` — Phase 3: 叙事引擎
- `AgentMemory` — Phase 1: 记忆系统
- `AgentPersona` — Phase 1: Agent 人格定义
- `InventoryItem` — Phase 2: 经济系统
- `TownSkill` — Phase 2: 技能系统

## 附录 B: 配置参考

```yaml
# config/phase5.yaml
plugin:
  maxPluginsPerTown: 20
  defaultSandbox:
    maxCpuMs: 100
    maxMemoryMb: 64
    timeout: 5000

mod:
  maxPackageSizeMb: 10
  autoCheckTimeout: 60000
  sandbox:
    maxCpuMs: 50
    maxMemoryMb: 32
    maxNetworkRequests: 0

federation:
  heartbeatIntervalMs: 30000
  travelTicketTtlMs: 1800000     # 30 分钟
  maxCoreMemories: 50
  signatureAlgorithm: 'Ed25519'

security:
  intentValidation:
    rateLimitPerMinute: 30
    anomalyDetectionWindow: '1h'
    contentSafety:
      keywordListVersion: 'v2.3'
      llmSafetyModel: 'content-safety-v1'
  promptInjection:
    detectionModel: 'injection-detector-v1'
    blockThreshold: 0.85

performance:
  dbPool:
    min: 10
    max: 32                       # CPU cores × 2
    idleTimeoutMs: 30000
  redis:
    maxRetriesPerRequest: 3
    enableOfflineQueue: true
  cache:
    narrationTemplateTtl: 3600
    actionSpaceTtl: 60
    cognitiveContextMaxSize: 2000

monitoring:
  prometheusPort: 9090
  alertmanagerEndpoint: 'http://alertmanager:9093'
  logRetention:
    access: '90d'
    cognitive: '30d'
    transaction: 'permanent'
    audit: '365d'
```

---

> **文档结束** — Phase 5: 扩展性、安全加固与生产就绪
