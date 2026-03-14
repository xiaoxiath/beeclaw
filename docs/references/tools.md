# 内置工具参考

Beeclaw 提供一系列内置工具，支持网络搜索、文件操作、Shell 执行等功能。

## 工具列表

### 网络与研究
| 工具 | 说明 |
|------|------|
| `web_search` | 多引擎网页搜索 |
| `web_fetch` | 获取网页内容 |
| `deep_research` | 深度多角度研究 |

### 文件与系统
| 工具 | 说明 |
|------|------|
| `file_read` | 读取本地文件 |
| `file_write` | 写入文件内容 |
| `file_list` | 列出目录文件 |
| `file_delete` | 删除文件 |
| `shell` | 安全执行 Shell 命令 |

### 记忆系统
| 工具 | 说明 |
|------|------|
| `memory_ls` | 列出记忆目录 |
| `memory_grep` | 全文搜索记忆 |
| `memory_search` | 索引搜索记忆（更快） |
| `memory_read` | 读取记忆文件 |
| `memory_write` | 写入记忆文件 |
| `memory_record` | 记录事实到指定分类 |
| `memory_index` | 重建关键词索引 |
| `memory_knowledge_create` | 创建知识文件 |
| `memory_compress` | 压缩旧记忆 |
| `memory_score` | 评估记忆重要性 |
| `memory_dedupe` | 去重检测 |

### 目标系统
| 工具 | 说明 |
|------|------|
| `goal_create` | 创建新目标 |
| `goal_list` | 列出所有目标 |
| `goal_get` | 获取目标详情 |
| `goal_update` | 更新目标状态 |
| `goal_delete` | 删除目标 |
| `goal_add_progress` | 添加进度记录 |

### 技能系统
| 工具 | 说明 |
|------|------|
| `skill_list` | 列出所有技能 |
| `skill_get` | 获取技能详情 |
| `skill_create` | 创建新技能 |
| `skill_update` | 更新技能内容 |
| `skill_delete` | 删除技能 |
| `skill_execute` | 执行技能 |

### 其他工具
| 工具 | 说明 |
|------|------|
| `time_now` | 获取当前时间 |
| `calc` | 数学计算 |
| `code_execute` | 执行 JavaScript |
| `weather` | 获取天气信息 |
| `url_shorten` | 短链接生成 |
| `qrcode` | 二维码生成 |
| `claude_code` | Claude Code SDK |

---

## 网络工具

### web_search

多引擎网页搜索，支持中英文查询和区域自动检测。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| query | string | ✅ | 搜索查询 |
| num_results | number | - | 结果数量 (1-20, 默认 10) |
| region | string | - | 区域: global, cn, us, auto |
| time_range | string | - | 时间范围: day, week, month, year |

**示例**:
```json
{
  "query": "人工智能 最新进展",
  "num_results": 10,
  "region": "cn",
  "time_range": "week"
}
```

### web_fetch

获取网页内容并转换为可读格式。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| url | string | ✅ | 网页 URL |
| format | string | - | 输出格式: text, markdown, json |
| max_length | number | - | 最大长度 (默认 10000) |

**示例**:
```json
{
  "url": "https://example.com/article",
  "format": "markdown",
  "max_length": 5000
}
```

---

## 深度研究工具

### deep_research

系统化的多角度深度研究工具。自动生成多样化搜索查询，获取关键来源，综合生成研究报告。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| topic | string | ✅ | 研究主题 |
| aspects | string[] | - | 研究角度 (可选，自动生成) |
| depth | string | - | 深度: quick, standard, comprehensive |
| time_range | string | - | 时间范围: day, week, month, year |

**深度级别**:

| 级别 | 搜索次数 | 来源抓取 | 适用场景 |
|------|---------|---------|---------|
| quick | 3 | 2 个 | 快速了解 |
| standard | 5 | 4 个 | 常规研究 |
| comprehensive | 8+ | 6 个 | 深度分析 |

**示例**:
```json
{
  "topic": "AI在医疗领域的应用",
  "aspects": ["诊断", "治疗", "监管", "伦理"],
  "depth": "standard"
}
```

**输出格式**:
```markdown
# "[主题]" 深度研究报告

*研究深度: standard | 搜索次数: 5 | 来源数: 15*

## 执行摘要
[关键发现概述]

## 关键发现

### [角度1]
- 发现1
- 发现2

### [角度2]
- 发现1

## 来源
1. [来源标题](来源URL)
2. [来源标题](来源URL)

## 研究方法
- 搜索查询: ...
- 深度内容抓取: N 个来源
```

---

## 文件工具

### file_read

读取本地文件内容。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| path | string | ✅ | 文件路径 |
| encoding | string | - | 编码: utf-8, base64, json |
| max_length | number | - | 最大长度 (默认 50000) |

**安全限制**: 仅允许访问项目目录及 `data/`, `output/`, `reports/`, `temp/` 目录。

**示例**:
```json
{
  "path": "reports/analysis.md",
  "encoding": "utf-8"
}
```

### file_write

写入文件内容，支持创建和追加模式。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| path | string | ✅ | 文件路径 |
| content | string | ✅ | 文件内容 |
| mode | string | - | 模式: write, append |
| create_dirs | boolean | - | 自动创建目录 (默认 true) |

**安全限制**: 写入位置会被重定向到 `output/` 目录（如果不在允许目录内）。

**示例**:
```json
{
  "path": "reports/analysis.html",
  "content": "<html>...</html>",
  "mode": "write"
}
```

### file_list

列出目录中的文件。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| path | string | - | 目录路径 (默认: 当前目录) |
| recursive | boolean | - | 递归列出 (默认 false) |
| pattern | string | - | 文件模式 (如 "*.md") |

**示例**:
```json
{
  "path": "reports",
  "pattern": "*.html"
}
```

**输出**:
```
Files in reports:

📄 report1.html (1.5KB)
📄 report2.html (2.3KB)
```

### file_delete

删除文件（仅限安全目录）。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| path | string | ✅ | 文件路径 |

**安全限制**: 仅允许删除 `output/`, `reports/`, `temp/` 目录中的文件。

---

## Shell 工具

### shell

安全执行 Shell 命令。采用多层安全防护机制。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| command | string | ✅ | Shell 命令 |
| timeout | number | - | 超时 (默认 10000ms, 最大 30000ms) |
| cwd | string | - | 工作目录 |

**安全机制**:

```
┌─────────────────────────────────────────────────────┐
│  1. 黑名单检查                                       │
│     阻止: sudo, rm -rf /, mkfs, ssh, nc             │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│  2. 白名单匹配                                       │
│     仅允许: ls, cat, git, npm, bun, curl 等         │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│  3. 执行保护                                         │
│     - 超时控制                                       │
│     - 环境变量清理 (移除 API Keys)                  │
│     - 输出截断 (最大 5000 字符)                     │
└─────────────────────────────────────────────────────┘
```

**允许的命令类型**:

| 类别 | 命令示例 |
|------|----------|
| 文件操作 | `ls`, `cat`, `head`, `tail`, `grep`, `find`, `mkdir`, `touch` |
| Git | `git status`, `git log`, `git diff`, `git branch` |
| 开发工具 | `node`, `bun`, `npx`, `tsc`, `eslint`, `prettier` |
| 网络 | `curl`, `wget`, `ping` |
| 系统信息 | `ps`, `df`, `du`, `date`, `pwd`, `whoami`, `uname` |

**示例**:
```json
{
  "command": "git log --oneline -5",
  "timeout": 5000
}
```

---

## 记忆工具

记忆系统基于文件系统 + 关键词索引，提供零 Embedding 成本的记忆管理。

### memory_ls

列出记忆目录结构。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| path | string | - | 记忆路径（默认: 根目录） |

**示例**:
```json
{
  "path": "facts"
}
```

**输出**:
```
facts/
├── events.md (2.3KB)
├── investments.md (1.8KB)
├── lessons.md (3.1KB)
└── preferences.md (1.2KB)
```

---

### memory_search

通过关键词索引搜索记忆（推荐）。

**参数**:

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| query | string | ✅ | - | 搜索关键词 |
| scope | string | - | "all" | 搜索范围: facts, knowledge, all |

**返回值**:
```typescript
{
  success: boolean;
  results: Array<{
    file: string;      // 文件路径
    matches: string[]; // 匹配的关键词
    score: number;     // 相关性分数
  }>;
}
```

**示例**:
```json
{
  "query": "投资",
  "scope": "all"
}
```

**输出**:
```
找到 3 个匹配:

📄 facts/investments.md (分数: 0.95)
   匹配关键词: 投资, 股票, 基金

📄 knowledge/finance.md (分数: 0.82)
   匹配关键词: 投资, 财务

📄 facts/events.md (分数: 0.71)
   匹配关键词: 投资
```

**错误处理**:
- `INDEX_NOT_FOUND`: 索引不存在，需先运行 `memory_index`
- `INVALID_SCOPE`: scope 参数无效

**相关工具**: memory_index, memory_grep

---

### memory_grep

全文搜索记忆（适合精确匹配）。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| query | string | ✅ | 搜索字符串 |
| path | string | - | 搜索路径（默认: 全部） |

**示例**:
```json
{
  "query": "裁员补偿",
  "path": "facts/events.md"
}
```

---

### memory_read

读取记忆文件内容。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| file | string | ✅ | 文件路径（相对于记忆根目录） |

**示例**:
```json
{
  "file": "facts/preferences.md"
}
```

---

### memory_write

写入记忆文件内容。

**参数**:

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| file | string | ✅ | - | 文件路径 |
| content | string | ✅ | - | 文件内容 |
| mode | string | - | "overwrite" | 写入模式: overwrite, append |

**示例**:
```json
{
  "file": "facts/events.md",
  "content": "## 2026-03-14\n\n- 参加团队会议\n- 完成文档优化",
  "mode": "append"
}
```

---

### memory_record

快速记录事实到指定分类。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| category | string | ✅ | 分类: events, lessons, preferences |
| fact | string | ✅ | 事实内容 |

**示例**:
```json
{
  "category": "preferences",
  "fact": "我喜欢简洁的代码风格，不喜欢过度工程化"
}
```

**行为**:
- 自动追加到 `facts/{category}.md`
- 自动添加时间戳
- 自动更新关键词索引

---

### memory_index

重建关键词索引。

**参数**: 无

**示例**:
```json
{}
```

**输出**:
```
✓ 索引重建完成
  - 扫描文件: 23
  - 提取关键词: 156
  - 耗时: 1.2s
```

---

### memory_knowledge_create

创建新的知识文件（使用模板）。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| category | string | ✅ | 知识分类（如: travel, hobbies） |
| content | string | - | 自定义内容（不提供则用模板） |

**预置模板**: `health`, `travel`, `hobbies`, `education`

**示例**:
```json
{
  "category": "travel"
}
```

**输出**:
```
✓ 创建知识文件: knowledge/travel.md

# 旅行偏好

## 常去地点
[待补充]

## 旅行风格
[待补充]

## 酒店偏好
[待补充]
```

---

### memory_compress

压缩旧记忆以节省空间。

**参数**:

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| dryRun | boolean | - | false | 试运行（不实际压缩） |
| force | boolean | - | false | 强制压缩（忽略时间限制） |

**示例**:
```json
{
  "dryRun": true
}
```

**输出**:
```
压缩预览（试运行模式）:

可压缩文件: 15
预计节省空间: 45KB
最早记录: 2025-12-01
最晚记录: 2026-01-15

压缩策略: 7天前的对话将被摘要
```

---

### memory_score

评估记忆内容的重要性。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| content | string | ✅ | 记忆内容 |
| timestamp | string | ✅ | 时间戳（ISO 8601） |

**示例**:
```json
{
  "content": "用户获得了晋升，职级从 P6 升到 P7",
  "timestamp": "2026-03-14T10:30:00Z"
}
```

**输出**:
```json
{
  "score": 0.92,
  "factors": {
    "recency": 1.0,
    "uniqueness": 0.9,
    "relevance": 0.85
  },
  "recommendation": "高重要性，建议长期保存"
}
```

---

### memory_dedupe

检测重复记忆。

**参数**:

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| threshold | number | - | 0.85 | 相似度阈值（0-1） |

**示例**:
```json
{
  "threshold": 0.85
}
```

**输出**:
```
检测到 3 组重复记忆:

组 1 (相似度: 0.92):
  - facts/preferences.md:15: 我喜欢简洁的代码
  - facts/preferences.md:23: 我偏爱简洁的代码风格

组 2 (相似度: 0.88):
  - facts/lessons.md:7: 定期备份很重要
  - facts/events.md:34: 完成了数据备份

建议: 合并重复项以减少冗余
```

---

## 目标工具

目标系统用于跟踪长期目标和进度。

### goal_create

创建新目标。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| title | string | ✅ | 目标标题 |
| description | string | - | 详细描述 |
| deadline | string | - | 截止日期（ISO 8601） |
| priority | string | - | 优先级: high, medium, low |

**示例**:
```json
{
  "title": "学习 Rust 编程语言",
  "description": "完成 Rust 官方教程，并能编写简单项目",
  "deadline": "2026-06-30",
  "priority": "medium"
}
```

**输出**:
```
✓ 目标创建成功
ID: goal_20260314_001
标题: 学习 Rust 编程语言
优先级: medium
状态: active
```

---

### goal_list

列出所有目标。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| status | string | - | 过滤状态: active, completed, failed |
| priority | string | - | 过滤优先级 |

**示例**:
```json
{
  "status": "active"
}
```

**输出**:
```
活跃目标 (3):

1. [高优先级] 完成文档优化
   ID: goal_20260310_003
   进度: 60% (3/5 任务)
   截止: 2026-03-20

2. [中优先级] 学习 Rust 编程语言
   ID: goal_20260314_001
   进度: 0%
   截止: 2026-06-30

3. [低优先级] 阅读 10 本书籍
   ID: goal_20260301_002
   进度: 40% (4/10)
   截止: 2026-12-31
```

---

### goal_get

获取目标详情。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| goalId | string | ✅ | 目标 ID |

**示例**:
```json
{
  "goalId": "goal_20260314_001"
}
```

---

### goal_update

更新目标状态。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| goalId | string | ✅ | 目标 ID |
| status | string | - | 新状态: active, completed, failed, paused |
| progress | number | - | 进度百分比（0-100） |

**示例**:
```json
{
  "goalId": "goal_20260314_001",
  "status": "active",
  "progress": 30
}
```

---

### goal_add_progress

添加进度记录。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| goalId | string | ✅ | 目标 ID |
| note | string | ✅ | 进度说明 |
| progressDelta | number | - | 进度增量（-100 到 100） |

**示例**:
```json
{
  "goalId": "goal_20260314_001",
  "note": "完成了 Rust所有权章节的学习",
  "progressDelta": 15
}
```

---

### goal_delete

删除目标。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| goalId | string | ✅ | 目标 ID |

**示例**:
```json
{
  "goalId": "goal_20260301_002"
}
```

---

## 技能工具

技能系统用于管理和执行可复用的提示词模块。

### skill_list

列出所有技能。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| category | string | - | 过滤分类 |
| maturity | string | - | 过滤成熟度: seed, growing, mature, deprecated |

**示例**:
```json
{
  "maturity": "mature"
}
```

**输出**:
```
成熟技能 (5):

📁 coding/
  └─ code-review (代码审查)
  └─ refactoring (重构建议)

📁 research/
  └─ deep-dive (深度研究)
  └─ summarize (内容总结)

📁 productivity/
  └─ weekly-report (周报生成)
```

---

### skill_get

获取技能详情。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| skillId | string | ✅ | 技能 ID（格式: category/name） |

**示例**:
```json
{
  "skillId": "coding/code-review"
}
```

**输出**:
```yaml
---
name: Code Review
description: 专业的代码审查建议
maturity: mature
version: 1.2.0
created: 2026-02-15
updated: 2026-03-10
tags: [coding, review, quality]
---

# Code Review 技能

作为资深代码审查专家，请对以下代码进行全面审查：

## 审查维度
1. **代码质量**: 可读性、可维护性
2. **性能**: 时间/空间复杂度
3. **安全**: 潜在漏洞
4. **最佳实践**: 是否符合规范

## 输出格式
...
```

---

### skill_create

创建新技能。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| category | string | ✅ | 分类名称 |
| name | string | ✅ | 技能名称 |
| description | string | ✅ | 功能描述 |
| content | string | ✅ | 技能内容（Markdown） |
| tags | string[] | - | 标签列表 |

**示例**:
```json
{
  "category": "productivity",
  "name": "meeting-summary",
  "description": "会议纪要自动生成",
  "content": "# 会议纪要生成\n\n根据会议记录生成结构化纪要...",
  "tags": ["meeting", "summary", "productivity"]
}
```

**输出**:
```
✓ 技能创建成功
ID: productivity/meeting-summary
路径: skills/productivity/MEETING-SUMMARY.md
成熟度: seed
```

---

### skill_update

更新技能内容。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| skillId | string | ✅ | 技能 ID |
| content | string | - | 新内容 |
| maturity | string | - | 更新成熟度 |
| description | string | - | 更新描述 |

**示例**:
```json
{
  "skillId": "productivity/meeting-summary",
  "maturity": "growing",
  "description": "会议纪要自动生成（支持多种格式）"
}
```

---

### skill_execute

执行技能。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| skillId | string | ✅ | 技能 ID |
| input | object | - | 输入参数（技能自定义） |

**示例**:
```json
{
  "skillId": "coding/code-review",
  "input": {
    "code": "function sum(a, b) { return a + b; }",
    "language": "javascript"
  }
}
```

**输出**:
```
执行技能: coding/code-review

## 代码审查结果

### 代码质量 ⭐⭐⭐⭐
- ✅ 简洁明了
- ✅ 命名规范
- ⚠️  缺少类型检查

### 性能 ⭐⭐⭐⭐⭐
- ✅ O(1) 时间复杂度
- ✅ 无内存泄漏风险

### 安全 ⭐⭐⭐
- ⚠️  未验证输入类型
- 建议: 添加参数验证

### 改进建议
1. 添加 TypeScript 类型注解
2. 增加输入验证
3. 补充单元测试
```

---

### skill_delete

删除技能。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| skillId | string | ✅ | 技能 ID |

**示例**:
```json
{
  "skillId": "productivity/old-skill"
}
```

---

## 其他工具

### time_now

获取当前时间。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| timezone | string | - | 时区 (如 "Asia/Shanghai") |
| format | string | - | 自定义格式 |

### calc

计算数学表达式。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| expression | string | ✅ | 数学表达式 |

**示例**:
```json
{ "expression": "sqrt(16) + 2 * 3" }
```

### code_execute

在沙箱中执行 JavaScript 代码。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| code | string | ✅ | JavaScript 代码 |
| language | string | - | 语言: javascript, typescript |
| timeout | number | - | 超时 (默认 5000ms) |

**沙箱限制**: 禁止 `require`, `import`, `eval`, `exec`, `spawn` 等危险操作。

### weather

获取天气信息和多日预报（使用和风天气 API）。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| location | string | ✅ | 城市名称，支持中文或英文（如 "北京", "Shanghai"） |
| format | string | - | 格式: current (简洁), forecast (多日预报), detailed (详细) |
| days | string | - | 预报天数: 3d, 7d, 10d, 15d, 30d (仅当 format=forecast 时有效，默认 3d) |

**配置要求**:

需要在 `.env` 文件中配置和风天气 API 密钥：
- `QWEATHER_KEY`: API KEY（推荐，简单易用）
- `QWEATHER_TOKEN`: JWT Token（可选，更安全）
- `QWEATHER_LOCATION`: 默认城市（默认: 北京）

获取密钥: https://dev.qweather.com/

**示例**:

```json
// 简洁格式 - 当前天气
{ "location": "北京", "format": "current" }
// 返回: 北京当前天气：雨夹雪，温度0°C，东风1-3级，湿度91%

// 详细格式 - 当前天气详情
{ "location": "上海", "format": "detailed" }
// 返回: 包含位置ID、温度、天气、风向风力、湿度、更新时间等详细信息

// 预报格式 - 3天预报
{ "location": "深圳", "format": "forecast", "days": "3d" }
// 返回:
📍 深圳 未来3天天气预报

📅 2026-03-03 (周二)
   🌡️  15°C ~ 20°C
   ☀️  白天: 大雨，北风1-3
   🌙  夜间: 小雨，北风1-3
   💧 湿度: 81%，降水: 34.8mm
   🌅 日出: 06:45，日落: 18:29
...

// 预报格式 - 7天预报
{ "location": "广州", "format": "forecast", "days": "7d" }
// 返回: 7天的详细预报数据
```

**功能特点**:

- ✅ 支持中英文城市名称
- ✅ 提供实时天气和1-30天预报
- ✅ 包含温度、天气状况、风力、湿度、降水量、日出日落等信息
- ✅ 支持多种预报天数（3d/7d/10d/15d/30d）
- ✅ 自动缓存城市ID，提高性能

### url_shorten

生成短链接。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| url | string | ✅ | 原始 URL |

### qrcode

生成二维码。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| text | string | ✅ | 二维码内容 |
| size | number | - | 尺寸 (默认 200px) |

### claude_code

使用 Claude Code SDK 执行任务。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| prompt | string | ✅ | 任务描述 |
| working_dir | string | - | 工作目录 |
| timeout | number | - | 超时 (默认 60000ms) |
| model | string | - | 模型选择 |

---

## 使用示例

### 示例 1: 深度研究并保存报告

```javascript
// 1. 执行深度研究
const research = await deep_research({
  topic: "2024年电动汽车市场趋势",
  depth: "standard"
});

// 2. 保存为 Markdown 报告
await file_write({
  path: "reports/ev-market-2024.md",
  content: research.data
});

// 3. 生成 HTML 版本
await file_write({
  path: "reports/ev-market-2024.html",
  content: `<!DOCTYPE html>
<html>
<head><title>电动汽车市场报告</title></head>
<body>${markdownToHtml(research.data)}</body>
</html>`
});
```

### 示例 2: 批量文件处理

```javascript
// 1. 列出所有报告
const files = await file_list({
  path: "reports",
  pattern: "*.md"
});

// 2. 读取并处理每个文件
for (const file of files) {
  const content = await file_read({ path: file });
  // 处理内容...
}
```

### 示例 3: Git 操作

```javascript
// 查看最近的提交
const log = await shell({
  command: "git log --oneline -10"
});

// 查看文件状态
const status = await shell({
  command: "git status --short"
});
```

---

## 相关文档

| 文档 | 描述 |
|------|------|
| [CLI 参考](./cli.md) | CLI 命令详解 |
| [API 参考](./tools.md) | HTTP API 文档 |
| [配置指南](./configuration.md) | 配置选项 |
