# 飞书文档和云盘功能使用指南

## 📄 文档操作 (Docx)

### 基础概念

飞书文档采用块（Block）结构：
- **Block**: 文档的基本单元（段落、标题、表格等）
- **Document**: 文档根节点
- **Children**: 子块列表

### 1. 获取文档内容

#### 获取单个块
```typescript
import { getBlock } from './feishu';

const block = await getBlock(
  client,
  'doccnxxxxxx', // document_id
  'doccnxxxxxx'  // block_id (通常文档根节点ID与document_id相同)
);

console.log('Block type:', block.type);
console.log('Block text:', block.text);
```

#### 列出子块
```typescript
import { listChildren } from './feishu';

const { blocks, hasMore } = await listChildren(
  client,
  'doccnxxxxxx',
  'doccnxxxxxx' // parent block id
);

for (const block of blocks) {
  console.log(`- ${block.block_id}: type=${block.type}`);
}
```

### 2. 创建文本内容

#### 创建简单文本
```typescript
import { createTextBlock } from './feishu';

// 普通文本
const block = await createTextBlock(
  client,
  'doccnxxxxxx',
  'parentBlockId',
  '这是一段普通文本'
);

// 标题
const heading = await createTextBlock(
  client,
  'doccnxxxxxx',
  'parentBlockId',
  '这是一级标题',
  { style: 'heading1' }
);

// 列表
const bullet = await createTextBlock(
  client,
  'doccnxxxxxx',
  'parentBlockId',
  '列表项1',
  { style: 'bullet' }
);
```

#### 批量创建
```typescript
import { appendBlocks } from './feishu';

const blocks = await appendBlocks(
  client,
  'doccnxxxxxx',
  'parentBlockId',
  [
    {
      type: 3, // heading1
      text: {
        elements: [{ text_run: { content: '标题1' } }],
      },
    },
    {
      type: 2, // text
      text: {
        elements: [{ text_run: { content: '段落内容' } }],
      },
    },
    {
      type: 12, // bullet
      text: {
        elements: [{ text_run: { content: '列表项' } }],
      },
    },
  ]
);
```

### 3. 表格操作

#### 创建表格
```typescript
import { createTable } from './feishu';

const table = await createTable(
  client,
  'doccnxxxxxx',
  'parentBlockId',
  3, // rows
  2, // columns
  { index: 0 } // insert position
);

console.log('Table created:', table.block_id);
```

#### 插入行/列
```typescript
import { insertTableRow, insertTableColumn } from './feishu';

// 在第2行位置插入新行
await insertTableRow(
  client,
  'doccnxxxxxx',
  'tableBlockId',
  2 // row index
);

// 在第1列位置插入新列
await insertTableColumn(
  client,
  'doccnxxxxxx',
  'tableBlockId',
  1 // column index
);
```

#### 删除行/列
```typescript
import { deleteTableRow, deleteTableColumn } from './feishu';

await deleteTableRow(client, 'doccnxxxxxx', 'tableBlockId', 1);
await deleteTableColumn(client, 'doccnxxxxxx', 'tableBlockId', 2);
```

### 4. 搜索文档
```typescript
import { searchDocument } from './feishu';

const { results } = await searchDocument(
  client,
  'doccnxxxxxx',
  '关键词'
);

for (const result of results) {
  console.log(`Found in block ${result.block.block_id}`);
  console.log('Highlights:', result.highlights);
}
```

### 5. 更新和删除

#### 更新块内容
```typescript
import { updateBlock } from './feishu';

const block = await updateBlock(
  client,
  'doccnxxxxxx',
  'blockId',
  {
    text: {
      elements: [{
        text_run: { content: '更新后的内容' },
      }],
    },
  }
);
```

#### 删除块
```typescript
import { deleteBlock } from './feishu';

await deleteBlock(client, 'doccnxxxxxx', 'blockId');
```

### 6. 完整示例：创建周报

```typescript
import {
  createTextBlock,
  appendBlocks,
  createTable,
  insertTableRow,
} from './feishu';

async function createWeeklyReport(
  client: any,
  documentId: string,
  data: {
    week: string;
    tasks: Array<{
      project: string;
      task: string;
      status: string;
      progress: number;
    }>;
  }
) {
  // 1. 添加标题
  await createTextBlock(
    client,
    documentId,
    documentId,
    `📅 ${data.week} 周报`,
    { style: 'heading1' }
  );

  // 2. 添加项目进度
  await createTextBlock(
    client,
    documentId,
    documentId,
    '## 项目进度',
    { style: 'heading2' }
  );

  // 3. 创建进度表格
  const table = await createTable(
    client,
    documentId,
    documentId,
    1, // 1行（表头）
    4, // 4列
    { index: -1 } // append to end
  );

  // 4. 填充表头
  // (这里需要通过API设置单元格内容，具体实现略)

  // 5. 添加每个任务
  for (const task of data.tasks) {
    await insertTableRow(
      client,
      documentId,
      table.block_id,
      1
    );
    // 填充任务数据...
  }

  console.log('✅ 周报创建完成');
}
```

## 📁 云盘操作 (Drive)

### 基础概念

- **Token**: 文件或文件夹的唯一标识
- **Root Token**: 根目录的token（通常通过API获取）
- **File Type**: file 或 folder

### 1. 浏览文件

#### 列出文件夹内容
```typescript
import { listFiles, getRootFolderToken } from './feishu';

// 获取根目录token
const rootToken = await getRootFolderToken(client);

// 列出根目录文件
const { files, hasMore } = await listFiles(
  client,
  rootToken // 或使用 'root' 字符串
);

for (const file of files) {
  console.log(`${file.type === 'folder' ? '📁' : '📄'} ${file.name}`);
  console.log(`  Token: ${file.token}`);
  console.log(`  Size: ${file.size || 'N/A'}`);
}
```

#### 分页浏览
```typescript
let pageToken: string | undefined;
let allFiles: FeishuFile[] = [];

do {
  const result = await listFiles(client, 'root', {
    pageSize: 100,
    pageToken,
  });

  allFiles.push(...result.files);
  pageToken = result.pageToken;
} while (pageToken);

console.log(`Total files: ${allFiles.length}`);
```

### 2. 文件夹操作

#### 创建文件夹
```typescript
import { createFolder } from './feishu';

const folder = await createFolder(
  client,
  'root', // parent folder
  '项目文档'
);

console.log('Created folder:', folder.token);
```

#### 获取文件信息
```typescript
import { getFileInfo } from './feishu';

const file = await getFileInfo(client, 'fileToken');
console.log('File name:', file.name);
console.log('File type:', file.type);
console.log('Created:', file.create_time);
console.log('Modified:', file.modify_time);
```

### 3. 文件操作

#### 移动文件
```typescript
import { moveFile } from './feishu';

await moveFile(
  client,
  'fileToken',
  'destinationFolderToken' // 或 'root'
);
```

#### 复制文件
```typescript
import { copyFile } from './feishu';

const newFile = await copyFile(
  client,
  'sourceFileToken',
  'destinationFolderToken',
  '新文件名.docx' // optional
);
```

#### 重命名文件
```typescript
import { renameFile } from './feishu';

const file = await renameFile(
  client,
  'fileToken',
  '新名称'
);
```

#### 删除文件
```typescript
import { deleteFile } from './feishu';

await deleteFile(client, 'fileToken', 'file');
await deleteFile(client, 'folderToken', 'folder');
```

### 4. 搜索文件

```typescript
import { searchFiles } from './feishu';

const { files } = await searchFiles(
  client,
  '项目报告'
);

for (const file of files) {
  console.log(`${file.name} - ${file.token}`);
}
```

### 5. 文件上传下载

#### 下载文件
```typescript
import { downloadFile } from './feishu';

const buffer = await downloadFile(client, 'fileToken');
console.log(`Downloaded ${buffer.length} bytes`);

// 保存到本地
import { writeFile } from 'fs/promises';
await writeFile('/path/to/file.docx', buffer);
```

#### 上传文件
```typescript
import { uploadFile } from './feishu';
import { readFile } from 'fs/promises';

const fileData = await readFile('/path/to/local/file.pdf');

const file = await uploadFile(
  client,
  'root', // parent folder
  'document.pdf',
  fileData
);

console.log('Uploaded:', file.token);
```

### 6. 分享功能

#### 创建分享链接
```typescript
import { createShareLink } from './feishu';

const { link, shortLink } = await createShareLink(
  client,
  'fileToken',
  {
    password: '1234', // optional
    expireTime: '2026-03-10T00:00:00Z', // optional
  }
);

console.log('Share link:', link);
console.log('Short link:', shortLink);
```

### 7. 完整示例：批量整理文件

```typescript
import {
  listFiles,
  createFolder,
  moveFile,
  getFileInfo,
} from './feishu';

async function organizeFiles(
  client: any,
  rootToken: string
) {
  // 1. 列出所有文件
  const { files } = await listFiles(client, rootToken);

  // 2. 按扩展名分组
  const groups: Record<string, typeof files> = {};

  for (const file of files) {
    if (file.type === 'folder') continue;

    const ext = file.file_extension || 'other';
    if (!groups[ext]) groups[ext] = [];
    groups[ext].push(file);
  }

  // 3. 为每组创建文件夹并移动文件
  for (const [ext, files] of Object.entries(groups)) {
    // 创建文件夹
    const folder = await createFolder(
      client,
      rootToken,
      `${ext.toUpperCase()} 文件`
    );

    // 移动文件
    for (const file of files) {
      await moveFile(client, file.token, folder.token);
      console.log(`✅ Moved ${file.name} to ${folder.name}`);
    }
  }

  console.log('✅ 文件整理完成');
}
```

## 🔧 工具调用方式

### 直接调用函数
```typescript
import { executeDocxTool, executeDriveTool } from './feishu';

// 文档工具
const result = await executeDocxTool(client, 'feishu_docx_get', {
  documentId: 'xxx',
  blockId: 'yyy',
});

if (result.success) {
  console.log('Block:', result.data);
} else {
  console.error('Error:', result.error);
}

// 云盘工具
const driveResult = await executeDriveTool(client, 'feishu_drive_list', {
  folderToken: 'root',
});

if (driveResult.success) {
  console.log('Files:', driveResult.data.files);
}
```

## 📚 Block 类型参考

| Type ID | 名称 | 说明 |
|---------|------|------|
| 1 | page | 页面/文档根节点 |
| 2 | text | 普通文本 |
| 3-11 | heading1-9 | 标题1-9级 |
| 12 | bullet | 无序列表 |
| 13 | ordered | 有序列表 |
| 14 | code | 代码块 |
| 15 | quote | 引用 |
| 17 | todo | 待办事项 |
| 22 | divider | 分割线 |
| 27 | image | 图片 |
| 31 | table | 表格 |

## 🎯 最佳实践

### 1. 批量操作
- 使用 `appendBlocks` 而不是多次 `createTextBlock`
- 限制每次批量操作在 50 个块以内

### 2. 错误处理
```typescript
try {
  const file = await getFileInfo(client, token);
} catch (error) {
  if (error.message.includes('not found')) {
    console.log('File not found');
  } else {
    throw error;
  }
}
```

### 3. Token 缓存
```typescript
// 缓存根目录token
let cachedRootToken: string;

async function getRootToken() {
  if (!cachedRootToken) {
    cachedRootToken = await getRootFolderToken(client);
  }
  return cachedRootToken;
}
```

### 4. 分页处理
```typescript
async function getAllFiles(token: string) {
  const allFiles: FeishuFile[] = [];
  let pageToken: string | undefined;

  do {
    const { files, pageToken: next } = await listFiles(client, token, {
      pageToken,
      pageSize: 100,
    });

    allFiles.push(...files);
    pageToken = next;
  } while (pageToken);

  return allFiles;
}
```

## 🐛 常见问题

### Q: 如何获取文档的 document_id？
A: 从飞书文档URL中提取，格式通常是 `https://xxx.feishu.cn/docx/DOCNxxxxx`，其中 `DOCNxxxxx` 就是 document_id。

### Q: Block 的 type 数字对应什么？
A: 参考 Block 类型参考表，或使用 `BLOCK_TYPE_NAMES` 映射。

### Q: 为什么 root token 不是 '0'？
A: 每个用户的 root token 可能不同，应该通过 `getRootFolderToken()` 获取。

### Q: 表格操作后数据丢失？
A: 确保在操作前获取最新的 document_revision_id，或使用 -1 表示最新版本。
