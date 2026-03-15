#!/usr/bin/env bun

/**
 * Feishu Permission Checker
 *
 * 检查飞书应用权限配置是否完整
 *
 * Usage:
 *   bun scripts/check-feishu-permissions.ts
 */

interface PermissionCheck {
  name: string;
  scope: string;
  required: boolean;
  description: string;
}

const PERMISSIONS: PermissionCheck[] = [
  // 日历权限
  { name: '日历-查看', scope: 'calendar:calendar:readonly', required: true, description: '获取日历列表和详情' },
  { name: '日历-管理', scope: 'calendar:calendar', required: true, description: '创建、更新日历' },
  { name: '事件-查看', scope: 'calendar:calendar_event:readonly', required: true, description: '查询日历事件' },
  { name: '事件-管理', scope: 'calendar:calendar_event', required: true, description: '创建、更新、删除事件' },

  // 文档权限
  { name: '文档-查看', scope: 'docx:document:readonly', required: true, description: '读取文档内容' },
  { name: '文档-编辑', scope: 'docx:document', required: true, description: '创建、编辑文档' },

  // 多维表格权限
  { name: '多维表格-查看', scope: 'bitable:app:readonly', required: true, description: '查询多维表格结构' },
  { name: '多维表格-管理', scope: 'bitable:app', required: true, description: '创建多维表格' },
  { name: '记录-查看', scope: 'bitable:app_table_record:readonly', required: true, description: '查询数据记录' },
  { name: '记录-管理', scope: 'bitable:app_table_record', required: true, description: '创建、更新、删除记录' },

  // 云文档权限
  { name: '云文档-查看', scope: 'drive:drive:readonly', required: true, description: '列出云盘文件' },
  { name: '云文档-管理', scope: 'drive:drive', required: true, description: '创建、移动、删除文件' },
  { name: '文件-上传', scope: 'drive:file:upload', required: true, description: '上传文件到云盘' },
  { name: '文件-下载', scope: 'drive:file:download', required: true, description: '从云盘下载文件' },

  // 知识库权限
  { name: '知识库-查看', scope: 'wiki:wiki:readonly', required: true, description: '查询知识库' },
  { name: '知识库-管理', scope: 'wiki:wiki', required: true, description: '创建、编辑知识库' },
  { name: '知识空间-获取', scope: 'wiki:space:retrieve', required: false, description: '获取知识空间' },

  // 旧版文档权限（可选）
  { name: '旧版文档-查看', scope: 'docs:doc:readonly', required: false, description: '查看旧版文档' },
  { name: '旧版文档-编辑', scope: 'docs:doc', required: false, description: '编辑旧版文档' },
];

console.log('🔍 Feishu Permission Checker\n');
console.log('📋 必需权限配置清单:\n');

const required = PERMISSIONS.filter(p => p.required);
const optional = PERMISSIONS.filter(p => !p.required);

console.log('✅ 必需权限 (核心功能):');
required.forEach((p, i) => {
  console.log(`   ${i + 1}. [${p.scope}]`);
  console.log(`      名称: ${p.name}`);
  console.log(`      说明: ${p.description}`);
});

console.log('\n📦 可选权限 (扩展功能):');
optional.forEach((p, i) => {
  console.log(`   ${i + 1}. [${p.scope}]`);
  console.log(`      名称: ${p.name}`);
  console.log(`      说明: ${p.description}`);
});

console.log('\n📝 配置步骤:\n');
console.log('1. 访问飞书开放平台:');
console.log('   https://open.feishu.cn/app/cli_a9390dcb98ba9cc6\n');

console.log('2. 进入应用 → 权限管理\n');

console.log('3. 搜索并开启上述权限\n');

console.log('4. 等待 1-5 分钟权限生效\n');

console.log('5. 运行测试验证:');
console.log('   bun test scripts/test-feishu-tools.ts\n');

console.log('🔗 快速配置链接:\n');

const scopes = PERMISSIONS.filter(p => p.required).map(p => p.scope).join(',');
const appId = 'cli_a9390dcb98ba9cc6';
console.log(`   https://open.feishu.cn/app/${appId}/auth?q=${scopes}&op_from=openapi&token_type=tenant\n`);

console.log('📚 相关文档:\n');
console.log('   • 权限配置指南: docs/feishu-tools-setup.md');
console.log('   • 错误排查文档: https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-fix-the-99991672-error\n');

console.log('✨ 配置完成后，你的飞书 Bot 就可以正常使用所有工具了！\n');
