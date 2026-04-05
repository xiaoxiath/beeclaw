# 工具参考

> Beeclaw 内置工具完整列表

工具分为两类：
- **始终加载** — 核心 builtin 工具，所有场景可用
- **条件加载** — 仅在配置了相应功能时可用（如搜索 Provider、子代理状态等）

---

## 搜索工具（条件加载）

需配置搜索 Provider（Bocha / Tavily / Google / Bing / Brave）。

### web_search

Web 搜索，支持中英文查询和自动区域检测。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索关键词 |
| `num_results` | number | 否 | 结果数量（1-20，默认 10） |
| `region` | string | 否 | 搜索区域：global / cn / us / auto（默认 auto） |
| `time_range` | string | 否 | 时间过滤：day / week / month / year |

### web_fetch

获取并提取网页内容。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | 是 | 目标 URL |
| `format` | string | 否 | 输出格式：text / markdown / json（默认 markdown） |
| `max_length` | number | 否 | 最大内容长度（默认 10000） |

### deep_research（条件加载）

系统性多角度深度研究，自动并行搜索、抓取关键来源并综合报告。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `topic` | string | 是 | 研究主题 |
| `aspects` | string[] | 否 | 需要调查的具体方面 |
| `depth` | string | 否 | 研究深度：quick / standard / comprehensive（默认 standard） |
| `time_range` | string | 否 | 时间过滤 |

### request_deep_analysis（条件加载）

请求后台深度分析，先发送快速回复，完成后推送结果。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `reason` | string | 是 | 需要深度分析的原因 |
| `quick_response` | string | 是 | 给用户的快速回复 |
| `analysis_tasks` | string[] | 否 | 分析任务列表 |

---

## 文件和 Shell 工具（始终加载）

### file_read

读取本地文件内容，支持文本、JSON 和 base64 编码。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径（相对于项目根目录） |
| `encoding` | string | 否 | 编码：utf-8 / base64 / json（默认 utf-8） |
| `max_length` | number | 否 | 最大内容长度（默认 50000） |

### file_write

写入本地文件，可创建新文件或追加内容。仅限 output/、reports/、temp/、data/ 目录。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |
| `content` | string | 是 | 文件内容 |
| `mode` | string | 否 | write / append（默认 write） |
| `create_dirs` | boolean | 否 | 自动创建父目录（默认 true） |

### file_list

列出目录下的文件。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 否 | 目录路径（默认当前目录） |
| `recursive` | boolean | 否 | 递归列出（默认 false） |
| `pattern` | string | 否 | 文件过滤模式（如 "*.md"） |

### file_delete

删除文件。仅限 output/、reports/、temp/ 目录。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |

### shell

在受控环境中执行 Shell 命令。支持 git、文件操作、开发工具等。禁止 sudo、rm -rf /、ssh、包安装等危险操作。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | string | 是 | Shell 命令 |
| `timeout` | number | 否 | 超时毫秒数（默认 10000，最大 30000） |
| `cwd` | string | 否 | 工作目录（默认项目根目录） |

---

## 实用工具（始终加载）

### time_now

获取当前日期和时间，使用用户配置的时区（默认 Asia/Shanghai）。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `timezone` | string | 否 | 覆盖时区（如 "America/New_York"） |
| `format` | string | 否 | 自定义格式（默认 YYYY-MM-DD HH:mm:ss） |

### weather

查询天气信息，使用和风天气 API。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `location` | string | 是 | 城市名（如 "北京"、"Shanghai"） |
| `format` | string | 否 | current / detailed / forecast（默认 current） |
| `days` | string | 否 | 预报天数：3d / 7d / 10d / 15d / 30d（仅 forecast 模式） |

### beeclaw_info

获取系统信息，包括版本号、运行时环境和功能配置。

**参数**: 无

### calc

计算数学表达式，支持基础运算、三角函数、对数等。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `expression` | string | 是 | 数学表达式（如 "sqrt(16)"、"sin(pi/4)"） |

### code_execute

在沙箱中执行 JavaScript 代码。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | string | 是 | JavaScript 代码 |
| `language` | string | 否 | javascript / typescript（默认 javascript） |
| `timeout` | number | 否 | 超时毫秒数（默认 5000，最大 10000） |

### claude_code

通过 Claude Code SDK 执行复杂任务。同步阻塞，建议优先使用 `spawn_subagent` 进行后台处理。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 任务描述 |
| `working_dir` | string | 否 | 工作目录 |
| `timeout` | number | 否 | 超时毫秒数（默认 120000，最大 900000） |
| `model` | string | 否 | 模型名称 |

### get_holiday_info

> 已废弃，请改用 `web_search` 查询节假日信息。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `date` | string | 否 | 日期（YYYY-MM-DD，默认今天） |

---

## 沙箱工具（始终加载）

沙箱工具提供隔离的执行环境，支持进程/容器级别隔离。

### sandbox_exec

在隔离沙箱中执行 Shell 命令。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | string | 是 | Shell 命令 |
| `cwd` | string | 否 | 工作目录（相对于沙箱工作区） |
| `timeout` | number | 否 | 超时毫秒数（默认 30000） |

### sandbox_write_file

在沙箱工作区写入文件。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径（相对于沙箱工作区） |
| `content` | string | 是 | 文件内容 |

### sandbox_read_file

从沙箱工作区读取文件。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |
| `startLine` | number | 否 | 起始行号（1-based） |
| `maxLines` | number | 否 | 最大读取行数 |

### sandbox_list_files

列出沙箱工作区文件。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 否 | 目录路径（默认 "."） |
| `recursive` | boolean | 否 | 递归列出（默认 false） |
| `hidden` | boolean | 否 | 包含隐藏文件（默认 false） |

### sandbox_status

获取沙箱状态，包括 Provider 类型和执行统计。

**参数**: 无

---

## 子代理工具（始终加载）

### spawn_subagent

生成单个子代理执行特定任务。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 子代理类型：research / memory / skill / code / general |
| `task` | string | 是 | 任务描述 |
| `context` | string | 否 | 额外上下文 |
| `timeout` | number | 否 | 超时毫秒数（默认 60000） |

### spawn_parallel

并行生成多个子代理执行独立任务。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tasks` | object[] | 是 | 任务列表，每项含 type、task、context、timeout |
| `maxParallelism` | number | 否 | 最大并行数（默认 3） |

---

## 状态工具（条件加载）

仅在子代理编排激活时可用。原有 9 个独立工具已整合为 3 个组合工具。

### state_manage

组合 set / get / update / delete 操作。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | 操作：set / get / update / delete |
| `key` | string | 是 | 状态键（使用命名空间如 "category:sub:item"） |
| `value` | any | 否 | 存储值（set/update 时使用） |
| `operation` | string | 否 | 更新操作：increment / decrement / append / prepend / merge / replace |
| `ttl` | number | 否 | 生存时间（毫秒） |
| `metadata` | object | 否 | 附加元数据（set 时使用） |

### state_query

组合 list / exists / stats 查询操作。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | 查询：list / exists / stats |
| `key` | string | 否 | 状态键（exists 时使用） |
| `prefix` | string | 否 | 键前缀过滤（list 时使用） |

### state_lock_manage

组合 acquire / release 锁操作。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | 操作：acquire / release |
| `key` | string | 是 | 要锁定/解锁的状态键 |
| `owner` | string | 否 | 锁持有者标识（acquire 时使用） |
| `timeout` | number | 否 | 锁获取超时（毫秒，默认 5000） |

---

## 用户交互工具（始终加载）

### ask_user_question

向用户提问，暂停执行直到获得回复。用于信息确认、决策和消除歧义。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `question` | string | 是 | 问题内容 |
| `options` | string[] | 否 | 选项列表 |
| `context` | string | 否 | 提问背景说明 |
| `inputType` | string | 否 | 输入类型：text / choice / confirmation / multi_choice |

### update_user_settings

更新用户设置（位置、时区），保存到 beeclaw.json。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `location` | string | 是 | 用户所在城市 |
| `timezone` | string | 否 | IANA 时区（不传则根据位置自动推断） |

---

## 记忆工具

### 基础工具（始终加载）

#### memory_ls

列出记忆文件。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 否 | 目录路径 |

#### memory_grep

搜索记忆内容。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索关键词 |
| `path` | string | 否 | 搜索路径 |

#### memory_read

读取记忆文件。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |

#### memory_write

写入记忆文件。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |
| `content` | string | 是 | 文件内容 |
| `mode` | string | 否 | overwrite / append |

#### memory_record

记录新事实。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `category` | string | 是 | 分类：user / preferences / events / investments / lessons |
| `content` | string | 是 | 事实内容 |

### 高级工具（条件加载）

以下工具需要高级记忆功能启用：

#### memory_compress

压缩旧记忆。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `category` | string | 是 | 要压缩的分类 |
| `olderThan` | number | 否 | 天数（默认 30） |

#### memory_score

计算记忆重要性分数。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `entryId` | string | 是 | 记忆条目 ID |

#### memory_dedupe

去除重复记忆。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `category` | string | 是 | 分类 |

#### memory_knowledge_create

创建知识库。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 知识库名称 |
| `description` | string | 否 | 描述 |

#### memory_index

创建记忆索引。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `category` | string | 是 | 分类 |

#### memory_search

语义搜索记忆。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索查询 |
| `limit` | number | 否 | 结果数量 |

---

## 技能工具

### 基础工具（始终加载）

#### skill_list

列出所有技能。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `maturity` | string | 否 | 成熟度过滤（seed / growing / mature / deprecated） |

#### skill_get

获取技能详情。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 技能名称 |

#### skill_ensure

创建或更新技能。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 技能名称 |
| `description` | string | 是 | 描述 |
| `content` | string | 是 | 技能内容 |
| `maturity` | string | 否 | 成熟度（默认 seed） |

#### skill_search

搜索技能。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索查询 |

### 管理工具（条件加载）

#### skill_delete

删除技能。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 技能名称 |

#### skill_maturity

更新技能成熟度。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 技能名称 |
| `maturity` | string | 是 | 新成熟度 |

#### skill_record

记录技能使用情况。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `skillName` | string | 是 | 技能名称 |
| `success` | boolean | 是 | 是否成功 |

#### skill_evals

技能评估（整合工具，通过 action 参数区分操作）。

**参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `skillName` | string | 是 | 技能名称 |
| `action` | string | 否 | 操作：get / set / run |

---

> **已废弃/迁移的工具**: `create_chart`（已移除，由 Card 渲染器内部处理）、`stock_quote`/`stock_history`/`stock_financial`/`stock_info`（已迁移到 beeclaw-hedge-fund-research 技能）、`datasource_health_check`（已移除，仅内部使用）。
