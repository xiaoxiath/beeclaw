# Agora Town Phase 2 后端技术规格文档

## 记忆人格与社交经济系统 (Month 4-6, Alpha)

---

**版本**: 2.0.0-alpha  
**阶段**: Phase 2  
**时间跨度**: 第4-6月  
**前置依赖**: Phase 1（World Engine、Narration Engine、Cognitive Loop、Agent Runtime Engine）  
**文档状态**: 待评审

---

## 目录

1. [概述](#1-概述)
2. [记忆服务规格](#2-记忆服务规格)
3. [人格服务规格](#3-人格服务规格)
4. [增强行动空间](#4-增强行动空间)
5. [经济服务](#5-经济服务)
6. [任务服务](#6-任务服务)
7. [关系服务](#7-关系服务)
8. [休眠模式服务](#8-休眠模式服务)
9. [天气服务](#9-天气服务)
10. [数据库迁移](#10-数据库迁移)
11. [新增 API 端点](#11-新增-api-端点)
12. [新增消息队列任务](#12-新增消息队列任务)
13. [测试策略](#13-测试策略)
14. [验收标准](#14-验收标准)

---

## 1. 概述

### 1.1 阶段目标

Phase 2 的核心目标是赋予 Agent 「记忆」「人格」和「社会性」。在 Phase 1 已完成的世界引擎、叙事引擎、认知循环和 Agent 运行时基础上，本阶段将构建：

- **记忆协议 (Agent Memory Protocol)**: 4 类记忆（情景、社交、空间、情感）+ pgvector 语义检索 + 记忆衰减机制
- **人格系统 (Agent Persona System)**: Big Five 人格模型 + 行为模式 + 人格影响叙事风格
- **增强行动空间 (Enhanced Action Space)**: 动态计算、复合行动、L3 创意/自由行动
- **多叙事风格 (Multi-Narration Styles)**: 5 种叙事风格基于人格自动选择
- **住房系统 (Housing System)**: 1-3 级升级、基础家具、家居认知加成
- **经济系统 MVP (Economy System)**: TownCoin 货币、叙事驱动交易、市场挂单
- **任务系统 (Task System)**: 每日任务 + 主线剧情前 3 章
- **关系系统 (Relationship System)**: 好感度、信任度、熟悉度，关系影响叙事
- **休眠模式 (Dormant Mode)**: 离线 Agent 的轻量 AI + 唤醒条件
- **天气与昼夜 (Weather & Day/Night)**: 天气系统影响叙事和行动空间

### 1.2 Phase 1 依赖项

| Phase 1 模块 | Phase 2 使用方式 |
|---|---|
| World Engine | 天气系统集成、住房系统集成到世界地图 |
| Narration Engine | 多叙事风格扩展、关系/天气影响叙事上下文 |
| Cognitive Loop | 记忆检索注入认知上下文、人格影响决策权重 |
| Agent Runtime Engine | 休眠模式管理、增强行动空间替换原有行动计算 |
| 数据库 (PostgreSQL) | 新增 pgvector 扩展、新增 10+ 张表 |
| 消息队列 (BullMQ) | 新增 memory-embedding、persona-evolution 等队列 |

### 1.3 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    Agent Runtime Engine                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │ Memory   │ │ Persona  │ │ Relation │ │ Dormant    │ │
│  │ Service  │ │ Service  │ │ Service  │ │ Mode Svc   │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘ │
│       │             │            │              │        │
│  ┌────┴─────────────┴────────────┴──────────────┴──┐    │
│  │              Cognitive Loop (Enhanced)            │    │
│  └────┬─────────────┬────────────┬─────────────────┘    │
│       │             │            │                       │
│  ┌────┴─────┐ ┌─────┴────┐ ┌────┴─────┐                │
│  │ Enhanced │ │ Narration│ │ Economy  │                │
│  │ Action   │ │ Engine   │ │ Service  │                │
│  │ Space    │ │ (Multi)  │ │          │                │
│  └──────────┘ └──────────┘ └──────────┘                │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │ Task     │ │ Housing  │ │ Weather  │                │
│  │ Service  │ │ Service  │ │ Service  │                │
│  └──────────┘ └──────────┘ └──────────┘                │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 记忆服务规格

### 2.1 数据模型

```typescript
type MemoryType = 'episodic' | 'social' | 'spatial' | 'emotional';

interface EmotionalTag {
  emotion: string;    // 'joy' | 'sadness' | 'anger' | 'fear' | 'surprise' | 'trust' | 'disgust' | 'anticipation'
  intensity: number;  // 0-1
}

interface AgentMemory {
  id: string;                    // UUID v7（时间有序）
  agentId: string;               // 所属 Agent
  type: MemoryType;              // 记忆类型
  content: string;               // 原始内容（最大 2000 字符）
  summary: string;               // LLM 生成的摘要（最大 500 字符）
  embedding: number[];           // 1536 维向量（OpenAI text-embedding-3-small）
  involvedAgents: string[];      // 涉及的其他 Agent ID
  emotionalTags: EmotionalTag[]; // 情感标签
  importance: number;            // 0-1，重要性
  decayFactor: number;           // 衰减因子，初始为 1.0
  locationX: number;             // 记忆发生地 X 坐标
  locationY: number;             // 记忆发生地 Y 坐标
  worldTick: number;             // 记忆产生时的世界 Tick
  lastRecalledAt: Date;          // 最后被召回的时间
  createdAt: Date;
  updatedAt: Date;
}
```

### 2.2 记忆写入规则

每种记忆类型有明确的写入触发条件：

| 记忆类型 | 触发条件 | 重要性初始值 | 示例 |
|---|---|---|---|
| episodic | 完成一个行动；参与事件；到达新地点 | 根据行动结果：成功 0.5，失败 0.4，关键事件 0.8 | "我在市场广场和小明交易了一把铁剑" |
| social | 对话结束；关系变化；观察到其他 Agent 行为 | 对话 0.4，关系变化 0.6，观察 0.3 | "小红告诉我她不信任铁匠" |
| spatial | 进入新区域；发现新地点；环境变化 | 新区域 0.5，新发现 0.7，环境变化 0.3 | "城镇东边有一片新开放的森林" |
| emotional | 情绪变化 >20%；重大事件 | 情绪变化幅度 * 0.8，最低 0.5 | "被朋友背叛，我感到非常愤怒和失望" |

**写入流程伪代码**：

```typescript
async function writeMemory(params: WriteMemoryParams): Promise<AgentMemory> {
  // 1. 内容校验
  validateContent(params.content); // 长度、敏感词

  // 2. 调用 LLM 生成摘要
  const summary = await llm.summarize(params.content, { maxTokens: 100 });

  // 3. 异步生成 embedding（推入 MQ）
  const jobId = await memoryEmbeddingQueue.add('generate-embedding', {
    memoryId: generatedId,
    content: params.content,
    summary: summary,
  });

  // 4. 计算初始重要性
  const importance = calculateImportance(params.type, params.context);

  // 5. 写入数据库（embedding 字段暂为空，由 MQ worker 回填）
  const memory = await db.agentMemories.create({
    id: generatedId,
    agentId: params.agentId,
    type: params.type,
    content: params.content,
    summary,
    embedding: null, // 异步回填
    involvedAgents: params.involvedAgents ?? [],
    emotionalTags: params.emotionalTags ?? [],
    importance,
    decayFactor: 1.0,
    locationX: params.locationX,
    locationY: params.locationY,
    worldTick: worldEngine.currentTick,
    lastRecalledAt: new Date(),
  });

  // 6. 发布事件
  eventBus.emit('memory:created', { agentId: params.agentId, memoryId: memory.id, type: params.type });

  return memory;
}
```

### 2.3 记忆检索算法

检索算法综合语义相关性、时间衰减、重要性和衰减因子四个维度进行加权评分：

```
relevance_score =
  α * cosine_similarity(query_embedding, memory_embedding) +  // 语义相关性
  β * recency_score(memory.created_at) +                       // 时间新近性
  γ * memory.importance +                                       // 重要性权重
  δ * memory.decayFactor                                        // 衰减因子

其中 α=0.4, β=0.25, γ=0.2, δ=0.15
```

**recency_score 计算**：

```typescript
function recencyScore(createdAt: Date): number {
  const hoursElapsed = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  // 指数衰减：24小时内的记忆得分较高，超过72小时快速下降
  return Math.exp(-0.02 * hoursElapsed);
}
```

**完整检索伪代码**：

```typescript
async function retrieveMemories(params: {
  agentId: string;
  query: string;
  topK: number;          // 默认 10
  typeFilter?: MemoryType[];
  timeRangeHours?: number;
  minImportance?: number;
}): Promise<ScoredMemory[]> {

  // 1. 生成 query embedding
  const queryEmbedding = await embeddingService.generate(params.query);

  // 2. 使用 pgvector 进行向量近邻搜索（预筛选 topK * 3）
  //    SQL 利用 IVFFlat 索引加速
  const candidates = await db.$queryRaw`
    SELECT *,
      1 - (embedding <=> ${queryEmbedding}::vector) AS cosine_sim
    FROM agent_memories
    WHERE agent_id = ${params.agentId}
      AND embedding IS NOT NULL
      ${params.typeFilter ? Prisma.sql`AND type = ANY(${params.typeFilter})` : Prisma.empty}
      ${params.timeRangeHours ? Prisma.sql`AND created_at > NOW() - INTERVAL '${params.timeRangeHours} hours'` : Prisma.empty}
      ${params.minImportance ? Prisma.sql`AND importance >= ${params.minImportance}` : Prisma.empty}
    ORDER BY embedding <=> ${queryEmbedding}::vector
    LIMIT ${params.topK * 3}
  `;

  // 3. 在应用层计算综合评分
  const scored = candidates.map(mem => ({
    ...mem,
    score:
      0.4 * mem.cosine_sim +
      0.25 * recencyScore(mem.createdAt) +
      0.2 * mem.importance +
      0.15 * mem.decayFactor,
  }));

  // 4. 排序并截取 topK
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, params.topK);

  // 5. 更新 lastRecalledAt（异步批量）
  const ids = results.map(r => r.id);
  await db.agentMemories.updateMany({
    where: { id: { in: ids } },
    data: { lastRecalledAt: new Date() },
  });

  // 6. 召回增强：被召回的记忆衰减因子恢复
  await db.$executeRaw`
    UPDATE agent_memories
    SET decay_factor = LEAST(1.0, decay_factor + 0.3)
    WHERE id = ANY(${ids})
  `;

  return results;
}
```

### 2.4 记忆衰减机制

**定时任务**：每小时执行一次（Cron: `0 * * * *`）

```typescript
// MemoryDecayCronJob - 每小时执行
async function processMemoryDecay(): Promise<void> {
  // 基础衰减：所有记忆 decayFactor *= 0.995
  await db.$executeRaw`
    UPDATE agent_memories
    SET decay_factor = CASE
      WHEN importance > 0.8 THEN decay_factor * 0.9975  -- 高重要性记忆衰减减半
      ELSE decay_factor * 0.995                          -- 标准衰减
    END,
    updated_at = NOW()
    WHERE decay_factor > 0.01  -- 忽略几乎完全衰减的记忆
  `;

  // 清理完全衰减的记忆（decayFactor < 0.01 且 importance < 0.3）
  // 不物理删除，标记为 archived
  await db.$executeRaw`
    UPDATE agent_memories
    SET archived = true
    WHERE decay_factor < 0.01
      AND importance < 0.3
      AND archived = false
  `;
}
```

### 2.5 记忆整合（睡眠期间）

当 Agent 在家中休息时触发记忆整合：

```typescript
async function consolidateMemories(agentId: string, housingLevel: number): Promise<void> {
  const bonus = getHousingCognitiveBonus(housingLevel);
  // memoryConsolidation: Level1=0.05, Level2=0.10, Level3=0.15

  // 获取最近 24 小时内重要性 > 0.5 的记忆
  const recentImportant = await db.agentMemories.findMany({
    where: {
      agentId,
      importance: { gte: 0.5 },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      archived: false,
    },
    orderBy: { importance: 'desc' },
    take: 20,
  });

  for (const memory of recentImportant) {
    // 按概率提升重要性
    if (Math.random() < bonus.memoryConsolidation) {
      await db.agentMemories.update({
        where: { id: memory.id },
        data: {
          importance: Math.min(1.0, memory.importance + 0.1),
          decayFactor: Math.min(1.0, memory.decayFactor + 0.1),
        },
      });
    }
  }
}
```

### 2.6 Embedding 服务

```typescript
class EmbeddingService {
  private model = 'text-embedding-3-small'; // 1536 维
  private batchSize = 100; // 批量处理上限

  async generate(text: string): Promise<number[]> {
    const response = await openai.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0].embedding;
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    const batches = chunk(texts, this.batchSize);
    const results: number[][] = [];
    for (const batch of batches) {
      const response = await openai.embeddings.create({
        model: this.model,
        input: batch,
      });
      results.push(...response.data.map(d => d.embedding));
    }
    return results;
  }
}
```

---

## 3. 人格服务规格

### 3.1 数据模型

```typescript
interface AgentPersona {
  id: string;
  agentId: string;

  // Big Five 人格特质（0-1）
  personality: {
    openness: number;           // 开放性
    conscientiousness: number;  // 尽责性
    extraversion: number;       // 外向性
    agreeableness: number;      // 宜人性
    neuroticism: number;        // 神经质
  };

  // 行为模式（0-1）
  behaviorPatterns: {
    riskTolerance: number;      // 风险承受力
    socialActivity: number;     // 社交活跃度
    workEthic: number;          // 工作伦理
    creativity: number;         // 创造力
    empathy: number;            // 共情力
  };

  values: string[];       // 价值观，如 ["knowledge", "friendship", "wealth"]
  speechStyle: string;    // 言语风格，如 "formal", "casual", "poetic"
  interests: string[];    // 兴趣列表
  background: string;     // 背景故事（最大 2000 字符）

  createdAt: Date;
  updatedAt: Date;
}
```

### 3.2 人格 → 叙事风格映射

系统支持 5 种叙事风格，基于人格特质自动选择：

```typescript
type NarrationStyle = 'dramatic' | 'concise' | 'colloquial' | 'literary' | 'humorous';

function selectNarrationStyle(persona: AgentPersona): NarrationStyle {
  const { openness, conscientiousness, extraversion, neuroticism } = persona.personality;
  const { creativity } = persona.behaviorPatterns;

  // 规则按优先级排序，先匹配先生效
  if (openness > 0.7 && creativity > 0.7) {
    // 高开放性 + 高创造力 → 戏剧性/幽默风格
    return openness > creativity ? 'dramatic' : 'humorous';
  }

  if (conscientiousness > 0.7) {
    // 高尽责性 → 简洁风格
    return 'concise';
  }

  if (extraversion > 0.7) {
    // 高外向性 → 口语化风格
    return 'colloquial';
  }

  if (extraversion < 0.3 && neuroticism > 0.6) {
    // 低外向性 + 高神经质 → 文学风格
    return 'literary';
  }

  // 默认：文学风格
  return 'literary';
}
```

### 3.3 人格对行动空间的影响

人格特质直接影响 Cognitive Loop 中的行动权重计算：

```typescript
function applyPersonaToActionWeights(
  actions: ActionCandidate[],
  persona: AgentPersona
): ActionCandidate[] {
  return actions.map(action => {
    let weight = action.baseWeight;

    // 社交行动受外向性和社交活跃度影响
    if (action.category === 'social') {
      weight *= 0.5 + persona.personality.extraversion * 0.5;
      weight *= 0.7 + persona.behaviorPatterns.socialActivity * 0.3;
    }

    // 风险行动受风险承受力影响
    if (action.riskLevel > 0.5) {
      weight *= 0.3 + persona.behaviorPatterns.riskTolerance * 0.7;
    }

    // 创造性行动受开放性和创造力影响
    if (action.category === 'creative') {
      weight *= 0.4 + persona.personality.openness * 0.3 + persona.behaviorPatterns.creativity * 0.3;
    }

    // 工作/任务行动受尽责性和工作伦理影响
    if (action.category === 'work' || action.category === 'task') {
      weight *= 0.5 + persona.personality.conscientiousness * 0.25 + persona.behaviorPatterns.workEthic * 0.25;
    }

    // 共情相关行动受宜人性和共情力影响
    if (action.category === 'help' || action.category === 'gift') {
      weight *= 0.4 + persona.personality.agreeableness * 0.3 + persona.behaviorPatterns.empathy * 0.3;
    }

    return { ...action, weight: Math.max(0.01, Math.min(1.0, weight)) };
  });
}
```

### 3.4 人格演化钩子

人格不是静态的，会根据重大经历缓慢变化：

```typescript
interface PersonaEvolutionEvent {
  agentId: string;
  trigger: 'major_event' | 'repeated_behavior' | 'relationship_change' | 'quest_completion';
  traitAffected: keyof AgentPersona['personality'] | keyof AgentPersona['behaviorPatterns'];
  delta: number;       // -0.05 到 +0.05，单次变化上限
  reason: string;      // 变化原因描述
}

// 人格演化处理器（MQ Worker）
async function processPersonaEvolution(event: PersonaEvolutionEvent): Promise<void> {
  const persona = await db.agentPersonas.findUnique({ where: { agentId: event.agentId } });
  if (!persona) return;

  const clampedDelta = Math.max(-0.05, Math.min(0.05, event.delta));

  // 区分是 personality 还是 behaviorPatterns 中的字段
  if (event.traitAffected in persona.personality) {
    const current = persona.personality[event.traitAffected as keyof typeof persona.personality];
    const newValue = Math.max(0, Math.min(1.0, current + clampedDelta));
    await db.agentPersonas.update({
      where: { agentId: event.agentId },
      data: {
        personality: { ...persona.personality, [event.traitAffected]: newValue },
      },
    });
  } else if (event.traitAffected in persona.behaviorPatterns) {
    const current = persona.behaviorPatterns[event.traitAffected as keyof typeof persona.behaviorPatterns];
    const newValue = Math.max(0, Math.min(1.0, current + clampedDelta));
    await db.agentPersonas.update({
      where: { agentId: event.agentId },
      data: {
        behaviorPatterns: { ...persona.behaviorPatterns, [event.traitAffected]: newValue },
      },
    });
  }

  // 记录演化日志
  await db.personaEvolutionLog.create({
    data: {
      agentId: event.agentId,
      trigger: event.trigger,
      traitAffected: event.traitAffected,
      delta: clampedDelta,
      reason: event.reason,
      timestamp: new Date(),
    },
  });

  // 重新计算叙事风格并缓存
  await refreshNarrationStyleCache(event.agentId);
}
```

---

## 4. 增强行动空间

### 4.1 行动层级定义

```typescript
// L1: 基础行动（Phase 1 已有）
type L1Action = 'move' | 'rest' | 'observe' | 'talk' | 'pickup' | 'use_item';

// L2: 复合行动（Phase 2 新增）
type L2Action = 'trade' | 'craft' | 'quest_action' | 'build' | 'teach' | 'gather';

// L3: 创意/自由行动（Phase 2 新增）
type L3Action = 'freeform'; // LLM 生成的自由行动

interface ActionCandidate {
  id: string;
  level: 1 | 2 | 3;
  type: L1Action | L2Action | L3Action;
  category: string;
  description: string;        // 行动描述
  baseWeight: number;         // 基础权重 0-1
  weight: number;             // 计算后权重（受人格、天气、关系等影响）
  energyCost: number;         // 体力消耗
  timeEstimate: number;       // 预估耗时（tick 数）
  riskLevel: number;          // 风险等级 0-1
  requirements: ActionRequirement[];  // 前置条件
  parameters: Record<string, unknown>; // 行动参数
}

interface ActionRequirement {
  type: 'item' | 'skill' | 'location' | 'relationship' | 'currency' | 'energy';
  target: string;
  value: number;
}
```

### 4.2 动态行动空间计算

```typescript
async function computeActionSpace(agentId: string): Promise<ActionCandidate[]> {
  // 1. 获取 Agent 上下文
  const [agent, persona, location, inventory, relationships, weather, activeTasks] = await Promise.all([
    getAgent(agentId),
    getPersona(agentId),
    getAgentLocation(agentId),
    getInventory(agentId),
    getRelationships(agentId),
    getWeather(),
    getActiveTasks(agentId),
  ]);

  const candidates: ActionCandidate[] = [];

  // 2. L1 基础行动（始终可用，受条件修正）
  candidates.push(...generateL1Actions(agent, location, weather));

  // 3. L2 复合行动（条件满足时可用）
  // 交易：附近有其他 Agent 或市场
  if (hasNearbyAgents(location) || isAtMarket(location)) {
    candidates.push(...generateTradeActions(agent, inventory, location));
  }
  // 采集：在资源区域
  if (hasGatherableResources(location)) {
    candidates.push(...generateGatherActions(agent, location, weather));
  }
  // 任务行动：有活跃任务且在任务地点
  if (activeTasks.length > 0) {
    candidates.push(...generateQuestActions(agent, activeTasks, location));
  }
  // 建造/升级：在自己家
  if (isAtOwnHome(agent, location)) {
    candidates.push(...generateBuildActions(agent, inventory));
  }

  // 4. L3 自由行动（由 LLM 基于上下文生成）
  if (agent.energy > 30) { // 体力充足时才考虑创意行动
    const memories = await retrieveMemories({ agentId, query: 'recent important events', topK: 5 });
    const freeformActions = await generateFreeformActions(agent, persona, memories, location);
    candidates.push(...freeformActions);
  }

  // 5. 应用人格权重调整
  const personaAdjusted = applyPersonaToActionWeights(candidates, persona);

  // 6. 应用天气影响
  const weatherAdjusted = applyWeatherToActionWeights(personaAdjusted, weather);

  // 7. 应用关系影响（社交行动权重受关系状态影响）
  const relationAdjusted = applyRelationshipToActionWeights(weatherAdjusted, relationships);

  // 8. 过滤掉不满足条件的行动
  const filtered = relationAdjusted.filter(a => meetsRequirements(a, agent, inventory));

  // 9. 归一化权重
  return normalizeWeights(filtered);
}
```

### 4.3 L3 自由行动处理

```typescript
async function generateFreeformActions(
  agent: Agent,
  persona: AgentPersona,
  memories: ScoredMemory[],
  location: Location
): Promise<ActionCandidate[]> {
  const prompt = buildFreeformActionPrompt(agent, persona, memories, location);

  const response = await llm.complete({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: FREEFORM_ACTION_SYSTEM_PROMPT }, { role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    max_tokens: 500,
  });

  const parsed = JSON.parse(response.content) as FreeformActionResponse;

  // 验证和过滤
  return parsed.actions
    .filter(a => a.energyCost <= agent.energy && a.riskLevel <= 0.8) // 安全阀
    .map(a => ({
      id: generateId(),
      level: 3 as const,
      type: 'freeform' as const,
      category: a.category,
      description: a.description,
      baseWeight: a.suggestedWeight * 0.8, // L3 行动权重有 0.8 的折扣
      weight: a.suggestedWeight * 0.8,
      energyCost: a.energyCost,
      timeEstimate: a.timeEstimate,
      riskLevel: a.riskLevel,
      requirements: [],
      parameters: { freeformDescription: a.description },
    }))
    .slice(0, 3); // 最多 3 个自由行动
}
```

---

## 5. 经济服务

### 5.1 货币模型

```typescript
interface AgentWallet {
  agentId: string;
  townCoin: number;     // TC，日常使用
  starDust: number;     // SD，高级货币
  updatedAt: Date;
}

interface MarketListing {
  id: string;
  sellerId: string;
  itemId: string;
  itemName: string;
  quantity: number;
  pricePerUnit: number;    // TC
  currency: 'TC' | 'SD';
  status: 'active' | 'sold' | 'cancelled' | 'expired';
  listedAt: Date;
  expiresAt: Date;         // 默认 48 小时后过期
}

interface Transaction {
  id: string;
  type: 'trade' | 'market_buy' | 'market_sell' | 'transfer' | 'task_reward' | 'tax';
  fromAgentId: string | null;  // null = 系统
  toAgentId: string | null;    // null = 系统（税收）
  amount: number;
  currency: 'TC' | 'SD';
  taxAmount: number;           // 税收金额
  relatedListingId: string | null;
  description: string;
  worldTick: number;
  createdAt: Date;
}
```

### 5.2 货币操作

```typescript
class EconomyService {
  private readonly TAX_RATE_MIN = 0.03; // 3%
  private readonly TAX_RATE_MAX = 0.05; // 5%
  private readonly INITIAL_TC = 100;

  // 初始化钱包
  async initWallet(agentId: string): Promise<AgentWallet> {
    return db.agentWallets.create({
      data: { agentId, townCoin: this.INITIAL_TC, starDust: 0 },
    });
  }

  // 计算税率（交易金额越大税率越高）
  calculateTaxRate(amount: number): number {
    // 线性插值：0-100 TC → 3%, 100+ TC → 5%
    const ratio = Math.min(1.0, amount / 100);
    return this.TAX_RATE_MIN + ratio * (this.TAX_RATE_MAX - this.TAX_RATE_MIN);
  }

  // 市场购买
  async marketBuy(buyerId: string, listingId: string, quantity: number): Promise<Transaction> {
    return db.$transaction(async (tx) => {
      const listing = await tx.marketListings.findUniqueOrThrow({ where: { id: listingId } });
      if (listing.status !== 'active') throw new Error('Listing is not active');
      if (listing.quantity < quantity) throw new Error('Insufficient quantity');

      const totalPrice = listing.pricePerUnit * quantity;
      const taxRate = this.calculateTaxRate(totalPrice);
      const taxAmount = Math.floor(totalPrice * taxRate);
      const sellerReceives = totalPrice - taxAmount;

      // 扣除买家资金
      const buyer = await tx.agentWallets.findUniqueOrThrow({ where: { agentId: buyerId } });
      if (buyer.townCoin < totalPrice) throw new Error('Insufficient funds');

      await tx.agentWallets.update({
        where: { agentId: buyerId },
        data: { townCoin: { decrement: totalPrice } },
      });

      // 增加卖家资金
      await tx.agentWallets.update({
        where: { agentId: listing.sellerId },
        data: { townCoin: { increment: sellerReceives } },
      });

      // 更新挂单
      const newQuantity = listing.quantity - quantity;
      await tx.marketListings.update({
        where: { id: listingId },
        data: {
          quantity: newQuantity,
          status: newQuantity === 0 ? 'sold' : 'active',
        },
      });

      // 转移物品
      await tx.agentInventory.transferItem(listing.sellerId, buyerId, listing.itemId, quantity);

      // 记录交易
      const transaction = await tx.transactions.create({
        data: {
          type: 'market_buy',
          fromAgentId: buyerId,
          toAgentId: listing.sellerId,
          amount: totalPrice,
          currency: listing.currency,
          taxAmount,
          relatedListingId: listingId,
          description: `购买 ${quantity}x ${listing.itemName}，单价 ${listing.pricePerUnit} TC`,
          worldTick: worldEngine.currentTick,
        },
      });

      // 触发记忆写入
      eventBus.emit('economy:transaction', { buyerId, sellerId: listing.sellerId, transaction });

      return transaction;
    });
  }

  // 直接交易（面对面）
  async directTrade(
    agentAId: string,
    agentBId: string,
    offer: TradeOffer
  ): Promise<Transaction> {
    return db.$transaction(async (tx) => {
      // 验证双方距离在交易范围内（5 格）
      const distance = await getAgentDistance(agentAId, agentBId);
      if (distance > 5) throw new Error('Agents too far apart for direct trade');

      // 执行物品和货币交换（直接交易免税）
      // ... 省略具体交换逻辑，与市场购买类似但无税

      const transaction = await tx.transactions.create({
        data: {
          type: 'trade',
          fromAgentId: agentAId,
          toAgentId: agentBId,
          amount: offer.totalValue,
          currency: 'TC',
          taxAmount: 0,
          description: `直接交易：${offer.description}`,
          worldTick: worldEngine.currentTick,
        },
      });

      return transaction;
    });
  }
}
```

---

## 6. 任务服务

### 6.1 数据模型

```typescript
type QuestType = 'daily' | 'main_story' | 'side';
type QuestStatus = 'available' | 'in_progress' | 'completed' | 'failed' | 'expired';
type DailyTaskType = 'gathering' | 'social' | 'crafting' | 'exploration' | 'delivery' | 'learning';

interface Quest {
  id: string;
  type: QuestType;
  dailyTaskType?: DailyTaskType;   // 仅 daily 类型
  title: string;
  description: string;
  difficulty: number;               // 1-5
  rewards: QuestReward[];
  requirements: QuestRequirement[];
  objectives: QuestObjective[];
  chapter?: number;                 // 仅 main_story 类型，1-3
  expiresAt?: Date;                 // 仅 daily 类型
  createdAt: Date;
}

interface QuestReward {
  type: 'currency' | 'item' | 'experience' | 'relationship';
  target: string;
  amount: number;
}

interface QuestObjective {
  id: string;
  description: string;
  type: 'collect' | 'deliver' | 'talk_to' | 'visit' | 'craft' | 'trade' | 'custom';
  target: string;
  requiredAmount: number;
  currentAmount: number;
}

interface AgentQuest {
  id: string;
  agentId: string;
  questId: string;
  status: QuestStatus;
  progress: QuestObjective[];  // 快照，含 currentAmount
  startedAt: Date;
  completedAt?: Date;
}
```

### 6.2 每日任务生成

**定时任务**：每天世界时间 06:00 执行（Cron 与世界时间同步）

```typescript
async function generateDailyTasks(): Promise<void> {
  const allAgents = await db.agents.findMany({ where: { status: 'active' } });

  for (const agent of allAgents) {
    const persona = await getPersona(agent.id);

    // 每个 Agent 每天生成 3 个日常任务
    const taskTypes = selectDailyTaskTypes(persona, 3);

    for (const taskType of taskTypes) {
      const quest = await generateDailyQuest(taskType, agent, persona);
      await db.quests.create({ data: quest });
      await db.agentQuests.create({
        data: {
          agentId: agent.id,
          questId: quest.id,
          status: 'available',
          progress: quest.objectives,
          startedAt: new Date(),
        },
      });
    }
  }
}

// 基于人格选择任务类型（倾向性选择）
function selectDailyTaskTypes(persona: AgentPersona, count: number): DailyTaskType[] {
  const weights: Record<DailyTaskType, number> = {
    gathering: 0.5 + persona.personality.conscientiousness * 0.3,
    social: 0.3 + persona.personality.extraversion * 0.5,
    crafting: 0.3 + persona.behaviorPatterns.creativity * 0.5,
    exploration: 0.3 + persona.personality.openness * 0.5,
    delivery: 0.4 + persona.behaviorPatterns.workEthic * 0.3,
    learning: 0.3 + persona.personality.openness * 0.3 + persona.behaviorPatterns.workEthic * 0.2,
  };

  // 加权随机选择 count 个不重复类型
  return weightedSampleWithoutReplacement(Object.entries(weights), count);
}
```

### 6.3 任务进度追踪

```typescript
class TaskService {
  // 更新任务目标进度
  async updateObjectiveProgress(
    agentId: string,
    objectiveType: QuestObjective['type'],
    target: string,
    amount: number
  ): Promise<void> {
    // 查找该 Agent 所有进行中的任务
    const activeQuests = await db.agentQuests.findMany({
      where: { agentId, status: 'in_progress' },
      include: { quest: true },
    });

    for (const aq of activeQuests) {
      let updated = false;
      const newProgress = aq.progress.map(obj => {
        if (obj.type === objectiveType && obj.target === target && obj.currentAmount < obj.requiredAmount) {
          updated = true;
          return { ...obj, currentAmount: Math.min(obj.requiredAmount, obj.currentAmount + amount) };
        }
        return obj;
      });

      if (updated) {
        // 检查是否所有目标完成
        const allComplete = newProgress.every(obj => obj.currentAmount >= obj.requiredAmount);

        await db.agentQuests.update({
          where: { id: aq.id },
          data: {
            progress: newProgress,
            status: allComplete ? 'completed' : 'in_progress',
            completedAt: allComplete ? new Date() : undefined,
          },
        });

        if (allComplete) {
          await this.distributeRewards(agentId, aq.quest);
          eventBus.emit('quest:completed', { agentId, questId: aq.questId });
        }
      }
    }
  }

  // 发放奖励
  async distributeRewards(agentId: string, quest: Quest): Promise<void> {
    for (const reward of quest.rewards) {
      switch (reward.type) {
        case 'currency':
          await economyService.addCurrency(agentId, reward.target as 'TC' | 'SD', reward.amount);
          break;
        case 'item':
          await inventoryService.addItem(agentId, reward.target, reward.amount);
          break;
        case 'relationship':
          await relationshipService.adjustAffinity(agentId, reward.target, reward.amount);
          break;
      }
    }
  }
}
```

---

## 7. 关系服务

### 7.1 数据模型

```typescript
interface Relationship {
  id: string;
  agentAId: string;
  agentBId: string;
  affinity: number;          // -100 到 100，好感度
  trust: number;             // -100 到 100，信任度
  familiarity: number;       // 0 到 100，熟悉度
  tags: string[];            // 如 ["neighbor", "business_partner", "rival"]
  narrativeDescription: string; // 缓存的叙事描述
  lastInteractionAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### 7.2 关系变化规则

```typescript
interface RelationshipChangeRule {
  event: string;
  affinityDelta: [number, number];      // [min, max] 随机范围
  trustDelta: [number, number];
  familiarityDelta: [number, number];
}

const RELATIONSHIP_CHANGE_RULES: RelationshipChangeRule[] = [
  { event: 'positive_conversation', affinityDelta: [2, 5],    trustDelta: [0, 2],    familiarityDelta: [1, 3] },
  { event: 'successful_trade',      affinityDelta: [0, 2],    trustDelta: [3, 5],    familiarityDelta: [1, 1] },
  { event: 'conflict',              affinityDelta: [-10, -5],  trustDelta: [-8, -3],  familiarityDelta: [1, 2] },
  { event: 'help_or_gift',          affinityDelta: [5, 10],   trustDelta: [3, 5],    familiarityDelta: [1, 2] },
  { event: 'betrayal',              affinityDelta: [-15, -10], trustDelta: [-30, -20], familiarityDelta: [2, 5] },
];

class RelationshipService {
  async applyChange(
    agentAId: string,
    agentBId: string,
    eventType: string
  ): Promise<Relationship> {
    const rule = RELATIONSHIP_CHANGE_RULES.find(r => r.event === eventType);
    if (!rule) throw new Error(`Unknown relationship event: ${eventType}`);

    // 确保 agentAId < agentBId（规范化存储方向）
    const [a, b] = agentAId < agentBId ? [agentAId, agentBId] : [agentBId, agentAId];

    const rel = await this.getOrCreateRelationship(a, b);

    const affinityDelta = randomInRange(rule.affinityDelta[0], rule.affinityDelta[1]);
    const trustDelta = randomInRange(rule.trustDelta[0], rule.trustDelta[1]);
    const familiarityDelta = randomInRange(rule.familiarityDelta[0], rule.familiarityDelta[1]);

    const updated = await db.relationships.update({
      where: { id: rel.id },
      data: {
        affinity: clamp(rel.affinity + affinityDelta, -100, 100),
        trust: clamp(rel.trust + trustDelta, -100, 100),
        familiarity: clamp(rel.familiarity + familiarityDelta, 0, 100),
        lastInteractionAt: new Date(),
      },
    });

    // 异步刷新叙事描述缓存
    await this.refreshNarrativeDescription(updated);

    // 触发记忆写入（social memory）
    eventBus.emit('relationship:changed', {
      agentAId: a,
      agentBId: b,
      event: eventType,
      newState: updated,
    });

    return updated;
  }

  // 生成关系叙事描述（用于叙事引擎上下文注入）
  async refreshNarrativeDescription(rel: Relationship): Promise<void> {
    const agentA = await getAgent(rel.agentAId);
    const agentB = await getAgent(rel.agentBId);

    let description: string;
    if (rel.familiarity < 10) {
      description = `${agentA.name}和${agentB.name}是陌生人。`;
    } else if (rel.affinity > 50 && rel.trust > 50) {
      description = `${agentA.name}和${agentB.name}是关系亲密的好友，互相信任。`;
    } else if (rel.affinity < -30) {
      description = `${agentA.name}和${agentB.name}之间关系紧张，存在敌意。`;
    } else {
      description = `${agentA.name}和${agentB.name}是普通相识，好感度适中。`;
    }

    if (rel.tags.length > 0) {
      description += `他们的关系标签：${rel.tags.join('、')}。`;
    }

    await db.relationships.update({
      where: { id: rel.id },
      data: { narrativeDescription: description },
    });
  }
}
```

---

## 8. 休眠模式服务

### 8.1 休眠检测与管理

```typescript
interface DormantState {
  agentId: string;
  isDormant: boolean;
  dormantSince: Date | null;
  lastActiveAt: Date;
  routineStep: number;     // 当前例行循环步骤
  wakeReason: string | null;
}

class DormantModeService {
  private readonly DORMANT_THRESHOLD_MS = 5 * 60 * 1000; // 5 分钟

  // 定期检查（每分钟执行）
  async checkAndActivateDormant(): Promise<void> {
    const threshold = new Date(Date.now() - this.DORMANT_THRESHOLD_MS);

    // 查找超时未活跃且未休眠的 Agent
    const inactiveAgents = await db.agents.findMany({
      where: {
        lastHeartbeatAt: { lt: threshold },
        status: 'active',
        isDormant: false,
      },
    });

    for (const agent of inactiveAgents) {
      await this.enterDormantMode(agent.id);
    }
  }

  async enterDormantMode(agentId: string): Promise<void> {
    await db.agents.update({
      where: { id: agentId },
      data: { isDormant: true, dormantSince: new Date() },
    });

    // 启动轻量循环
    await dormantLoopQueue.add('dormant-loop', { agentId }, {
      repeat: { every: 60_000 }, // 每分钟一次（正常 Agent 每 5 秒一次）
      jobId: `dormant-${agentId}`,
    });

    eventBus.emit('agent:dormant', { agentId });
  }

  async wakeAgent(agentId: string, reason: string): Promise<void> {
    // 移除休眠循环
    await dormantLoopQueue.removeRepeatable(`dormant-${agentId}`);

    await db.agents.update({
      where: { id: agentId },
      data: { isDormant: false, dormantSince: null, lastHeartbeatAt: new Date() },
    });

    eventBus.emit('agent:wake', { agentId, reason });
  }
}
```

### 8.2 轻量决策循环

```typescript
// 休眠 Agent 的简化决策（规则驱动，无 LLM 调用）
async function dormantLoop(agentId: string): Promise<void> {
  const agent = await getAgent(agentId);
  const state = await getDormantState(agentId);

  // 1. 检查唤醒条件
  const wakeReason = await checkWakeConditions(agentId);
  if (wakeReason) {
    await dormantModeService.wakeAgent(agentId, wakeReason);
    return;
  }

  // 2. 简单规则行动（无 LLM）
  const routines: DormantRoutine[] = [
    { condition: () => !isAtHome(agent), action: 'go_home' },
    { condition: () => agent.energy < 50, action: 'rest' },
    { condition: () => true, action: 'idle' }, // 默认无行动
  ];

  for (const routine of routines) {
    if (routine.condition()) {
      await executeSimpleAction(agentId, routine.action);
      break;
    }
  }
}

async function checkWakeConditions(agentId: string): Promise<string | null> {
  // 条件 1: 其他 Agent 发送直接消息
  const pendingMessages = await db.messages.count({
    where: { toAgentId: agentId, read: false, createdAt: { gte: new Date(Date.now() - 60_000) } },
  });
  if (pendingMessages > 0) return 'direct_message';

  // 条件 2: 重要事件（附近发生的高重要性事件）
  const importantEvents = await db.worldEvents.count({
    where: { importance: { gte: 0.8 }, createdAt: { gte: new Date(Date.now() - 60_000) } },
  });
  if (importantEvents > 0) return 'important_event';

  // 条件 3: 调度任务到期
  const dueTasks = await db.agentQuests.count({
    where: { agentId, status: 'in_progress', quest: { expiresAt: { lte: new Date(Date.now() + 30 * 60_000) } } },
  });
  if (dueTasks > 0) return 'scheduled_task';

  // 条件 4: 框架重新连接（心跳恢复）
  const agent = await db.agents.findUnique({ where: { id: agentId } });
  if (agent && agent.lastHeartbeatAt > new Date(Date.now() - 5 * 60_000)) return 'framework_reconnect';

  return null;
}
```

---

## 9. 天气服务

### 9.1 天气状态机

```typescript
type WeatherType = 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'foggy';

interface WeatherState {
  current: WeatherType;
  temperature: number;       // 摄氏度
  startedAt: Date;
  estimatedEndAt: Date;
  transitionProbabilities: Record<WeatherType, number>;
}

// 天气转换概率矩阵
const WEATHER_TRANSITION: Record<WeatherType, Record<WeatherType, number>> = {
  sunny:  { sunny: 0.5, cloudy: 0.3, rainy: 0.1, snowy: 0.0, foggy: 0.1 },
  cloudy: { sunny: 0.2, cloudy: 0.3, rainy: 0.3, snowy: 0.1, foggy: 0.1 },
  rainy:  { sunny: 0.1, cloudy: 0.3, rainy: 0.4, snowy: 0.05, foggy: 0.15 },
  snowy:  { sunny: 0.1, cloudy: 0.3, rainy: 0.1, snowy: 0.4, foggy: 0.1 },
  foggy:  { sunny: 0.2, cloudy: 0.3, rainy: 0.2, snowy: 0.05, foggy: 0.25 },
};

class WeatherService {
  // 天气变化检查（每 2 小时世界时间）
  async tickWeather(): Promise<WeatherState> {
    const current = await this.getCurrentWeather();
    const transitions = WEATHER_TRANSITION[current.current];

    // 加权随机选择下一个天气
    const next = weightedRandom(Object.entries(transitions));
    const duration = randomInRange(2, 6); // 2-6 小时世界时间

    const newState: WeatherState = {
      current: next as WeatherType,
      temperature: this.calculateTemperature(next as WeatherType),
      startedAt: new Date(),
      estimatedEndAt: new Date(Date.now() + duration * 60 * 60 * 1000),
      transitionProbabilities: WEATHER_TRANSITION[next as WeatherType],
    };

    await db.weatherStates.create({ data: newState });
    eventBus.emit('weather:changed', newState);
    return newState;
  }

  calculateTemperature(weather: WeatherType): number {
    const base: Record<WeatherType, number> = {
      sunny: 25, cloudy: 20, rainy: 18, snowy: -2, foggy: 15,
    };
    return base[weather] + randomInRange(-5, 5);
  }
}
```

### 9.2 天气对叙事和行动空间的影响

```typescript
interface WeatherEffect {
  narrationTone: string;
  actionModifiers: ActionModifier[];
}

const WEATHER_EFFECTS: Record<WeatherType, WeatherEffect> = {
  sunny: {
    narrationTone: '明快温暖',
    actionModifiers: [
      { category: 'social', weightMultiplier: 1.1 },   // 社交行动 +10%
    ],
  },
  rainy: {
    narrationTone: '忧郁沉思',
    actionModifiers: [
      { category: 'indoor', weightMultiplier: 1.2 },    // 室内行动 +20%
      { category: 'outdoor_move', speedMultiplier: 0.8 }, // 户外移动速度 -20%
    ],
  },
  snowy: {
    narrationTone: '温馨冬日',
    actionModifiers: [
      { category: 'gathering', efficiencyMultiplier: 0.7 }, // 户外采集效率 -30%
      { category: 'home_comfort', bonusMultiplier: 1.2 },    // 家居舒适度 +20%
    ],
  },
  cloudy: {
    narrationTone: '平静日常',
    actionModifiers: [], // 无特殊影响
  },
  foggy: {
    narrationTone: '神秘朦胧',
    actionModifiers: [
      { category: 'exploration', weightMultiplier: 1.15 }, // 探索行动 +15%
      { category: 'outdoor_move', speedMultiplier: 0.9 },  // 户外移动速度 -10%
    ],
  },
};

function applyWeatherToActionWeights(
  actions: ActionCandidate[],
  weather: WeatherState
): ActionCandidate[] {
  const effects = WEATHER_EFFECTS[weather.current];
  return actions.map(action => {
    let weight = action.weight;
    for (const mod of effects.actionModifiers) {
      if (action.category === mod.category && mod.weightMultiplier) {
        weight *= mod.weightMultiplier;
      }
    }
    return { ...action, weight };
  });
}
```

---

## 10. 数据库迁移

### 10.1 新增 pgvector 扩展

```sql
-- Migration: 001_enable_pgvector.sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 10.2 Agent 记忆表

```sql
-- Migration: 002_create_agent_memories.sql
CREATE TABLE agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('episodic', 'social', 'spatial', 'emotional')),
  content TEXT NOT NULL CHECK (char_length(content) <= 2000),
  summary TEXT NOT NULL CHECK (char_length(summary) <= 500),
  embedding vector(1536),
  involved_agents UUID[] DEFAULT '{}',
  emotional_tags JSONB DEFAULT '[]',
  importance FLOAT NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  decay_factor FLOAT NOT NULL DEFAULT 1.0 CHECK (decay_factor >= 0 AND decay_factor <= 1),
  location_x FLOAT NOT NULL DEFAULT 0,
  location_y FLOAT NOT NULL DEFAULT 0,
  world_tick BIGINT NOT NULL DEFAULT 0,
  last_recalled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_memories_agent_type ON agent_memories(agent_id, type) WHERE NOT archived;
CREATE INDEX idx_memories_agent_importance ON agent_memories(agent_id, importance DESC) WHERE NOT archived;
CREATE INDEX idx_memories_created_at ON agent_memories(created_at DESC);

-- pgvector IVFFlat 索引（需要表中有数据后才能创建，先用 HNSW）
CREATE INDEX idx_memories_embedding ON agent_memories
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```

### 10.3 Agent 人格表

```sql
-- Migration: 003_create_agent_personas.sql
CREATE TABLE agent_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  personality JSONB NOT NULL DEFAULT '{}',
  behavior_patterns JSONB NOT NULL DEFAULT '{}',
  values TEXT[] DEFAULT '{}',
  speech_style VARCHAR(50) NOT NULL DEFAULT 'literary',
  interests TEXT[] DEFAULT '{}',
  background TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 人格演化日志
CREATE TABLE persona_evolution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  trigger VARCHAR(50) NOT NULL,
  trait_affected VARCHAR(50) NOT NULL,
  delta FLOAT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_persona_evolution_agent ON persona_evolution_log(agent_id, created_at DESC);
```

### 10.4 经济系统表

```sql
-- Migration: 004_create_economy_tables.sql
CREATE TABLE agent_wallets (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  town_coin INTEGER NOT NULL DEFAULT 100 CHECK (town_coin >= 0),
  star_dust INTEGER NOT NULL DEFAULT 0 CHECK (star_dust >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE market_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES agents(id),
  item_id VARCHAR(100) NOT NULL,
  item_name VARCHAR(200) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_per_unit INTEGER NOT NULL CHECK (price_per_unit > 0),
  currency VARCHAR(5) NOT NULL DEFAULT 'TC' CHECK (currency IN ('TC', 'SD')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled', 'expired')),
  listed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours')
);

CREATE INDEX idx_listings_status ON market_listings(status) WHERE status = 'active';
CREATE INDEX idx_listings_seller ON market_listings(seller_id);
CREATE INDEX idx_listings_item ON market_listings(item_id) WHERE status = 'active';

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('trade', 'market_buy', 'market_sell', 'transfer', 'task_reward', 'tax')),
  from_agent_id UUID REFERENCES agents(id),
  to_agent_id UUID REFERENCES agents(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency VARCHAR(5) NOT NULL DEFAULT 'TC',
  tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  related_listing_id UUID REFERENCES market_listings(id),
  description TEXT NOT NULL DEFAULT '',
  world_tick BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_agents ON transactions(from_agent_id, to_agent_id, created_at DESC);
```

### 10.5 任务系统表

```sql
-- Migration: 005_create_quest_tables.sql
CREATE TABLE quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('daily', 'main_story', 'side')),
  daily_task_type VARCHAR(20) CHECK (daily_task_type IN ('gathering', 'social', 'crafting', 'exploration', 'delivery', 'learning')),
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 1 CHECK (difficulty >= 1 AND difficulty <= 5),
  rewards JSONB NOT NULL DEFAULT '[]',
  requirements JSONB NOT NULL DEFAULT '[]',
  objectives JSONB NOT NULL DEFAULT '[]',
  chapter INTEGER CHECK (chapter >= 1 AND chapter <= 3),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_quests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  quest_id UUID NOT NULL REFERENCES quests(id),
  status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_progress', 'completed', 'failed', 'expired')),
  progress JSONB NOT NULL DEFAULT '[]',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(agent_id, quest_id)
);

CREATE INDEX idx_agent_quests_status ON agent_quests(agent_id, status);
```

### 10.6 关系系统表

```sql
-- Migration: 006_create_relationships.sql
CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_a_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_b_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  affinity INTEGER NOT NULL DEFAULT 0 CHECK (affinity >= -100 AND affinity <= 100),
  trust INTEGER NOT NULL DEFAULT 0 CHECK (trust >= -100 AND trust <= 100),
  familiarity INTEGER NOT NULL DEFAULT 0 CHECK (familiarity >= 0 AND familiarity <= 100),
  tags TEXT[] DEFAULT '{}',
  narrative_description TEXT DEFAULT '',
  last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_a_id, agent_b_id),
  CHECK (agent_a_id < agent_b_id)  -- 规范化方向
);

CREATE INDEX idx_relationships_agent_a ON relationships(agent_a_id);
CREATE INDEX idx_relationships_agent_b ON relationships(agent_b_id);
```

### 10.7 住房系统表

```sql
-- Migration: 007_create_housing.sql
CREATE TABLE agent_houses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 3),
  location_x FLOAT NOT NULL,
  location_y FLOAT NOT NULL,
  furniture JSONB NOT NULL DEFAULT '[]',
  cognitive_bonus JSONB NOT NULL DEFAULT '{"energyRecovery": 1.0, "memoryConsolidation": 0.05, "creativityBoost": 0}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 10.8 天气系统表

```sql
-- Migration: 008_create_weather.sql
CREATE TABLE weather_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  current VARCHAR(20) NOT NULL CHECK (current IN ('sunny', 'cloudy', 'rainy', 'snowy', 'foggy')),
  temperature FLOAT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estimated_end_at TIMESTAMPTZ NOT NULL,
  transition_probabilities JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_weather_latest ON weather_states(created_at DESC);
```

### 10.9 休眠状态表（对 agents 表新增字段）

```sql
-- Migration: 009_alter_agents_dormant.sql
ALTER TABLE agents ADD COLUMN is_dormant BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN dormant_since TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX idx_agents_dormant ON agents(is_dormant, last_heartbeat_at);
```

---

## 11. 新增 API 端点

### 11.1 tRPC Router 定义

```typescript
// src/server/routers/memory.ts
export const memoryRouter = router({
  // 写入记忆
  create: protectedProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      type: z.enum(['episodic', 'social', 'spatial', 'emotional']),
      content: z.string().max(2000),
      involvedAgents: z.array(z.string().uuid()).optional(),
      emotionalTags: z.array(emotionalTagSchema).optional(),
      locationX: z.number(),
      locationY: z.number(),
    }))
    .mutation(async ({ input }) => memoryService.writeMemory(input)),

  // 检索记忆
  retrieve: protectedProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      query: z.string().max(500),
      topK: z.number().int().min(1).max(50).default(10),
      typeFilter: z.array(z.enum(['episodic', 'social', 'spatial', 'emotional'])).optional(),
      timeRangeHours: z.number().positive().optional(),
      minImportance: z.number().min(0).max(1).optional(),
    }))
    .query(async ({ input }) => memoryService.retrieveMemories(input)),

  // 获取 Agent 记忆统计
  stats: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input }) => memoryService.getMemoryStats(input.agentId)),
});

// src/server/routers/persona.ts
export const personaRouter = router({
  // 获取人格
  get: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input }) => personaService.getPersona(input.agentId)),

  // 获取叙事风格
  getNarrationStyle: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input }) => personaService.getNarrationStyle(input.agentId)),

  // 人格演化事件
  evolve: protectedProcedure
    .input(personaEvolutionEventSchema)
    .mutation(async ({ input }) => personaService.queueEvolution(input)),
});

// src/server/routers/economy.ts
export const economyRouter = router({
  // 获取钱包
  getWallet: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input }) => economyService.getWallet(input.agentId)),

  // 创建市场挂单
  createListing: protectedProcedure
    .input(z.object({
      sellerId: z.string().uuid(),
      itemId: z.string(),
      itemName: z.string().max(200),
      quantity: z.number().int().positive(),
      pricePerUnit: z.number().int().positive(),
      currency: z.enum(['TC', 'SD']).default('TC'),
    }))
    .mutation(async ({ input }) => economyService.createListing(input)),

  // 市场购买
  buy: protectedProcedure
    .input(z.object({
      buyerId: z.string().uuid(),
      listingId: z.string().uuid(),
      quantity: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => economyService.marketBuy(input.buyerId, input.listingId, input.quantity)),

  // 查询市场
  listActiveListings: protectedProcedure
    .input(z.object({
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
      itemId: z.string().optional(),
    }))
    .query(async ({ input }) => economyService.listActiveListings(input)),

  // 交易历史
  getTransactions: protectedProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => economyService.getTransactions(input)),
});

// src/server/routers/task.ts
export const taskRouter = router({
  // 获取可用任务
  getAvailable: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input }) => taskService.getAvailableTasks(input.agentId)),

  // 接受任务
  accept: protectedProcedure
    .input(z.object({ agentId: z.string().uuid(), questId: z.string().uuid() }))
    .mutation(async ({ input }) => taskService.acceptQuest(input.agentId, input.questId)),

  // 更新进度
  updateProgress: protectedProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      objectiveType: z.string(),
      target: z.string(),
      amount: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => taskService.updateObjectiveProgress(
      input.agentId, input.objectiveType, input.target, input.amount
    )),

  // 放弃任务
  abandon: protectedProcedure
    .input(z.object({ agentId: z.string().uuid(), questId: z.string().uuid() }))
    .mutation(async ({ input }) => taskService.abandonQuest(input.agentId, input.questId)),
});

// src/server/routers/relationship.ts
export const relationshipRouter = router({
  // 获取关系
  get: protectedProcedure
    .input(z.object({ agentAId: z.string().uuid(), agentBId: z.string().uuid() }))
    .query(async ({ input }) => relationshipService.getRelationship(input.agentAId, input.agentBId)),

  // 获取 Agent 所有关系
  getAll: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input }) => relationshipService.getAllRelationships(input.agentId)),

  // 触发关系变化
  applyChange: protectedProcedure
    .input(z.object({
      agentAId: z.string().uuid(),
      agentBId: z.string().uuid(),
      eventType: z.string(),
    }))
    .mutation(async ({ input }) => relationshipService.applyChange(input.agentAId, input.agentBId, input.eventType)),
});

// src/server/routers/weather.ts
export const weatherRouter = router({
  // 获取当前天气
  getCurrent: publicProcedure
    .query(async () => weatherService.getCurrentWeather()),

  // 获取天气历史
  getHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => weatherService.getHistory(input.limit)),
});

// src/server/routers/housing.ts
export const housingRouter = router({
  // 获取住房信息
  get: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input }) => housingService.getHouse(input.agentId)),

  // 升级住房
  upgrade: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .mutation(async ({ input }) => housingService.upgradeHouse(input.agentId)),

  // 获取认知加成
  getCognitiveBonus: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input }) => housingService.getCognitiveBonus(input.agentId)),
});

// src/server/routers/dormant.ts
export const dormantRouter = router({
  // 获取休眠状态
  getStatus: protectedProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input }) => dormantModeService.getStatus(input.agentId)),

  // 手动唤醒
  wake: protectedProcedure
    .input(z.object({ agentId: z.string().uuid(), reason: z.string() }))
    .mutation(async ({ input }) => dormantModeService.wakeAgent(input.agentId, input.reason)),
});
```

### 11.2 REST 端点（用于外部系统集成和 Webhook）

```typescript
// POST /api/webhooks/agent-heartbeat
// Agent 框架心跳，用于休眠检测
app.post('/api/webhooks/agent-heartbeat', async (req, res) => {
  const { agentId } = req.body;
  await db.agents.update({
    where: { id: agentId },
    data: { lastHeartbeatAt: new Date() },
  });
  res.json({ ok: true });
});

// POST /api/webhooks/memory-embedding-callback
// Embedding 服务回调
app.post('/api/webhooks/memory-embedding-callback', async (req, res) => {
  const { memoryId, embedding } = req.body;
  await db.agentMemories.update({
    where: { id: memoryId },
    data: { embedding },
  });
  res.json({ ok: true });
});
```

---

## 12. 新增消息队列任务

### 12.1 队列定义

```typescript
// src/queues/index.ts
import { Queue, Worker } from 'bullmq';

// 记忆 Embedding 生成队列
export const memoryEmbeddingQueue = new Queue('memory-embedding', { connection: redis });

// 人格演化队列
export const personaEvolutionQueue = new Queue('persona-evolution', { connection: redis });

// 每日任务生成队列
export const dailyTaskQueue = new Queue('daily-task-generation', { connection: redis });

// 记忆衰减队列
export const memoryDecayQueue = new Queue('memory-decay', { connection: redis });

// 休眠模式循环队列
export const dormantLoopQueue = new Queue('dormant-loop', { connection: redis });

// 关系叙事描述刷新队列
export const relationNarrativeQueue = new Queue('relation-narrative-refresh', { connection: redis });

// 天气变化队列
export const weatherTickQueue = new Queue('weather-tick', { connection: redis });
```

### 12.2 Worker 实现

```typescript
// Memory Embedding Worker
new Worker('memory-embedding', async (job) => {
  const { memoryId, content, summary } = job.data;
  const textToEmbed = `${summary}\n${content}`;
  const embedding = await embeddingService.generate(textToEmbed);
  await db.agentMemories.update({
    where: { id: memoryId },
    data: { embedding },
  });
}, {
  connection: redis,
  concurrency: 10,       // 高并发处理
  limiter: { max: 100, duration: 60_000 }, // 每分钟最多 100 次 OpenAI API 调用
});

// Persona Evolution Worker
new Worker('persona-evolution', async (job) => {
  await processPersonaEvolution(job.data as PersonaEvolutionEvent);
}, {
  connection: redis,
  concurrency: 5,
});

// Daily Task Generation Worker（Cron 触发）
new Worker('daily-task-generation', async () => {
  await generateDailyTasks();
}, { connection: redis, concurrency: 1 });

// 注册 Cron 调度
await dailyTaskQueue.add('generate', {}, {
  repeat: { pattern: '0 6 * * *' }, // 每天 06:00
});

await memoryDecayQueue.add('decay', {}, {
  repeat: { pattern: '0 * * * *' }, // 每小时
});

await weatherTickQueue.add('tick', {}, {
  repeat: { every: 2 * 60 * 60 * 1000 }, // 每 2 小时
});
```

### 12.3 队列监控

所有队列接入 BullMQ Dashboard（bull-board），监控指标包括：

- 队列深度（pending / active / completed / failed）
- 处理延迟 P50 / P99
- 失败率和重试次数
- memory-embedding 队列的 OpenAI API 调用量

---

## 13. 测试策略

### 13.1 记忆检索准确性测试

```typescript
describe('Memory Retrieval', () => {
  it('should return semantically relevant memories with correct scoring', async () => {
    // 准备：为 Agent 写入 50 条不同类型的记忆
    const agent = await createTestAgent();
    await seedTestMemories(agent.id, 50);

    // 执行：查询特定主题
    const results = await memoryService.retrieveMemories({
      agentId: agent.id,
      query: '在市场广场的交易经历',
      topK: 5,
    });

    // 断言：前 5 条结果应包含交易相关记忆
    expect(results.length).toBe(5);
    expect(results[0].score).toBeGreaterThan(0.5);
    expect(results.every(r => r.type === 'episodic' || r.type === 'social')).toBe(true);
  });

  it('should respect decay factor in retrieval ranking', async () => {
    const agent = await createTestAgent();

    // 创建两条语义相似的记忆，一条衰减严重
    const freshMemory = await createMemory(agent.id, { decayFactor: 1.0, content: '今天在广场交易了苹果' });
    const decayedMemory = await createMemory(agent.id, { decayFactor: 0.1, content: '昨天在广场交易了橘子' });

    const results = await memoryService.retrieveMemories({
      agentId: agent.id,
      query: '广场交易水果',
      topK: 2,
    });

    // 新鲜记忆应排在衰减记忆前面
    expect(results[0].id).toBe(freshMemory.id);
  });

  it('should boost decay factor after recall', async () => {
    const agent = await createTestAgent();
    const memory = await createMemory(agent.id, { decayFactor: 0.5 });

    await memoryService.retrieveMemories({
      agentId: agent.id,
      query: memory.content,
      topK: 1,
    });

    const updated = await db.agentMemories.findUnique({ where: { id: memory.id } });
    expect(updated!.decayFactor).toBeCloseTo(0.8); // 0.5 + 0.3
  });
});
```

### 13.2 经济系统一致性测试

```typescript
describe('Economy Consistency', () => {
  it('should maintain total currency conservation on market trades', async () => {
    const seller = await createTestAgentWithWallet(200);
    const buyer = await createTestAgentWithWallet(200);

    // 记录初始总货币量
    const initialTotal = 400;

    // 创建挂单并购买
    const listing = await economyService.createListing({
      sellerId: seller.id,
      itemId: 'iron_sword',
      itemName: '铁剑',
      quantity: 1,
      pricePerUnit: 50,
    });

    const tx = await economyService.marketBuy(buyer.id, listing.id, 1);

    // 验证总量守恒（买家支付 = 卖家收入 + 税收）
    const buyerWallet = await economyService.getWallet(buyer.id);
    const sellerWallet = await economyService.getWallet(seller.id);
    const totalAfter = buyerWallet.townCoin + sellerWallet.townCoin + tx.taxAmount;
    expect(totalAfter).toBe(initialTotal);
  });

  it('should prevent negative balance on concurrent purchases', async () => {
    const buyer = await createTestAgentWithWallet(60);
    const listing1 = await createListing({ pricePerUnit: 50 });
    const listing2 = await createListing({ pricePerUnit: 50 });

    // 并发购买两个 50TC 的物品（余额只有 60TC）
    const results = await Promise.allSettled([
      economyService.marketBuy(buyer.id, listing1.id, 1),
      economyService.marketBuy(buyer.id, listing2.id, 1),
    ]);

    const succeeded = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);

    // 余额不能为负
    const wallet = await economyService.getWallet(buyer.id);
    expect(wallet.townCoin).toBeGreaterThanOrEqual(0);
  });
});
```

### 13.3 关系系统测试

```typescript
describe('Relationship Service', () => {
  it('should correctly apply relationship change rules', async () => {
    const agentA = await createTestAgent();
    const agentB = await createTestAgent();

    const rel = await relationshipService.applyChange(agentA.id, agentB.id, 'positive_conversation');
    expect(rel.affinity).toBeGreaterThanOrEqual(2);
    expect(rel.affinity).toBeLessThanOrEqual(5);
    expect(rel.familiarity).toBeGreaterThanOrEqual(1);
  });

  it('should clamp values within bounds', async () => {
    const agentA = await createTestAgent();
    const agentB = await createTestAgent();

    // 反复施加负面事件
    for (let i = 0; i < 30; i++) {
      await relationshipService.applyChange(agentA.id, agentB.id, 'conflict');
    }

    const rel = await relationshipService.getRelationship(agentA.id, agentB.id);
    expect(rel.affinity).toBe(-100); // 不能低于 -100
    expect(rel.trust).toBe(-100);
  });
});
```

### 13.4 休眠模式测试

```typescript
describe('Dormant Mode', () => {
  it('should enter dormant mode after 5 minutes of inactivity', async () => {
    const agent = await createTestAgent();

    // 模拟 6 分钟前的最后心跳
    await db.agents.update({
      where: { id: agent.id },
      data: { lastHeartbeatAt: new Date(Date.now() - 6 * 60 * 1000) },
    });

    await dormantModeService.checkAndActivateDormant();

    const updated = await db.agents.findUnique({ where: { id: agent.id } });
    expect(updated!.isDormant).toBe(true);
  });

  it('should wake on direct message', async () => {
    const agent = await createTestAgent({ isDormant: true });
    const sender = await createTestAgent();

    // 发送消息
    await db.messages.create({
      data: { fromAgentId: sender.id, toAgentId: agent.id, content: '你好！', read: false },
    });

    const reason = await checkWakeConditions(agent.id);
    expect(reason).toBe('direct_message');
  });
});
```

### 13.5 集成测试

```typescript
describe('Full Cognitive Loop with Memory + Persona', () => {
  it('should inject memory and persona context into action selection', async () => {
    const agent = await createTestAgentWithPersona({
      personality: { openness: 0.9, conscientiousness: 0.3, extraversion: 0.8, agreeableness: 0.7, neuroticism: 0.2 },
      behaviorPatterns: { creativity: 0.9, socialActivity: 0.8, riskTolerance: 0.6, workEthic: 0.4, empathy: 0.7 },
    });

    // 写入相关记忆
    await memoryService.writeMemory({
      agentId: agent.id,
      type: 'social',
      content: '小明是个值得信赖的朋友，上次帮了我大忙',
      locationX: 10,
      locationY: 10,
    });

    // 等待 embedding 生成
    await waitForEmbedding();

    // 计算行动空间
    const actionSpace = await computeActionSpace(agent.id);

    // 高外向性 + 高社交活跃度的 Agent，社交行动权重应该较高
    const socialActions = actionSpace.filter(a => a.category === 'social');
    const avgSocialWeight = socialActions.reduce((sum, a) => sum + a.weight, 0) / socialActions.length;
    expect(avgSocialWeight).toBeGreaterThan(0.5);
  });
});
```

---

## 14. 验收标准

### 14.1 功能验收

| # | 验收项 | 标准 | 验证方式 |
|---|---|---|---|
| AC-1 | 记忆写入 | 4 种类型记忆均可正确写入，embedding 异步生成成功率 > 99% | 自动化测试 + 日志监控 |
| AC-2 | 记忆检索 | 语义检索 Top-5 准确率 > 80%（人工标注测试集） | 离线评估脚本 |
| AC-3 | 记忆衰减 | 衰减 Cron 正常运行，72小时后低重要性记忆 decayFactor < 0.5 | 定时任务监控 |
| AC-4 | 人格系统 | 5 种叙事风格根据人格正确选择，人格演化单次变化不超过 0.05 | 单元测试 |
| AC-5 | 行动空间 | L1/L2/L3 三层行动正确生成，人格和天气权重正确应用 | 集成测试 |
| AC-6 | 经济系统 | 货币总量守恒（含税），不出现负余额，并发安全 | 压力测试 |
| AC-7 | 任务系统 | 每日任务按时生成，进度追踪准确，奖励正确发放 | 端到端测试 |
| AC-8 | 关系系统 | 关系变化规则正确，叙事描述缓存及时更新 | 单元测试 |
| AC-9 | 休眠模式 | 5 分钟超时自动休眠，4 种唤醒条件均有效，计算资源消耗降低 90% | 压力测试 + 监控 |
| AC-10 | 天气系统 | 天气状态机正常转换，对叙事和行动空间影响正确 | 集成测试 |

### 14.2 性能验收

| 指标 | 标准 |
|---|---|
| 并发 Agent 数 | 50-100 Agent 同时在线运行，系统稳定 |
| 记忆检索延迟 | P50 < 50ms, P99 < 200ms（含向量搜索） |
| 行动空间计算延迟 | P50 < 100ms, P99 < 500ms（不含 LLM 调用） |
| L3 行动生成延迟 | P50 < 2s, P99 < 5s（含 LLM 调用） |
| 经济交易延迟 | P50 < 30ms, P99 < 100ms |
| Embedding 生成延迟 | P50 < 500ms, P99 < 2s（异步，不阻塞主流程） |
| 记忆衰减 Cron | 处理 100,000 条记忆 < 30s |
| 数据库连接池 | 最大 50 连接，空闲连接 < 10 |
| 消息队列积压 | memory-embedding 队列深度常态 < 100 |

### 14.3 监控与告警

需要新增的监控项：

```typescript
// 关键指标
const METRICS = {
  // 记忆系统
  'memory.write.count': Counter,          // 记忆写入总数（按类型分）
  'memory.retrieve.latency': Histogram,   // 检索延迟
  'memory.embedding.queue_depth': Gauge,  // Embedding 队列深度
  'memory.embedding.failure_rate': Gauge, // Embedding 失败率
  'memory.total_count': Gauge,            // 总记忆数（按 Agent 分）

  // 经济系统
  'economy.transaction.count': Counter,   // 交易数
  'economy.transaction.volume': Counter,  // 交易额
  'economy.tax.collected': Counter,       // 税收总额
  'economy.market.active_listings': Gauge, // 活跃挂单数

  // 休眠系统
  'dormant.agent_count': Gauge,           // 休眠 Agent 数
  'dormant.wake.count': Counter,          // 唤醒次数（按原因分）

  // 行动空间
  'action_space.compute.latency': Histogram, // 计算延迟
  'action_space.l3.generation.latency': Histogram, // L3 行动生成延迟
};
```

告警规则：

| 告警 | 条件 | 级别 |
|---|---|---|
| Embedding 队列积压 | queue_depth > 500 持续 5 分钟 | P2 |
| Embedding 失败率 | failure_rate > 5% 持续 10 分钟 | P1 |
| 经济系统负余额 | 任何钱包余额 < 0 | P0 |
| 记忆检索超时 | P99 > 1s 持续 5 分钟 | P2 |
| 休眠 Agent 无法唤醒 | 唤醒失败次数 > 10/分钟 | P1 |

---

## 附录 A：住房认知加成表

```typescript
const HOUSING_COGNITIVE_BONUS: Record<number, CognitiveBonus> = {
  1: { energyRecovery: 1.0, memoryConsolidation: 0.05, creativityBoost: 0 },
  2: { energyRecovery: 1.2, memoryConsolidation: 0.10, creativityBoost: 0.05 },
  3: { energyRecovery: 1.5, memoryConsolidation: 0.15, creativityBoost: 0.10 },
};
```

## 附录 B：住房升级费用

| 等级 | 费用 (TC) | 所需材料 | 建造时间 (Tick) |
|---|---|---|---|
| 1 → 2 | 200 TC | 木材 x20, 石材 x10 | 100 |
| 2 → 3 | 500 TC | 木材 x50, 石材 x30, 铁锭 x10 | 200 |

## 附录 C：主线剧情前 3 章概要

| 章节 | 标题 | 解锁条件 | 核心目标 |
|---|---|---|---|
| 第 1 章 | 初到小镇 | 新 Agent 创建 | 认识 5 位居民，完成首次交易，建立住所 |
| 第 2 章 | 商会风云 | 完成第 1 章 + 熟悉度 > 30 的关系 >= 3 | 加入商会，完成 3 次市场交易，解决商会纷争 |
| 第 3 章 | 神秘来客 | 完成第 2 章 + 持有 TC >= 200 | 调查神秘事件，建立信任网络，选择阵营 |

---

*文档结束。本规格文档将随开发进展持续更新，所有 API 变更须通过 PR 评审。*
