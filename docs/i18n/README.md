# 多语言支持规划

> Beeclaw 文档国际化（i18n）实施指南

---

## 📋 规划概览

### 目标

- ✅ 建立中英文双语文档体系
- ✅ 统一术语翻译标准
- ✅ 支持社区翻译贡献
- ✅ 自动化翻译工作流

### 优先级

| 阶段 | 内容 | 时间 |
|------|------|------|
| **Phase 1** | 术语表 + 核心文档翻译 | 1-2 周 |
| **Phase 2** | 完整文档翻译 | 1 个月 |
| **Phase 3** | i18n 架构 + 自动化 | 2 周 |

---

## 📖 术语表（Glossary）

### 核心概念

| 中文 | 英文 | 说明 | 示例 |
|------|------|------|------|
| **子代理** | Subagent | 独立执行的 AI Agent 实例 | "spawn a subagent" |
| **记忆系统** | Memory System | 文件系统 + 索引的知识存储 | "memory_search tool" |
| **技能** | Skill | 可复用的提示词模块 | "skill_execute" |
| **主动系统** | Proactive System | 定时任务和主动通知 | "proactive scheduling" |
| **插件** | Plugin | OpenClaw 兼容的扩展模块 | "plugin development" |
| **会话** | Session | 一次完整的对话流程 | "session recovery" |
| **上下文** | Context | AI 可见的信息集合 | "context management" |
| **工具** | Tool | AI 可调用的函数 | "web_search tool" |
| **提示词** | Prompt | 输入给 AI 的文本 | "system prompt" |
| **提供者** | Provider | AI 模型提供商 | "OpenAI provider" |

### 系统架构

| 中文 | 英文 | 说明 |
|------|------|------|
| **统一会话架构** | Unified Session Architecture | CLI/Bot 统一会话管理 |
| **弹性设计** | Resilience Design | 熔断、重试、降级机制 |
| **上下文管理** | Context Management | Token 预算和压缩 |
| **熔断器** | Circuit Breaker | 故障隔离机制 |
| **守护进程** | Daemon | 后台运行的服务进程 |

### 文件系统

| 中文 | 英文 | 说明 |
|------|------|------|
| **事实** | Facts | 动态数据（日/周级更新） |
| **知识** | Knowledge | 稳定信息（月/年级更新） |
| **索引** | Index | 关键词索引 |
| **压缩** | Compression | 记忆摘要和归档 |

### 工具名称

**保留英文，不翻译**：

- `memory_search`
- `web_search`
- `deep_research`
- `skill_execute`
- `spawn_subagent`
- `file_write`
- `shell`

**原因**: 工具名称是 API 调用，翻译会导致混淆。

---

## 🌍 翻译规范

### 1. 不翻译的内容

- ✅ **代码**：变量名、函数名、命令
- ✅ **工具名称**：`memory_search`, `web_fetch`
- ✅ **配置项**：`providers`, `agents`
- ✅ **文件路径**：`beeclaw.json`, `data/memory/`
- ✅ **专有名词**：OpenAI, React, TypeScript

### 2. 需要翻译的内容

- ✅ **标题和章节名**
- ✅ **说明文字**
- ✅ **示例描述**
- ✅ **常见问题**

### 3. 翻译风格

#### 标题层级

```markdown
❌ Bad: 使用 Memory System 提升效率
✅ Good: 使用记忆系统提升效率

❌ Bad: Subagent 编排最佳实践
✅ Good: 子代理编排最佳实践
```

#### 代码注释

```typescript
// ✅ Good (英文注释)
// Create a new skill instance
const skill = await createSkill('weekly-report');

// ❌ Bad (中文注释)
// 创建一个新的技能实例
const skill = await createSkill('weekly-report');
```

#### 示例对话

```markdown
❌ Bad:
> 帮我 search "人工智能"

✅ Good:
> 帮我搜索"人工智能"
```

---

## 📁 文档结构

### 当前结构（中文）

```
docs/
├── README.md
├── getting-started.md
├── learning-paths.md
├── guide/
│   ├── memory-system.md
│   └── skill-system.md
└── ...
```

### 未来结构（双语）

```
docs/
├── README.md              # 中文（默认）
├── en/                    # 英文版
│   ├── README.md
│   ├── getting-started.md
│   ├── learning-paths.md
│   ├── guide/
│   │   ├── memory-system.md
│   │   └── skill-system.md
│   └── ...
├── zh/                    # 中文版（可选，默认根目录）
│   └── ...
└── i18n/                  # 翻译资源
    ├── glossary.json      # 术语表
    ├── en.json            # 英文翻译
    └── zh.json            # 中文原文
```

### 文档切换

在每个文档顶部添加语言切换器：

```markdown
[English](../en/README.md) | **中文**
```

---

## 🔧 技术实现

### 方案 1：静态文件（推荐初期）

**优点**:
- ✅ 简单直接
- ✅ SEO 友好
- ✅ 无需构建工具

**缺点**:
- ❌ 维护成本高
- ❌ 同步困难

**实施**:
```bash
# 创建英文版目录
mkdir -p docs/en/{guide,design,references,cookbook}

# 复制并翻译
cp docs/README.md docs/en/README.md
# 手动翻译...
```

---

### 方案 2：i18n 框架（推荐长期）

**使用 VitePress i18n**:

```typescript
// .vitepress/config.ts
export default {
  locales: {
    '/': {
      lang: 'zh-CN',
      title: 'Beeclaw 文档',
      description: '可进化的 AI 助手'
    },
    '/en/': {
      lang: 'en-US',
      title: 'Beeclaw Docs',
      description: 'An Evolving AI Assistant'
    }
  }
}
```

**优点**:
- ✅ 自动化
- ✅ 语言切换器
- ✅ SEO 优化
- ✅ 搜索支持

**缺点**:
- ❌ 需要迁移到 VitePress
- ❌ 初期配置复杂

---

### 方案 3：自动化翻译（辅助）

**使用 AI 辅助翻译**:

```bash
# 翻译脚本
translate-doc() {
  local file=$1
  local output="docs/en/${file}"

  # 使用 AI 翻译
  claude-code "
    将以下 Markdown 文档翻译成英文：
    1. 保持代码块不变
    2. 保留工具名称（如 memory_search）
    3. 遵循术语表
    4. 保持 Markdown 格式

    文件: $file
  " > $output
}

# 批量翻译
translate-all() {
  find docs -name "*.md" | while read file; do
    translate-doc $file
  done
}
```

---

## 📝 翻译流程

### Phase 1：准备工作（1 周）

#### Week 1

**Day 1-2**: 建立术语表
- ✅ 创建 `docs/i18n/glossary.json`
- ✅ 整理核心术语（50+ 条）
- ✅ 确定翻译标准

**Day 3-4**: 翻译核心文档
- ✅ README.md
- ✅ getting-started.md
- ✅ learning-paths.md

**Day 5-7**: 审核和发布
- ✅ 母语审核（找英语母语者）
- ✅ 修复问题
- ✅ 发布到 `/en/` 目录

---

### Phase 2：完整翻译（3 周）

#### Week 2-3: 用户指南

- [ ] guide/memory-system.md
- [ ] guide/skill-system.md
- [ ] guide/subagent-system.md
- [ ] guide/plugin-system.md
- [ ] guide/proactive-system.md
- [ ] guide/feishu-integration.md

#### Week 4: 架构和参考

- [ ] architecture.md
- [ ] design/context-management.md
- [ ] design/resilience.md
- [ ] references/tools.md
- [ ] references/cli.md

---

### Phase 3：自动化（2 周）

#### Week 5-6: i18n 架构

- [ ] 迁移到 VitePress（可选）
- [ ] 配置 i18n 系统
- [ ] 实现语言切换器
- [ ] 自动化翻译工作流

---

## 🤝 社区翻译

### 贡献指南

创建 `TRANSLATION.md`:

```markdown
# 翻译贡献指南

## 如何贡献翻译

1. **选择文档**: 从 [待翻译列表](#待翻译) 中选择
2. **Fork 仓库**: 创建你的分支
3. **翻译文档**: 遵循 [翻译规范](#规范)
4. **提交 PR**: 标题格式: `docs(i18n): Translate XXX to English`

## 翻译规范

1. **使用术语表**: 参考 `docs/i18n/glossary.json`
2. **保持代码**: 代码块和命令不翻译
3. **保留格式**: Markdown 格式保持一致
4. **母语审核**: 找母语者审核（可选）

## 待翻译文档

- [ ] guide/memory-system.md
- [ ] guide/skill-system.md
- [ ] ...
```

---

### 翻译质量保证

**审核清单**:

- [ ] 术语翻译准确
- [ ] 代码未翻译
- [ ] 格式保持一致
- [ ] 链接有效
- [ ] 无语法错误
- [ ] 母语者审核（推荐）

---

## 📊 翻译进度跟踪

### 优先级矩阵

| 文档 | 优先级 | 字数 | 状态 | 译者 |
|------|--------|------|------|------|
| README.md | P0 | 500 | ⏳ 进行中 | @user1 |
| getting-started.md | P0 | 1500 | ✅ 完成 | @user2 |
| learning-paths.md | P0 | 2000 | 📝 待开始 | - |
| memory-system.md | P1 | 2500 | 📝 待开始 | - |

**状态**:
- ✅ 完成
- ⏳ 进行中
- 📝 待开始
- 🔍 审核中

---

## 🔍 质量检查

### 自动化检查

```bash
#!/bin/bash
# check-translation.sh

# 检查术语一致性
check-glossary() {
  local file=$1
  local errors=0

  # 检查是否使用了正确的英文术语
  grep -E "子代理|记忆系统|技能" $file | while read line; do
    echo "⚠️  发现未翻译术语: $line"
    ((errors++))
  done

  return $errors
}

# 检查代码块
check-code-blocks() {
  local file=$1

  # 确保代码块未翻译
  # 实现逻辑...
}

# 主检查
for file in docs/en/**/*.md; do
  echo "检查 $file..."
  check-glossary $file
  check-code-blocks $file
done
```

---

## 💡 最佳实践

### 1. 渐进式翻译

**不要一次性翻译所有文档**:

```markdown
❌ Bad: 试图一个月内翻译所有文档
✅ Good: 先翻译核心文档，逐步扩展
```

### 2. 保持同步

**使用脚本检测变更**:

```bash
# 检查中文文档是否比英文新
check-sync() {
  local zh_file=$1
  local en_file="docs/en/${zh_file}"

  if [ $(stat -f %m $zh_file) -gt $(stat -f %m $en_file) ]; then
    echo "⚠️  $zh_file 已更新，需要同步翻译"
  fi
}
```

### 3. 版本控制

**在 CHANGELOG 中记录翻译**:

```markdown
## [v2.1.1] - 2026-03-15

### 🌐 i18n

- ✨ 新增英文版 README
- ✨ 新增英文版 getting-started
- 📝 更新术语表（新增 20 条）
```

---

## 🎯 成功指标

### 短期（1 个月）

- [ ] 核心文档（5 个）英文版完成
- [ ] 术语表包含 100+ 条
- [ ] 语言切换器可用

### 中期（3 个月）

- [ ] 所有用户指南翻译完成
- [ ] 社区贡献 5+ 翻译 PR
- [ ] 英文文档 PV > 1000

### 长期（6 个月）

- [ ] 完整双语文档体系
- [ ] 支持 3+ 种语言
- [ ] 自动化翻译工作流

---

## 📚 参考资料

### 优秀案例

- [VitePress i18n](https://vitepress.dev/guide/i18n)
- [Vue.js 文档](https://vuejs.org/)
- [React 文档](https://react.dev/)

### 工具

- [i18n Studio](https://i18n.studio/) - 翻译管理
- [Crowdin](https://crowdin.com/) - 协作翻译
- [DeepL](https://www.deepl.com/) - AI 翻译

---

## 🚀 下一步行动

### 立即开始

1. **创建术语表**: `docs/i18n/glossary.json`
2. **翻译 README**: 第一个英文文档
3. **建立流程**: 确定翻译和审核流程

### 本周完成

- [ ] 术语表（50+ 条）
- [ ] 英文 README
- [ ] 英文 getting-started
- [ ] 语言切换器

---

**维护者**: Beeclaw Team
**最后更新**: 2026-03-14
**版本**: v1.0.0
