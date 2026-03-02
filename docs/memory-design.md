# 记忆系统设计

> 核心观点：文件系统 + 关键词索引 > 纯 RAG

## 设计哲学

传统的 RAG（向量检索）存在以下问题：
- 语义相似 ≠ 相关
- 丢失文档结构
- 黑盒检索，不可解释
- Embedding 成本

**更好的方案**：让 AI 通过工具直接操作文件系统 + 轻量关键词索引。

```
传统 RAG:
  用户问题 → Embedding → 向量搜索 → 返回片段 → AI 回答

文件系统 + 索引:
  用户问题 → AI 思考 → index/grep/cat → 读取文件 → AI 回答
                    ↓
              AI 可以直接创建/修改文件！
```

## 记忆架构

```
data/memory/
├── SOUL.md                  # AI 性格、价值观、行为准则
├── USER.md                  # 用户画像（精简版）
├── traits.json              # 心理特质 (MBTI, OCEAN)
├── index.json               # 关键词索引
├── compression-log.json     # 压缩日志
│
├── facts/                   # 动态事实（日/周级更新）
│   ├── events.md            # 近期事件、日程
│   ├── investments.md       # 投资持仓（经常变动）
│   ├── lessons.md           # 经验教训
│   └── preferences.md       # 用户偏好
│
├── knowledge/               # 稳定知识（月/年级更新）
│   ├── README.md            # 规范文档
│   ├── career.md            # 职业、FIRE计划
│   ├── family.md            # 家庭成员详情
│   ├── finance.md           # 财务概况
│   └── health.md            # 健康信息
│
├── conversations/           # 对话记录
│   └── 2026-02/            # 按月组织
│       ├── 26.md           # 每天一个文件
│       └── 27.md
│
├── decisions/               # 决策记录
│   └── 2026-02/
│
├── skills/                  # 技能库
│   └── coding/SKILL.md
│
├── goals/                   # 目标系统
│   ├── index.json
│   ├── active/
│   └── completed/
│
├── proactive/               # 主动调度
│   └── schedules.json
│
├── consolidated/            # 压缩后的摘要
│
├── archive/                 # 长期存档
│
└── daemon/                  # 守护进程状态
```

## 核心设计

### 1. 双层存储：facts vs knowledge

| 目录 | 内容类型 | 更新频率 | 示例 |
|------|----------|----------|------|
| `facts/` | 动态数据 | 日/周级 | 近期事件、投资持仓、经验教训 |
| `knowledge/` | 稳定信息 | 月/年级 | 家庭、职业、财务概况、健康 |

**判断标准**：
- 这个信息多久变一次？ → 日/周 → `facts/`，月/年 → `knowledge/`
- 如果丢失，多久能重新收集？ → 难收集 → `knowledge/`，易收集 → `facts/`

### 2. 关键词索引系统

```json
// data/memory/index.json
{
  "facts": {
    "keywords": {
      "裁员": ["facts/events.md", "facts/lessons.md"],
      "绩效": ["facts/events.md"],
      "投资": ["facts/investments.md"]
    },
    "lastUpdated": "2026-02-28T06:50:53Z"
  },
  "knowledge": {
    "keywords": {
      "字节": ["knowledge/career.md"],
      "期权": ["knowledge/career.md", "knowledge/finance.md"],
      "媳妇": ["knowledge/family.md"]
    },
    "lastUpdated": "2026-02-28T06:50:53Z"
  },
  "lastFullIndex": "2026-02-28T06:50:53Z"
}
```

**索引特点**：
- 自动提取中文关键词（人名、公司、地点、专业术语）
- 支持增量更新
- 搜索速度快，无需 Embedding

### 3. AI 可操作的工具

```typescript
const memoryTools = {
  // 浏览记忆
  'memory_ls': { params: { path: 'string' } },
  'memory_grep': { params: { query: 'string', path?: 'string' } },
  'memory_read': { params: { file: 'string' } },

  // 写入记忆
  'memory_write': { params: { file: 'string', content: 'string', mode?: 'append|overwrite' } },
  'memory_record': { params: { category: 'string', fact: 'string' } },

  // 索引搜索（NEW）
  'memory_search': { params: { query: 'string', scope?: 'facts|knowledge|all' } },
  'memory_index': { params: {} },  // 重建索引

  // 知识拓展（NEW）
  'memory_knowledge_create': {
    params: {
      category: 'string',  // 如 'travel', 'hobbies'
      content?: 'string'   // 可选，不提供则用模板
    }
  },

  // 记忆管理
  'memory_compress': { params: { dryRun?: 'boolean', force?: 'boolean' } },
  'memory_score': { params: { content: 'string', timestamp: 'string' } },
  'memory_dedupe': { params: { threshold?: 'number' } },
};
```

### 4. 记忆压缩系统

**分层策略：**

| 层级 | 保留期限 | 存储方式 | 触发条件 |
|------|---------|---------|---------|
| Recent | 7天 | 完整对话 | 默认 |
| Consolidated | 90天 | AI 摘要 | 7天后 |
| Archived | 永久 | 压缩文件 | 90天后 |

**自动压缩**：
- Bot 启动时自动创建每日 3AM 压缩任务
- 手动触发：`/memory compress`

### 5. 知识自动拓展

当用户提到新的知识领域时，AI 可以自动创建 knowledge 文件：

```typescript
// 检测到新主题 "旅行偏好"
executeMemoryTool('memory_knowledge_create', {
  category: 'travel'  // 使用预置模板
});

// 或带自定义内容
executeMemoryTool('memory_knowledge_create', {
  category: 'hobbies',
  content: '# 兴趣爱好\n\n## 主要爱好\n- 撸猫\n...'
});
```

**预置模板**：`health`, `travel`, `hobbies`, `education`

### 6. 工作流示例

**场景：用户问"我的投资组合怎么样？"**

```
AI 思考过程：
1. 投资是动态数据 → 在 facts/ 中
2. 先用索引搜索：memory_search("投资")
3. 找到：facts/investments.md
4. 读取文件：memory_read("facts/investments.md")
5. 分析并回复
```

**场景：用户提到想去云南旅游**

```
AI 思考过程：
1. 这是新的知识领域 → 创建 knowledge 文件
2. 检查是否存在 travel.md → 不存在
3. memory_knowledge_create({ category: 'travel' })
4. 询问更多偏好，填充内容
5. 重建索引：memory_index()
```

**场景：记录经验教训**

```
AI 思考过程：
1. 这是动态事实 → 写入 facts/
2. memory_record({ category: 'lessons', fact: '...' })
3. 自动追加到 facts/lessons.md
```

## CLI 命令

```bash
# 记忆管理
/memory ls [path]           # 列出目录
/memory grep <query>        # 全文搜索
/memory search <query>      # 索引搜索（更快）
/memory read <file>         # 读取文件
/memory record <cat> <fact> # 记录事实
/memory index               # 重建索引
/memory compress [--dry-run] # 压缩旧记忆
/memory stats               # 压缩统计
```

## knowledge/ 规范

详见 `knowledge/README.md`：

- 使用小写英文命名
- 一个主题一个文件
- 文件底部添加元数据：`*knowledge/{filename}.md - YYYY-MM-DD*`

## 与 RAG 的对比

| 操作 | 文件系统 + 索引 | RAG |
|------|---------------|-----|
| 查找"用户偏好" | `memory_search("偏好")` | 向量搜索 |
| 搜索所有提到"投资"的地方 | `memory_search("投资")` | 向量搜索 |
| 添加新事实 | `memory_record()` | 插入向量库 |
| 更新用户信息 | 直接编辑文件 | 重新 embed |
| 创建新知识领域 | `memory_knowledge_create()` | N/A |
| 压缩旧记忆 | 自动摘要 + 存档 | N/A |

## 实现状态

### Phase 1: 基础文件系统 ✅
- [x] 创建目录结构
- [x] 实现 memory_ls/grep/read/write/record 工具

### Phase 2: 智能记忆 ✅
- [x] 记忆压缩系统
- [x] 重要性评分系统
- [x] 去重检测

### Phase 3: 扩展系统 ✅
- [x] 目标系统
- [x] 主动调度
- [x] AIEOS 人格协议
- [x] 飞书集成

### Phase 4: 轻量索引 ✅
- [x] 关键词索引实现
- [x] memory_search 工具
- [x] memory_knowledge_create 工具
- [x] 自动拓展 knowledge

## 配置

```json
{
  "memory": {
    "type": "filesystem",
    "path": "./data/memory",
    "tools": {
      "enabled": [
        "memory_ls", "memory_grep", "memory_read", "memory_write",
        "memory_record", "memory_search", "memory_index",
        "memory_knowledge_create", "memory_compress", "memory_score", "memory_dedupe"
      ],
      "autoRecord": true
    },
    "retention": {
      "conversations": "90d",
      "facts": "forever",
      "knowledge": "forever"
    },
    "compression": {
      "autoCompress": true,
      "compressAfterDays": 7,
      "runSchedule": "0 3 * * *"
    }
  }
}
```

## 总结

**核心优势**：
1. AI 主动操作，而非被动检索
2. facts/knowledge 分层，结构清晰
3. 关键词索引，零 Embedding 成本
4. 支持增量更新和自动拓展
5. 自动压缩和归档

**RAG 的角色**：
- 作为补充，而非主力
- 处理海量非结构化数据时使用
- 对于 AI 助手的记忆，文件系统足够
