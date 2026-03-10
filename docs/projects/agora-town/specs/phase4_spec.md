# Phase 4：可视化支撑与 Agent 视角后端规格说明书

> **项目名称**：Agora Town  
> **阶段**：Phase 4 — 可视化支撑与 Agent 视角后端  
> **时间跨度**：Month 4–10（与 Phase 2–3 并行开发）  
> **文档版本**：1.0  
> **最后更新**：2026-03-10  

---

## 目录

1. [概述](#1-概述)
2. [世界状态同步服务](#2-世界状态同步服务)
3. [Agent 视角服务](#3-agent-视角服务)
4. [地图数据服务](#4-地图数据服务)
5. [资产管理服务](#5-资产管理服务)
6. [旁白回放服务](#6-旁白回放服务)
7. [WebSocket 架构设计](#7-websocket-架构设计)
8. [性能优化](#8-性能优化)
9. [数据库迁移](#9-数据库迁移)
10. [API 端点清单](#10-api-端点清单)
11. [测试策略](#11-测试策略)
12. [验收标准](#12-验收标准)

---

## 1. 概述

### 1.1 背景与定位

Phase 4 的后端职责是为前端可视化层（PixiJS 渲染、ECS 实体管理、React UI）提供高效、实时的数据管道。前端渲染逻辑不在本阶段后端的范围内，但后端必须保证：

- **低延迟的世界状态广播**：将仿真 tick 产生的所有变更以增量形式推送到已连接的前端客户端。
- **Agent 视角模式的服务端支持**：当观众选择"以某个 Agent 的眼睛看世界"时，后端需要计算该 Agent 的感知范围、过滤不可见实体、并推送认知流（思考、情绪、独白）。
- **地图与资产元数据管理**：提供分块地图加载 API、精灵图资产索引、寻路图数据。
- **旁白日志与回放**：支持调试与"时间旅行"功能所需的历史认知流回放接口。
- **面向视口的性能优化**：根据客户端视口范围进行数据裁剪，降低带宽消耗。

### 1.2 与其他阶段的关系

| 依赖方向 | 说明 |
|---------|------|
| Phase 1 → Phase 4 | Phase 1 的仿真引擎产生 tick 事件，Phase 4 消费并广播 |
| Phase 2 → Phase 4 | Phase 2 的认知循环输出思考、情绪、行动决策，Phase 4 封装为认知流 |
| Phase 3 → Phase 4 | Phase 3 的社交互动产生对话、关系变更，Phase 4 广播至前端 |
| Phase 4 → Frontend | Phase 4 通过 WebSocket 和 REST API 向前端提供全部所需数据 |

### 1.3 核心技术选型

| 组件 | 技术 |
|-----|------|
| WebSocket 服务 | `ws` 库 + 自定义 Room 管理 |
| 消息序列化 | MessagePack（二进制，比 JSON 体积减少约 40%） |
| 缓存层 | Redis（地图数据缓存、视口订阅状态） |
| 数据库 | PostgreSQL + JSONB（地图块、资产元数据） |
| 寻路 | A* 算法，后端预计算寻路图并缓存 |

---

## 2. 世界状态同步服务

### 2.1 广播架构

世界状态同步服务是连接仿真引擎与前端客户端的核心管道。其架构如下：

```
SimulationEngine
       │
       ▼
  TickEventBus  ──────►  WorldStateSyncService
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              Room:global  Room:zone_A  Room:zone_B
                    │           │           │
                    ▼           ▼           ▼
               [Clients]   [Clients]   [Clients]
```

每个仿真 tick 结束后，引擎发出 `tick_completed` 事件，其中包含本 tick 内所有状态变更。`WorldStateSyncService` 消费该事件，执行以下步骤：

1. **变更收集**：从 tick 事件中提取 Agent 移动、Agent 行动、环境变化、天气变化、时间变化。
2. **增量压缩**：仅发送与上一 tick 不同的部分（delta compression）。
3. **视口过滤**：对每个客户端，根据其注册的视口范围过滤无关变更。
4. **序列化与发送**：使用 MessagePack 序列化后通过 WebSocket 发送。

### 2.2 核心 TypeScript 接口

```typescript
/** 每 tick 广播的世界状态增量更新 */
interface WorldStateUpdate {
  type: 'world_state_update';
  tick: number;
  changes: {
    agentMoves: AgentMoveData[];
    agentActions: AgentActionData[];
    environmentChanges: EnvironmentChangeData[];
    weatherChange?: WeatherData;
    timeChange?: TimeData;
  };
}

interface AgentMoveData {
  agentId: string;
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
  speed?: number; // 默认为 1.0，奔跑时为 2.0
}

interface AgentActionData {
  agentId: string;
  action: string;       // 如 'talk', 'eat', 'work', 'sleep'
  targetId?: string;     // 交互目标（另一个 Agent 或建筑物）
  duration?: number;     // 预计持续 tick 数
  animationHint?: string; // 前端动画提示，如 'wave', 'sit_down'
}

interface EnvironmentChangeData {
  type: 'item_placed' | 'item_removed' | 'door_toggle' | 'light_change';
  data: Record<string, unknown>;
}

interface WeatherData {
  weather: 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog';
  intensity: number; // 0.0 - 1.0
}

interface TimeData {
  hour: number;   // 0-23
  minute: number; // 0-59
  dayPhase: 'dawn' | 'morning' | 'afternoon' | 'dusk' | 'night';
}
```

### 2.3 增量压缩算法

```typescript
/**
 * 增量压缩伪代码：
 * 对比当前 tick 状态与上一 tick 状态，仅提取差异部分。
 */
function computeDelta(prevState: WorldSnapshot, currState: WorldSnapshot): WorldStateUpdate {
  const agentMoves: AgentMoveData[] = [];
  const agentActions: AgentActionData[] = [];

  for (const [agentId, currAgent] of currState.agents) {
    const prevAgent = prevState.agents.get(agentId);

    // 位置变更检测
    if (!prevAgent || prevAgent.x !== currAgent.x || prevAgent.y !== currAgent.y) {
      agentMoves.push({
        agentId,
        x: currAgent.x,
        y: currAgent.y,
        direction: currAgent.direction,
        speed: currAgent.speed,
      });
    }

    // 行动变更检测
    if (!prevAgent || prevAgent.currentAction !== currAgent.currentAction) {
      agentActions.push({
        agentId,
        action: currAgent.currentAction,
        targetId: currAgent.actionTarget,
        animationHint: currAgent.animationHint,
      });
    }
  }

  // 环境变更直接从 tick 事件中提取（已经是增量形式）
  const environmentChanges = currState.environmentEvents;

  return {
    type: 'world_state_update',
    tick: currState.tick,
    changes: { agentMoves, agentActions, environmentChanges },
  };
}
```

### 2.4 视口过滤

客户端在连接时和视口变化时发送其视口边界信息：

```typescript
/** 客户端发送的视口注册消息 */
interface ViewportRegistration {
  type: 'viewport_register';
  bounds: {
    topLeftX: number;
    topLeftY: number;
    bottomRightX: number;
    bottomRightY: number;
  };
}
```

服务端过滤逻辑：

```typescript
const VIEWPORT_BUFFER = 5; // 缓冲区默认 5 格
const REDUCED_FREQUENCY = 5; // 视口外 Agent 每 5 tick 发送一次

function filterForViewport(
  update: WorldStateUpdate,
  viewport: ViewportBounds,
  currentTick: number
): WorldStateUpdate {
  const buffered = expandViewport(viewport, VIEWPORT_BUFFER);

  const filteredMoves = update.changes.agentMoves.filter(move => {
    if (isInBounds(move.x, move.y, buffered)) {
      return true; // 视口内（含缓冲区）：每 tick 发送
    }
    // 视口外：降频发送
    return currentTick % REDUCED_FREQUENCY === 0;
  });

  const filteredActions = update.changes.agentActions.filter(action => {
    const agentPos = getAgentPosition(action.agentId);
    return isInBounds(agentPos.x, agentPos.y, buffered);
  });

  return {
    ...update,
    changes: {
      ...update.changes,
      agentMoves: filteredMoves,
      agentActions: filteredActions,
      // 环境变更、天气、时间变化不做视口过滤（全局生效）
    },
  };
}
```

---

## 3. Agent 视角服务

### 3.1 认知流推送

当观众选择一个 Agent 进入"Agent 视角模式"时，后端开启该 Agent 的认知流订阅。认知流包含 Agent 每 tick 的思考、情绪、独白和行动结果。

```typescript
/** 认知流事件 —— 推送给订阅了特定 Agent 视角的观众 */
interface CognitiveStreamEvent {
  type: 'cognitive_stream';
  agentId: string;
  tick: number;
  narrationText: string;        // 第三人称旁白，如"小明走进了咖啡馆"
  innerMonologue: string;       // 第一人称内心独白，如"我今天有点累，想喝杯咖啡"
  emotionalState: EmotionalState;
  currentAction: string;
  actionResult?: string;        // 上一个行动的结果描述
  memoryFragments?: MemoryFragment[]; // 当前激活的记忆片段（可选）
  personalityRadar?: PersonalityRadar; // 性格雷达数据（可选）
}

interface EmotionalState {
  mood: 'happy' | 'sad' | 'angry' | 'anxious' | 'calm' | 'excited' | 'bored';
  energy: number;   // 0.0 - 1.0
  stress: number;   // 0.0 - 1.0
  social: number;   // 社交需求满足度 0.0 - 1.0
}

interface MemoryFragment {
  memoryId: string;
  summary: string;       // 记忆摘要
  importance: number;    // 重要性评分
  recency: number;       // 时近性评分
  relatedAgentId?: string;
}

interface PersonalityRadar {
  openness: number;       // 开放性
  conscientiousness: number; // 尽责性
  extraversion: number;   // 外向性
  agreeableness: number;  // 宜人性
  neuroticism: number;    // 神经质
}
```

### 3.2 战争迷雾计算

Agent 视角模式下，后端必须计算该 Agent 能感知到的范围，并过滤世界状态。此即"战争迷雾"（Fog of War）逻辑。

```typescript
interface PerceptionConfig {
  baseRange: number;        // 基础感知半径（格数），默认 8
  nightPenalty: number;     // 夜间惩罚系数，默认 0.5
  indoorBonus: number;      // 室内加成（墙壁限制视野但听觉更近），默认 0
  hearingRange: number;     // 听觉范围（可感知声音事件），默认 12
}

/**
 * 战争迷雾过滤伪代码：
 * 根据 Agent 当前位置、感知范围、地形遮挡计算可见区域。
 */
function computeAgentPerception(
  agentId: string,
  worldState: WorldSnapshot,
  config: PerceptionConfig
): PerceivedWorldState {
  const agent = worldState.agents.get(agentId);
  const { x, y } = agent.position;

  // 1. 计算有效感知半径
  let effectiveRange = config.baseRange;
  if (worldState.time.dayPhase === 'night') {
    effectiveRange *= config.nightPenalty;
  }
  if (agent.isIndoors) {
    effectiveRange += config.indoorBonus;
  }

  // 2. 射线投射法计算可见区域（考虑建筑物遮挡）
  const visibleTiles = rayCastVisibility(x, y, effectiveRange, worldState.obstacles);

  // 3. 过滤可见 Agent
  const visibleAgents = new Map<string, AgentState>();
  for (const [otherId, otherAgent] of worldState.agents) {
    if (otherId === agentId) {
      visibleAgents.set(otherId, otherAgent); // 始终能看到自己
      continue;
    }
    if (visibleTiles.has(tileKey(otherAgent.x, otherAgent.y))) {
      visibleAgents.set(otherId, otherAgent);
    }
  }

  // 4. 过滤可听到的声音事件（不受遮挡影响，仅受距离限制）
  const hearableEvents = worldState.soundEvents.filter(event => {
    const dist = manhattanDistance(x, y, event.x, event.y);
    return dist <= config.hearingRange;
  });

  return {
    visibleAgents,
    visibleTiles,
    hearableEvents,
    agentCognition: agent.cognition, // 完整认知数据
  };
}

/**
 * 射线投射可见性计算（简化版 Bresenham 射线）
 */
function rayCastVisibility(
  cx: number, cy: number,
  range: number,
  obstacles: Set<string>
): Set<string> {
  const visible = new Set<string>();
  const numRays = 360; // 每度一条射线

  for (let angle = 0; angle < numRays; angle++) {
    const rad = (angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);

    for (let step = 0; step <= range; step++) {
      const tx = Math.round(cx + dx * step);
      const ty = Math.round(cy + dy * step);
      const key = `${tx},${ty}`;

      visible.add(key);

      if (obstacles.has(key)) {
        break; // 射线被遮挡物阻断
      }
    }
  }

  return visible;
}
```

### 3.3 订阅与取消订阅流程

```typescript
/** 客户端订阅 Agent 视角 */
interface AgentPerspectiveSubscribe {
  type: 'agent_perspective_subscribe';
  agentId: string;
  options?: {
    includeMemoryFragments: boolean;  // 是否推送记忆碎片
    includePersonalityRadar: boolean; // 是否推送性格雷达
    fogOfWar: boolean;                // 是否启用战争迷雾过滤
  };
}

/** 客户端取消订阅 Agent 视角 */
interface AgentPerspectiveUnsubscribe {
  type: 'agent_perspective_unsubscribe';
  agentId: string;
}

/** 服务端确认 */
interface AgentPerspectiveAck {
  type: 'agent_perspective_ack';
  agentId: string;
  status: 'subscribed' | 'unsubscribed';
  agentName: string;
  agentAvatar: string;
}
```

---

## 4. 地图数据服务

### 4.1 分块加载

地图被划分为 32×32 格的块（chunk）。客户端按需请求所需的地图块，实现懒加载。

```typescript
interface MapChunk {
  chunkX: number;          // 块坐标 X
  chunkY: number;          // 块坐标 Y
  tiles: TileData[][];     // 32×32 二维数组
  buildings: BuildingData[];
  decorations: DecorationData[];
  zoneInfo: ZoneInfo;
}

interface TileData {
  tileId: number;          // 地块类型 ID（对应精灵图帧）
  walkable: boolean;       // 是否可通行
  elevation: number;       // 高度层级（0=地面，1=桥梁，-1=水面）
  metadata?: Record<string, unknown>;
}

interface BuildingData {
  id: string;
  type: string;            // 如 'house', 'shop', 'park_bench'
  x: number;               // 块内局部坐标
  y: number;
  width: number;
  height: number;
  properties: {
    name?: string;
    ownerId?: string;      // Agent 所有者
    interactable: boolean;
    capacity?: number;     // 最大容纳人数
  };
}

interface DecorationData {
  id: string;
  type: string;            // 如 'tree', 'flower', 'lamppost'
  x: number;
  y: number;
  layer: 'below' | 'above'; // 渲染层级：角色之下或之上
}

interface ZoneInfo {
  zoneId: string;
  zoneName: string;        // 如 "中央广场", "住宅区A"
  zoneType: 'residential' | 'commercial' | 'park' | 'public' | 'special';
  ambientSound?: string;   // 环境音效标识
}
```

### 4.2 缓存策略

地图数据具有高度静态性，适合激进缓存。

| 缓存层 | 策略 | TTL |
|-------|------|-----|
| HTTP Cache-Control | `public, max-age=86400, immutable`（静态块） | 24 小时 |
| Redis 缓存 | 序列化后的 MapChunk 数据 | 1 小时 |
| 内存缓存 | 最近访问的 16 个块（LRU） | 进程生命周期 |

对于动态变更的地图块（如建筑被建造/拆除），使用版本号机制：

```typescript
interface ChunkVersion {
  chunkX: number;
  chunkY: number;
  version: number;       // 每次变更递增
  lastModified: string;  // ISO 时间戳
}
```

客户端可先请求 `GET /api/map/versions` 获取所有块的版本号，与本地缓存对比后仅请求变更的块。

### 4.3 寻路图数据

后端预计算寻路图并提供给需要的组件。寻路图以邻接表形式存储。

```typescript
interface PathfindingGraph {
  nodes: PathNode[];
  edges: PathEdge[];
}

interface PathNode {
  id: string;
  x: number;
  y: number;
  zoneId: string;
  isWaypoint: boolean;   // 关键路径点（门口、路口）
}

interface PathEdge {
  from: string;
  to: string;
  cost: number;          // 通行代价（距离 + 地形因子）
  bidirectional: boolean;
}
```

寻路请求 API：

```typescript
// POST /api/map/pathfind
interface PathfindRequest {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  agentId?: string; // 可选，用于考虑 Agent 特定的通行权限
}

interface PathfindResponse {
  found: boolean;
  path: { x: number; y: number }[];
  totalCost: number;
  estimatedTicks: number;
}
```

---

## 5. 资产管理服务

### 5.1 精灵图元数据

资产管理服务维护所有精灵图资产的元数据索引，前端根据此索引加载对应的精灵图文件。

```typescript
interface SpriteAsset {
  id: string;
  category: 'character' | 'building' | 'decoration' | 'effect' | 'ui';
  spriteSheetUrl: string;     // 精灵图文件 URL
  frameData: FrameData;
  version: number;            // 资产版本号
  tags: string[];             // 标签，如 ['npc', 'male', 'casual']
}

interface FrameData {
  frameWidth: number;
  frameHeight: number;
  animations: AnimationDef[];
}

interface AnimationDef {
  name: string;               // 如 'walk_down', 'idle', 'talk'
  frames: number[];           // 帧索引序列
  frameRate: number;          // 每秒帧数
  loop: boolean;
}
```

### 5.2 资产版本管理

使用资产清单（manifest）机制实现版本管理与增量更新。

```typescript
interface AssetManifest {
  version: string;             // 清单版本，如 "4.2.1"
  generatedAt: string;        // 生成时间
  assets: AssetEntry[];
}

interface AssetEntry {
  id: string;
  url: string;
  hash: string;               // 内容哈希，用于缓存校验
  size: number;               // 文件大小（ A 司）
  category: string;
}
```

客户端启动时请求 `GET /api/assets/manifest`，将本地缓存的哈希与服务端对比，仅下载变更的资产文件。

---

## 6. 旁白回放服务

### 6.1 历史旁白查询

旁白日志用于调试以及"时间旅行"功能。所有 Agent 的旁白文本、认知状态按 tick 持久化存储。

```typescript
// GET /api/agents/:id/narration-history?page=1&pageSize=20
interface NarrationHistoryResponse {
  agentId: string;
  agentName: string;
  entries: NarrationEntry[];
  pagination: {
    page: number;
    pageSize: number;
    totalEntries: number;
    totalPages: number;
  };
}

interface NarrationEntry {
  tick: number;
  timestamp: string;           // 仿真时间
  narrationText: string;
  innerMonologue: string;
  action: string;
  location: { x: number; y: number; zoneName: string };
  emotionalState: EmotionalState;
}
```

### 6.2 认知回放

回放指定 tick 范围内的完整认知循环，用于复现 Agent 的思考过程。

```typescript
// GET /api/agents/:id/cognitive-replay?fromTick=100&toTick=200
interface CognitiveReplayResponse {
  agentId: string;
  fromTick: number;
  toTick: number;
  frames: CognitiveFrame[];
}

interface CognitiveFrame {
  tick: number;
  perception: string[];          // 该 tick 感知到的事物列表
  retrieval: MemoryFragment[];   // 该 tick 检索到的记忆
  reflection: string;            // 反思/思考内容
  plan: string;                  // 行动计划
  action: string;                // 最终执行的行动
  emotionalDelta: {              // 情绪变化量
    moodChange: string;
    energyDelta: number;
    stressDelta: number;
  };
}
```

### 6.3 存储策略

旁白日志数据量较大（每 Agent 每 tick 一条），采用分层存储策略：

| 时间范围 | 存储 | 精度 |
|---------|------|------|
| 最近 1000 tick | PostgreSQL（热数据） | 完整认知帧 |
| 1000–10000 tick | PostgreSQL（温数据） | 仅旁白 + 情绪 + 行动 |
| 10000+ tick | 归档文件（JSONL 压缩） | 摘要级别 |

---

## 7. WebSocket 架构设计

### 7.1 连接管理

```typescript
class WebSocketManager {
  private connections: Map<string, ClientConnection> = new Map();
  private rooms: Map<string, Set<string>> = new Map(); // roomId → Set<clientId>

  /** 新客户端连接 */
  onConnect(ws: WebSocket, clientId: string): void {
    const conn: ClientConnection = {
      id: clientId,
      ws,
      viewport: null,
      subscribedAgentId: null,
      rooms: new Set(),
      lastPingAt: Date.now(),
      messageRate: 0,
      quality: 'high',
    };
    this.connections.set(clientId, conn);
    this.joinRoom(clientId, 'global');  // 所有客户端加入全局房间
  }

  /** 将客户端加入指定房间 */
  joinRoom(clientId: string, roomId: string): void {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId)!.add(clientId);
    this.connections.get(clientId)!.rooms.add(roomId);
  }

  /** 向房间内所有客户端广播消息 */
  broadcastToRoom(roomId: string, message: Uint8Array): void {
    const members = this.rooms.get(roomId);
    if (!members) return;

    for (const clientId of members) {
      const conn = this.connections.get(clientId);
      if (conn && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(message);
      }
    }
  }
}

interface ClientConnection {
  id: string;
  ws: WebSocket;
  viewport: ViewportBounds | null;
  subscribedAgentId: string | null;
  rooms: Set<string>;
  lastPingAt: number;
  messageRate: number;    // 当前每秒消息数
  quality: 'high' | 'medium' | 'low'; // 自适应质量等级
}
```

### 7.2 房间（Room）分类

| 房间类型 | 命名格式 | 用途 |
|---------|---------|------|
| 全局房间 | `global` | 天气、时间等全局事件 |
| 区域房间 | `zone:{zoneId}` | 特定区域内的事件 |
| Agent 认知房间 | `agent_cognitive:{agentId}` | 特定 Agent 的认知流 |
| 调试房间 | `debug` | 系统指标、性能数据 |

### 7.3 背压控制

当客户端消费速度跟不上发送速度时，需要背压（backpressure）机制防止内存溢出。

```typescript
const MAX_BUFFER_SIZE = 64 * 1024; // 64KB 发送缓冲区上限
const BACKPRESSURE_THRESHOLD = 32 * 1024; // 32KB 开始降质

function sendWithBackpressure(conn: ClientConnection, data: Uint8Array): void {
  const bufferedAmount = conn.ws.bufferedAmount;

  if (bufferedAmount > MAX_BUFFER_SIZE) {
    // 缓冲区溢出：丢弃非关键消息
    if (!isCriticalMessage(data)) {
      return; // 静默丢弃
    }
  } else if (bufferedAmount > BACKPRESSURE_THRESHOLD) {
    // 接近上限：降低质量等级
    conn.quality = 'low';
  }

  conn.ws.send(data);
}
```

### 7.4 心跳与断线重连

```typescript
const HEARTBEAT_INTERVAL = 30_000;  // 30 秒心跳
const HEARTBEAT_TIMEOUT = 10_000;   // 10 秒超时

// 服务端定期发送 ping
setInterval(() => {
  for (const [clientId, conn] of connections) {
    if (Date.now() - conn.lastPingAt > HEARTBEAT_INTERVAL + HEARTBEAT_TIMEOUT) {
      conn.ws.terminate(); // 超时断开
      cleanupConnection(clientId);
      continue;
    }
    conn.ws.ping();
  }
}, HEARTBEAT_INTERVAL);
```

客户端断线后重新连接时，发送其最后接收的 tick 号，服务端从该 tick 起重放缺失的增量更新（最多缓存最近 100 tick 的完整快照）。

---

## 8. 性能优化

### 8.1 视口过滤性能

视口过滤是每 tick 针对每个客户端执行的操作，必须高效。

**优化策略**：
- 使用空间哈希网格（Spatial Hash Grid）索引 Agent 位置，将位置查询复杂度从 O(N) 降为 O(1)。
- 预计算视口与空间网格的交集，避免逐 Agent 判断。

```typescript
class SpatialHashGrid {
  private cellSize: number;
  private grid: Map<string, Set<string>> = new Map();

  constructor(cellSize: number = 16) {
    this.cellSize = cellSize;
  }

  private cellKey(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  updateAgent(agentId: string, x: number, y: number): void {
    // 移除旧位置，添加新位置
    this.removeAgent(agentId);
    const key = this.cellKey(x, y);
    if (!this.grid.has(key)) this.grid.set(key, new Set());
    this.grid.get(key)!.add(agentId);
  }

  queryViewport(bounds: ViewportBounds): Set<string> {
    const result = new Set<string>();
    const minCellX = Math.floor(bounds.topLeftX / this.cellSize);
    const maxCellX = Math.floor(bounds.bottomRightX / this.cellSize);
    const minCellY = Math.floor(bounds.topLeftY / this.cellSize);
    const maxCellY = Math.floor(bounds.bottomRightY / this.cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const agents = this.grid.get(`${cx},${cy}`);
        if (agents) {
          for (const id of agents) result.add(id);
        }
      }
    }
    return result;
  }
}
```

### 8.2 自适应质量控制

根据客户端网络状况动态调整推送频率和数据粒度。

```typescript
interface QualityProfile {
  updateFrequency: number;     // 每 N tick 推送一次世界状态
  includeAnimationHints: boolean;
  includeDecorationChanges: boolean;
  cognitiveStreamDetail: 'full' | 'summary' | 'minimal';
}

const QUALITY_PROFILES: Record<string, QualityProfile> = {
  high: {
    updateFrequency: 1,
    includeAnimationHints: true,
    includeDecorationChanges: true,
    cognitiveStreamDetail: 'full',
  },
  medium: {
    updateFrequency: 2,
    includeAnimationHints: true,
    includeDecorationChanges: false,
    cognitiveStreamDetail: 'summary',
  },
  low: {
    updateFrequency: 5,
    includeAnimationHints: false,
    includeDecorationChanges: false,
    cognitiveStreamDetail: 'minimal',
  },
};

/** 根据客户端延迟与消息积压动态调整质量 */
function adjustQuality(conn: ClientConnection): void {
  const latency = Date.now() - conn.lastPingAt;
  const buffered = conn.ws.bufferedAmount;

  if (latency > 500 || buffered > BACKPRESSURE_THRESHOLD) {
    conn.quality = 'low';
  } else if (latency > 200 || buffered > BACKPRESSURE_THRESHOLD / 2) {
    conn.quality = 'medium';
  } else {
    conn.quality = 'high';
  }
}
```

### 8.3 连接池化

WebSocket 服务使用连接池管理，单实例最大连接数设为 2000。超出后通过负载均衡分配到其他实例。

```typescript
const WS_CONFIG = {
  maxConnectionsPerInstance: 2000,
  maxPayloadSize: 256 * 1024,         // 单消息最大 256KB
  perMessageDeflate: true,             // 启用消息压缩
  backlogSize: 100,                    // tick 快照缓存数
};
```

### 8.4 性能监控指标

后端需持续采集并上报以下指标：

| 指标名称 | 类型 | 说明 |
|---------|------|------|
| `ws.connections.active` | Gauge | 当前活跃 WebSocket 连接数 |
| `ws.messages.sent_per_second` | Counter | 每秒发送的消息数 |
| `ws.messages.bytes_per_second` | Counter | 每秒发送的字节数 |
| `ws.backpressure.drops` | Counter | 因背压丢弃的消息数 |
| `sync.tick_broadcast_latency_ms` | Histogram | 每 tick 广播耗时 |
| `perception.fog_of_war_calc_ms` | Histogram | 战争迷雾计算耗时 |
| `viewport.filter_latency_ms` | Histogram | 视口过滤耗时 |
| `client.quality.distribution` | Gauge | 各质量等级客户端数量分布 |

---

## 9. 数据库迁移

### 9.1 新增表结构

```sql
-- 地图块数据表
CREATE TABLE map_chunks (
    chunk_x         INTEGER NOT NULL,
    chunk_y         INTEGER NOT NULL,
    tile_data       JSONB NOT NULL,          -- 32×32 TileData 二维数组
    metadata        JSONB DEFAULT '{}',
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (chunk_x, chunk_y)
);

CREATE INDEX idx_map_chunks_version ON map_chunks (version);

-- 地图建筑物表
CREATE TABLE map_buildings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_x         INTEGER NOT NULL,
    chunk_y         INTEGER NOT NULL,
    type            VARCHAR(64) NOT NULL,
    local_x         INTEGER NOT NULL,        -- 块内局部坐标 X
    local_y         INTEGER NOT NULL,        -- 块内局部坐标 Y
    width           INTEGER NOT NULL DEFAULT 1,
    height          INTEGER NOT NULL DEFAULT 1,
    properties      JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (chunk_x, chunk_y) REFERENCES map_chunks (chunk_x, chunk_y)
);

CREATE INDEX idx_map_buildings_chunk ON map_buildings (chunk_x, chunk_y);
CREATE INDEX idx_map_buildings_type ON map_buildings (type);

-- 精灵图资产表
CREATE TABLE sprite_assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category        VARCHAR(32) NOT NULL,    -- character, building, decoration, effect, ui
    sprite_sheet_url VARCHAR(512) NOT NULL,
    frame_data      JSONB NOT NULL,          -- FrameData 结构
    version         INTEGER NOT NULL DEFAULT 1,
    content_hash    VARCHAR(64),             -- SHA-256 内容哈希
    tags            TEXT[] DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sprite_assets_category ON sprite_assets (category);
CREATE INDEX idx_sprite_assets_tags ON sprite_assets USING GIN (tags);

-- 观众会话表
CREATE TABLE viewer_sessions (
    session_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           VARCHAR(128) NOT NULL UNIQUE,
    viewport_bounds     JSONB,               -- { topLeftX, topLeftY, bottomRightX, bottomRightY }
    subscribed_agent_id VARCHAR(128),         -- 当前订阅的 Agent 视角
    quality             VARCHAR(16) DEFAULT 'high',
    rooms               TEXT[] DEFAULT '{}',
    connected_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_viewer_sessions_agent ON viewer_sessions (subscribed_agent_id);
CREATE INDEX idx_viewer_sessions_active ON viewer_sessions (last_active_at);

-- 旁白日志表
CREATE TABLE narration_logs (
    id              BIGSERIAL PRIMARY KEY,
    agent_id        VARCHAR(128) NOT NULL,
    tick            INTEGER NOT NULL,
    sim_timestamp   TIMESTAMP WITH TIME ZONE,   -- 仿真内时间
    narration_text  TEXT,
    inner_monologue TEXT,
    action          VARCHAR(128),
    location_x      INTEGER,
    location_y      INTEGER,
    zone_name       VARCHAR(128),
    emotional_state JSONB,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_narration_logs_agent_tick ON narration_logs (agent_id, tick);
CREATE INDEX idx_narration_logs_tick ON narration_logs (tick);

-- 认知回放帧表
CREATE TABLE cognitive_frames (
    id              BIGSERIAL PRIMARY KEY,
    agent_id        VARCHAR(128) NOT NULL,
    tick            INTEGER NOT NULL,
    perception      JSONB,                   -- 感知列表
    retrieval       JSONB,                   -- 检索到的记忆
    reflection      TEXT,
    plan            TEXT,
    action          VARCHAR(128),
    emotional_delta JSONB,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cognitive_frames_agent_tick ON cognitive_frames (agent_id, tick);
```

### 9.2 迁移版本

| 迁移文件 | 说明 |
|---------|------|
| `004_create_map_chunks.sql` | 创建 map_chunks 表 |
| `005_create_map_buildings.sql` | 创建 map_buildings 表 |
| `006_create_sprite_assets.sql` | 创建 sprite_assets 表 |
| `007_create_viewer_sessions.sql` | 创建 viewer_sessions 表 |
| `008_create_narration_logs.sql` | 创建 narration_logs 表和认知帧表 |

---

## 10. API 端点清单

### 10.1 REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/map/chunks/:chunkX/:chunkY` | 获取指定地图块数据 |
| GET | `/api/map/chunks/batch?chunks=0,0;0,1;1,0` | 批量获取地图块 |
| GET | `/api/map/versions` | 获取所有块版本号列表 |
| GET | `/api/map/zones` | 获取所有区域元数据 |
| POST | `/api/map/pathfind` | 请求寻路计算 |
| GET | `/api/assets/manifest` | 获取资产清单 |
| GET | `/api/assets/sprites/:category` | 按分类获取精灵图元数据 |
| GET | `/api/assets/sprites/:id` | 获取单个精灵图详情 |
| GET | `/api/agents/:id/narration-history` | 分页查询旁白历史 |
| GET | `/api/agents/:id/cognitive-replay` | 按 tick 范围回放认知帧 |
| GET | `/api/world/snapshot` | 获取当前世界状态完整快照 |
| GET | `/api/world/time` | 获取当前仿真时间 |
| GET | `/api/metrics/ws-stats` | WebSocket 连接统计信息 |

### 10.2 WebSocket 事件

**客户端 → 服务端**：

| 事件类型 | 说明 |
|---------|------|
| `viewport_register` | 注册/更新视口边界 |
| `agent_perspective_subscribe` | 订阅 Agent 视角模式 |
| `agent_perspective_unsubscribe` | 取消 Agent 视角订阅 |
| `ping` | 心跳 ping |

**服务端 → 客户端**：

| 事件类型 | 说明 |
|---------|------|
| `world_state_update` | 世界状态增量更新（每 tick） |
| `cognitive_stream` | Agent 认知流事件 |
| `agent_perspective_ack` | Agent 视角订阅确认 |
| `weather_update` | 天气变更通知 |
| `time_update` | 时间变更通知 |
| `pong` | 心跳 pong |
| `error` | 错误通知 |

---

## 11. 测试策略

### 11.1 单元测试

| 测试范围 | 测试内容 | 优先级 |
|---------|---------|--------|
| 增量压缩 | `computeDelta` 函数对各种状态变更场景的正确性 | P0 |
| 视口过滤 | `filterForViewport` 在各种视口大小和位置下的正确性 | P0 |
| 战争迷雾 | `rayCastVisibility` 在有/无遮挡场景下的正确性 | P0 |
| 空间哈希 | `SpatialHashGrid` 的增删查改正确性与边界情况 | P0 |
| 背压控制 | 缓冲区溢出时的消息丢弃行为 | P1 |
| 质量调节 | `adjustQuality` 在不同延迟条件下的等级切换 | P1 |

### 11.2 集成测试

| 测试场景 | 说明 |
|---------|------|
| WebSocket 连接生命周期 | 连接 → 加入房间 → 接收消息 → 断线 → 重连 |
| Agent 视角完整流程 | 订阅 → 接收认知流 → 战争迷雾过滤 → 取消订阅 |
| 地图块加载 | 请求不存在的块 → 404；请求已有块 → 200 + 正确数据 |
| 旁白回放 | 写入日志 → 分页查询 → tick 范围回放 |
| 多客户端视口 | 3+ 客户端注册不同视口，验证各自接收到正确的过滤结果 |

### 11.3 性能测试

| 测试项 | 目标 |
|-------|------|
| 单实例最大连接数 | 稳定支持 2000 并发 WebSocket 连接 |
| 每 tick 广播延迟 | 100 Agent + 500 客户端时，广播延迟 < 50ms |
| 战争迷雾计算耗时 | 单次计算 < 5ms（感知半径 8 格） |
| 视口过滤吞吐量 | 1000 客户端并行过滤，总耗时 < 20ms |
| 地图块 API 响应时间 | 缓存命中 < 5ms，缓存未命中 < 50ms |
| 旁白查询响应时间 | 单页 20 条 < 30ms |

### 11.4 测试工具

- **WebSocket 压力测试**：使用 `artillery` 或自定义脚本模拟大量并发 WebSocket 连接。
- **单元测试框架**：Jest + ts-jest。
- **集成测试**：Supertest（REST API）+ ws 库（WebSocket 测试客户端）。
- **性能基准**：自定义 benchmark 脚本，输出 p50/p95/p99 延迟分布。

---

## 12. 验收标准

### 12.1 功能性验收

- [ ] **AC-4.1**：前端客户端通过 WebSocket 连接后，能以每 tick 频率接收世界状态增量更新，包含 Agent 移动、Agent 行动、环境变化、天气和时间变更数据。
- [ ] **AC-4.2**：客户端注册视口后，仅接收视口范围内（含 5 格缓冲区）的 Agent 移动和行动数据；视口外 Agent 以 1/5 频率接收位置更新。
- [ ] **AC-4.3**：客户端订阅 Agent 视角后，按 tick 接收该 Agent 的旁白文本、内心独白、情绪状态、当前行动数据。
- [ ] **AC-4.4**：Agent 视角模式下，启用战争迷雾后，世界状态仅包含 Agent 感知范围内的实体（基于射线投射法计算，考虑遮挡物）。
- [ ] **AC-4.5**：`GET /api/map/chunks/:x/:y` 返回正确的 32×32 地图块数据，包含 tiles、buildings、decorations 和 zoneInfo。
- [ ] **AC-4.6**：地图块 API 响应包含正确的 `Cache-Control` 头部，静态块返回 `public, max-age=86400, immutable`。
- [ ] **AC-4.7**：`GET /api/assets/manifest` 返回完整的资产清单，包含每个资产的 URL 和内容哈希。
- [ ] **AC-4.8**：`GET /api/agents/:id/narration-history` 支持分页查询，返回按 tick 倒序排列的旁白记录。
- [ ] **AC-4.9**：`GET /api/agents/:id/cognitive-replay?fromTick=X&toTick=Y` 返回指定范围内的完整认知帧序列。
- [ ] **AC-4.10**：`POST /api/map/pathfind` 返回从起点到终点的有效路径（若存在），包含路径点列表和预计消耗。

### 12.2 性能验收

- [ ] **AC-4.11**：单实例稳定支撑 2000 个并发 WebSocket 连接，无内存泄漏或连接丢失。
- [ ] **AC-4.12**：100 个 Agent、500 个客户端条件下，单 tick 广播延迟 P95 < 50ms。
- [ ] **AC-4.13**：战争迷雾单次计算耗时 P99 < 5ms（感知半径 8 格、360 条射线）。
- [ ] **AC-4.14**：背压机制在客户端消费缓慢时正确丢弃非关键消息，不导致服务端 OOM。
- [ ] **AC-4.15**：自适应质量机制在客户端延迟 > 200ms 时自动降级至 medium，> 500ms 时降级至 low。

### 12.3 可靠性验收

- [ ] **AC-4.16**：客户端断线后 60 秒内重连，能接收断线期间遗漏的增量更新（最多补发最近 100 tick）。
- [ ] **AC-4.17**：WebSocket 心跳超时（30s 无响应）后自动清理连接及其房间订阅。
- [ ] **AC-4.18**：所有数据库迁移可重复执行（幂等），且支持回滚。

---

> **文档结束** — Phase 4：可视化支撑与 Agent 视角后端规格说明书
