# Beeclaw Feishu 完整功能复刻计划

基于 openclaw/extensions/feishu 的深度分析，完整复刻所有飞书功能到 beeclaw。

## 📋 功能清单

### ✅ 已实现功能 (Beeclaw 现有)

1. **基础消息功能**
   - ✅ WebSocket 连接 (`src/feishu/websocket-client.ts`)
   - ✅ 消息接收与解析
   - ✅ 文本消息发送
   - ✅ 图片消息处理（下载 + 识别）
   - ✅ 消息去重
   - ✅ 反应表情（Reaction）

2. **AI 对话**
   - ✅ 会话管理
   - ✅ 上下文压缩
   - ✅ 多模态支持（图片 + 文本）

### 🎯 需要新增功能

## 1. 核心架构增强

### 1.1 多账号支持
**优先级**: 高 | **工作量**: 3天

**功能点**:
- 支持多个飞书应用实例
- 账号级别配置继承
- 独立的客户端缓存

**实现文件**:
```
src/feishu/accounts.ts
src/feishu/client.ts (增强)
```

**参考**: `openclaw/extensions/feishu/src/accounts.ts`

### 1.2 客户端管理优化
**优先级**: 高 | **工作量**: 2天

**功能点**:
- 客户端缓存机制（基于 accountId）
- 多域名支持（飞书/Lark/私有部署）
- 代理支持（https_proxy 环境变量）

**实现文件**:
```
src/feishu/client.ts
```

**参考**: `openclaw/extensions/feishu/src/client.ts`

### 1.3 权限管理
**优先级**: 高 | **工作量**: 2天

**功能点**:
- DM 策略（open/pairing/allowlist）
- 群组策略（open/allowlist/disabled）
- 基于 ID 的访问控制
- @提及要求配置

**实现文件**:
```
src/feishu/policy.ts
src/feishu/config-schema.ts
```

**参考**: `openclaw/extensions/feishu/src/policy.ts`

## 2. 消息功能增强

### 2.1 富文本消息
**优先级**: 高 | **工作量**: 3天

**功能点**:
- Post 消息格式（富文本）
- Markdown 表格转换
- @提及支持（文本和卡片格式）
- 消息编辑（24小时窗口）

**实现文件**:
```
src/feishu/send.ts (新增)
src/feishu/format.ts (新增)
```

**参考**: `openclaw/extensions/feishu/src/send.ts`

### 2.2 卡片消息
**优先级**: 高 | **工作量**: 4天

**功能点**:
- 交互式卡片消息
- Schema 2.0 格式
- 卡片按钮交互处理
- 流式卡片更新（实时更新）

**实现文件**:
```
src/feishu/card.ts (新增)
src/feishu/streaming-card.ts (新增)
src/feishu/card-action.ts (新增)
```

**参考**:
- `openclaw/extensions/feishu/src/streaming-card.ts`
- `openclaw/extensions/feishu/src/card-action.ts`

### 2.3 媒体上传
**优先级**: 高 | **工作量**: 2天

**功能点**:
- 图片上传（JPEG, PNG, WEBP, GIF 等）
- 文件上传（最大 30MB）
- 从 URL/Buffer/本地路径上传
- CVE-2026-26321 防护

**实现文件**:
```
src/feishu/media.ts (增强)
```

**参考**: `openclaw/extensions/feishu/src/media.ts`

### 2.4 @提及系统
**优先级**: 中 | **工作量**: 2天

**功能点**:
- 提及目标提取
- Mention-forward 检测
- @所有人支持
- 提及格式化（文本/卡片）

**实现文件**:
```
src/feishu/mention.ts (新增)
```

**参考**: `openclaw/extensions/feishu/src/mention.ts`

### 2.5 表情回应增强
**优先级**: 中 | **工作量**: 1天

**功能点**:
- 添加/删除表情
- 列出消息的所有表情
- 表情事件转消息（通知）

**实现文件**:
```
src/feishu/reactions.ts (增强)
```

**参考**: `openclaw/extensions/feishu/src/reactions.ts`

## 3. 业务功能模块

### 3.1 文档操作 (Docx)
**优先级**: 高 | **工作量**: 5天

**功能点**:
- 读取文档（get, list_children, search）
- 写入文档（create, append, insert, update, delete）
- 批量操作（batch_create，50块限制）
- 表格操作（创建/插入/删除行列，合并单元格）
- 格式化（彩色文本段）
- 图片上传并插入

**工具列表**:
```
feishu_docx_get
feishu_docx_list_children
feishu_docx_create
feishu_docx_append
feishu_docx_insert
feishu_docx_update
feishu_docx_delete
feishu_docx_search
feishu_docx_create_table
feishu_docx_insert_row
feishu_docx_insert_column
feishu_docx_delete_row
feishu_docx_delete_column
feishu_docx_merge_cells
feishu_docx_update_color_text
```

**实现文件**:
```
src/feishu/tools/docx.ts (新增)
src/feishu/docx-table-ops.ts (新增)
src/feishu/docx-batch-insert.ts (新增)
src/feishu/docx-color-text.ts (新增)
```

**参考**:
- `openclaw/extensions/feishu/src/docx.ts` (59KB, 核心文件)
- `openclaw/extensions/feishu/src/docx-table-ops.ts`
- `openclaw/extensions/feishu/src/docx-batch-insert.ts`

### 3.2 云盘操作 (Drive)
**优先级**: 高 | **工作量**: 3天

**功能点**:
- 列出文件/文件夹
- 获取文件元数据
- 创建文件夹
- 移动文件
- 删除文件/文件夹
- 根目录 token 获取

**工具列表**:
```
feishu_drive_list
feishu_drive_info
feishu_drive_create_folder
feishu_drive_move
feishu_drive_delete
```

**实现文件**:
```
src/feishu/tools/drive.ts (新增)
```

**参考**: `openclaw/extensions/feishu/src/drive.ts`

### 3.3 知识库操作 (Wiki)
**优先级**: 高 | **工作量**: 3天

**功能点**:
- 列出知识库空间
- 列出节点（树结构）
- 获取节点元数据
- 创建新页面
- 移动节点
- 重命名节点

**工具列表**:
```
feishu_wiki_spaces
feishu_wiki_nodes
feishu_wiki_get
feishu_wiki_create
feishu_wiki_move
feishu_wiki_rename
```

**实现文件**:
```
src/feishu/tools/wiki.ts (新增)
```

**参考**: `openclaw/extensions/feishu/src/wiki.ts`

### 3.4 多维表格 (Bitable)
**优先级**: 中 | **工作量**: 4天

**功能点**:
- URL 解析（提取 app_token + table_id）
- 列出字段（列）
- 列出记录（行）
- 获取单条记录
- 创建记录
- 更新记录
- 创建新的 Bitable
- 创建字段

**工具列表**:
```
feishu_bitable_get_meta
feishu_bitable_list_fields
feishu_bitable_list_records
feishu_bitable_get_record
feishu_bitable_create_record
feishu_bitable_update_record
feishu_bitable_create_app
feishu_bitable_create_field
```

**实现文件**:
```
src/feishu/tools/bitable.ts (新增)
```

**参考**: `openclaw/extensions/feishu/src/bitable.ts` (714行)

### 3.5 聊天管理 (Chat)
**优先级**: 中 | **工作量**: 2天

**功能点**:
- 列出群成员（分页）
- 获取群元数据（名称、描述、所有者、成员数）

**工具列表**:
```
feishu_chat_members
feishu_chat_info
```

**实现文件**:
```
src/feishu/tools/chat.ts (新增)
```

**参考**: `openclaw/extensions/feishu/src/chat.ts`

### 3.6 权限管理 (Perm)
**优先级**: 中 | **工作量**: 2天

**功能点**:
- 列出有权限的成员
- 授予权限（查看/编辑/完全访问）
- 撤销权限

**工具列表**:
```
feishu_perm_list
feishu_perm_add
feishu_perm_remove
```

**实现文件**:
```
src/feishu/tools/perm.ts (新增)
```

**参考**: `openclaw/extensions/feishu/src/perm.ts`

## 4. 监控与运维

### 4.1 健康检查
**优先级**: 高 | **工作量**: 1天

**功能点**:
- Bot 信息获取（名称、open_id）
- 凭证验证
- 结果缓存（10分钟 TTL）

**实现文件**:
```
src/feishu/probe.ts (新增)
```

**参考**: `openclaw/extensions/feishu/src/probe.ts`

### 4.2 动态代理创建
**优先级**: 中 | **工作量**: 2天

**功能点**:
- 为 DM 用户创建独立代理工作区
- 基于模板的配置

**实现文件**:
```
src/feishu/dynamic-agent.ts (新增)
```

**参考**: `openclaw/extensions/feishu/src/dynamic-agent.ts`

### 4.3 消息去重增强
**优先级**: 高 | **工作量**: 1天

**功能点**:
- 内存去重（同步检查）
- 持久化去重（重启后保留）
- 合并转发消息处理

**实现文件**:
```
src/feishu/dedup.ts (增强)
```

**参考**: `openclaw/extensions/feishu/src/dedup.ts`

## 5. 辅助功能

### 5.1 合并转发消息
**优先级**: 中 | **工作量**: 2天

**功能点**:
- 获取完整转发消息
- 解析子消息（最多50条）
- 格式化为列表

**实现文件**:
```
src/feishu/merge-forward.ts (新增)
```

**参考**: `openclaw/extensions/feishu/src/bot.ts` (merge_forward 处理)

### 5.2 消息回退机制
**优先级**: 中 | **工作量**: 1天

**功能点**:
- 消息撤回/未找到时的回退
- 自动降级为新消息

**实现文件**:
```
src/feishu/send.ts (已包含)
```

### 5.3 会话作用域
**优先级**: 高 | **工作量**: 2天

**功能点**:
- 群组会话作用域（group/group_sender/group_topic/group_topic_sender）
- 话题根 ID 追踪
- 回复到话题

**实现文件**:
```
src/feishu/session.ts (新增)
```

**参考**: `openclaw/extensions/feishu/src/bot.ts` (session routing)

### 5.4 输入验证与清洗
**优先级**: 高 | **工作量**: 1天

**功能点**:
- Schema 验证（TypeBox）
- 参数清洗
- 错误处理

**实现文件**:
```
src/feishu/validation.ts (新增)
```

**参考**: `openclaw/extensions/feishu/src/config-schema.ts`

## 📊 实施优先级

### Phase 1: 核心功能（2周）
**目标**: 完整的消息交互能力

1. **Week 1**:
   - ✅ 富文本消息
   - ✅ 卡片消息
   - ✅ 媒体上传
   - ✅ 健康检查

2. **Week 2**:
   - ✅ 文档操作
   - ✅ 云盘操作
   - ✅ 知识库操作
   - ✅ 权限管理增强

### Phase 2: 业务功能（2周）
**目标**: 完整的业务工具集

3. **Week 3**:
   - ✅ 多维表格
   - ✅ 聊天管理
   - ✅ @提及系统
   - ✅ 表情回应增强

4. **Week 4**:
   - ✅ 多账号支持
   - ✅ 客户端优化
   - ✅ 会话作用域
   - ✅ 消息去重增强

### Phase 3: 高级功能（1周）
**目标**: 企业级特性

5. **Week 5**:
   - ✅ 流式卡片
   - ✅ 动态代理
   - ✅ 合并转发
   - ✅ 卡片按钮交互

## 🏗️ 架构设计

### 目录结构
```
src/feishu/
├── client.ts              # 客户端管理（增强）
├── accounts.ts            # 多账号管理（新增）
├── config-schema.ts       # 配置 Schema（新增）
├── policy.ts              # 权限策略（新增）
├── send.ts                # 消息发送（新增）
├── card.ts                # 卡片消息（新增）
├── streaming-card.ts      # 流式卡片（新增）
├── card-action.ts         # 卡片交互（新增）
├── media.ts               # 媒体上传（增强）
├── mention.ts             # @提及（新增）
├── reactions.ts           # 表情回应（增强）
├── dedup.ts               # 消息去重（增强）
├── probe.ts               # 健康检查（新增）
├── session.ts             # 会话作用域（新增）
├── validation.ts          # 输入验证（新增）
├── merge-forward.ts       # 合并转发（新增）
├── dynamic-agent.ts       # 动态代理（新增）
│
├── tools/                 # 工具模块
│   ├── docx.ts           # 文档操作
│   ├── drive.ts          # 云盘操作
│   ├── wiki.ts           # 知识库操作
│   ├── bitable.ts        # 多维表格
│   ├── chat.ts           # 聊天管理
│   └── perm.ts           # 权限管理
│
├── websocket-client.ts    # WebSocket 客户端（现有）
└── index.ts               # 导出（增强）
```

### 依赖关系
```
@larksuiteoapi/node-sdk (^1.59.0)  - 飞书官方 SDK
@sinclair/typebox (0.34.48)        - Schema 验证
https-proxy-agent (^7.0.6)         - 代理支持
zod (^4.3.6)                       - 运行时验证
```

## 🎯 关键技术点

### 1. 客户端缓存策略
```typescript
const clientCache = new Map<accountId, { client, config }>();
// 重用连接，减少资源消耗
```

### 2. 多账号配置继承
```typescript
resolveAccount(accountId) {
  return merge(baseConfig, accountConfig);
}
```

### 3. 消息分块
```typescript
// Markdown 感知分块（4000字符限制）
chunkMarkdownText(text, 4000);
```

### 4. 批量操作限制
```typescript
// 文档块操作：50块/批次
BATCH_SIZE = 50;
```

### 5. 缓存 TTL
```typescript
Bot info cache: 10 minutes
Sender name cache: 10 minutes
Token cache: 10 minutes
```

### 6. 节流控制
```typescript
// 流式卡片：最大10次/秒
throttle(100ms);
```

## 📝 实施建议

### 1. 代码复用
- 直接参考 openclaw 的实现逻辑
- 保持函数签名和接口一致
- 复用错误处理和边界检查

### 2. 测试策略
- 单元测试：每个工具模块
- 集成测试：完整的消息流程
- E2E 测试：真实飞书环境

### 3. 文档完善
- 每个工具的使用文档
- 配置示例
- 错误码说明

### 4. 性能优化
- 客户端缓存
- 结果缓存
- 批量操作
- 节流控制

### 5. 安全加固
- ID-based 访问控制
- CVE 防护
- 权限错误检测
- 本地文件访问限制

## 🚀 快速开始

### 第一步：核心消息
```bash
# 实现顺序
1. send.ts - 富文本消息
2. card.ts - 卡片消息
3. media.ts - 媒体上传
```

### 第二步：业务工具
```bash
# 实现顺序
1. tools/docx.ts - 文档操作
2. tools/drive.ts - 云盘操作
3. tools/wiki.ts - 知识库操作
```

### 第三步：增强功能
```bash
# 实现顺序
1. accounts.ts - 多账号
2. policy.ts - 权限管理
3. streaming-card.ts - 流式卡片
```

## 📈 预期成果

完成后，beeclaw 将具备：

✅ **完整的飞书消息能力**（文本、富文本、卡片、媒体）
✅ **全功能的业务工具集**（文档、云盘、知识库、多维表格）
✅ **企业级的多账号支持**
✅ **高级交互能力**（流式卡片、按钮交互）
✅ **生产级的性能和稳定性**

总工作量估算：**5周**（1人全职）
