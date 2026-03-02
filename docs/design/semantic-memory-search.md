# 语义记忆搜索 - 设计文档

> **状态**: 设计中
> **优先级**: P0 (高)
> **最后更新**: 2026-03-02

## 1. 问题分析

### 当前状况

Beeclaw 当前的记忆搜索 (`src/memory/indexer.ts`) 使用**关键词匹配**：

```typescript
// 当前实现
function extractKeywords(content: string): string[] {
  // 硬编码的模式匹配
  const patterns = [
    /([汤吴纪修][\u4e00-\u9fa5]{1,3})/g,  // 人名
    /(字节|百度|腾讯|阿里)/g,              // 公司
    /(期权|股票|基金)/g,                   // 金融
    // ...
  ];
}
```

### 问题

1. **无法理解语义相似性**
   - 用户问："上次聊到的那个项目" → 无法匹配
   - 用户问："我老婆的工作" → 搜索 "老婆" 可能找不到 "妻子"

2. **硬编码模式维护困难**
   - 新词汇需要手动添加规则
   - 无法适应新领域

3. **中英文混合支持差**
   - 中英文混合查询效果不佳

## 2. 解决方案

### 2.1 技术选型

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **Ollama 本地 Embedding** | 免费、隐私、离线 | 需要安装 Ollama | ✅ 推荐 |
| 智谱 API | 中文效果好 | 需要网络、有成本 | 备选 |
| OpenAI Embedding | 效果最好 | 需要网络、成本高 | 不推荐 |
| 句向量 (无 embedding) | 零依赖 | 效果差 | 不推荐 |

**推荐方案**: Ollama + nomic-embed-text (本地、免费、中文支持)

### 2.2 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Semantic Memory Search                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐     ┌──────────────┐                     │
│  │ Memory Files │────▶│   Embedder    │                     │
│  │ (*.md)        │     │ (Ollama)     │                     │
│  └──────────────┘     └──────┬───────┘                     │
│                              │                               │
│                              ▼                               │
│                       ┌──────────────┐                      │
│                       │  Embeddings   │                      │
│                       │  Store        │                      │
│                       │ (SQLite/JSON) │                      │
│                       └──────┬───────┘                      │
│                              │                               │
│  ┌──────────────┐     ┌──────────────┐                     │
│  │ User Query   │────▶│   Search     │                     │
│  │               │     │  (Cosine)    │                     │
│  └──────────────┘     └──────┬───────┘                     │
│                              │                               │
│                              ▼                               │
│                       ┌──────────────┐                      │
│                       │   Results     │                      │
│                       │  (Ranked)     │                      │
│                       └──────────────┘                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 数据结构

```typescript
// 向量存储结构
interface EmbeddingEntry {
  id: string;              // UUID
  path: string;            // 文件路径: facts/preferences.md
  content: string;         // 原始文本块
  embedding: number[];     // 768 维向量 (nomic-embed-text)
  chunkIndex: number;      // 文件内的块索引
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    source: 'facts' | 'knowledge' | 'core';
  };
}

// 向量索引文件: data/memory/embeddings.json
interface EmbeddingStore {
  entries: EmbeddingEntry[];
  lastIndexed: string;
  model: string;  // "nomic-embed-text"
  dimension: number;  // 768
}
```

### 2.4 核心模块

#### 2.4.1 Embedder (向量化)

```typescript
// src/memory/embedding.ts

export interface EmbedderConfig {
  provider: 'ollama' | 'zhipu' | 'openai';
  model: string;  // 默认: nomic-embed-text
  baseUrl?: string;
}

export class Embedder {
  constructor(config: EmbedderConfig);

  // 文本向量化
  async embed(text: string): Promise<number[]>;

  // 批量向量化
  async embedBatch(texts: string[]): Promise<number[][]>;
}
```

#### 2.4.2 VectorStore (向量存储)

```typescript
// src/memory/vector-store.ts

export class VectorStore {
  private store: EmbeddingStore;
  private storePath: string;

  constructor(storePath: string);

  // 添加向量
  async add(entry: Omit<EmbeddingEntry, 'id'>): Promise<string>;

  // 批量添加
  async addBatch(entries: Omit<EmbeddingEntry, 'id'>[]): Promise<string[]>;

  // 删除文件的所有向量
  async deleteByPath(path: string): Promise<void>;

  // 相似度搜索
  async search(
    query: number[],
    options: {
      topK?: number;         // 返回前 K 个结果，      threshold?: number;  // 相似度阈值
      source?: 'facts' | 'knowledge' | 'core';
    }
  ): Promise<SearchResult[]>;

  // 获取统计
  getStats(): { totalEntries: number; bySource: Record<string, number> };
}
```

#### 2.4.3 SemanticSearcher (语义搜索)

```typescript
// src/memory/semantic-search.ts

export interface SemanticSearchResult {
  path: string;           // 文件路径
  content: string;        // 匹配的文本块
  score: number;          // 相似度分数 (0-1)
  chunkIndex: number;     // 块索引
  matchedContext?: string; // 前后文
}

export class SemanticSearcher {
  private embedder: Embedder;
  private vectorStore: VectorStore;

  constructor(config: SemanticSearchConfig);

  // 语义搜索
  async search(
    query: string,
    options?: {
      topK?: number;
      threshold?: number;
      source?: 'facts' | 'knowledge' | 'core';
      hybrid?: boolean;  // 是否混合关键词搜索
    }
  ): Promise<SemanticSearchResult[]>;

  // 重建索引
  async rebuildIndex(): Promise<void>;

  // 增量更新
  async updateFile(path: string, content: string): Promise<void>;
}
```

### 2.5 工具集成

更新 `memory_search` 工具支持语义搜索：

```typescript
// src/memory/tools.ts

export const memorySearchTool = {
  name: 'memory_search',
  description: `Search memories using semantic understanding.

Examples:
- "上次聊到的那个项目" - finds project-related conversations
- "我老婆的工作" - finds wife's job info (even if stored as "妻子")
- "投资相关的信息" - finds all investment-related content

Parameters:
- query: Natural language search query
- mode: "semantic" (default) | "keyword" | "hybrid"
- topK: Number of results (default: 5)
- source: "facts" | "knowledge" | "all" (default: "all")`,
  parameters: { ... }
};
```

### 2.6 配置选项

```json
// beeclaw.json
{
  "memory": {
    "embedding": {
      "enabled": true,
      "provider": "ollama",
      "model": "nomic-embed-text",
      "baseUrl": "http://localhost:11434",
      "chunkSize": 500,      // 每块最大字符数
      "chunkOverlap": 50,     // 块重叠字符数
      "autoIndex": true       // 文件变更时自动更新索引
    }
  }
}
```

## 3. 实现计划

### Phase 1: 核心模块 (1-2 天)

| 任务 | 文件 | 说明 |
|------|------|------|
| Embedder | `src/memory/embedding.ts` | Ollama 集成 |
| VectorStore | `src/memory/vector-store.ts` | 向量存储 |
| SemanticSearcher | `src/memory/semantic-search.ts` | 搜索逻辑 |
| 配置 Schema | `src/config/schema.ts` | 添加 embedding 配置 |

### Phase 2: 集成 (1 天)

| 任务 | 文件 | 说明 |
|------|------|------|
| 更新 memory_search | `src/memory/tools.ts` | 支持语义搜索 |
| 更新 MemoryStore | `src/memory/store.ts` | 集成向量存储 |
| 索引构建 | `src/memory/indexer.ts` | 自动向量化 |

### Phase 3: 测试和优化 (1 天)

| 任务 | 说明 |
|------|------|
| 单元测试 | Embedder, VectorStore, Searcher |
| 集成测试 | 端到端搜索测试 |
| 性能测试 | 搜索延迟、内存占用 |

## 4. 使用示例

### 4.1 CLI 使用

```bash
# 用户提问
> 上次我们讨论的那个项目进展怎么样了？

# 系统自动搜索 (语义匹配)
[Memory] Semantic search: "项目进展"
  → Found in facts/projects.md (score: 0.87)
  → Found in facts/lessons.md (score: 0.72)

# 返回相关记忆
根据你之前的记录，那个项目的进展是...
```

### 4.2 工具调用

```typescript
// LLM 调用工具
memory_search({
  query: "我老婆最近的工作情况",
  mode: "semantic",
  topK: 3
})

// 返回结果
{
  success: true,
  results: [
    {
      path: "facts/family.md",
      content: "妻子最近在准备换工作，面试了几家公司...",
      score: 0.89
    }
  ]
}
```

## 5. 性能考虑

### 5.1 内存占用

| 组件 | 估算大小 |
|------|---------|
| nomic-embed-text 向量 | 768 × 4 bytes = 3KB/条 |
| 1000 条记忆 | ~3MB |
| 10000 条记忆 | ~30MB |

### 5.2 搜索延迟

| 操作 | 预期延迟 |
|------|---------|
| Embedding 查询 | 50-200ms (Ollama 本地) |
| 向量搜索 (1000条) | <10ms |
| 总延迟 | <300ms |

### 5.3 优化策略

1. **增量索引**: 只索引变更的文件
2. **缓存查询 Embedding**: 相同查询复用
3. **懒加载**: 大量数据时分页加载

## 6. 依赖

```json
// package.json
{
  "dependencies": {
    "ollama-ai-provider": "^0.5.0"  // 或直接 fetch
  },
  "optionalDependencies": {
    "vectordb": "^0.1.0"  // 可选：更高效的向量数据库
  }
}
```

## 7. 风险和缓解

| 风险 | 缓解措施 |
|------|---------|
| Ollama 未安装 | 回退到关键词搜索，提示用户安装 |
| 向量维度不匹配 | 存储 model 信息，检测到变化时重建索引 |
| 内存占用过大 | 持久化到文件，懒加载 |
| 中文效果不好 | 测试 nomic-embed-text 中文效果，备选智谱 |

---

## 待确认问题

1. **Embedding 模型选择**: 确认使用 nomic-embed-text 还是其他中文优化模型？
2. **存储方案**: JSON 文件存储还是 SQLite/LevelDB？
3. **索引时机**: 实时索引还是定时批量索引？
4. **回退策略**: Ollama 不可用时是否需要 API 回退？
