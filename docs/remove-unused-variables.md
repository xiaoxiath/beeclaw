# 移除未使用变量指南

## 概述

本项目已配置完整的工程化工具链，用于检测和移除未使用的变量。

## 已完成的配置

### 1. ESLint 配置（`.eslintrc.json`）

添加了严格的 `@typescript-eslint/no-unused-vars` 规则：

```json
"@typescript-eslint/no-unused-vars": [
  "error",
  {
    "args": "all",
    "argsIgnorePattern": "^_",
    "caughtErrors": "all",
    "caughtErrorsIgnorePattern": "^_",
    "destructuredArrayIgnorePattern": "^_",
    "varsIgnorePattern": "^_",
    "ignoreRestSiblings": true
  }
]
```

**特性**：
- 以 `_` 开头的变量被视为有意未使用（不会报错）
- 捕获的错误变量（catch）也支持 `_` 前缀
- 解构数组的忽略模式支持 `_` 前缀

### 2. TypeScript 编译器选项（`tsconfig.json`）

添加了编译时检查：

```json
{
  "noUnusedLocals": true,
  "noUnusedParameters": true
}
```

## 使用方法

### 1. 检测未使用的导入

```bash
# 运行 ESLint 检查
bun lint

# 只看未使用变量
bun lint 2>&1 | grep "is defined but never used"
```

### 2. 自动移除未使用的导入

```bash
# 运行自动清理脚本（推荐）
bun run lint:cleanup

# 该脚本会：
# - 扫描所有 TypeScript 文件
# - 安全移除未使用的命名导入
# - 如果导入声明完全未使用，移除整个声明
```

### 3. 检测未使用的导出

```bash
# 检测未被其他文件引用的导出
bun run lint:unused

# 更严格的检查（包括模块内部未使用）
bun run lint:unused:strict
```

### 4. 手动修复未使用的参数

对于未使用的函数参数，有两种处理方式：

**方式一：添加 `_` 前缀（推荐）**

```typescript
// ❌ 错误：未使用的参数
function handleClick(event: Event) {
  console.log('clicked');
}

// ✅ 正确：使用 _ 前缀标记有意未使用
function handleClick(_event: Event) {
  console.log('clicked');
}
```

**方式二：使用解构忽略**

```typescript
// ❌ 错误：未使用的变量
const [first, second] = array;

// ✅ 正确：标记忽略
const [first, _second] = array;
```

### 5. 处理未使用的 catch 错误

```typescript
// ❌ 错误：未使用的错误变量
try {
  await riskyOperation();
} catch (error) {
  console.log('Failed');
}

// ✅ 正确：使用 _ 前缀
try {
  await riskyOperation();
} catch (_error) {
  console.log('Failed');
}

// 或者使用错误信息
try {
  await riskyOperation();
} catch (error) {
  console.error('Operation failed:', error.message);
}
```

## 最佳实践

### 1. 定期运行清理

```bash
# 建议在代码提交前运行
bun run lint:cleanup && bun lint
```

### 2. CI/CD 集成

在 CI 中添加检查：

```yaml
- name: Check for unused variables
  run: bun lint
```

### 3. IDE 配置

**VS Code 设置**（`.vscode/settings.json`）：

```json
{
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.preferences.importModuleSpecifier": "relative"
}
```

### 4. 预提交钩子

使用 lint-staged 自动修复：

```json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "bun run lint:cleanup"
    ]
  }
}
```

## 统计数据

- **初始状态**：224 个未使用变量
- **自动移除**：136 个未使用导入（60%）
- **剩余**：88 个需要手动处理（主要是函数参数）

## 常见问题

### Q: 为什么有些导入没有被自动移除？

A: 脚本只移除命名导入（named imports）。默认导入和命名空间导入需要手动检查：

```typescript
// 自动移除
import { unused } from 'module';

// 需要手动处理
import unused from 'module';
import * as unused from 'module';
```

### Q: 如何处理类型导入？

A: TypeScript 的类型导入在编译后会被移除，但如果未使用，ESLint 仍会报错：

```typescript
// ❌ 未使用的类型
import { UnusedType } from './types';

// ✅ 使用 type 关键字
import type { UnusedType } from './types';

// 或移除未使用的类型导入
```

### Q: 测试文件中的未使用变量怎么办？

A: 测试文件（`*.test.ts` 和 `**/__tests__/**`）已在 `.eslintrc.json` 中被忽略，不会触发错误。

## 工具对比

| 工具 | 用途 | 自动修复 |
|------|------|----------|
| ESLint | 检测所有未使用变量 | ❌（需要手动） |
| ts-prune | 检测未使用的导出 | ❌ |
| lint:cleanup | 移除未使用的导入 | ✅ |
| TypeScript | 编译时检查 | ❌ |

## 下一步

1. 运行 `bun lint` 查看剩余的 88 个未使用变量
2. 逐个文件修复，将未使用的参数添加 `_` 前缀
3. 考虑移除真正不需要的变量/参数
4. 在 CI 中添加 lint 检查，防止新增未使用变量

## 参考资料

- [TypeScript: noUnusedLocals](https://www.typescriptlang.org/tsconfig#noUnusedLocals)
- [ESLint: no-unused-vars](https://eslint.org/docs/latest/rules/no-unused-vars)
- [ts-morph](https://ts-morph.com/)
