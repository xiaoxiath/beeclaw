# 自动知识提取 - 设计文档

> **状态**: 设计中
> **优先级**: P0 (高)
> **最后更新**: 2026-03-02

## 1. 问题分析

### 当前状况

Beeclaw 需要用户主动调用 `memory_record` 工具来存储信息：

```
用户: 记住我老婆最近换了工作
AI: 好的，我来记录这个信息。[调用 memory_record]
```

### 问题

1. **用户负担重**
   - 用户必须明确要求"记住这个"
   - 容易忘记让 AI 记录重要信息

2. **信息丢失**
   - 对话中的重要细节没有被记录
   - 后续对话无法引用之前的信息

3. **被动而非主动**
   - AI 不会主动判断什么值得记录
   - 缺乏智能的信息管理

## 2. 解决方案

### 2.1 核心理念

```
对话 → 自动分析 → 提取知识 → 结构化存储
         ↓
    用户无感知，AI 主动学习
```

### 2.2 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                 Automatic Knowledge Extraction               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐                                           │
│  │  Conversation │                                          │
│  │  (Messages)   │                                          │
│  └──────┬───────┘                                           │
│         │                                                     │
│         ▼                                                     │
│  ┌──────────────┐     ┌──────────────┐                      │
│  │   Trigger     │────▶│   Extractor   │                      │
│  │   Detector    │     │   (LLM)       │                      │
│  └──────────────┘     └──────┬───────┘                      │
│                              │                                │
│         ┌────────────────────┼────────────────────┐         │
│         ▼                    ▼                    ▼         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │    Facts      │   │  Preferences │   │   Events     │    │
│  │   Store       │   │   Store      │   │   Store      │    │
│  └──────────────┘   └──────────────┘   └──────────────┘    │
│         │                    │                    │         │
│         └────────────────────┴────────────────────┘         │
│                              │                                │
│                              ▼                                │
│                       ┌──────────────┐                      │
│                       │   Deduper     │                      │
│                       │   (去重合并)   │                      │
│                       └──────────────┘                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 触发时机

| 时机 | 触发条件 | 提取类型 |
|------|---------|---------|
| **对话结束** | 用户发送 `结束`/`bye` 或 5 分钟无响应 | 全量提取 |
| **关键短语** | "记住"、"别忘了"、"记一下" | 立即提取 |
| **周期性** | 每 10 轮对话 | 增量提取 |
| **显式请求** | 用户明确要求记录 | 立即提取 |

### 2.4 知识分类

```typescript
// 提取的知识类型
type KnowledgeCategory =
  | 'personal'      // 个人信息: 名字、生日、地址
  | 'family'        // 家庭: 家人信息
  | 'work'          // 工作: 公司、职位、项目
  | 'finance'       // 财务: 收入、资产、投资
  | 'health'        // 健康: 疾病、用药、运动
  | 'preferences'   // 偏好: 食物、娱乐、习惯
  | 'events'        // 事件: 日程、计划、历史
  | 'lessons'       // 教训: 错误、经验
  | 'goals'         // 目标: 短期、长期计划
  | 'relationships' // 关系: 朋友、同事
  | 'skills'        // 技能: 已掌握、想学习
  | 'decisions';    // 决策: 做过的选择

// 提取结果
interface ExtractedKnowledge {
  category: KnowledgeCategory;
  key: string;          // 唯一标识: "wife.company"
  value: string;        // 值: "字节跳动"
  confidence: number;   // 置信度: 0-1
  source: string;       // 来源对话 ID
  timestamp: Date;
  context?: string;     // 原始上下文
}
```

## 3. 核心模块

### 3.1 ExtractionPrompt (提取提示词)

```typescript
// src/extraction/prompt.ts

export const EXTRACTION_PROMPT = `你是一个知识提取专家。分析以下对话，提取应该长期记住的信息。

## 提取规则

1. **值得记录的信息**:
   - 用户的个人信息（年龄、职业、住址等）
   - 家庭成员信息（名字、工作、喜好等）
   - 重要的偏好和习惯
   - 财务相关信息（收入、投资、资产）
   - 重要的日程和计划
   - 做过的重要决策
   - 经验教训

2. **不应该记录**:
   - 临时性的聊天内容
   - 明显的假设或猜测
   - 一次性查询结果（如天气）
   - 敏感密码或密钥

3. **输出格式** (JSON):
{
  "extractions": [
    {
      "category": "family",
      "key": "wife.company",
      "value": "字节跳动",
      "confidence": 0.95,
      "reason": "用户明确提到妻子的公司"
    }
  ]
}

## 对话内容

{conversation}

## 提取结果 (仅输出 JSON)`;
```

### 3.2 KnowledgeExtractor (知识提取器)

```typescript
// src/extraction/extractor.ts

export interface ExtractionConfig {
  enabled: boolean;
  model: string;           // 使用便宜的模型
  triggerPhrases: string[]; // 触发短语
  minMessages: number;      // 最少消息数才触发
  confidenceThreshold: number; // 置信度阈值
  maxExtractionsPerRun: number; // 每次最多提取条数
}

export class KnowledgeExtractor {
  private config: ExtractionConfig;
  private llmProvider: AIProvider;

  constructor(config: ExtractionConfig, provider: AIProvider);

  // 检查是否应该触发提取
  shouldTrigger(context: ExtractionContext): boolean;

  // 执行提取
  async extract(messages: ChatMessage[]): Promise<ExtractedKnowledge[]>;

  // 增量提取 (只处理新消息)
  async extractIncremental(
    newMessages: ChatMessage[],
    lastExtractedId: string
  ): Promise<ExtractedKnowledge[]>;
}
```

### 3.3 KnowledgeDeduper (去重合并)

```typescript
// src/extraction/deduper.ts

export class KnowledgeDeduper {
  // 检查是否重复
  isDuplicate(
    newKnowledge: ExtractedKnowledge,
    existing: ExtractedKnowledge[]
  ): boolean;

  // 合并更新
  merge(
    newKnowledge: ExtractedKnowledge,
    existing: ExtractedKnowledge
  ): ExtractedKnowledge;

  // 批量去重
  deduplicate(
    newKnowledge: ExtractedKnowledge[],
    existing: ExtractedKnowledge[]
  ): {
    toAdd: ExtractedKnowledge[];
    toUpdate: ExtractedKnowledge[];
    duplicates: ExtractedKnowledge[];
  };
}
```

### 3.4 KnowledgeStore (知识存储)

```typescript
// src/extraction/store.ts

export class KnowledgeStore {
  private basePath: string;

  // 存储知识
  async store(knowledge: ExtractedKnowledge): Promise<void>;

  // 批量存储
  async storeBatch(knowledge: ExtractedKnowledge[]): Promise<void>;

  // 按类别获取
  async getByCategory(category: KnowledgeCategory): Promise<ExtractedKnowledge[]>;

  // 按关键词搜索
  async search(query: string): Promise<ExtractedKnowledge[]>;

  // 获取最近更新
  async getRecent(limit?: number): Promise<ExtractedKnowledge[]>;
}
```

### 3.5 ExtractionTrigger (提取触发器)

```typescript
// src/extraction/trigger.ts

export class ExtractionTrigger {
  // 检测触发短语
  detectTriggerPhrase(message: string): boolean;

  // 检测对话结束
  detectConversationEnd(messages: ChatMessage[]): boolean;

  // 检查周期性触发
  shouldPeriodicTrigger(messageCount: number): boolean;

  // 综合判断
  shouldTrigger(
    messages: ChatMessage[],
    context: TriggerContext
  ): {
    trigger: boolean;
    reason: 'phrase' | 'end' | 'periodic' | 'explicit' | 'none';
    urgency: 'immediate' | 'background';
  };
}
```

## 4. 工作流程

### 4.1 完整流程

```
1. 用户发送消息
      │
      ▼
2. 触发检测
   ├─ 关键短语? → 立即提取
   ├─ 对话结束? → 全量提取
   ├─ 每10轮? → 增量提取
   └─ 无触发 → 继续对话
      │
      ▼
3. 知识提取 (LLM)
   ├─ 分析对话内容
   ├─ 识别有价值信息
   └─ 结构化输出
      │
      ▼
4. 去重合并
   ├─ 检查是否已存在
   ├─ 合并更新
   └─ 标记置信度
      │
      ▼
5. 持久化存储
   ├─ 更新 facts/*.md
   ├─ 更新索引
   └─ 记录来源
      │
      ▼
6. (可选) 通知用户
   "我记下了：你老婆最近换了工作"
```

### 4.2 后台任务流程

```typescript
// 对话结束后，后台异步执行
async function backgroundExtraction(session: Session) {
  // 1. 获取对话历史
  const messages = session.getMessages();

  // 2. 提取知识
  const extractor = new KnowledgeExtractor(config);
  const extractions = await extractor.extract(messages);

  // 3. 去重
  const deduper = new KnowledgeDeduper();
  const { toAdd, toUpdate } = deduper.deduplicate(
    extractions,
    await knowledgeStore.getAll()
  );

  // 4. 存储
  await knowledgeStore.storeBatch([...toAdd, ...toUpdate]);

  // 5. 更新索引
  await indexer.rebuild();

  // 6. 日志
  console.log(`[Extraction] Added ${toAdd.length}, Updated ${toUpdate.length}`);
}
```

## 5. 配置选项

```json
// beeclaw.json
{
  "extraction": {
    "enabled": true,
    "model": "glm-4-flash",
    "triggers": {
      "phrases": ["记住", "别忘了", "记一下", "记住这个", "保存"],
      "conversationEnd": true,
      "periodic": {
        "enabled": true,
        "interval": 10  // 每10轮对话
      }
    },
    "limits": {
      "minMessages": 3,
      "maxExtractionsPerRun": 20,
      "confidenceThreshold": 0.7
    },
    "categories": {
      "enabled": ["personal", "family", "work", "finance", "preferences", "events", "lessons", "goals"],
      "disabled": []
    },
    "storage": {
      "notifyUser": true,     // 是否通知用户
      "includeContext": true  // 是否保存原始上下文
    }
  }
}
```

## 6. 使用示例

### 6.1 自动提取场景

```
用户: 我老婆最近在准备换工作，已经面试了字节和阿里

AI: 听起来是个好机会！字节和阿里的什么岗位呢？

用户: 字节是前端，阿里是全栈，她更倾向于字节

AI: 了解。字节的前端岗位确实机会更多。

[后台自动提取]
{
  "extractions": [
    {
      "category": "family",
      "key": "wife.job_search",
      "value": "正在换工作，面试了字节前端和阿里全栈，倾向于字节",
      "confidence": 0.95
    },
    {
      "category": "family",
      "key": "wife.current_company",
      "value": null,  // 未提及当前公司
      "confidence": 0
    }
  ]
}

[系统通知]
💡 我记下了：你老婆正在换工作，倾向于字节的前端岗位
```

### 6.2 手动触发

```
用户: 把刚才讨论的投资策略记下来

AI: 好的，我来记录。

[立即提取]
{
  "extractions": [
    {
      "category": "finance",
      "key": "investment_strategy",
      "value": "分散投资：40%指数基金，30%债券，30%个股",
      "confidence": 1.0
    }
  ]
}

✅ 已记录到 facts/finance.md
```

### 6.3 去重合并

```
[之前记录]
wife.company = "字节跳动"

[新提取]
wife.company = "字节"

[合并结果]
wife.company = "字节跳动"  // 保持更完整的版本
wife.company_updated = "2026-03-02"
```

## 7. 与现有系统集成

### 7.1 与 memory 工具集成

```typescript
// memory_record 工具调用时，也走提取流程
async function memoryRecord(params: { content: string, category: string }) {
  // 1. 直接存储用户指定的内容
  await memoryStore.append(params.category, params.content);

  // 2. 同时触发自动提取，看是否有额外信息
  const extractions = await extractor.extractFromText(params.content);
  await knowledgeStore.storeBatch(extractions);
}
```

### 7.2 与 Session 集成

```typescript
// src/session/index.ts

export async function continueConversation(sessionId: string, message: string) {
  // ... 对话逻辑 ...

  // 对话结束后，后台提取
  if (extractionTrigger.shouldTrigger(session.messages)) {
    // 不阻塞响应，后台执行
    queueMicrotask(() => {
      backgroundExtraction(session).catch(console.error);
    });
  }
}
```

### 7.3 与 memory_search 集成

```typescript
// 搜索时同时查自动提取的知识
async function memorySearch(query: string) {
  // 1. 搜索 facts/*.md 文件
  const fileResults = await grepFiles(query);

  // 2. 搜索自动提取的知识库
  const knowledgeResults = await knowledgeStore.search(query);

  // 3. 合并结果
  return mergeResults(fileResults, knowledgeResults);
}
```

## 8. 性能考虑

### 8.1 成本控制

| 操作 | Token 消耗 | 频率 | 日成本估算 |
|------|-----------|------|-----------|
| 提取 (10轮对话) | ~2000 tokens | 10次/天 | ¥0.02 |
| 提取 (对话结束) | ~3000 tokens | 5次/天 | ¥0.03 |
| **总计** | | | **~¥0.05/天** |

### 8.2 延迟优化

- 提取在后台执行，不阻塞对话响应
- 使用便宜的快模型 (glm-4-flash)
- 增量提取而非全量

## 9. 实现计划

### Phase 1: 核心模块 (2 天)

| 任务 | 文件 | 说明 |
|------|------|------|
| 提取提示词 | `src/extraction/prompt.ts` | 优化提取效果 |
| KnowledgeExtractor | `src/extraction/extractor.ts` | LLM 提取 |
| KnowledgeDeduper | `src/extraction/deduper.ts` | 去重合并 |
| ExtractionTrigger | `src/extraction/trigger.ts` | 触发检测 |

### Phase 2: 存储和集成 (1 天)

| 任务 | 文件 | 说明 |
|------|------|------|
| KnowledgeStore | `src/extraction/store.ts` | 知识存储 |
| Session 集成 | `src/session/index.ts` | 后台触发 |
| 配置支持 | `src/config/schema.ts` | 添加配置 |

### Phase 3: 测试和优化 (1 天)

| 任务 | 说明 |
|------|------|
| 提取准确率测试 | 测试不同类型信息的提取效果 |
| 去重测试 | 测试合并逻辑 |
| 性能测试 | 延迟、成本 |

## 10. 风险和缓解

| 风险 | 缓解措施 |
|------|---------|
| 提取错误信息 | 置信度阈值 + 用户确认 |
| 隐私问题 | 本地存储 + 用户可控 |
| 过度提取 | 分类限制 + 重要性判断 |
| 成本过高 | 后台批量 + 便宜模型 |

---

## 待确认问题

1. **通知策略**: 提取后是否总是通知用户？还是只在高置信度时静默存储？
2. **用户确认**: 低置信度提取是否需要用户确认？
3. **冲突处理**: 新旧信息冲突时如何处理？（保留最新？保留最详细？询问用户？）
4. **敏感信息**: 如何识别和过滤敏感信息（密码、密钥等）？
5. **提取模型**: 使用 glm-4-flash 还是其他更便宜的模型？
