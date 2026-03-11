# Beeclaw Web UI — 产品设计与技术方案

> **版本**: v1.0 Draft | **日期**: 2026-03-10 | **作者**: Beeclaw Team
> **状态**: RFC（征求意见稿）

---

## 一、背景与问题

### 1.1 现状

Beeclaw 当前仅提供两种交互入口：

1. **CLI（命令行）**：基于 REPL 的交互模式，适合开发者本地调试
2. **飞书 Bot**：通过 WebSocket 长连接接入飞书，面向企业用户日常使用

缺失的能力：

- **无 Web 管理界面**：技能管理、记忆浏览、配置修改、会话历史查看、DAG 执行可视化均需手动操作文件或数据库
- **无实时监控**：Agent/子代理的运行状态、工具调用链、Token 消耗、沙箱资源使用等信息不可见
- **无 API 层**：外部系统无法通过 HTTP 接口与 Beeclaw 交互

### 1.2 竞品对标

| 能力 | Beeclaw | DeerFlow | OpenClaw |
|---|---|---|---|
| Web UI | ❌ 无 | ✅ Next.js 16 全功能前端 | ✅ Lit Web Components + Control UI |
| REST API | ❌ 无 | ✅ FastAPI Gateway | ✅ Gateway Server |
| 实时聊天界面 | ❌ | ✅ 完整聊天 UI + Markdown 渲染 | ✅ WebChat |
| 技能管理 UI | ❌ | ✅ 技能浏览器 | ✅ Skills 面板 |
| 配置管理 UI | ❌ | ❌（配置文件） | ✅ 图形化配置 |
| 执行可视化 | ❌ | ✅ @xyflow/react 流程图 | ❌ |

### 1.3 目标

为 Beeclaw 构建一个轻量、与现有 Bun 架构无缝集成的 Web 管理面板，覆盖配置管理、技能管理、会话/记忆可视化、实时聊天四大功能模块。

---

## 二、技术选型分析

### 2.1 候选方案对比

基于 Beeclaw 已有的 **Bun 运行时 + TypeScript** 技术栈，评估以下五种方案：

| 维度 | Hono + React | Elysia + React | Next.js (Bun) | Vite + React (SPA) | Hono + htmx |
|---|---|---|---|---|---|
| **Bun 原生支持** | ✅ 一等公民（Web Standards） | ✅ 原生专属 | ⚠️ 兼容层（需 `--bun` flag） | ✅ 良好 | ✅ 一等公民 |
| **服务端核心大小** | 14KB | ~20KB | 200+ 依赖 | 无需服务端框架 | 14KB |
| **冷启动时间** | <50ms | <50ms | 2-5s | N/A（静态文件） | <50ms |
| **端到端类型安全** | ✅ Hono RPC (无代码生成) | ✅ Eden Treaty (更丰富) | ⚠️ 需额外 tRPC | ⚠️ 手动/tRPC | ❌ 无 |
| **React 生态兼容** | ✅ 完整支持 | ✅ 完整支持 | ✅ 原生 | ✅ 原生 | ❌ 无法使用 |
| **UI 组件库** | shadcn/ui, TanStack | shadcn/ui, TanStack | 全部 | 全部 | 仅 Tailwind 手写 |
| **与现有 CLI 共进程** | ✅ 直接嵌入 | ✅ 直接嵌入 | ❌ 独立进程 | ⚠️ 需独立构建 | ✅ 直接嵌入 |
| **社区规模 (stars)** | 29.1K | 11K | 132K | 72K (Vite) | 29.1K (Hono) |
| **跨运行时可移植** | ✅ Node/Deno/CF Workers | ❌ 仅 Bun | ✅ Node | ✅ 任意静态托管 | ✅ 同 Hono |
| **学习曲线** | 低 | 低-中 | 高 | 中 | 低 |

### 2.2 方案详细评估

#### 方案 A：Hono + React（推荐）

**优势**：
- **与 Bun 无缝集成**：Hono 基于 Web Standard API（Fetch/Request/Response），是 Bun 官方推荐的 HTTP 框架。核心仅 14KB，冷启动 <50ms。
- **Hono RPC 提供端到端类型安全**：定义服务端路由后，客户端自动获取完整类型推断，无需代码生成。这对管理面板中大量 CRUD 接口尤为重要。
- **同进程共享**：Hono 可直接嵌入现有 Bun 进程中（`Bun.serve({ fetch: app.fetch })`），与 CLI、飞书 Bot 共享配置、数据库连接、Agent 实例等，无需进程间通信。
- **React 全生态可用**：配合 Vite 构建 React SPA，可使用 shadcn/ui、TanStack Table、TanStack Query 等现代组件库。
- **渐进式架构**：简单页面用 Hono 原生 JSX（SSR，0KB 客户端 JS），复杂页面用 React 客户端组件。Hono 的 `hono/jsx/dom`（2.8KB）还提供轻量客户端 Hooks。

**劣势**：
- Hono JSX 的服务端渲染不如 Next.js RSC 成熟
- 需要自行组织前端构建流程（Vite/Bun bundler）

#### 方案 B：Elysia + React

**优势**：
- Bun 原生专属框架，微基准测试性能略优于 Hono
- Eden Treaty 比 Hono RPC 更丰富（含错误类型、WebSocket 类型推断）

**劣势**：
- **锁定 Bun 运行时**——如果未来需要部署到 Cloudflare Workers 或 Node.js 环境，无法迁移
- 社区仅 11K stars，Stack Overflow 答案和生产案例显著少于 Hono
- 生态成熟度风险：2AM 排查问题时可参考资料有限

#### 方案 C：Next.js (Bun 兼容模式)

**优势**：
- 最大的社区和生态（132K stars）
- react-admin / Refine 等完整 Admin 框架可直接使用
- NextAuth 等认证方案开箱即用

**劣势**：
- **重量级框架**：200+ 依赖，冷启动 2-5s，与 Beeclaw 的轻量哲学矛盾
- **与现有架构不兼容**：Next.js 要求独占应用生命周期，无法嵌入现有 Bun CLI 进程。需要独立进程 + 进程间通信，显著增加运维复杂度
- **过度设计**：SSG/ISR/RSC 等能力面向公共网站，管理面板场景完全用不到
- Bun 兼容性仍需 `--bun` flag，部分 Node API 行为在 Bun 下有差异

#### 方案 D：Vite + React (纯 SPA)

**优势**：
- 最灵活的前端方案，构建为纯静态文件
- HMR 速度极快（<50ms）
- 可配合任意后端 API 框架

**劣势**：
- **需要单独的 API 层**——仍需引入 Hono/Elysia 做 API Server，不如方案 A 一体化
- 无端到端类型安全（除非叠加 tRPC）
- 首次加载需要下载整个 JS Bundle（200-500KB）

#### 方案 E：Hono + htmx

**优势**：
- 零客户端 JS 框架，极致轻量
- 服务端渲染 HTML，首屏秒开
- 对 CRUD 管理面板天然契合

**劣势**：
- **无法使用 React 组件库**（shadcn/ui、TanStack Table 等全部不可用）
- 复杂交互能力受限：拖拽 DAG 编排、实时图表、富文本编辑器等场景难以实现
- 社区共识是 htmx "tends to buckle" 当面对高度模块化的交互界面

### 2.3 最终决策：方案 A — Hono + React

**选择 Hono + React 的决定性理由**：

1. **架构一致性**：Hono 可嵌入现有 Bun 进程，与 CLI、飞书 Bot、Agent、沙箱共享同一应用上下文。无需多进程协调。
2. **类型安全闭环**：Hono RPC 自动推断 → TanStack Query → React UI，全链路 TypeScript 类型安全，零代码生成。
3. **生态平衡**：29K stars 的活跃社区 + 完整 React 生态 + 跨运行时可移植性，风险收益比最优。
4. **渐进复杂度**：从简单的 Hono JSX 页面起步，按需引入 React 客户端组件，不一次性引入所有复杂度。

**不选 Elysia 的原因**：Eden Treaty 虽好，但 Bun-only 锁定 + 社区规模差距不值得冒险。Hono RPC 已满足 95% 需求。

**不选 Next.js 的原因**：独立进程 + 200+ 依赖 + 2-5s 冷启动，与 Beeclaw 的轻量嵌入式哲学不兼容。管理面板不需要 SSG/RSC。

---

## 三、产品设计

### 3.1 用户故事

| 编号 | 角色 | 故事 | 验收标准 |
|---|---|---|---|
| US-1 | 管理员 | 我需要通过 Web 界面查看和修改 Beeclaw 配置 | 配置项可编辑并实时热加载，无需重启 |
| US-2 | 管理员 | 我需要管理技能的生命周期 | 可查看/创建/编辑/启用/禁用/删除技能 |
| US-3 | 管理员 | 我需要浏览 Agent 的记忆库 | 可搜索、浏览、删除记忆条目 |
| US-4 | 管理员 | 我需要查看历史会话和执行日志 | 可按时间/状态筛选，查看完整对话和工具调用链 |
| US-5 | 用户 | 我需要通过 Web 界面直接与 Agent 对话 | 实时聊天，支持 Markdown 渲染和流式输出 |
| US-6 | 管理员 | 我需要查看子代理 DAG 执行过程 | 可视化 DAG 流程图，实时展示节点状态 |
| US-7 | 管理员 | 我需要监控系统运行状态 | Dashboard 展示在线状态、Token 用量、沙箱状态 |
| US-8 | 外部系统 | 我需要通过 API 与 Beeclaw 集成 | 提供 RESTful API + OpenAPI 文档 |

### 3.2 信息架构

```
Beeclaw Web UI
├── 📊 Dashboard（首页仪表盘）
│   ├── 系统状态（在线/离线、运行时间、版本）
│   ├── 今日统计（对话数、工具调用数、Token 消耗）
│   ├── 活跃会话列表
│   └── 沙箱资源监控
│
├── 💬 Chat（实时聊天）
│   ├── 新建对话
│   ├── 历史对话列表
│   └── 对话详情（Markdown 渲染 + 工具调用展开 + 流式输出）
│
├── 🛠 Skills（技能管理）
│   ├── 技能列表（名称、状态、成熟度、调用次数）
│   ├── 技能详情/编辑器（YAML frontmatter + Markdown 编辑）
│   ├── 创建新技能
│   └── 技能进化历史
│
├── 🧠 Memory（记忆浏览）
│   ├── 记忆搜索（关键词/语义）
│   ├── 记忆条目列表（时间、来源、分类）
│   └── 记忆详情/编辑/删除
│
├── 📋 Sessions（会话历史）
│   ├── 会话列表（时间、来源、状态）
│   ├── 会话详情（对话流 + 工具调用 + 子代理 DAG）
│   └── DAG 执行可视化
│
├── ⚙️ Settings（配置管理）
│   ├── 基础配置（模型、提供商、API Key）
│   ├── 飞书连接配置
│   ├── 沙箱配置
│   ├── 工具/MCP 配置
│   └── 高级配置（热加载）
│
└── 📡 API Docs（API 文档）
    └── 嵌入式 Swagger UI / Scalar
```

### 3.3 页面线框设计

#### Dashboard（仪表盘）

```
┌─────────────────────────────────────────────────────┐
│  🐝 Beeclaw                    [Settings] [v0.2.0]  │
├──────────┬──────────────────────────────────────────┤
│          │                                           │
│ Dashboard│   ┌─────┐ ┌─────┐ ┌─────┐ ┌─────────┐   │
│ Chat     │   │ 在线 │ │ 23  │ │ 156 │ │ 12.4K   │   │
│ Skills   │   │ ● UP │ │对话数│ │工具调│ │Tokens   │   │
│ Memory   │   └─────┘ └─────┘ └─────┘ └─────────┘   │
│ Sessions │                                           │
│ Settings │   活跃会话                                 │
│ API Docs │   ┌────────────────────────────────────┐  │
│          │   │ sess-a12 │ 飞书 │ 进行中 │ 3 min  │  │
│          │   │ sess-b34 │ CLI  │ 空闲   │ 15 min │  │
│          │   └────────────────────────────────────┘  │
│          │                                           │
│          │   沙箱状态                                 │
│          │   ┌────────────────────────────────────┐  │
│          │   │ 容器池: 2/10 空闲  │ CPU: 23%     │  │
│          │   │ 活跃容器: 1        │ 内存: 128MB  │  │
│          │   └────────────────────────────────────┘  │
└──────────┴──────────────────────────────────────────┘
```

#### Chat（实时聊天）

```
┌──────────┬──────────────────────────────────────────┐
│          │  New Chat ✨                              │
│ 历史对话  │                                          │
│ ────────  │  🤖 你好！我是 Beeclaw，有什么可以帮你的？ │
│ 3/10 14:2│                                          │
│ 代码审查  │  👤 帮我分析一下 src/agent 目录的代码质量  │
│ ────────  │                                          │
│ 3/10 11:0│  🤖 好的，我来分析...                      │
│ 日报生成  │  ┌──────────────────────────────┐        │
│ ────────  │  │ 🔧 sandbox_bash              │        │
│ 3/09 16:3│  │ $ find src/agent -name '*.ts' │        │
│ 周报汇总  │  │ [展开查看输出]                │        │
│          │  └──────────────────────────────┘        │
│          │                                          │
│          │  ┌─────────────────────────────────┐     │
│          │  │ 输入消息...               [发送] │     │
│          │  └─────────────────────────────────┘     │
└──────────┴──────────────────────────────────────────┘
```

#### Skills（技能管理）

```
┌──────────┬──────────────────────────────────────────┐
│          │  Skills                    [+ 新建技能]   │
│          │                                           │
│          │  搜索: [________________] [🔍]            │
│          │                                           │
│          │  ┌──────────────────────────────────────┐ │
│          │  │ 📄 code_review    │ mature │ ✅ 启用 │ │
│          │  │    代码审查与建议  │ v3     │ 42次    │ │
│          │  ├──────────────────────────────────────┤ │
│          │  │ 📄 daily_report   │ growing│ ✅ 启用 │ │
│          │  │    日报自动生成    │ v1     │ 15次    │ │
│          │  ├──────────────────────────────────────┤ │
│          │  │ 📄 data_analysis  │ seed   │ ⚠️ 测试 │ │
│          │  │    数据分析助手    │ v0     │ 3次     │ │
│          │  └──────────────────────────────────────┘ │
│          │                                           │
│          │  技能进化时间线                             │
│          │  seed ──→ growing ──→ mature ──→ deprecated│
│          │  ●         ●          ◉                    │
└──────────┴──────────────────────────────────────────┘
```

### 3.4 认证与权限

考虑到 Beeclaw 定位为**本地/内网部署**的管理面板，采用轻量认证方案：

| 级别 | 方案 | 适用场景 |
|---|---|---|
| **Level 0** | 无认证（默认） | 本地开发，`localhost` 访问 |
| **Level 1** | 静态 Token（配置文件） | 内网部署，简单防护 |
| **Level 2** | Hono Basic Auth 中间件 | 少量用户，无需集成 SSO |
| **Level 3** | `@hono/auth-js`（预留） | 未来多用户 SaaS 场景 |

默认 Level 0，通过配置启用更高级别：

```jsonc
{
  "web": {
    "auth": {
      "level": "token",        // "none" | "token" | "basic"
      "token": "your-secret",
      "basicUsers": [
        { "username": "admin", "password": "hashed-password" }
      ]
    }
  }
}
```

---

## 四、技术方案

### 4.1 整体架构

```
                 ┌─────────────────────────────────┐
                 │        Bun.serve() (Port 3000)   │
                 │           Hono App               │
                 ├─────────────┬───────────────────┤
                 │  /api/*     │  /*               │
                 │  API Routes │  Static Files     │
                 │  (JSON)     │  (React SPA)      │
                 ├─────────────┤                   │
                 │  /api/ws    │                   │
                 │  WebSocket  │                   │
                 │  (Chat流式)  │                   │
                 └──────┬──────┴───────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
   ┌───────────┐ ┌───────────┐ ┌───────────┐
   │ Agent Core│ │  Config   │ │  Sandbox  │
   │ (共享实例) │ │  Store    │ │  Manager  │
   └───────────┘ └───────────┘ └───────────┘
          │
  ┌───────┴────────┐
  ▼                ▼
┌────────┐  ┌───────────┐
│ Skills │  │  Memory   │
│ Store  │  │  Store    │
└────────┘  └───────────┘
```

**关键设计决策**：

1. **同进程嵌入**：Hono App 和现有的飞书 Bot / CLI 运行在同一 Bun 进程中，共享 `appState`、`configStore`、`skillStore`、`memoryStore` 等全局单例
2. **API 优先**：所有 UI 操作通过 API 完成，API 即产品——外部系统可直接调用
3. **WebSocket 流式通信**：聊天接口使用 Bun 原生 WebSocket，支持 SSE 流式输出
4. **静态文件服务**：React SPA 构建产物由 Hono 的 `serveStatic` 中间件托管

### 4.2 目录结构

```
src/
├── web/                           # 新增 Web 模块
│   ├── server/                    # Hono 服务端
│   │   ├── index.ts               # Hono App 实例 + 中间件挂载
│   │   ├── middleware/
│   │   │   ├── auth.ts            # 认证中间件
│   │   │   ├── cors.ts            # CORS 配置
│   │   │   └── logger.ts          # 请求日志
│   │   ├── routes/
│   │   │   ├── index.ts           # 路由注册（barrel export）
│   │   │   ├── config.ts          # GET/PUT /api/config
│   │   │   ├── skills.ts          # CRUD /api/skills
│   │   │   ├── memory.ts          # CRUD /api/memory
│   │   │   ├── sessions.ts        # GET /api/sessions
│   │   │   ├── chat.ts            # POST /api/chat + WebSocket
│   │   │   ├── sandbox.ts         # GET /api/sandbox/status
│   │   │   ├── stats.ts           # GET /api/stats (Dashboard)
│   │   │   └── health.ts          # GET /api/health
│   │   └── ws.ts                  # WebSocket 管理（Bun 原生）
│   │
│   └── client/                    # React 客户端
│       ├── index.html             # SPA 入口
│       ├── main.tsx               # React 根挂载
│       ├── app.tsx                # 路由 + 布局
│       ├── lib/
│       │   ├── api.ts             # Hono RPC 客户端（自动类型推断）
│       │   ├── ws.ts              # WebSocket 客户端
│       │   └── utils.ts
│       ├── hooks/
│       │   ├── use-config.ts      # TanStack Query 封装
│       │   ├── use-skills.ts
│       │   ├── use-memory.ts
│       │   ├── use-sessions.ts
│       │   └── use-chat.ts
│       ├── pages/
│       │   ├── dashboard.tsx
│       │   ├── chat.tsx
│       │   ├── skills.tsx
│       │   ├── skill-editor.tsx
│       │   ├── memory.tsx
│       │   ├── sessions.tsx
│       │   └── settings.tsx
│       ├── components/
│       │   ├── layout/
│       │   │   ├── sidebar.tsx
│       │   │   ├── header.tsx
│       │   │   └── page-container.tsx
│       │   ├── chat/
│       │   │   ├── message-list.tsx
│       │   │   ├── message-bubble.tsx
│       │   │   ├── tool-call-card.tsx
│       │   │   └── chat-input.tsx
│       │   ├── skills/
│       │   │   ├── skill-card.tsx
│       │   │   ├── skill-editor.tsx
│       │   │   └── maturity-badge.tsx
│       │   ├── dag/
│       │   │   ├── dag-viewer.tsx      # @xyflow/react
│       │   │   └── dag-node.tsx
│       │   └── ui/                     # shadcn/ui 组件
│       │       ├── button.tsx
│       │       ├── card.tsx
│       │       ├── input.tsx
│       │       ├── table.tsx
│       │       ├── dialog.tsx
│       │       ├── badge.tsx
│       │       └── ...
│       └── styles/
│           └── globals.css             # Tailwind CSS
│
├── app/
│   └── index.ts                   # 修改：启动时同时挂载 Web Server
├── config/
│   └── schema.ts                  # 扩展 web 配置 schema
└── ...
```

### 4.3 Hono 服务端实现

#### 4.3.1 App 入口

```typescript
// src/web/server/index.ts

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { secureHeaders } from 'hono/secure-headers';
import { createAuthMiddleware } from './middleware/auth';
import { configRoutes } from './routes/config';
import { skillRoutes } from './routes/skills';
import { memoryRoutes } from './routes/memory';
import { sessionRoutes } from './routes/sessions';
import { chatRoutes } from './routes/chat';
import { sandboxRoutes } from './routes/sandbox';
import { statsRoutes } from './routes/stats';
import { healthRoutes } from './routes/health';
import { getConfig } from '../../config';

export function createWebApp() {
  const app = new Hono();
  const config = getConfig().web;

  // 全局中间件
  app.use('*', secureHeaders());
  app.use('*', logger());
  app.use('/api/*', cors({
    origin: config.cors?.origins ?? ['http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  }));

  // 认证中间件（API 路由）
  if (config.auth.level !== 'none') {
    app.use('/api/*', createAuthMiddleware(config.auth));
  }

  // API 路由
  const api = app
    .basePath('/api')
    .route('/health', healthRoutes)
    .route('/stats', statsRoutes)
    .route('/config', configRoutes)
    .route('/skills', skillRoutes)
    .route('/memory', memoryRoutes)
    .route('/sessions', sessionRoutes)
    .route('/chat', chatRoutes)
    .route('/sandbox', sandboxRoutes);

  // 静态文件服务（React SPA 构建产物）
  app.use('/*', serveStatic({ root: './src/web/client/dist' }));

  // SPA Fallback：所有非 API 路径返回 index.html
  app.get('*', serveStatic({ path: './src/web/client/dist/index.html' }));

  return { app, api };
}

// 导出 API 类型，供客户端 RPC 使用
export type ApiType = ReturnType<typeof createWebApp>['api'];
```

#### 4.3.2 API 路由示例

**技能管理路由**（完整 CRUD + Hono RPC 类型推断）：

```typescript
// src/web/server/routes/skills.ts

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSkillStore } from '../../../skills/store';

// 请求体 Schema（用于 Hono RPC 类型推断）
const createSkillSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string(),
  content: z.string(),
  triggers: z.array(z.string()).optional(),
  enabled: z.boolean().default(true),
});

const updateSkillSchema = createSkillSchema.partial();

export const skillRoutes = new Hono()

  // GET /api/skills — 列出所有技能
  .get('/', async (c) => {
    const store = getSkillStore();
    const skills = await store.listSkills();
    return c.json({
      skills: skills.map(s => ({
        name: s.name,
        description: s.description,
        maturity: s.maturity,        // seed | growing | mature | deprecated
        enabled: s.enabled,
        version: s.version,
        callCount: s.callCount,
        lastUsed: s.lastUsed,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      total: skills.length,
    });
  })

  // GET /api/skills/:name — 获取技能详情
  .get('/:name', async (c) => {
    const { name } = c.req.param();
    const store = getSkillStore();
    const skill = await store.getSkill(name);
    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404);
    }
    return c.json({ skill });
  })

  // POST /api/skills — 创建技能
  .post('/', zValidator('json', createSkillSchema), async (c) => {
    const body = c.req.valid('json');
    const store = getSkillStore();

    // 检查重名
    const existing = await store.getSkill(body.name);
    if (existing) {
      return c.json({ error: 'Skill already exists' }, 409);
    }

    const skill = await store.createSkill(body);
    return c.json({ skill }, 201);
  })

  // PUT /api/skills/:name — 更新技能
  .put('/:name', zValidator('json', updateSkillSchema), async (c) => {
    const { name } = c.req.param();
    const body = c.req.valid('json');
    const store = getSkillStore();

    const skill = await store.updateSkill(name, body);
    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404);
    }
    return c.json({ skill });
  })

  // DELETE /api/skills/:name — 删除技能
  .delete('/:name', async (c) => {
    const { name } = c.req.param();
    const store = getSkillStore();
    const deleted = await store.deleteSkill(name);
    if (!deleted) {
      return c.json({ error: 'Skill not found' }, 404);
    }
    return c.json({ success: true });
  })

  // POST /api/skills/:name/toggle — 启用/禁用技能
  .post('/:name/toggle', async (c) => {
    const { name } = c.req.param();
    const store = getSkillStore();
    const skill = await store.toggleSkill(name);
    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404);
    }
    return c.json({ skill });
  });
```

**聊天路由**（SSE 流式输出）：

```typescript
// src/web/server/routes/chat.ts

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getAgent } from '../../../agent';

const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
});

export const chatRoutes = new Hono()

  // POST /api/chat — 发送消息并接收流式回复
  .post('/', zValidator('json', chatSchema), async (c) => {
    const { message, sessionId } = c.req.valid('json');
    const agent = getAgent();

    return streamSSE(c, async (stream) => {
      const sid = sessionId || `web-${Date.now()}`;

      // 发送 session ID
      await stream.writeSSE({
        event: 'session',
        data: JSON.stringify({ sessionId: sid }),
      });

      // 流式处理 Agent 回复
      await agent.streamChat(message, sid, {
        onToken: async (token: string) => {
          await stream.writeSSE({
            event: 'token',
            data: JSON.stringify({ token }),
          });
        },
        onToolCall: async (toolCall: any) => {
          await stream.writeSSE({
            event: 'tool_call',
            data: JSON.stringify(toolCall),
          });
        },
        onToolResult: async (result: any) => {
          await stream.writeSSE({
            event: 'tool_result',
            data: JSON.stringify(result),
          });
        },
        onSubagent: async (subagentEvent: any) => {
          await stream.writeSSE({
            event: 'subagent',
            data: JSON.stringify(subagentEvent),
          });
        },
        onComplete: async (response: string) => {
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({ response }),
          });
        },
        onError: async (error: Error) => {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ error: error.message }),
          });
        },
      });
    });
  })

  // GET /api/chat/history — 获取会话历史
  .get('/history', async (c) => {
    const sessionId = c.req.query('sessionId');
    if (!sessionId) {
      return c.json({ error: 'sessionId required' }, 400);
    }
    const agent = getAgent();
    const history = await agent.getSessionHistory(sessionId);
    return c.json({ history });
  })

  // GET /api/chat/sessions — 列出所有聊天会话
  .get('/sessions', async (c) => {
    const agent = getAgent();
    const sessions = await agent.listSessions();
    return c.json({ sessions });
  });
```

#### 4.3.3 WebSocket 实时通信

利用 Bun 原生 WebSocket 支持：

```typescript
// src/web/server/ws.ts

import type { ServerWebSocket } from 'bun';
import { getAgent } from '../../agent';
import { SandboxManager } from '../../sandbox/manager';

interface WSData {
  sessionId: string;
  authenticated: boolean;
}

export function createWebSocketHandler() {
  return {
    open(ws: ServerWebSocket<WSData>) {
      const sessionId = `ws-${Date.now()}`;
      ws.data = { sessionId, authenticated: true };
      ws.subscribe('system-events'); // 订阅系统事件广播
    },

    async message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
      try {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case 'chat': {
            const agent = getAgent();
            await agent.streamChat(data.message, ws.data.sessionId, {
              onToken: (token) => ws.send(JSON.stringify({ type: 'token', token })),
              onToolCall: (tc) => ws.send(JSON.stringify({ type: 'tool_call', ...tc })),
              onToolResult: (tr) => ws.send(JSON.stringify({ type: 'tool_result', ...tr })),
              onComplete: (resp) => ws.send(JSON.stringify({ type: 'done', response: resp })),
              onError: (err) => ws.send(JSON.stringify({ type: 'error', error: err.message })),
            });
            break;
          }

          case 'subscribe_sandbox': {
            // 订阅沙箱状态更新
            ws.subscribe('sandbox-status');
            break;
          }

          case 'subscribe_dag': {
            // 订阅特定 DAG 执行状态
            ws.subscribe(`dag-${data.dagId}`);
            break;
          }
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'error', error: err.message }));
      }
    },

    close(ws: ServerWebSocket<WSData>) {
      ws.unsubscribe('system-events');
      ws.unsubscribe('sandbox-status');
    },
  };
}
```

### 4.4 React 客户端实现

#### 4.4.1 Hono RPC 客户端（端到端类型安全）

```typescript
// src/web/client/lib/api.ts

import { hc, InferResponseType, InferRequestType } from 'hono/client';
import type { ApiType } from '../../server/index';

// 自动从服务端路由推断所有类型——零代码生成
export const api = hc<ApiType>('/');

// 导出类型工具函数，供 TanStack Query 使用
export type SkillsResponse = InferResponseType<typeof api.api.skills.$get>;
export type CreateSkillRequest = InferRequestType<typeof api.api.skills.$post>['json'];
export type StatsResponse = InferResponseType<typeof api.api.stats.$get>;
```

#### 4.4.2 TanStack Query 集成

```typescript
// src/web/client/hooks/use-skills.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: async () => {
      const res = await api.api.skills.$get();
      if (!res.ok) throw new Error('Failed to fetch skills');
      return res.json();
    },
  });
}

export function useSkill(name: string) {
  return useQuery({
    queryKey: ['skills', name],
    queryFn: async () => {
      const res = await api.api.skills[':name'].$get({ param: { name } });
      if (!res.ok) throw new Error('Skill not found');
      return res.json();
    },
    enabled: !!name,
  });
}

export function useCreateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      description: string;
      content: string;
      triggers?: string[];
    }) => {
      const res = await api.api.skills.$post({ json: data });
      if (!res.ok) throw new Error('Failed to create skill');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });
}

export function useToggleSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await api.api.skills[':name'].toggle.$post({
        param: { name },
      });
      if (!res.ok) throw new Error('Failed to toggle skill');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });
}
```

#### 4.4.3 流式聊天 Hook

```typescript
// src/web/client/hooks/use-chat.ts

import { useState, useCallback, useRef } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallEvent[];
  timestamp: number;
}

interface ToolCallEvent {
  name: string;
  args: Record<string, any>;
  result?: string;
  status: 'calling' | 'done' | 'error';
}

export function useChat(sessionId?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(sessionId);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    // 添加用户消息
    const userMsg: ChatMessage = {
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);

    // 初始化 Assistant 消息
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [],
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, assistantMsg]);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          sessionId: currentSessionId,
        }),
        signal: abortController.signal,
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No response stream');

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            switch (data.event || '') {
              case 'session':
                setCurrentSessionId(data.sessionId);
                break;
              case 'token':
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    last.content += data.token;
                  }
                  return updated;
                });
                break;
              case 'tool_call':
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    last.toolCalls = [
                      ...(last.toolCalls || []),
                      { name: data.name, args: data.args, status: 'calling' },
                    ];
                  }
                  return updated;
                });
                break;
              case 'tool_result':
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant' && last.toolCalls) {
                    const tc = last.toolCalls.find(t => t.name === data.name && t.status === 'calling');
                    if (tc) {
                      tc.result = data.result;
                      tc.status = 'done';
                    }
                  }
                  return updated;
                });
                break;
              case 'done':
                break;
              case 'error':
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    last.content += `\n\n⚠️ Error: ${data.error}`;
                  }
                  return updated;
                });
                break;
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant') {
            last.content = `⚠️ 连接错误: ${err.message}`;
          }
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [currentSessionId]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return {
    messages,
    isStreaming,
    sessionId: currentSessionId,
    sendMessage,
    stopStreaming,
  };
}
```

#### 4.4.4 DAG 可视化组件

```typescript
// src/web/client/components/dag/dag-viewer.tsx

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { DagNode } from './dag-node';
import type { DAGTask } from './types';

interface DagViewerProps {
  tasks: DAGTask[];
  edges: Array<{ source: string; target: string }>;
}

const nodeTypes = {
  dagTask: DagNode,
};

export function DagViewer({ tasks, edges }: DagViewerProps) {
  const nodes: Node[] = tasks.map((task, index) => ({
    id: task.id,
    type: 'dagTask',
    position: calculatePosition(index, tasks.length),
    data: {
      label: task.name,
      status: task.status,
      duration: task.duration,
      toolCalls: task.toolCalls,
    },
  }));

  const flowEdges: Edge[] = edges.map((e, i) => ({
    id: `edge-${i}`,
    source: e.source,
    target: e.target,
    animated: tasks.find(t => t.id === e.target)?.status === 'running',
    style: {
      stroke: tasks.find(t => t.id === e.target)?.status === 'completed'
        ? '#22c55e'
        : '#94a3b8',
    },
  }));

  return (
    <div style={{ width: '100%', height: '400px' }}>
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

function calculatePosition(index: number, total: number) {
  // 简单的分层布局
  const cols = Math.ceil(Math.sqrt(total));
  const row = Math.floor(index / cols);
  const col = index % cols;
  return { x: col * 250, y: row * 150 };
}
```

### 4.5 启动集成

修改 Beeclaw 入口文件，在现有启动流程中集成 Web Server：

```typescript
// src/app/index.ts 修改

import { createWebApp } from '../web/server';
import { createWebSocketHandler } from '../web/server/ws';

export async function startApp(mode: 'bot' | 'cli') {
  // ... 现有初始化逻辑（config, agent, feishu bot, etc.）...

  // 启动 Web Server（与现有服务共进程）
  const webConfig = getConfig().web;
  if (webConfig.enabled) {
    const { app } = createWebApp();
    const wsHandler = createWebSocketHandler();

    Bun.serve({
      port: webConfig.port || 3000,
      fetch: app.fetch,
      websocket: wsHandler,
    });

    logger.info(`Web UI available at http://localhost:${webConfig.port || 3000}`);
  }

  // ... 继续现有的 bot/cli 启动逻辑 ...
}
```

### 4.6 前端构建方案

使用 Bun 原生 Bundler 或 Vite 构建 React SPA：

**方案 A：Bun Bundler（推荐，零额外依赖）**

```typescript
// scripts/build-web.ts

await Bun.build({
  entrypoints: ['./src/web/client/main.tsx'],
  outdir: './src/web/client/dist',
  target: 'browser',
  format: 'esm',
  splitting: true,           // 代码分割
  minify: true,
  sourcemap: 'external',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

// 复制 index.html 到 dist
await Bun.write(
  './src/web/client/dist/index.html',
  await Bun.file('./src/web/client/index.html').text()
);
```

**方案 B：Vite（备选，更成熟的 HMR）**

```typescript
// vite.config.ts

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: './src/web/client',
  plugins: [react()],
  build: {
    outDir: './dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/web/client'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
```

**推荐使用方案 A（Bun Bundler）**，原因：
- 零额外依赖，与项目 Bun-first 理念一致
- 构建速度比 Vite 更快（Bun 原生 TS/JSX 编译）
- 如后续需要更丰富的 HMR 功能，可无缝切换到 Vite

### 4.7 配置扩展

在 `beeclaw.config.json` 中新增 `web` 字段：

```jsonc
{
  "web": {
    "enabled": true,
    "port": 3000,
    "host": "0.0.0.0",

    // 认证配置
    "auth": {
      "level": "none",               // "none" | "token" | "basic"
      "token": "",                    // level=token 时的密钥
      "basicUsers": []                // level=basic 时的用户列表
    },

    // CORS 配置
    "cors": {
      "origins": ["http://localhost:3000"],
      "credentials": true
    },

    // 前端构建
    "build": {
      "mode": "bun",                  // "bun" | "vite"
      "watch": false                   // 开发模式下热重载
    }
  }
}
```

### 4.8 新增依赖

```json
{
  "dependencies": {
    "hono": "^4.7.0",
    "@hono/zod-validator": "^0.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@tanstack/react-query": "^5.60.0",
    "@tanstack/react-router": "^1.80.0",
    "@xyflow/react": "^12.4.0",
    "tailwindcss": "^4.0.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.6.0",
    "lucide-react": "^0.400.0",
    "react-markdown": "^9.0.0",
    "react-syntax-highlighter": "^15.6.0"
  }
}
```

**为什么不用 `@radix-ui/*` 全家桶**：shadcn/ui 组件会按需复制到 `components/ui/` 目录，不引入完整 Radix 依赖树，保持轻量。

---

## 五、API 设计总览

| 方法 | 路径 | 描述 | 认证 |
|---|---|---|---|
| `GET` | `/api/health` | 健康检查 | ❌ |
| `GET` | `/api/stats` | Dashboard 统计数据 | ✅ |
| `GET` | `/api/config` | 获取配置（脱敏） | ✅ |
| `PUT` | `/api/config` | 更新配置（热加载） | ✅ |
| `GET` | `/api/skills` | 列出技能 | ✅ |
| `GET` | `/api/skills/:name` | 获取技能详情 | ✅ |
| `POST` | `/api/skills` | 创建技能 | ✅ |
| `PUT` | `/api/skills/:name` | 更新技能 | ✅ |
| `DELETE` | `/api/skills/:name` | 删除技能 | ✅ |
| `POST` | `/api/skills/:name/toggle` | 启用/禁用技能 | ✅ |
| `GET` | `/api/memory` | 搜索记忆 | ✅ |
| `GET` | `/api/memory/:id` | 获取记忆详情 | ✅ |
| `DELETE` | `/api/memory/:id` | 删除记忆 | ✅ |
| `GET` | `/api/sessions` | 列出会话 | ✅ |
| `GET` | `/api/sessions/:id` | 会话详情（含消息） | ✅ |
| `GET` | `/api/sessions/:id/dag` | 获取 DAG 执行数据 | ✅ |
| `POST` | `/api/chat` | 发送消息（SSE 流式回复） | ✅ |
| `GET` | `/api/chat/history` | 获取聊天历史 | ✅ |
| `GET` | `/api/sandbox/status` | 沙箱状态 | ✅ |
| `WebSocket` | `/api/ws` | 实时双向通信 | ✅ |

---

## 六、实施计划

| 阶段 | 内容 | 工期 | 交付物 |
|---|---|---|---|
| **Phase 1** | Hono 服务端骨架 + API 路由 | 3 天 | `web/server/*`，health/stats/config/skills 路由 |
| **Phase 2** | React SPA 骨架 + 布局 | 2 天 | `web/client/*`，Sidebar/Header/Dashboard 页面 |
| **Phase 3** | 技能管理 + 记忆浏览 UI | 3 天 | Skills 页面（CRUD）、Memory 页面（搜索/浏览） |
| **Phase 4** | 实时聊天功能 | 3 天 | Chat 页面（SSE 流式 + Markdown 渲染 + 工具调用展示） |
| **Phase 5** | DAG 可视化 + 会话历史 | 2 天 | Sessions 页面、@xyflow/react DAG 视图 |
| **Phase 6** | 配置管理 + 认证 | 2 天 | Settings 页面、Token/Basic Auth 中间件 |
| **Phase 7** | 集成测试 + 优化 | 2 天 | E2E 测试、性能优化、文档 |

**总工期**：约 17 个工作日

---

## 七、风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| Bun Bundler 对 React 19 兼容性问题 | 构建失败 | 备选方案 Vite，已预留配置切换 |
| Hono RPC 在复杂嵌套路由下类型推断失败 | 部分 API 失去类型安全 | 对复杂路由退化为手动类型注解 |
| WebSocket 与飞书 WSClient 端口冲突 | 启动失败 | Web Server 使用独立端口，PM2 配置隔离 |
| 前端 Bundle 体积过大 | 首屏加载慢 | 代码分割 + 路由级懒加载 + shadcn 按需引入 |
| 同进程共享导致 Agent CPU 密集操作阻塞 UI | Web UI 卡顿 | Agent 重计算放入 Worker Thread / 子进程 |

---

## 八、未来扩展

1. **OpenAPI 文档自动生成**：通过 `@hono/swagger-ui` 或 `@scalar/hono-api-reference` 自动从路由 + Zod schema 生成交互式 API 文档
2. **多语言 i18n**：支持中英文切换，使用 `react-i18next`
3. **深色模式**：Tailwind `dark:` 变体 + 系统偏好检测
4. **移动端适配**：响应式布局，支持手机端查看 Dashboard 和聊天
5. **插件系统 UI**：可视化管理 MCP Server 连接、OpenClaw 插件安装
6. **Hono 到 Auth.js 集成**：未来多用户 SaaS 模式时，通过 `@hono/auth-js` 接入 OAuth 提供商
7. **SSR 渐进增强**：对 Dashboard 等首屏关键页面，使用 Hono JSX 服务端渲染 + React 客户端 Hydrate，减少首屏白屏时间
