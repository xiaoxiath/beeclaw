# Beeclaw 飞书消息体验优化 — 详细技术方案

> **文档版本**: v1.0  
> **状态**: Draft  
> **优先级**: P0  
> **预计工期**: 2 周  
> **参考实现**: [Agentara - community/feishu/messaging](https://github.com/MagicCube/agentara/tree/main/src/community/feishu/messaging)

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [现状分析](#2-现状分析)
3. [目标效果](#3-目标效果)
4. [整体架构设计](#4-整体架构设计)
5. [详细设计](#5-详细设计)
   - 5.1 [Card Schema 2.0 类型系统](#51-card-schema-20-类型系统)
   - 5.2 [ContentBlock 结构化消息模型](#52-contentblock-结构化消息模型)
   - 5.3 [MessageCardRenderer 消息卡片渲染器](#53-messagecardrenderer-消息卡片渲染器)
   - 5.4 [StreamingMessageController 流式消息控制器](#54-streamingmessagecontroller-流式消息控制器)
   - 5.5 [Session 处理流程改造](#55-session-处理流程改造)
   - 5.6 [话题（Thread）会话管理](#56-话题thread会话管理)
6. [完整代码实现](#6-完整代码实现)
7. [迁移方案](#7-迁移方案)
8. [测试方案](#8-测试方案)
9. [风险评估与缓解](#9-风险评估与缓解)
10. [附录](#10-附录)

---

## 1. 背景与动机

### 1.1 问题陈述

Beeclaw 当前的飞书消息发送存在以下用户体验问题：

1. **用户等待焦虑**：Agent 推理过程中用户看不到任何进展，只能干等最终结果。对于复杂任务（工具调用链、多轮搜索、代码执行），等待时间可能长达 30-60 秒，用户无法判断是否在正常工作。

2. **Markdown 渲染粗糙**：当前使用 `post` 消息类型 + 手动 `split('\n')` 逐行解析 Markdown。这种方式丢失了层级结构、不支持代码块高亮、不支持表格、链接只能显示为纯文本。

3. **消息格式不统一**：`sendTextMessage`、`sendPostMessage`、`sendMarkdownMessage`、`sendMarkdownCard` 四种函数混用，调用侧需要自行选择格式，缺乏统一的输出管道。

4. **无工具执行可见性**：用户无法看到 Agent 调用了哪些工具（搜索、文件操作、代码执行等），降低了信任感和可调试性。

### 1.2 对标参考

Agentara 项目使用 **飞书 Interactive Card Schema 2.0** 实现了优秀的消息展示效果：

- 推理过程以可折叠步骤面板（`CollapsiblePanel`）展示
- 最终回答使用 Card 内嵌 Markdown Element 原生渲染
- 全流程通过 `streaming_mode` + `message.patch` 实时更新
- 每种工具有对应的图标和描述文本

本方案的目标是将这些能力移植到 Beeclaw，同时保留 Beeclaw 的特有工具生态（SubAgent、Skills、MCP Tools、飞书 API 等）。

### 1.3 与已有 RFC 的关系

本方案与之前的架构设计文档中 RFC-01（MessageChannel/Gateway 抽象）紧密关联，但设计为**可独立实施**：

| 关系 | 说明 |
|------|------|
| 独立先行 | 本方案在现有 `src/feishu/` 目录下新增模块，不依赖 RFC-01 的 MessageChannel 接口 |
| 后续整合 | RFC-01 实施时，`StreamingMessageController` 将被整合进 `FeishuChannel.replyMessage()` |
| 接口预留 | 本方案的所有公共接口设计已与 RFC-01 的 `MessageChannel` 接口对齐 |

---

## 2. 现状分析

### 2.1 Beeclaw 当前消息发送架构

```
src/feishu/
├── send.ts          # 消息发送函数集合
├── card.ts          # CardBuilder 类 + 卡片构建辅助函数
├── client.ts        # 飞书 Client 初始化
├── ws-client.ts     # WebSocket 接收消息
├── media.ts         # 媒体上传
├── mention.ts       # @提及处理
└── index.ts         # 统一导出
```

#### 消息发送函数清单

| 函数 | 消息类型 | 使用场景 | 问题 |
|------|---------|---------|------|
| `sendTextMessage()` | `text` | 简单文本回复 | 不支持格式化 |
| `sendPostMessage()` | `post` | 富文本回复 | 手动逐行解析 Markdown，丢失结构 |
| `sendMarkdownMessage()` | `post` + `md` tag | Markdown 回复 | `md` tag 在 post 中渲染能力有限 |
| `sendMarkdownCard()` | `interactive` (template) | 卡片 Markdown | 依赖外部模板 ID，灵活性差 |
| `sendCardMessage()` | `interactive` | 交互卡片 | 手动构建，无标准化 |
| `editMessage()` | `text` / `post` | 编辑已发消息 | 只能替换文本，不支持流式卡片 |
| `replyMessage()` | `text` / `post` / `interactive` | 回复消息 | 不使用 `reply_in_thread`，无话题聚合 |

#### `buildPostContent()` 的核心缺陷

```typescript
// src/feishu/send.ts — 现有的 Markdown → Post 转换函数
function buildPostContent(markdown: string, mentionTargets?: MentionTarget[]) {
  const elements: Array<PostContentElement> = [];
  const lines = markdown.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('### ')) {
      elements.push({ tag: 'text', text: line.substring(3), style: ['bold'] });
    } else if (line.startsWith('## ')) {
      elements.push({ tag: 'text', text: line.substring(2), style: ['bold'] });
    }
    // ... 逐行 if-else 匹配
  }
  return [elements];
}
```

**问题列表**：
- 只处理单行内的格式，跨行结构（代码块、表格、引用块）无法解析
- Bold 和 Code 不能嵌套处理
- 所有标题都降级为 `bold` 文本，丢失语义层级
- 链接 `[text](url)` 直接当纯文本输出
- 列表只是在前面加 `•`，没有缩进

#### `CardBuilder` 的局限

```typescript
// src/feishu/card.ts — 现有的 CardBuilder
export class CardBuilder {
  private config: CardConfig = {};  // 只有 wide_screen_mode, enable_forward
  private elements: CardElement[] = [];
  // ...
  build(): FeishuCard {
    return {
      type: 'interactive',     // 没有 schema: "2.0"
      config: this.config,     // 没有 streaming_mode
      elements: this.elements, // 没有 body 包裹
    };
  }
}
```

**缺失能力**：
- 没有 `schema: "2.0"` 声明（无法使用新组件）
- 没有 `streaming_mode` 配置
- 没有 `collapsible_panel` 组件
- 没有 `standard_icon` 图标系统
- 没有 `width_mode: "fill"` 宽屏模式
- 没有 `summary` 配置（消息列表预览文本）

### 2.2 Beeclaw Session 处理流程

```
用户消息到达
    │
    ▼
sendProactiveMessage() → SessionMessageQueue.enqueue()
    │
    ▼
_sendProactiveMessageInternal()
    │
    ├── getOrCreateSession()           // 获取/创建 session
    ├── session.messages.push(user)     // 追加用户消息
    ├── agent = createAgent(...)        // 创建 Agent
    ├── response = agent.chat(...)      // ⚡ 这里是阻塞的！等待完整响应
    ├── session.messages.push(assistant)// 追加 AI 响应
    ├── saveSession()                   // 持久化
    └── handler(sessionId, response)    // 通过 channelHandler 发送到飞书
```

**关键问题**：`agent.chat()` 是一次性返回完整响应，不是流式的。即使改为流式，当前也没有机制将中间状态（thinking、tool_use）实时推送给飞书。

### 2.3 Agentara 的实现分析

Agentara 的飞书消息渲染由以下组件协作完成：

**类型层** (`types/interactive/`):

```
types/interactive/
├── card.ts       # Card, CardConfig, CardHead, CardBody
├── elements.ts   # CollapsiblePanel, DivElement, MarkdownElement, IconElement
├── styles.ts     # Color (190+ 色值), TextSize (17 级), TextAlign
└── index.ts      # 统一导出
```

**渲染层** (`message-renderer.ts`):

核心函数 `renderMessageCard(content, { streaming })` 的工作流程：

1. 创建 `CollapsiblePanel`（步骤面板），根据 `streaming` 参数决定是否展开
2. 遍历 `content` 数组：
   - `thinking` → 截取文本 + `robot_outlined` 图标
   - `tool_use` → 根据工具名映射图标和描述文本（12 种工具映射）
   - `text` → 仅在 `streaming=false` 时作为 `MarkdownElement` 添加到卡片底部
3. 更新步骤计数文本（"Working on it (N steps)" / "Show N steps"）
4. 流式模式添加 `⋯` 加载指示器

**通道层** (`message-channel.ts`):

`FeishuMessageChannel` 实现了 `MessageChannel` 接口：
- `replyMessage()` → `renderMessageCard()` → `client.im.message.reply()` + `reply_in_thread: true`
- `updateMessageContent()` → `renderMessageCard()` → `client.im.message.patch()`
- `_handleMessageReceive()` → 解析入站消息 → `emit("message:inbound")`
- `_resolveSessionId()` → thread_id 映射（内存 Map + SQLite 持久化）

---

## 3. 目标效果

### 3.1 流式推理中的卡片效果

```
┌──────────────────────────────────────────────────┐
│  ▼ 正在处理 (4 个步骤)                              │
│  ─────────────────────────────────────────────── │
│  🤖 分析用户问题，确定需要搜索相关信息...              │
│  🔍 搜索 "TypeScript 设计模式最佳实践"               │
│  🌐 获取网页 "https://refactoring.guru/..."         │
│  💻 执行命令: 分析搜索结果并提取关键信息               │
│                                                   │
│  ⋯                                               │
└──────────────────────────────────────────────────┘
```

**特点**：
- 可折叠面板默认展开，用户能实时看到每一步
- 每个步骤有语义化图标，一目了然
- 底部有 `⋯` 动画指示器
- 卡片使用宽屏模式，内容不被截断

### 3.2 推理完成后的卡片效果

```
┌──────────────────────────────────────────────────┐
│  ▶ 查看 6 个步骤                                   │
│  ─────────────────────────────────────────────── │
│                                                   │
│  ## TypeScript 设计模式对比分析                      │
│                                                   │
│  根据搜索和分析的结果，以下是三种主要设计模式的对比：    │
│                                                   │
│  | 模式 | 适用场景 | 优势 |                          │
│  |------|---------|------|                          │
│  | 策略 | 算法替换 | 开闭原则 |                       │
│  | 观察者| 事件驱动 | 松耦合 |                         │
│  | 工厂 | 对象创建 | 封装性 |                         │
│                                                   │
│  ### 推荐方案                                       │
│  对于 Beeclaw 的插件系统，建议使用**策略模式**...      │
└──────────────────────────────────────────────────┘
```

**特点**：
- 步骤面板自动折叠为一行，不占空间
- 点击可展开查看完整执行过程
- 最终回答以 **原生 Markdown** 渲染（标题、表格、代码块、加粗等完美呈现）
- 消息列表预览显示摘要文本

### 3.3 非工具调用场景（纯文本对话）

```
┌──────────────────────────────────────────────────┐
│                                                   │
│  你好！我是 Beeclaw，有什么可以帮助你的？              │
│                                                   │
└──────────────────────────────────────────────────┘
```

- 没有工具调用时，不显示步骤面板
- 直接以 Markdown 渲染最终文本
- 简洁自然

---

## 4. 整体架构设计

### 4.1 模块关系图

```
src/
├── types/
│   └── content-block.ts              # [新增] ContentBlock 联合类型定义
│
├── feishu/
│   ├── card-v2/                      # [新增] Card Schema 2.0 模块
│   │   ├── types/
│   │   │   ├── card.ts               # Card, CardConfig, CardBody
│   │   │   ├── elements.ts           # CollapsiblePanel, DivElement, MarkdownElement
│   │   │   ├── styles.ts             # Color, TextSize, TextAlign
│   │   │   └── index.ts              # 统一导出
│   │   ├── message-renderer.ts       # renderMessageCard() 核心渲染器
│   │   ├── tool-icon-registry.ts     # 工具→图标映射注册表
│   │   ├── streaming-controller.ts   # StreamingMessageController
│   │   └── index.ts                  # 统一导出
│   │
│   ├── thread-manager.ts             # [新增] Thread→Session 映射管理
│   ├── send.ts                       # [保留] 基础消息发送函数
│   ├── card.ts                       # [保留] 旧版 CardBuilder
│   ├── client.ts                     # [保留] 飞书 Client
│   └── ...
│
└── session/
    └── index.ts                      # [修改] 集成 StreamingMessageController
```

### 4.2 数据流设计

```
┌─────────────────────────────────────────────────────────────┐
│                        Session 处理                          │
│                                                              │
│  用户消息 → sendProactiveMessage()                            │
│                │                                             │
│                ▼                                             │
│  ┌─────────────────────────────┐                             │
│  │ StreamingMessageController  │                             │
│  │                             │                             │
│  │  1. agent.chatStream()      │                             │
│  │     │                       │                             │
│  │     ├─ thinking block ──────┼──► pushContent(thinking)    │
│  │     │                       │         │                   │
│  │     ├─ tool_use block ──────┼──► pushContent(tool_use)    │
│  │     │                       │         │                   │
│  │     ├─ tool_result block    │         │                   │
│  │     │                       │         ▼                   │
│  │     └─ text block ──────────┼──► pushContent(text)        │
│  │                             │                             │
│  │  2. finish()                │                             │
│  └──────────┬──────────────────┘                             │
│             │                                                │
│             ▼                                                │
│  ┌─────────────────────────────┐                             │
│  │  MessageCardRenderer        │                             │
│  │                             │                             │
│  │  renderMessageCard(         │                             │
│  │    contentBlocks,           │                             │
│  │    { streaming }            │                             │
│  │  ) → Card JSON              │                             │
│  └──────────┬──────────────────┘                             │
│             │                                                │
│             ▼                                                │
│  ┌─────────────────────────────┐                             │
│  │  飞书 API                    │                             │
│  │                             │                             │
│  │  首次: im.message.reply()   │                             │
│  │  更新: im.message.patch()   │                             │
│  │  (节流: 500ms debounce)     │                             │
│  └─────────────────────────────┘                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 关键设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| Card Schema 版本 | 2.0 | 只有 2.0 支持 `collapsible_panel`、`streaming_mode`、`standard_icon` |
| 消息回复方式 | `reply_in_thread: true` | 话题内聚合对话，不污染群聊主流；thread_id 可作为 session 映射键 |
| 流式更新节流 | 500ms debounce | 飞书 `message.patch` QPS 限制约 5/s，500ms 间隔安全且体验流畅 |
| 渲染器架构 | 纯函数 `renderMessageCard()` | 无状态、可测试、可被多个 Controller 复用 |
| 工具图标注册 | 可扩展注册表模式 | Beeclaw 工具种类远多于 Agentara，需要可插拔注册 |
| 兼容方案 | 新旧并行 + 功能开关 | 新格式作为可选项，出问题可一键回退 |
| 降级策略 | Card 失败回退 post + md tag | 确保消息始终能送达 |

---

## 5. 详细设计

### 5.1 Card Schema 2.0 类型系统

完整的飞书 Interactive Card Schema 2.0 TypeScript 类型系统，基于 Agentara 的实现并补充了 Beeclaw 需要的扩展。

#### 5.1.1 颜色与样式类型

```typescript
// src/feishu/card-v2/types/styles.ts

/**
 * 飞书卡片颜色系统
 * 
 * 包含 14 个色系 × 13 个色阶 = 182 个颜色值。
 * 实际使用中主要用到：grey 系列（步骤面板）、blue 系列（链接/强调）。
 */
export type Color =
  | 'bg-white' | 'white'
  // Grey 系列 — 步骤面板主色
  | 'grey' | 'grey-00' | 'grey-50' | 'grey-100' | 'grey-200' | 'grey-300'
  | 'grey-350' | 'grey-400' | 'grey-500' | 'grey-600' | 'grey-650'
  | 'grey-700' | 'grey-800' | 'grey-900' | 'grey-950' | 'grey-1000'
  // Blue 系列
  | 'blue' | 'blue-50' | 'blue-100' | 'blue-200' | 'blue-300' | 'blue-350'
  | 'blue-400' | 'blue-500' | 'blue-600' | 'blue-700' | 'blue-800' | 'blue-900'
  // Green 系列 — 成功状态
  | 'green' | 'green-50' | 'green-100' | 'green-200' | 'green-300' | 'green-350'
  | 'green-400' | 'green-500' | 'green-600' | 'green-700' | 'green-800' | 'green-900'
  // Red 系列 — 错误状态
  | 'red' | 'red-50' | 'red-100' | 'red-200' | 'red-300' | 'red-350'
  | 'red-400' | 'red-500' | 'red-600' | 'red-700' | 'red-800' | 'red-900'
  // Orange 系列 — 警告状态
  | 'orange' | 'orange-50' | 'orange-100' | 'orange-200' | 'orange-300'
  | 'orange-350' | 'orange-400' | 'orange-500' | 'orange-600' | 'orange-700'
  | 'orange-800' | 'orange-900'
  // 其他色系（按需使用）
  | 'purple' | 'violet' | 'indigo' | 'wathet' | 'turquoise'
  | 'carmine' | 'yellow' | 'lime' | 'sunflower'
  | string; // 允许扩展

/**
 * 文字大小
 * notation: 最小号（用于步骤描述）
 * normal: 正常大小
 * heading ~ heading-4: 标题级别
 */
export type TextSize =
  | 'notation' | 'xx-small' | 'x-small' | 'small' | 'medium' | 'normal'
  | 'large' | 'x-large' | 'xx-large' | 'xxx-large' | 'xxxx-large'
  | 'heading' | 'heading-0' | 'heading-1' | 'heading-2' | 'heading-3' | 'heading-4';

/**
 * 文字对齐
 */
export type TextAlign = 'left' | 'center' | 'right';
```

#### 5.1.2 元素类型

```typescript
// src/feishu/card-v2/types/elements.ts

import type { Color, TextSize, TextAlign } from './styles';

// ─── 基础接口 ───

export interface BaseElement<T extends string = string> {
  tag: T;
  element_id?: string;
}

export interface BaseContainer<T extends string = string> extends BaseElement<T> {
  elements: Element[];
}

// ─── 文本类元素 ───

/** 纯文本元素 */
export interface PlainTextElement extends BaseElement<'plain_text'> {
  content: string;
  text_size?: TextSize;
  text_color?: Color;
  text_align?: TextAlign;
  lines?: number;
}

/** Markdown 元素 — 飞书原生渲染 Markdown */
export interface MarkdownElement extends BaseElement<'markdown'> {
  content: string;
  icon?: IconElement;
  margin?: string;
  text_size?: TextSize;
  text_align?: TextAlign;
}

// ─── 图标元素 ───

/** 标准图标（飞书内置图标库） */
export interface StandardIconElement extends BaseElement<'standard_icon'> {
  /** 图标 token，如 'robot_outlined'、'search_outlined' 等 */
  token: string;
  color?: Color;
  size?: string;
}

/** 自定义图标（上传图片） */
export interface CustomIconElement extends BaseElement<'custom_icon'> {
  img_key: string;
  size?: string;
}

export type IconElement = StandardIconElement | CustomIconElement;

// ─── 容器元素 ───

/** Div 元素 — 图标 + 文本的基础容器 */
export interface DivElement extends BaseElement<'div'> {
  icon?: IconElement;
  text?: PlainTextElement;
  margin?: string;
  width?: string;
}

/** 可折叠面板 — 步骤展示的核心组件 */
export interface CollapsiblePanel extends BaseContainer<'collapsible_panel'> {
  /** 方向 */
  direction?: 'vertical' | 'horizontal';
  /** 子元素垂直间距 */
  vertical_spacing?: string;
  horizontal_spacing?: string;
  vertical_align?: 'top' | 'center' | 'bottom';
  horizontal_align?: 'left' | 'center' | 'right';
  padding?: string;
  margin?: string;
  /** 是否默认展开。流式时 true，完成时 false */
  expanded?: boolean;
  background_color?: Color;
  /** 边框样式 */
  border?: {
    color?: Color;
    corner_radius?: string;
  };
  /** 面板头部 */
  header: {
    title: PlainTextElement | MarkdownElement;
    background_color?: Color;
    vertical_align?: 'top' | 'center' | 'bottom';
    padding?: string;
    position?: 'top' | 'bottom';
    width?: string;
    icon?: IconElement;
    icon_position?: 'left' | 'right' | 'follow_text';
    /** 展开时图标旋转角度，通常设为 90 */
    icon_expanded_angle?: number;
  };
}

// ─── 元素联合类型 ───

export type Element =
  | CollapsiblePanel
  | DivElement
  | IconElement
  | MarkdownElement
  | PlainTextElement;
```

#### 5.1.3 卡片类型

```typescript
// src/feishu/card-v2/types/card.ts

import type { Element, IconElement, PlainTextElement } from './elements';

/** 卡片配置 */
export interface CardConfig {
  /** 启用流式模式 — 飞书客户端会展示流式动画效果 */
  streaming_mode: boolean;
  /** 宽度模式。fill = 填满容器宽度 */
  width_mode?: 'fill' | 'compact';
  /** 是否允许转发 */
  enable_forward?: boolean;
  /** 转发后是否保留交互 */
  enable_forward_interaction?: boolean;
  /** 使用自定义翻译 */
  use_custom_translation?: boolean;
  /** 消息列表中的摘要预览文本 */
  summary: {
    content: string;
  };
}

/** 卡片头部（可选） */
export interface CardHead {
  icon?: IconElement;
  title: PlainTextElement;
  subtitle?: PlainTextElement;
  template?:
    | 'default' | 'blue' | 'wathet' | 'turquoise' | 'green'
    | 'yellow' | 'orange' | 'red' | 'carmine' | 'violet'
    | 'purple' | 'indigo' | 'grey';
  padding?: string;
}

/** 卡片主体 */
export interface CardBody {
  direction?: 'vertical' | 'horizontal';
  padding?: string;
  horizontal_spacing?: string;
  horizontal_align?: 'left' | 'center' | 'right';
  vertical_spacing?: string;
  elements: Element[];
}

/** 飞书 Interactive Card Schema 2.0 */
export interface Card {
  schema: '2.0';
  config?: CardConfig;
  head?: CardHead;
  body: CardBody;
}
```

#### 5.1.4 导出

```typescript
// src/feishu/card-v2/types/index.ts
export * from './card';
export * from './elements';
export * from './styles';
```

### 5.2 ContentBlock 结构化消息模型

定义 Agent 推理过程中产生的内容块类型。这是连接 Agent 输出和消息渲染的桥梁。

```typescript
// src/types/content-block.ts

import { z } from 'zod';

// ─── Zod Schema 定义 ───

/** 思考过程 */
export const ThinkingBlock = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
});

/** 工具调用 */
export const ToolUseBlock = z.object({
  type: z.literal('tool_use'),
  /** 工具名称，如 'Bash', 'WebSearch', 'SkillExec' 等 */
  name: z.string(),
  /** 调用 ID（Claude API 返回的 tool_use id） */
  id: z.string(),
  /** 工具输入参数 */
  input: z.record(z.string(), z.any()),
});

/** 工具结果（不在卡片中展示，仅用于上下文传递） */
export const ToolResultBlock = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.string(),
});

/** 最终文本回答 */
export const TextBlock = z.object({
  type: z.literal('text'),
  text: z.string(),
});

/** 图片内容 */
export const ImageBlock = z.object({
  type: z.literal('image'),
  image_key: z.string(),
  alt: z.string().optional(),
});

// ─── 联合类型 ───

export const ContentBlock = z.discriminatedUnion('type', [
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  TextBlock,
  ImageBlock,
]);

export type ContentBlock = z.infer<typeof ContentBlock>;
export type ThinkingBlock = z.infer<typeof ThinkingBlock>;
export type ToolUseBlock = z.infer<typeof ToolUseBlock>;
export type ToolResultBlock = z.infer<typeof ToolResultBlock>;
export type TextBlock = z.infer<typeof TextBlock>;
export type ImageBlock = z.infer<typeof ImageBlock>;

/**
 * 可在卡片步骤面板中展示的 ContentBlock 类型
 * tool_result 和 text 不作为步骤展示
 */
export type StepBlock = ThinkingBlock | ToolUseBlock;

/**
 * 判断 block 是否为步骤类型
 */
export function isStepBlock(block: ContentBlock): block is StepBlock {
  return block.type === 'thinking' || block.type === 'tool_use';
}
```

### 5.3 MessageCardRenderer 消息卡片渲染器

这是核心渲染模块，负责将 `ContentBlock[]` 转换为飞书 Card JSON。

#### 5.3.1 工具图标注册表

采用可扩展的注册表模式，支持 Beeclaw 的丰富工具生态。

```typescript
// src/feishu/card-v2/tool-icon-registry.ts

/**
 * 工具图标注册条目
 */
export interface ToolIconEntry {
  /** 飞书 standard_icon token */
  iconToken: string;
  /** 根据工具输入参数生成步骤描述文本 */
  label: (input: Record<string, any>) => string;
}

/**
 * 工具图标注册表
 * 
 * 维护 工具名称 → (图标, 描述文本) 的映射。
 * 支持运行时动态注册新工具图标。
 */
class ToolIconRegistry {
  private _entries = new Map<string, ToolIconEntry>();

  /** 注册单个工具图标 */
  register(toolName: string, entry: ToolIconEntry): this {
    this._entries.set(toolName, entry);
    return this;
  }

  /** 批量注册 */
  registerAll(entries: Record<string, ToolIconEntry>): this {
    for (const [name, entry] of Object.entries(entries)) {
      this._entries.set(name, entry);
    }
    return this;
  }

  /** 获取工具图标条目，未注册返回 undefined */
  get(toolName: string): ToolIconEntry | undefined {
    return this._entries.get(toolName);
  }

  /** 判断是否已注册 */
  has(toolName: string): boolean {
    return this._entries.has(toolName);
  }
}

// ─── 全局单例 ───

const registry = new ToolIconRegistry();

/** 获取全局工具图标注册表 */
export function getToolIconRegistry(): ToolIconRegistry {
  return registry;
}

// ─── 内置工具注册 ───

/** 截断文本，超长时加省略号 */
function truncate(text: string, maxLen: number = 80): string {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

registry.registerAll({
  // ── Claude 内置工具 ──
  'Bash': {
    iconToken: 'computer_outlined',
    label: (i) => truncate(i.description ?? i.command ?? '执行命令'),
  },
  'Read': {
    iconToken: 'file-link-bitable_outlined',
    label: (i) => `读取文件 "${truncate(i.file_path, 60)}"`,
  },
  'Write': {
    iconToken: 'edit_outlined',
    label: (i) => `写入文件 "${truncate(i.file_path, 60)}"`,
  },
  'Edit': {
    iconToken: 'edit_outlined',
    label: (i) => `编辑文件 "${truncate(i.file_path, 60)}"`,
  },
  'MultiEdit': {
    iconToken: 'edit_outlined',
    label: (i) => `批量编辑文件 "${truncate(i.file_path, 60)}"`,
  },
  'Glob': {
    iconToken: 'card-search_outlined',
    label: (i) => `搜索文件 "${truncate(i.pattern, 60)}"`,
  },
  'Grep': {
    iconToken: 'doc-search_outlined',
    label: (i) => {
      const glob = i.glob ? ` 在 "${truncate(i.glob, 30)}"` : '';
      return `搜索文本 "${truncate(i.pattern, 40)}"${glob}`;
    },
  },
  'WebSearch': {
    iconToken: 'search_outlined',
    label: (i) => `搜索 "${truncate(i.query, 60)}"`,
  },
  'WebFetch': {
    iconToken: 'language_outlined',
    label: (i) => `获取网页 "${truncate(i.url, 60)}"`,
  },

  // ── Agentara 兼容 ──
  'Agent': {
    iconToken: 'robot_outlined',
    label: () => '运行子代理',
  },
  'Task': {
    iconToken: 'robot_outlined',
    label: () => '执行任务',
  },
  'Skill': {
    iconToken: 'file-link-mindnote_outlined',
    label: (i) => `加载技能 "${truncate(i.skill, 60)}"`,
  },

  // ── Beeclaw 特有工具 ──
  'SubAgent': {
    iconToken: 'robot_outlined',
    label: (i) => `子代理: ${truncate(i.agent_type ?? i.task ?? '执行子任务', 60)}`,
  },
  'SkillExec': {
    iconToken: 'file-link-mindnote_outlined',
    label: (i) => `执行技能 "${truncate(i.skill ?? i.name ?? '', 40)}"${i.action ? ` - ${i.action}` : ''}`,
  },
  'MCPTool': {
    iconToken: 'setting-inter_outlined',
    label: (i) => {
      const server = i.server ?? 'unknown';
      const tool = i.tool ?? i.name ?? 'unknown';
      return `MCP 工具: ${truncate(`${server}/${tool}`, 60)}`;
    },
  },
  'FeishuAPI': {
    iconToken: 'chat_outlined',
    label: (i) => `飞书 API: ${truncate(i.api ?? i.method ?? '', 60)}`,
  },
  'MemorySearch': {
    iconToken: 'mindnote_outlined',
    label: (i) => `搜索记忆 "${truncate(i.query, 60)}"`,
  },
  'MemoryWrite': {
    iconToken: 'mindnote_outlined',
    label: (i) => `写入记忆: ${truncate(i.key ?? i.content ?? '', 60)}`,
  },
  'FinanceQuery': {
    iconToken: 'chart_outlined',
    label: (i) => `查询财务: ${truncate(i.query ?? i.metric ?? '', 60)}`,
  },
  'CalendarTool': {
    iconToken: 'calendar_outlined',
    label: (i) => `日历操作: ${truncate(i.action ?? '', 60)}`,
  },
  'DocumentTool': {
    iconToken: 'file-link-docx_outlined',
    label: (i) => `文档操作: ${truncate(i.action ?? i.title ?? '', 60)}`,
  },
  'BitableTool': {
    iconToken: 'file-link-bitable_outlined',
    label: (i) => `多维表格: ${truncate(i.action ?? '', 60)}`,
  },
  'DeepAnalysis': {
    iconToken: 'robot_outlined',
    label: (i) => `深度分析: ${truncate(i.topic ?? i.query ?? '', 60)}`,
  },
});
```

#### 5.3.2 消息卡片渲染器

```typescript
// src/feishu/card-v2/message-renderer.ts

import type { ContentBlock } from '../../types/content-block';
import { isStepBlock } from '../../types/content-block';
import type {
  Card,
  CollapsiblePanel,
  DivElement,
  MarkdownElement,
  PlainTextElement,
  StandardIconElement,
} from './types';
import { getToolIconRegistry } from './tool-icon-registry';

// ─── 配置 ───

export interface RenderOptions {
  /** 是否处于流式推理中 */
  streaming: boolean;
  /** 语言。默认 'zh-CN' */
  locale?: 'zh-CN' | 'en';
  /** 最终回答最大长度（字符），超出会被截断。默认 20000 */
  maxAnswerLength?: number;
  /** 步骤文本最大长度。默认 100 */
  maxStepTextLength?: number;
}

// ─── 主渲染函数 ───

/**
 * 将 ContentBlock 数组渲染为飞书 Interactive Card Schema 2.0 JSON。
 *
 * 这是一个**纯函数**：相同的输入总是产生相同的输出，没有副作用。
 *
 * @param contentBlocks - Agent 推理过程中累积的 content 数组
 * @param options - 渲染选项
 * @returns 可直接作为飞书 API 的 content 参数的 Card 对象
 *
 * @example
 * ```typescript
 * const card = renderMessageCard(blocks, { streaming: true });
 * await client.im.message.reply({
 *   path: { message_id: incomingId },
 *   data: {
 *     msg_type: 'interactive',
 *     content: JSON.stringify(card),
 *     reply_in_thread: true,
 *   },
 * });
 * ```
 */
export function renderMessageCard(
  contentBlocks: ContentBlock[],
  options: RenderOptions,
): Card {
  const {
    streaming,
    locale = 'zh-CN',
    maxAnswerLength = 20000,
    maxStepTextLength = 100,
  } = options;

  const isZh = locale === 'zh-CN';

  // 1. 创建步骤面板
  const stepPanel = createStepPanel(streaming);

  // 2. 创建卡片骨架
  const card: Card = {
    schema: '2.0',
    config: {
      streaming_mode: true,
      enable_forward: true,
      enable_forward_interaction: false,
      width_mode: 'fill',
      summary: { content: '' },
    },
    body: {
      elements: [stepPanel],
    },
  };

  // 3. 遍历 content blocks，填充步骤面板
  for (const block of contentBlocks) {
    if (block.type === 'thinking') {
      const text = truncateText(block.thinking, maxStepTextLength);
      stepPanel.elements.push(
        createStepElement(text, 'robot_outlined'),
      );
    } else if (block.type === 'tool_use') {
      const stepEl = renderToolUseStep(block.name, block.input, maxStepTextLength);
      stepPanel.elements.push(stepEl);
    }
    // text, tool_result, image 不作为步骤展示
  }

  // 4. 非流式时，添加最终回答
  if (!streaming) {
    const lastTextBlock = findLastTextBlock(contentBlocks);
    if (lastTextBlock) {
      const answerText = lastTextBlock.text.length > maxAnswerLength
        ? lastTextBlock.text.slice(0, maxAnswerLength) + '\n\n> ⚠️ 内容过长，已截断显示'
        : lastTextBlock.text;

      const resultElement: MarkdownElement = {
        tag: 'markdown',
        content: answerText,
      };
      card.body.elements.push(resultElement);

      // 设置摘要（消息列表预览）
      card.config!.summary.content = truncateText(
        lastTextBlock.text.replace(/[#*`\[\]]/g, ''), // 去除 Markdown 标记
        200,
      );
    }
  }

  // 5. 更新步骤面板头部文本
  const stepCount = stepPanel.elements.length;
  if (stepCount > 0) {
    const stepCountText = isZh
      ? `${stepCount} 个步骤`
      : `${stepCount} ${stepCount === 1 ? 'step' : 'steps'}`;

    if (streaming) {
      stepPanel.header.title = createPlainText(
        isZh ? `正在处理 (${stepCountText})` : `Working on it (${stepCountText})`,
        'grey',
        'notation',
      );
      card.config!.summary.content = isZh
        ? `正在处理 (${stepCountText})`
        : `Working on it (${stepCountText})`;
    } else {
      stepPanel.header.title = createPlainText(
        isZh ? `查看 ${stepCountText}` : `Show ${stepCountText}`,
        'grey',
        'notation',
      );
    }
  } else {
    // 没有步骤，移除空面板
    card.body.elements.splice(0, 1);
    // 确保卡片不为空（飞书 API 要求至少一个元素）
    if (card.body.elements.length === 0) {
      card.body.elements.push({
        tag: 'div',
        text: createPlainText(''),
      } as DivElement);
    }
  }

  // 6. 流式模式添加加载指示器
  if (streaming) {
    card.body.elements.push({
      tag: 'div',
      icon: {
        tag: 'standard_icon',
        token: 'more_outlined',
        color: 'grey',
      } as StandardIconElement,
    } as DivElement);
  }

  return card;
}

// ─── 辅助函数 ───

/** 创建步骤面板骨架 */
function createStepPanel(expanded: boolean): CollapsiblePanel {
  return {
    tag: 'collapsible_panel',
    expanded,
    border: {
      color: 'grey-300',
      corner_radius: '6px',
    },
    vertical_spacing: '2px',
    header: {
      title: createPlainText('', 'grey', 'notation'),
      icon: {
        tag: 'standard_icon',
        token: 'right_outlined',
        color: 'grey',
      } as StandardIconElement,
      icon_position: 'right',
      icon_expanded_angle: 90,
    },
    elements: [],
  };
}

/** 创建步骤元素（图标 + 文本） */
function createStepElement(text: string, iconToken: string): DivElement {
  return {
    tag: 'div',
    icon: {
      tag: 'standard_icon',
      token: iconToken,
      color: 'grey',
    } as StandardIconElement,
    text: createPlainText(text, 'grey', 'notation'),
  };
}

/** 创建纯文本元素 */
function createPlainText(
  content: string,
  color?: string,
  textSize?: string,
): PlainTextElement {
  const el: PlainTextElement = {
    tag: 'plain_text',
    content,
  };
  if (color) el.text_color = color;
  if (textSize) el.text_size = textSize as any;
  return el;
}

/** 渲染工具调用步骤 */
function renderToolUseStep(
  toolName: string,
  input: Record<string, any>,
  maxLen: number,
): DivElement {
  const registry = getToolIconRegistry();
  const entry = registry.get(toolName);

  if (entry) {
    const label = truncateText(entry.label(input), maxLen);
    return createStepElement(label, entry.iconToken);
  }

  // 未注册的工具使用通用图标
  return createStepElement(toolName, 'setting-inter_outlined');
}

/** 找到最后一个 text 类型的 block */
function findLastTextBlock(
  blocks: ContentBlock[],
): { type: 'text'; text: string } | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'text') {
      return blocks[i] as { type: 'text'; text: string };
    }
  }
  return undefined;
}

/** 截断文本 */
function truncateText(text: string, maxLen: number): string {
  if (!text) return '';
  // 移除换行，合并为单行
  const singleLine = text.replace(/\n+/g, ' ').trim();
  return singleLine.length > maxLen
    ? singleLine.slice(0, maxLen) + '...'
    : singleLine;
}
```

### 5.4 StreamingMessageController 流式消息控制器

管理一条飞书消息从创建到完成的完整生命周期，包含 API 节流保护。

```typescript
// src/feishu/card-v2/streaming-controller.ts

import type { Client } from '@larksuiteoapi/node-sdk';
import type { ContentBlock } from '../../types/content-block';
import type { Card } from './types';
import { renderMessageCard, type RenderOptions } from './message-renderer';
import { getLogger } from '../../utils/logger';

const logger = getLogger('feishu:streaming');

// ─── 配置 ───

export interface StreamingControllerOptions {
  /** 飞书 Client 实例 */
  client: Client;
  /** 回复的目标消息 ID */
  replyToMessageId: string;
  /** 流式更新节流时间（ms）。默认 500 */
  throttleMs?: number;
  /** 渲染选项 */
  renderOptions?: Partial<Omit<RenderOptions, 'streaming'>>;
  /** 是否使用话题回复。默认 true */
  replyInThread?: boolean;
}

// ─── 控制器状态 ───

type ControllerState = 'idle' | 'active' | 'finishing' | 'finished' | 'error';

// ─── 主类 ───

/**
 * 流式消息控制器
 *
 * 管理一条飞书消息的完整生命周期：
 * 1. 首次 pushContent → 创建消息（im.message.reply）
 * 2. 后续 pushContent → 节流更新（im.message.patch）
 * 3. finish() → 最终渲染（im.message.patch with streaming=false）
 *
 * 线程安全：所有操作通过内部 Promise 链串行化，防止并发 API 调用。
 *
 * @example
 * ```typescript
 * const ctrl = new StreamingMessageController({
 *   client: feishuClient,
 *   replyToMessageId: incomingMessage.message_id,
 * });
 *
 * // Agent 推理过程中
 * await ctrl.pushContent({ type: 'thinking', thinking: '分析问题...' });
 * await ctrl.pushContent({ type: 'tool_use', name: 'WebSearch', id: '1', input: { query: 'xxx' } });
 * await ctrl.pushContent({ type: 'text', text: '最终回答...' });
 *
 * // 推理完成
 * await ctrl.finish();
 * ```
 */
export class StreamingMessageController {
  private _client: Client;
  private _replyToMessageId: string;
  private _throttleMs: number;
  private _renderOptions: Partial<Omit<RenderOptions, 'streaming'>>;
  private _replyInThread: boolean;

  // 状态
  private _state: ControllerState = 'idle';
  private _messageId: string | null = null;
  private _threadId: string | null = null;
  private _contentBlocks: ContentBlock[] = [];

  // 节流控制
  private _throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingUpdate = false;

  // 串行化 Promise 链
  private _operationChain: Promise<void> = Promise.resolve();

  // 统计
  private _patchCount = 0;
  private _startTime = 0;

  constructor(options: StreamingControllerOptions) {
    this._client = options.client;
    this._replyToMessageId = options.replyToMessageId;
    this._throttleMs = options.throttleMs ?? 500;
    this._renderOptions = options.renderOptions ?? {};
    this._replyInThread = options.replyInThread ?? true;
  }

  // ─── 公共属性 ───

  /** 当前消息 ID（创建后可用） */
  get messageId(): string | null {
    return this._messageId;
  }

  /** 话题 ID（创建后可用，仅 replyInThread=true 时有值） */
  get threadId(): string | null {
    return this._threadId;
  }

  /** 控制器状态 */
  get state(): ControllerState {
    return this._state;
  }

  /** 累积的 content blocks */
  get contentBlocks(): readonly ContentBlock[] {
    return this._contentBlocks;
  }

  // ─── 公共方法 ───

  /**
   * 追加一个 content block 并触发消息更新。
   *
   * 首次调用会创建消息，后续调用通过节流机制更新。
   * 调用是幂等安全的：finish 后再调用会被忽略。
   *
   * @param block - 要追加的 ContentBlock
   */
  async pushContent(block: ContentBlock): Promise<void> {
    if (this._state === 'finished' || this._state === 'error') {
      logger.warn(`pushContent called on ${this._state} controller, ignoring`);
      return;
    }

    this._contentBlocks.push(block);

    if (this._state === 'idle') {
      // 首次内容：创建消息
      this._state = 'active';
      this._startTime = Date.now();
      await this._enqueue(() => this._createMessage());
    } else if (this._state === 'active') {
      // 后续内容：节流更新
      this._scheduleThrottledUpdate();
    }
  }

  /**
   * 完成流式推理，发送最终卡片。
   *
   * 会清除所有待执行的节流更新，然后发送 streaming=false 的最终卡片。
   * 调用后控制器进入 finished 状态，不再接受新的 pushContent。
   */
  async finish(): Promise<void> {
    if (this._state === 'finished') return;

    this._state = 'finishing';
    this._clearThrottle();

    if (this._messageId) {
      await this._enqueue(() => this._updateMessage(false));
    }

    this._state = 'finished';
    const elapsed = Date.now() - this._startTime;
    logger.info(
      `✅ Streaming finished: ${this._messageId} | ` +
      `${this._contentBlocks.length} blocks, ${this._patchCount} patches, ${elapsed}ms`,
    );
  }

  /**
   * 发送错误状态的最终卡片。
   *
   * 在最终文本中追加错误信息，然后调用 finish。
   *
   * @param errorMessage - 错误描述文本
   */
  async error(errorMessage: string): Promise<void> {
    this._contentBlocks.push({
      type: 'text',
      text: `⚠️ 处理过程中发生错误: ${errorMessage}`,
    });

    try {
      await this.finish();
    } catch {
      this._state = 'error';
      logger.error(`Failed to send error card for ${this._messageId}`);
    }
  }

  /**
   * 降级发送：当 Card 失败时，使用纯文本回复。
   *
   * @param text - 纯文本内容
   */
  async fallbackToText(text: string): Promise<void> {
    try {
      await this._client.im.message.reply({
        path: { message_id: this._replyToMessageId },
        data: {
          msg_type: 'post',
          content: JSON.stringify({
            zh_cn: {
              content: [[{ tag: 'md', text }]],
            },
          }),
        },
      });
      this._state = 'finished';
      logger.info(`Fallback to post message for ${this._replyToMessageId}`);
    } catch (err) {
      this._state = 'error';
      logger.error('Fallback message also failed:', err);
      throw err;
    }
  }

  // ─── 内部方法 ───

  /** 将操作加入串行化队列 */
  private async _enqueue(operation: () => Promise<void>): Promise<void> {
    this._operationChain = this._operationChain.then(operation, (err) => {
      logger.error('Operation chain error:', err);
      return operation();
    });
    await this._operationChain;
  }

  /** 创建初始回复消息 */
  private async _createMessage(): Promise<void> {
    try {
      const card = this._renderCard(true);

      const response = await this._client.im.message.reply({
        path: { message_id: this._replyToMessageId },
        data: {
          msg_type: 'interactive',
          content: JSON.stringify(card),
          ...(this._replyInThread ? { reply_in_thread: true } : {}),
        },
      });

      if (response.code !== 0) {
        throw new Error(`Feishu API error ${response.code}: ${response.msg}`);
      }

      this._messageId = response.data?.message_id ?? null;
      this._threadId = (response.data as any)?.thread_id ?? null;

      logger.info(`📨 Streaming message created: ${this._messageId}`);
    } catch (err) {
      logger.error('Failed to create streaming message:', err);
      // 尝试降级
      const lastText = this._contentBlocks.find(b => b.type === 'text');
      if (lastText && lastText.type === 'text') {
        await this.fallbackToText(lastText.text);
      }
      throw err;
    }
  }

  /** 更新消息内容 */
  private async _updateMessage(streaming: boolean): Promise<void> {
    if (!this._messageId) return;

    try {
      const card = this._renderCard(streaming);

      await this._client.im.message.patch({
        path: { message_id: this._messageId },
        data: { content: JSON.stringify(card) },
      });

      this._patchCount++;
    } catch (err: any) {
      // message.patch 失败不应中断推理流程
      if (err?.code === 230011 || err?.code === 231003) {
        // 消息已被撤回，标记为错误状态
        logger.warn(`Message ${this._messageId} was withdrawn, stopping updates`);
        this._state = 'error';
        return;
      }
      logger.warn(`Patch failed (${this._patchCount + 1}th attempt): ${err?.message}`);
    }
  }

  /** 渲染卡片 */
  private _renderCard(streaming: boolean): Card {
    return renderMessageCard(this._contentBlocks, {
      streaming,
      ...this._renderOptions,
    });
  }

  /** 调度节流更新 */
  private _scheduleThrottledUpdate(): void {
    if (this._state !== 'active') return;

    this._pendingUpdate = true;

    // 如果已有定时器在等待，不重复创建
    if (this._throttleTimer) return;

    this._throttleTimer = setTimeout(async () => {
      this._throttleTimer = null;

      if (this._pendingUpdate && this._state === 'active') {
        this._pendingUpdate = false;
        await this._enqueue(() => this._updateMessage(true));
      }
    }, this._throttleMs);
  }

  /** 清除节流定时器 */
  private _clearThrottle(): void {
    if (this._throttleTimer) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = null;
    }
    this._pendingUpdate = false;
  }
}
```

### 5.5 Session 处理流程改造

#### 5.5.1 改造目标

将 `_sendProactiveMessageInternal()` 中的 `agent.chat()` 同步调用改为流式调用，并在推理过程中实时更新飞书卡片。

#### 5.5.2 前置条件

Beeclaw 的 `createAgent()` 需要支持流式输出。如果当前 Agent 不支持 streaming，需要先添加 `agent.chatStream()` 方法（或使用 Anthropic SDK 的 `messages.stream()` API）。

#### 5.5.3 改造方案

```typescript
// src/session/streaming-handler.ts

import type { Client } from '@larksuiteoapi/node-sdk';
import Anthropic from '@anthropic-ai/sdk';
import type { ContentBlock } from '../types/content-block';
import { StreamingMessageController } from '../feishu/card-v2';
import { getLogger } from '../utils/logger';

const logger = getLogger('session:streaming');

/**
 * 流式消息处理选项
 */
export interface StreamingHandlerOptions {
  /** 飞书 Client */
  feishuClient: Client;
  /** 用户发来的消息 ID（用于回复） */
  incomingMessageId: string;
  /** Anthropic Client */
  anthropicClient: Anthropic;
  /** 模型名称 */
  model: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 对话历史 */
  messages: Anthropic.Messages.MessageParam[];
  /** 可用工具 */
  tools?: Anthropic.Messages.Tool[];
  /** 最大 token */
  maxTokens?: number;
  /** 是否使用话题回复 */
  replyInThread?: boolean;
}

/**
 * 流式消息处理结果
 */
export interface StreamingHandlerResult {
  /** 是否成功 */
  success: boolean;
  /** AI 最终回答文本 */
  responseText: string;
  /** 飞书消息 ID */
  messageId: string | null;
  /** 话题 ID */
  threadId: string | null;
  /** 推理过程中收集的所有 content blocks */
  contentBlocks: ContentBlock[];
  /** 错误信息 */
  error?: string;
}

/**
 * 处理一次完整的 Agent 流式交互。
 *
 * 流程：
 * 1. 创建 StreamingMessageController
 * 2. 调用 Anthropic streaming API
 * 3. 解析 stream events → pushContent
 * 4. 处理 tool_use → 执行工具 → 追加 tool_result → 继续对话
 * 5. 获取最终 text → finish
 *
 * 支持多轮工具调用（agentic loop）。
 */
export async function handleStreamingMessage(
  options: StreamingHandlerOptions,
): Promise<StreamingHandlerResult> {
  const {
    feishuClient,
    incomingMessageId,
    anthropicClient,
    model,
    systemPrompt,
    messages,
    tools,
    maxTokens = 8192,
    replyInThread = true,
  } = options;

  // 1. 创建流式控制器
  const ctrl = new StreamingMessageController({
    client: feishuClient,
    replyToMessageId: incomingMessageId,
    replyInThread,
  });

  const allBlocks: ContentBlock[] = [];
  let finalText = '';

  try {
    // 2. Agentic loop — 支持多轮工具调用
    let currentMessages = [...messages];
    let shouldContinue = true;

    while (shouldContinue) {
      shouldContinue = false;

      // 3. 调用 Anthropic streaming API
      const stream = anthropicClient.messages.stream({
        model,
        system: systemPrompt,
        messages: currentMessages,
        max_tokens: maxTokens,
        ...(tools && tools.length > 0 ? { tools } : {}),
      });

      const response = await stream.finalMessage();

      // 4. 处理 response content blocks
      const toolUseBlocks: Array<{ id: string; name: string; input: any }> = [];

      for (const block of response.content) {
        if (block.type === 'thinking' && 'thinking' in block) {
          const thinkingBlock: ContentBlock = {
            type: 'thinking',
            thinking: String(block.thinking),
          };
          allBlocks.push(thinkingBlock);
          await ctrl.pushContent(thinkingBlock);
        } else if (block.type === 'tool_use') {
          const toolBlock: ContentBlock = {
            type: 'tool_use',
            name: block.name,
            id: block.id,
            input: block.input as Record<string, any>,
          };
          allBlocks.push(toolBlock);
          await ctrl.pushContent(toolBlock);

          toolUseBlocks.push({
            id: block.id,
            name: block.name,
            input: block.input,
          });
        } else if (block.type === 'text') {
          finalText = block.text;
          const textBlock: ContentBlock = {
            type: 'text',
            text: block.text,
          };
          allBlocks.push(textBlock);
          await ctrl.pushContent(textBlock);
        }
      }

      // 5. 如果有工具调用，执行工具并继续
      if (toolUseBlocks.length > 0 && response.stop_reason === 'tool_use') {
        // 追加 assistant 消息
        currentMessages.push({
          role: 'assistant',
          content: response.content,
        });

        // 执行工具并收集结果
        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
        for (const toolUse of toolUseBlocks) {
          try {
            // 注意：这里需要接入 Beeclaw 的工具执行系统
            // 具体实现依赖于 Beeclaw 的 tool dispatcher
            const result = await executeToolInBeeclaw(toolUse.name, toolUse.input);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: typeof result === 'string' ? result : JSON.stringify(result),
            });
          } catch (err: any) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Error: ${err.message}`,
              is_error: true,
            });
          }
        }

        // 追加 tool results
        currentMessages.push({
          role: 'user',
          content: toolResults,
        });

        shouldContinue = true; // 继续下一轮
      }
    }

    // 6. 完成
    await ctrl.finish();

    return {
      success: true,
      responseText: finalText,
      messageId: ctrl.messageId,
      threadId: ctrl.threadId,
      contentBlocks: allBlocks,
    };
  } catch (err: any) {
    logger.error('Streaming handler error:', err);

    try {
      await ctrl.error(err.message || String(err));
    } catch {
      // 连错误卡片都发不出去，尝试纯文本降级
      if (finalText) {
        await ctrl.fallbackToText(finalText);
      }
    }

    return {
      success: false,
      responseText: finalText,
      messageId: ctrl.messageId,
      threadId: ctrl.threadId,
      contentBlocks: allBlocks,
      error: err.message,
    };
  }
}

/**
 * 执行 Beeclaw 工具
 * 
 * TODO: 接入 Beeclaw 现有的工具执行系统
 * 这里是一个占位实现，需要根据 Beeclaw 的 tools 模块进行适配
 */
async function executeToolInBeeclaw(
  toolName: string,
  input: Record<string, any>,
): Promise<string> {
  // 这里需要根据 Beeclaw 的实际工具系统进行实现
  // 可能的接入方式：
  // 1. 直接调用 src/tools/ 下的对应工具函数
  // 2. 通过 MCP Client 调用
  // 3. 通过 SkillStore 执行
  throw new Error(`Tool execution not yet integrated: ${toolName}`);
}
```

#### 5.5.4 Session 集成点

在 `src/session/index.ts` 的 `_sendProactiveMessageInternal()` 中替换 `agent.chat()` 调用：

```typescript
// src/session/index.ts — 改造部分（伪代码，展示关键变更）

import { handleStreamingMessage } from './streaming-handler';
import { getConfig } from '../config';

async function _sendProactiveMessageInternal(
  options: ProactiveMessageOptions,
): Promise<ProactiveMessageResult> {
  // ... 现有的 session 获取逻辑不变 ...

  const config = getConfig();
  const useStreamingCard = config.feishu?.useStreamingCard ?? true;

  if (useStreamingCard && options.channel === 'feishu' && options.context?.messageId) {
    // ─── 新路径：流式卡片 ───
    const result = await handleStreamingMessage({
      feishuClient: getFeishuClient(),
      incomingMessageId: options.context.messageId as string,
      anthropicClient: getAnthropicClient(),
      model: agentConfig!.model,
      systemPrompt: buildSystemPrompt(session, agentConfig!),
      messages: buildMessages(session),
      tools: getAllToolsForAI(),
      replyInThread: true,
    });

    // 更新 session
    session.messages.push({
      role: 'assistant',
      content: result.responseText,
      timestamp: new Date().toISOString(),
    });
    saveSession(session);

    if (result.success) {
      confirmDelivery(session.id);
    }

    return {
      success: result.success,
      sessionId: session.id,
      response: result.responseText,
      error: result.error,
    };
  } else {
    // ─── 旧路径：保持不变 ───
    // 现有的 agent.chat() → channelHandler() 逻辑
    // ...
  }
}
```

### 5.6 话题（Thread）会话管理

#### 5.6.1 Thread → Session 映射

当使用 `reply_in_thread: true` 回复消息时，飞书会创建一个话题（Thread）。同一话题内的后续消息会携带 `thread_id`。需要将 `thread_id` 映射到 Beeclaw 的 `sessionId`。

```typescript
// src/feishu/thread-manager.ts

import { getLogger } from '../utils/logger';

const logger = getLogger('feishu:thread');

/**
 * Thread → Session 映射管理器
 * 
 * 当前使用内存 Map + JSON 文件持久化。
 * 后续 RFC-03（SQLite + Drizzle）实施后，迁移到 DB 持久化。
 */
class ThreadManager {
  private _threadToSession = new Map<string, string>();
  private _persistPath: string;
  private _dirty = false;
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(persistPath: string = './data/feishu-threads.json') {
    this._persistPath = persistPath;
    this._load();
  }

  /** 建立 thread → session 映射 */
  map(threadId: string, sessionId: string): void {
    this._threadToSession.set(threadId, sessionId);
    this._markDirty();
    logger.debug(`Thread ${threadId} → Session ${sessionId}`);
  }

  /** 通过 thread_id 解析 session_id */
  resolve(threadId: string | undefined): string | undefined {
    if (!threadId) return undefined;
    return this._threadToSession.get(threadId);
  }

  /** 获取映射数量 */
  get size(): number {
    return this._threadToSession.size;
  }

  // ─── 持久化 ───

  private _load(): void {
    try {
      const { existsSync, readFileSync } = require('fs');
      if (existsSync(this._persistPath)) {
        const data = JSON.parse(readFileSync(this._persistPath, 'utf-8'));
        if (typeof data === 'object') {
          for (const [k, v] of Object.entries(data)) {
            if (typeof v === 'string') {
              this._threadToSession.set(k, v);
            }
          }
          logger.info(`Loaded ${this._threadToSession.size} thread mappings`);
        }
      }
    } catch (err) {
      logger.warn('Failed to load thread mappings:', err);
    }
  }

  private _markDirty(): void {
    this._dirty = true;
    if (this._saveTimer) return;
    // 延迟 2 秒批量写入
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (this._dirty) {
        this._save();
        this._dirty = false;
      }
    }, 2000);
  }

  private _save(): void {
    try {
      const { writeFileSync, mkdirSync } = require('fs');
      const { dirname } = require('path');
      mkdirSync(dirname(this._persistPath), { recursive: true });
      const data = Object.fromEntries(this._threadToSession);
      writeFileSync(this._persistPath, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.error('Failed to save thread mappings:', err);
    }
  }
}

// 全局单例
let instance: ThreadManager | null = null;

export function getThreadManager(): ThreadManager {
  if (!instance) {
    instance = new ThreadManager();
  }
  return instance;
}
```

#### 5.6.2 入站消息处理

在飞书 WebSocket 消息接收处理中，需要从 `thread_id` 解析 `sessionId`：

```typescript
// src/feishu/ws-client.ts — 改造部分

import { getThreadManager } from './thread-manager';

// 在 im.message.receive_v1 事件处理中：
function handleMessageReceive(event: MessageReceiveEvent) {
  const { message_id, thread_id, chat_id } = event.message;
  const threadManager = getThreadManager();

  // 优先通过 thread_id 解析 session
  let sessionId = threadManager.resolve(thread_id);

  if (!sessionId) {
    // 没有映射，使用原有的 sessionId 生成逻辑
    sessionId = generateSessionId('feishu', event.sender.sender_id.open_id);
  }

  // 继续现有的消息处理流程，但传入正确的 sessionId
  // ...
}
```

---

## 6. 完整代码实现

### 6.1 模块导出

```typescript
// src/feishu/card-v2/index.ts

// 类型导出
export type {
  Card,
  CardConfig,
  CardHead,
  CardBody,
} from './types/card';

export type {
  Element,
  BaseElement,
  BaseContainer,
  PlainTextElement,
  MarkdownElement,
  StandardIconElement,
  CustomIconElement,
  IconElement,
  DivElement,
  CollapsiblePanel,
} from './types/elements';

export type {
  Color,
  TextSize,
  TextAlign,
} from './types/styles';

// 功能导出
export {
  renderMessageCard,
  type RenderOptions,
} from './message-renderer';

export {
  StreamingMessageController,
  type StreamingControllerOptions,
} from './streaming-controller';

export {
  getToolIconRegistry,
  type ToolIconEntry,
} from './tool-icon-registry';
```

### 6.2 配置项

```typescript
// src/config/schema.ts — 新增配置项

export interface FeishuMessageConfig {
  /**
   * 是否启用流式卡片消息。
   * 设为 false 时使用旧的消息发送方式。
   * @default true
   */
  useStreamingCard: boolean;

  /**
   * 流式更新节流时间（毫秒）。
   * 飞书 message.patch API 有 QPS 限制，建议不低于 300ms。
   * @default 500
   */
  streamThrottleMs: number;

  /**
   * 是否使用话题回复。
   * 启用后同一 session 的消息会聚合在话题中。
   * @default true
   */
  replyInThread: boolean;

  /**
   * 步骤描述语言。
   * @default 'zh-CN'
   */
  locale: 'zh-CN' | 'en';

  /**
   * 最终回答最大字符数。
   * 飞书 Card content 限制约 28KB，建议不超过 20000 字符。
   * @default 20000
   */
  maxAnswerLength: number;
}

// 默认配置
export const DEFAULT_FEISHU_MESSAGE_CONFIG: FeishuMessageConfig = {
  useStreamingCard: true,
  streamThrottleMs: 500,
  replyInThread: true,
  locale: 'zh-CN',
  maxAnswerLength: 20000,
};
```

---

## 7. 迁移方案

### 7.1 分阶段实施计划

| 阶段 | 内容 | 工期 | 风险等级 |
|------|------|------|---------|
| **Phase 1: 基础模块** | 类型系统 + 渲染器 + 工具注册表 | 2 天 | 低 |
| **Phase 2: 流式控制器** | StreamingMessageController + 节流 | 2 天 | 中 |
| **Phase 3: 话题管理** | ThreadManager + 入站消息适配 | 1 天 | 低 |
| **Phase 4: Session 集成** | streaming-handler + session 改造 | 3 天 | 高 |
| **Phase 5: 测试 & 调优** | 单测 + 集成测试 + 效果调优 | 2 天 | 中 |
| **Phase 6: 灰度上线** | 配置开关 + 部分用户测试 | 持续 | 中 |

### 7.2 Phase 1: 基础模块（Day 1-2）

**任务清单**：

1. 创建 `src/types/content-block.ts`
2. 创建 `src/feishu/card-v2/types/` 目录及所有类型文件
3. 创建 `src/feishu/card-v2/tool-icon-registry.ts`
4. 创建 `src/feishu/card-v2/message-renderer.ts`
5. 创建 `src/feishu/card-v2/index.ts`
6. 编写 `message-renderer` 单元测试

**验证方式**：
```typescript
// 单元测试验证渲染输出
const card = renderMessageCard([
  { type: 'thinking', thinking: '分析用户问题...' },
  { type: 'tool_use', name: 'WebSearch', id: '1', input: { query: 'TypeScript patterns' } },
  { type: 'text', text: '# 结论\n\n这是最终回答' },
], { streaming: false });

assert(card.schema === '2.0');
assert(card.config?.streaming_mode === true);
assert(card.body.elements[0].tag === 'collapsible_panel');
assert(card.body.elements[1].tag === 'markdown');
```

### 7.3 Phase 2: 流式控制器（Day 3-4）

**任务清单**：

1. 创建 `src/feishu/card-v2/streaming-controller.ts`
2. 编写单元测试（mock 飞书 Client）
3. 手动测试：构造假数据 → 发送到测试群 → 验证卡片效果

**注意事项**：
- 需要一个飞书测试群和测试 Bot
- 节流时间可能需要根据实际 QPS 限制调整
- `message.patch` 的 content 大小限制需要实际验证

### 7.4 Phase 3: 话题管理（Day 5）

**任务清单**：

1. 创建 `src/feishu/thread-manager.ts`
2. 修改 `src/feishu/ws-client.ts`，添加 `thread_id` 解析逻辑
3. 验证话题内连续对话的 session 连续性

### 7.5 Phase 4: Session 集成（Day 6-8）

**任务清单**：

1. 创建 `src/session/streaming-handler.ts`
2. 修改 `src/session/index.ts`，添加流式路径
3. 添加配置项 `feishu.useStreamingCard`
4. 接入 Beeclaw 工具执行系统（`executeToolInBeeclaw`）
5. 端到端测试

**风险点**：
- `agent.chatStream()` 如果不存在，需要先实现
- 工具执行的接入可能涉及较多适配工作
- 需要确保旧路径仍然可用

### 7.6 回退方案

```typescript
// 一键回退：在配置中设置
{
  "feishu": {
    "useStreamingCard": false  // 关闭流式卡片，回到旧模式
  }
}
```

回退不影响：
- 现有的 `sendTextMessage`、`sendPostMessage` 等函数完全保留
- `CardBuilder` 和旧版卡片构建函数不受影响
- Session 持久化格式不变

---

## 8. 测试方案

### 8.1 单元测试

| 测试模块 | 测试项 | 覆盖目标 |
|---------|--------|---------|
| `message-renderer` | 纯 thinking blocks | 只有步骤面板，无最终回答 |
| `message-renderer` | 纯 text block | 只有最终回答，无步骤面板 |
| `message-renderer` | thinking + tool_use + text 混合 | 完整卡片结构 |
| `message-renderer` | streaming=true 时无最终回答 | 步骤面板展开 + 加载指示器 |
| `message-renderer` | streaming=false 时步骤面板折叠 | expanded=false |
| `message-renderer` | 空 contentBlocks | 不崩溃，返回有效卡片 |
| `message-renderer` | 超长文本截断 | 步骤 100 字、回答 20000 字 |
| `message-renderer` | 未注册工具名 | 使用通用图标 |
| `tool-icon-registry` | 所有内置工具 | 图标和描述正确 |
| `tool-icon-registry` | 动态注册 | register 后立即可用 |
| `streaming-controller` | 生命周期 | idle → active → finishing → finished |
| `streaming-controller` | finish 后 pushContent | 被忽略，不报错 |
| `streaming-controller` | error 降级 | 发送错误卡片 |
| `streaming-controller` | fallbackToText | 降级到 post 消息 |
| `content-block` | Zod 验证 | 合法/非法输入 |

### 8.2 集成测试

| 测试场景 | 验证要点 |
|---------|---------|
| 简单对话 | 无工具调用，直接 Markdown 回答 |
| 搜索 + 回答 | thinking → WebSearch → text 流式展示 |
| 多工具串联 | Bash → Read → Write 连续调用展示 |
| 超长回答 | 卡片大小 < 28KB，文本正确截断 |
| 话题连续对话 | 第二条消息在同一话题内，session 连续 |
| 消息撤回场景 | patch 返回 230011 时优雅终止 |
| 并发消息 | 同一 session 两条消息，串行处理不冲突 |
| 网络抖动 | patch 偶发失败不影响最终结果 |

### 8.3 性能基准

| 指标 | 目标值 | 测量方式 |
|------|--------|---------|
| 首条消息延迟 | < 1s（从用户发送到卡片出现） | 端到端计时 |
| 流式更新间隔 | 500ms ± 50ms | Controller 日志 |
| 最终渲染延迟 | < 200ms（finish → patch 完成） | Controller 日志 |
| 单卡片 JSON 大小 | < 20KB（典型场景） | JSON.stringify 测量 |
| 内存占用增量 | < 5MB / session | 进程内存监控 |

---

## 9. 风险评估与缓解

| 风险 | 严重度 | 概率 | 缓解措施 |
|------|--------|------|---------|
| 飞书 `message.patch` QPS 限流 | 高 | 中 | 500ms 节流 + 退避到 1000ms + 失败不中断 |
| Card JSON 超过 28KB 大小限制 | 中 | 低 | 步骤文本截断 100 字 + 回答截断 20000 字 + 超限降级为 post |
| `collapsible_panel` 在旧版飞书客户端不支持 | 中 | 低 | 飞书会自动降级渲染，不影响功能 |
| `reply_in_thread` 改变现有交互模式 | 中 | 中 | 通过配置开关控制，灰度上线观察 |
| `agent.chatStream()` 不存在 | 高 | 取决于现状 | Phase 4 开始前确认，必要时先实现 streaming 接口 |
| 工具执行接入复杂 | 中 | 高 | `executeToolInBeeclaw` 分步接入，先支持核心工具 |
| 消息被撤回导致 patch 失败循环 | 低 | 低 | 检测 230011/231003 错误码，立即停止更新 |
| 内存泄漏（Controller 未正确释放） | 中 | 低 | finish/error 后清除定时器和引用 |
| 话题映射文件损坏 | 低 | 低 | 后续迁移到 SQLite（RFC-03）后消除；当前损坏时重建 |

---

## 10. 附录

### 10.1 飞书 Standard Icon Token 速查表

以下是本方案使用的图标及其视觉效果对照：

| Token | 用途 | 视觉描述 |
|-------|------|---------|
| `robot_outlined` | Thinking / SubAgent | 🤖 机器人轮廓 |
| `search_outlined` | WebSearch | 🔍 搜索放大镜 |
| `computer_outlined` | Bash 命令 | 💻 电脑屏幕 |
| `edit_outlined` | Write / Edit 文件 | ✏️ 编辑笔 |
| `file-link-bitable_outlined` | Read 文件 / Bitable | 📄 文件链接 |
| `card-search_outlined` | Glob 文件搜索 | 🗂️ 卡片搜索 |
| `doc-search_outlined` | Grep 文本搜索 | 📋 文档搜索 |
| `language_outlined` | WebFetch 网页获取 | 🌐 地球/语言 |
| `file-link-mindnote_outlined` | Skill 加载 | 📑 思维导图链接 |
| `setting-inter_outlined` | 通用/未知工具 | ⚙️ 设置齿轮 |
| `chat_outlined` | 飞书 API | 💬 对话气泡 |
| `mindnote_outlined` | Memory 操作 | 🧠 思维导图 |
| `chart_outlined` | 财务查询 | 📊 图表 |
| `calendar_outlined` | 日历操作 | 📅 日历 |
| `file-link-docx_outlined` | 文档操作 | 📝 文档 |
| `right_outlined` | 折叠面板箭头 | ▶ 右箭头 |
| `more_outlined` | 加载指示器 | ⋯ 更多 |

### 10.2 Card JSON 完整示例

#### 流式推理中

```json
{
  "schema": "2.0",
  "config": {
    "streaming_mode": true,
    "enable_forward": true,
    "enable_forward_interaction": false,
    "width_mode": "fill",
    "summary": { "content": "正在处理 (3 个步骤)" }
  },
  "body": {
    "elements": [
      {
        "tag": "collapsible_panel",
        "expanded": true,
        "border": { "color": "grey-300", "corner_radius": "6px" },
        "vertical_spacing": "2px",
        "header": {
          "title": {
            "tag": "plain_text",
            "text_color": "grey",
            "text_size": "notation",
            "content": "正在处理 (3 个步骤)"
          },
          "icon": { "tag": "standard_icon", "token": "right_outlined", "color": "grey" },
          "icon_position": "right",
          "icon_expanded_angle": 90
        },
        "elements": [
          {
            "tag": "div",
            "icon": { "tag": "standard_icon", "token": "robot_outlined", "color": "grey" },
            "text": { "tag": "plain_text", "text_color": "grey", "text_size": "notation", "content": "分析用户问题，确定需要搜索相关信息..." }
          },
          {
            "tag": "div",
            "icon": { "tag": "standard_icon", "token": "search_outlined", "color": "grey" },
            "text": { "tag": "plain_text", "text_color": "grey", "text_size": "notation", "content": "搜索 \"TypeScript 设计模式最佳实践\"" }
          },
          {
            "tag": "div",
            "icon": { "tag": "standard_icon", "token": "language_outlined", "color": "grey" },
            "text": { "tag": "plain_text", "text_color": "grey", "text_size": "notation", "content": "获取网页 \"https://refactoring.guru/design-patterns\"" }
          }
        ]
      },
      {
        "tag": "div",
        "icon": { "tag": "standard_icon", "token": "more_outlined", "color": "grey" }
      }
    ]
  }
}
```

#### 推理完成

```json
{
  "schema": "2.0",
  "config": {
    "streaming_mode": true,
    "enable_forward": true,
    "enable_forward_interaction": false,
    "width_mode": "fill",
    "summary": { "content": "TypeScript 设计模式对比分析 根据搜索和分析的结果..." }
  },
  "body": {
    "elements": [
      {
        "tag": "collapsible_panel",
        "expanded": false,
        "border": { "color": "grey-300", "corner_radius": "6px" },
        "vertical_spacing": "2px",
        "header": {
          "title": {
            "tag": "plain_text",
            "text_color": "grey",
            "text_size": "notation",
            "content": "查看 5 个步骤"
          },
          "icon": { "tag": "standard_icon", "token": "right_outlined", "color": "grey" },
          "icon_position": "right",
          "icon_expanded_angle": 90
        },
        "elements": ["...步骤列表（省略）..."]
      },
      {
        "tag": "markdown",
        "content": "## TypeScript 设计模式对比分析\n\n根据搜索和分析的结果，以下是三种主要设计模式的对比：\n\n| 模式 | 适用场景 | 优势 |\n|------|---------|------|\n| 策略 | 算法替换 | 开闭原则 |\n| 观察者 | 事件驱动 | 松耦合 |\n| 工厂 | 对象创建 | 封装性 |\n\n### 推荐方案\n\n对于 Beeclaw 的插件系统，建议使用**策略模式**配合**观察者模式**，具体原因如下：\n\n1. 策略模式可以让不同的 AI Provider 作为可替换的策略\n2. 观察者模式可以实现插件的事件钩子系统\n3. 两者结合可以保持系统的灵活性和可扩展性"
      }
    ]
  }
}
```

### 10.3 与 Agentara 实现的差异说明

| 项目 | Agentara | Beeclaw（本方案） | 差异原因 |
|------|---------|----------------|---------|
| 工具图标管理 | switch-case 硬编码 | 可扩展注册表 | Beeclaw 工具种类更多，需要可插拔 |
| Thread 映射持久化 | SQLite + Drizzle | JSON 文件（过渡） → SQLite | 暂不依赖 RFC-03，后续迁移 |
| 消息降级 | 无 | post + md tag 降级 | 增加鲁棒性 |
| 语言支持 | 英文 | 中/英双语 | Beeclaw 主要用户为中文 |
| Agentic loop | 外部 AgentRunner 驱动 | streaming-handler 内置 | Beeclaw 尚无独立 AgentRunner |
| 操作串行化 | 无（依赖外部 TaskDispatcher） | Controller 内部 Promise 链 | 独立运行，不依赖 RFC-02 |
| 配置管理 | 环境变量 | 配置文件 + 功能开关 | 便于灰度上线和回退 |
