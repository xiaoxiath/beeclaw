# 内置工具参考

Beeclaw 提供一系列内置工具，支持网络搜索、文件操作、Shell 执行等功能。

## 工具列表

| 工具 | 分类 | 说明 |
|------|------|------|
| `web_search` | 网络 | 多引擎网页搜索 |
| `web_fetch` | 网络 | 获取网页内容 |
| `deep_research` | 研究 | 深度多角度研究 |
| `file_read` | 文件 | 读取本地文件 |
| `file_write` | 文件 | 写入文件内容 |
| `file_list` | 文件 | 列出目录文件 |
| `file_delete` | 文件 | 删除文件 |
| `shell` | 系统 | 安全执行 Shell 命令 |
| `time_now` | 工具 | 获取当前时间 |
| `calc` | 工具 | 数学计算 |
| `code_execute` | 工具 | 执行 JavaScript |
| `weather` | 工具 | 获取天气信息 |
| `url_shorten` | 工具 | 短链接生成 |
| `qrcode` | 工具 | 二维码生成 |
| `claude_code` | 工具 | Claude Code SDK |

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
1. [标题](URL)
2. [标题](URL)

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

获取天气信息。

**参数**:

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| location | string | ✅ | 位置 |
| format | string | - | 格式: current, forecast, detailed |

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
| [CLI 参考](./cli-reference.md) | CLI 命令详解 |
| [API 参考](./api-reference.md) | HTTP API 文档 |
| [配置指南](./configuration.md) | 配置选项 |
