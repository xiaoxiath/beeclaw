# Feishu Tools Migration Template

## 已完成 ✅

### Drive Tools (`src/adapter/feishu/tools/drive.ts`)
- ✅ 支持双模式执行（SDK + CLI）
- ✅ 所有主要函数已迁移：
  - `listFiles` - 列出文件
  - `getFileInfo` - 获取文件信息
  - `createFolder` - 创建文件夹
  - `createDocument` - 创建文档
  - `moveFile` - 移动文件
  - `copyFile` - 复制文件
  - `deleteFile` - 删除文件
  - `uploadFile` - 上传文件（SDK only）
  - `downloadFile` - 下载文件（SDK only）
  - `getFilePermissions` - 获取权限（SDK only）
  - `renameFile` - 不支持
  - `searchFiles` - 不支持
  - `createShareLink` - 不支持

## 待迁移 🚧

### Wiki Tools (`src/adapter/feishu/tools/wiki.ts`)
- ⬜ `listSpaces` - 列出知识库
- ⬜ `getSpaceInfo` - 获取知识库信息
- ⬜ `listNodes` - 列出节点
- ⬜ `getNodeInfo` - 获取节点信息
- ⬜ `createPage` - 创建页面
- ⬜ `moveNode` - 移动节点
- ⬜ `renameNode` - 重命名节点
- ⬜ `deleteNode` - 删除节点
- ⬜ `copyNode` - 复制节点
- ⬜ `searchPages` - 搜索页面
- ⬜ `getNodeTree` - 获取节点树

### Calendar Tools (`src/adapter/feishu/tools/calendar.ts`)
需要用户授权，优先级较低

### Document Tools (`src/adapter/feishu/tools/docx.ts`)
复杂度高，优先级较低

### Bitable Tools (`src/adapter/feishu/tools/bitable.ts`)
复杂度中等，优先级较低

## 迁移模式

### 模式检测函数
```typescript
function isCLI(clientOrRunner: Client | FeishuCLIRunner): clientOrRunner is FeishuCLIRunner {
  return clientOrRunner && typeof (clientOrRunner as any).execute === 'function';
}
```

### 双模式函数模板
```typescript
export async function functionName(
  clientOrRunner: Client | FeishuCLIRunner,
  ...args: any[]
): Promise<ReturnType> {
  // CLI execution path
  if (isCLI(clientOrRunner)) {
    const args = ['command', 'subcommand', ...];
    const result = await clientOrRunner.execute<ResponseType>(
      'command',
      args,
      { json: true }
    );

    if (!result.success) {
      throw new Error(`Failed to ...: ${result.error}`);
    }

    logger.info(`✅ ... via CLI`);
    return convertCLIResponseToType(result.data);
  }

  // SDK execution path (existing code)
  const client = clientOrRunner as Client;
  try {
    const response = await client.xxx.yyy.zzz({ ... });
    if (response.code !== 0) {
      throw new Error(`Failed to ...: ${response.msg}`);
    }
    logger.info(`✅ ...`);
    return response.data;
  } catch (error) {
    logger.error('Failed to ...:', error);
    throw error;
  }
}
```

### 类型转换函数
```typescript
// 在 cli-types.ts 中定义
export function cliXxxToFeishuXxx(cliObj: CLIXxxResponse): FeishuXxx {
  return {
    field1: cliObj.field1,
    field2: cliObj.field2,
    // ... 字段映射
  };
}
```

## 下一步行动

1. **立即**: 迁移 Wiki Tools 的核心函数
   - `listSpaces`
   - `listNodes`
   - `createPage`

2. **短期**: 完成所有 Wiki Tools

3. **中期**: 迁移 Calendar Tools（需要用户授权支持）

4. **长期**: 迁移 Docx 和 Bitable Tools

## 测试策略

### 单元测试
```typescript
describe('Drive Tools', () => {
  it('should list files via CLI', async () => {
    const mockRunner = createMockCLIRunner();
    const result = await listFiles(mockRunner, 'folder_token');
    expect(result.files).toBeDefined();
  });

  it('should list files via SDK', async () => {
    const mockClient = createMockClient();
    const result = await listFiles(mockClient, 'folder_token');
    expect(result.files).toBeDefined();
  });
});
```

### 集成测试
```bash
# CLI mode
FEISHU_MODE=cli bun test tests/integration/feishu-drive.test.ts

# SDK mode
FEISHU_MODE=sdk bun test tests/integration/feishu-drive.test.ts
```

## 性能基准

### 目标
- CLI overhead: < 200ms
- Test coverage: > 80%
- Zero breaking changes

### 测量方法
```typescript
const start = Date.now();
await executeDriveTool(clientOrRunner, 'feishu_drive_list', params);
const duration = Date.now() - start;
console.log(`Duration: ${duration}ms`);
```
