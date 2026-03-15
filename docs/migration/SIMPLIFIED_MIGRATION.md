# 简化迁移指南 - 纯 CLI 模式

## ✅ 已完成

### 1. 基础设施
- ✅ CLI Runner (`src/adapter/feishu/cli-runner.ts`)
- ✅ CLI Types (`src/adapter/feishu/cli-types.ts`)
- ✅ 配置更新（移除 mode，仅 CLI）
- ✅ 工具执行器（移除 SDK 路径）

### 2. Drive Tools
- ✅ 完全迁移到 CLI 模式
- ✅ 所有函数使用 `FeishuCLIRunner`
- ✅ 新增功能：
  - `renameFile` - 重命名文件
  - `searchFiles` - 搜索文件
  - `uploadFile` - 上传文件
  - `downloadFile` - 下载文件
  - `createShareLink` - 创建分享链接

## 🚧 待迁移

### Wiki Tools
需要更新函数签名：

```typescript
// 从
export async function listSpaces(client: Client, ...)

// 到
export async function listSpaces(runner: FeishuCLIRunner, ...)
```

### Calendar Tools
```typescript
// 从
export async function getCalendarList(client: Client, ...)

// 到
export async function getCalendarList(runner: FeishuCLIRunner, ...)
```

### Document Tools
```typescript
// 从
export async function getBlock(client: Client, ...)

// 到
export async function getBlock(runner: FeishuCLIRunner, ...)
```

### Bitable Tools
```typescript
// 从
export async function getBitableMeta(client: Client, ...)

// 到
export async function getBitableMeta(runner: FeishuCLIRunner, ...)
```

## 迁移模式

### 简单函数迁移示例

**之前（SDK）**:
```typescript
export async function listSpaces(
  client: Client,
  options?: { pageSize?: number }
): Promise<{ spaces: FeishuWikiSpace[] }> {
  const response = await client.wiki.space.list({
    params: { page_size: options?.pageSize || 20 }
  });

  if (response.code !== 0) {
    throw new Error(`Failed: ${response.msg}`);
  }

  return { spaces: response.data?.items || [] };
}
```

**之后（CLI）**:
```typescript
export async function listSpaces(
  runner: FeishuCLIRunner,
  options?: { pageSize?: number }
): Promise<{ spaces: FeishuWikiSpace[] }> {
  const args = ['list'];
  if (options?.pageSize) args.push('--page-size', String(options.pageSize));

  const result = await runner.execute<{ spaces: CLIWikiSpaceResponse[] }>(
    'wiki',
    args,
    { json: true }
  );

  if (!result.success) {
    throw new Error(`Failed to list spaces: ${result.error}`);
  }

  const spaces = result.data.spaces.map(cliSpaceToFeishuSpace);
  logger.info(`✅ Listed ${spaces.length} wiki spaces`);

  return { spaces };
}
```

### 执行器更新

**之前**:
```typescript
export async function executeWikiTool(
  client: Client,
  name: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // ... implementation using client
}
```

**之后**:
```typescript
export async function executeWikiTool(
  runner: FeishuCLIRunner,
  name: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // ... implementation using runner
}
```

## CLI 命令映射

### Wiki Commands
| Tool | CLI Command |
|------|-------------|
| `listSpaces` | `feishu wiki list` |
| `getSpaceInfo` | `feishu wiki get <space_id>` |
| `listNodes` | `feishu wiki nodes <space_id>` |
| `createPage` | `feishu wiki create --title <title>` |
| `moveNode` | `feishu wiki move <token> --parent <parent>` |
| `renameNode` | `feishu wiki rename <token> --title <title>` |
| `deleteNode` | `feishu wiki delete <token>` |
| `searchPages` | `feishu wiki search --query <query>` |

### Calendar Commands
| Tool | CLI Command |
|------|-------------|
| `getCalendarList` | `feishu calendar list` |
| `getEvent` | `feishu calendar event-get <event_id>` |
| `listEvents` | `feishu calendar events --calendar-id <id>` |
| `createEvent` | `feishu calendar event-create --summary <title>` |
| `updateEvent` | `feishu calendar event-update <event_id>` |
| `deleteEvent` | `feishu calendar event-delete <event_id>` |

### Document Commands
| Tool | CLI Command |
|------|-------------|
| `getBlock` | `feishu doc get <block_id>` |
| `listChildren` | `feishu doc children <block_id>` |
| `createBlock` | `feishu doc create --content <json>` |
| `updateBlock` | `feishu doc update <block_id> --content <json>` |
| `deleteBlock` | `feishu doc delete <block_id>` |

### Bitable Commands
| Tool | CLI Command |
|------|-------------|
| `getBitableMeta` | `feishu bitable get <app_token>` |
| `listTables` | `feishu bitable tables <app_token>` |
| `listRecords` | `feishu bitable records <app_token> <table_id>` |
| `createRecord` | `feishu bitable record-create <app_token> <table_id>` |

## 配置简化

### 旧配置（混合模式）
```json
{
  "feishu": {
    "enabled": true,
    "mode": "cli",
    "cliPath": "/usr/local/bin/feishu",
    "toolMode": {
      "feishu_drive_list": "cli",
      "feishu_calendar_event_create": "sdk"
    },
    "appId": "${FEISHU_APP_ID}",
    "appSecret": "${FEISHU_APP_SECRET}"
  }
}
```

### 新配置（纯 CLI）
```json
{
  "feishu": {
    "enabled": true,
    "cliPath": "/usr/local/bin/feishu",
    "cliTimeout": 30000,
    "cliRetries": 2,
    "appId": "${FEISHU_APP_ID}",
    "appSecret": "${FEISHU_APP_SECRET}"
  }
}
```

## 批量迁移脚本

创建 `scripts/migrate-to-cli.sh`:

```bash
#!/bin/bash
# 批量更新工具函数签名

find src/adapter/feishu/tools -name "*.ts" -type f | while read file; do
  echo "Processing $file..."

  # 替换函数签名
  sed -i '' 's/client: Client/runner: FeishuCLIRunner/g' "$file"
  sed -i '' 's/client: Client | FeishuCLIRunner/runner: FeishuCLIRunner/g' "$file"

  # 替换函数调用
  sed -i '' 's/await client\./await runner.execute(/g' "$file"

  echo "✅ Updated $file"
done

echo "Migration complete!"
```

## 测试更新

### 更新测试导入
```typescript
// 从
import { Client } from '@larksuiteoapi/node-sdk';

// 到
import { FeishuCLIRunner } from '../cli-runner';
```

### 更新 Mock
```typescript
// 从
const mockClient = {
  drive: {
    file: {
      list: jest.fn()
    }
  }
} as unknown as Client;

// 到
const mockRunner = {
  execute: jest.fn()
} as unknown as FeishuCLIRunner;
```

## 清理任务

完成迁移后：

1. ✅ 移除 `@larksuiteoapi/node-sdk` 依赖
2. ✅ 删除 SDK 客户端代码
3. ✅ 更新所有导入
4. ✅ 清理混合模式逻辑
5. ✅ 简化配置模式

## 下一步

1. **立即**: 迁移 Wiki Tools
2. **短期**: 迁移 Calendar, Docx, Bitable Tools
3. **中期**: 移除 SDK 依赖
4. **长期**: 生产部署和监控

## 验证

```bash
# 1. 运行测试
bun test

# 2. 检查类型
bun run typecheck

# 3. 验证功能
bun run cli
# 然后测试 Feishu 工具

# 4. 检查依赖
grep -r "@larksuiteoapi/node-sdk" src/
# 应该没有输出
```

---

**最后更新**: 2026-03-15
**状态**: 简化迁移策略 - 直接使用 CLI，移除 SDK
