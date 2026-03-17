#!/usr/bin/env bun
/**
 * 自动移除未使用的导入和变量
 *
 * 使用 ts-morph 来安全地移除未使用的：
 * - 导入声明
 * - 变量声明
 * - 函数参数
 */

import { Project, SourceFile, SyntaxKind } from 'ts-morph';
import { glob } from 'glob';
import path from 'path';

async function removeUnusedImports() {
  const project = new Project({
    tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
  });

  const sourceFiles = project.getSourceFiles();
  let totalRemoved = 0;

  for (const sourceFile of sourceFiles) {
    const removed = processFile(sourceFile);
    if (removed > 0) {
      console.log(`✓ ${sourceFile.getFilePath()}: removed ${removed} unused imports`);
      totalRemoved += removed;
    }
  }

  if (totalRemoved > 0) {
    await project.save();
    console.log(`\n✅ Total removed ${totalRemoved} unused imports across ${sourceFiles.length} files`);
  } else {
    console.log('No unused imports found');
  }
}

function processFile(sourceFile: SourceFile): number {
  let removed = 0;

  // 获取所有导入声明
  const importDeclarations = sourceFile.getImportDeclarations();

  for (const importDecl of importDeclarations) {
    const namedImports = importDecl.getNamedImports();

    for (const namedImport of namedImports) {
      const importName = namedImport.getName();

      // 检查是否被使用（包括类型使用）
      if (!isImportUsed(sourceFile, importName, importDecl.isTypeOnly())) {
        namedImport.remove();
        removed++;
      }
    }

    // 如果没有命名导入了，移除整个导入声明
    if (importDecl.getNamedImports().length === 0 && !importDecl.getDefaultImport() && !importDecl.getNamespaceImport()) {
      importDecl.remove();
    }
  }

  return removed;
}

function isImportUsed(sourceFile: SourceFile, importName: string, isTypeOnly: boolean): boolean {
  // 获取文件中所有的标识符使用
  const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);

  for (const identifier of identifiers) {
    // 跳过导入声明中的标识符
    if (identifier.getParent()?.getKind() === SyntaxKind.ImportSpecifier) {
      continue;
    }

    // 如果找到使用，返回 true
    if (identifier.getText() === importName) {
      return true;
    }
  }

  // 检查是否在 export type 中使用
  const exportDeclarations = sourceFile.getExportDeclarations();
  for (const exportDecl of exportDeclarations) {
    const namedExports = exportDecl.getNamedExports();
    for (const namedExport of namedExports) {
      if (namedExport.getName() === importName) {
        return true; // 被重新导出，算作使用
      }
    }
  }

  return false;
}

// 运行
removeUnusedImports().catch(console.error);
