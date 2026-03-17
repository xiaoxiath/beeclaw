#!/usr/bin/env bun
/**
 * 自动修复未使用的变量
 *
 * 策略：
 * 1. 未使用的函数参数 -> 添加 _ 前缀
 * 2. 未使用的 catch 错误 -> 添加 _ 前缀
 * 3. 未使用的导入 -> 移除（已在 remove-unused-imports.ts 中处理）
 */

import { Project, SourceFile, SyntaxKind, Node, ParameterDeclaration, CatchClause } from 'ts-morph';
import { execSync } from 'child_process';
import path from 'path';

interface UnusedVar {
  file: string;
  line: number;
  column: number;
  name: string;
  type: 'parameter' | 'catch' | 'variable';
}

async function fixUnusedVariables() {
  console.log('🔍 Running ESLint to detect unused variables...\n');

  // 运行 ESLint 获取未使用变量列表
  let lintOutput: string;
  try {
    lintOutput = execSync('bun lint 2>&1', { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
  } catch (error: any) {
    // ESLint 返回非零退出码时，stdout 包含输出
    lintOutput = error.stdout || error.message;
  }

  const unusedVars = parseLintOutput(lintOutput);

  console.log(`Found ${unusedVars.length} unused variables\n`);

  // 按 file 分组
  const byFile = new Map<string, UnusedVar[]>();
  for (const v of unusedVars) {
    if (!byFile.has(v.file)) {
      byFile.set(v.file, []);
    }
    byFile.get(v.file)!.push(v);
  }

  // 创建 ts-morph 项目
  const project = new Project({
    tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
  });

  let totalFixed = 0;

  // 处理每个文件
  for (const [filePath, vars] of byFile) {
    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) {
      console.log(`⚠️  Skipping ${filePath} (not in project)`);
      continue;
    }

    const fixed = fixFile(sourceFile, vars);
    if (fixed > 0) {
      console.log(`✓ ${filePath}: fixed ${fixed} unused variables`);
      totalFixed += fixed;
    }
  }

  if (totalFixed > 0) {
    await project.save();
    console.log(`\n✅ Total fixed ${totalFixed} unused variables`);
  } else {
    console.log('No unused variables to fix');
  }
}

function parseLintOutput(output: string): UnusedVar[] {
  const lines = output.split('\n');
  const result: UnusedVar[] = [];
  let currentFile = '';

  for (const line of lines) {
    // 文件路径行
    if (line.startsWith('/')) {
      currentFile = line.trim();
      continue;
    }

    // 错误行
    const match = line.match(/^\s+(\d+):(\d+)\s+error\s+'(.+?)' is defined but never used/);
    if (match) {
      const [, lineStr, colStr, name] = match;
      const lineNum = parseInt(lineStr, 10);
      const colNum = parseInt(colStr, 10);

      // 判断类型
      let type: 'parameter' | 'catch' | 'variable' = 'variable';
      if (line.includes('caught errors')) {
        type = 'catch';
      } else if (line.includes('args')) {
        type = 'parameter';
      }

      result.push({
        file: currentFile,
        line: lineNum,
        column: colNum,
        name,
        type,
      });
    }
  }

  return result;
}

function fixFile(sourceFile: SourceFile, vars: UnusedVar[]): number {
  let fixed = 0;

  // 按行号排序，从后往前处理（避免行号变化）
  const sortedVars = [...vars].sort((a, b) => b.line - a.line || b.column - a.column);

  for (const v of sortedVars) {
    try {
      const node = findNodeAtPosition(sourceFile, v.line, v.column);
      if (!node) continue;

      if (Node.isParameterDeclaration(node)) {
        // 函数参数：添加 _ 前缀
        const name = node.getName();
        if (!name.startsWith('_')) {
          node.rename('_' + name);
          fixed++;
        }
      } else if (Node.isCatchClause(node)) {
        // catch 子句：找到错误变量声明
        const clause = node as CatchClause;
        const declaration = clause.getVariableDeclaration();
        if (declaration) {
          const name = declaration.getName();
          if (!name.startsWith('_')) {
            declaration.rename('_' + name);
            fixed++;
          }
        }
      } else if (Node.isVariableDeclaration(node)) {
        // 变量声明：如果是解构，可能需要特殊处理
        const name = node.getName();
        if (!name.startsWith('_')) {
          node.rename('_' + name);
          fixed++;
        }
      } else if (Node.isBindingElement(node)) {
        // 解构元素
        const name = node.getName();
        if (!name.startsWith('_')) {
          node.rename('_' + name);
          fixed++;
        }
      }
    } catch (error) {
      console.log(`  ⚠️  Failed to fix at line ${v.line}: ${error}`);
    }
  }

  return fixed;
}

function findNodeAtPosition(sourceFile: SourceFile, line: number, column: number): Node | undefined {
  // ts-morph 使用 1-based 行号，列号基于 tab 宽度
  // 获取该行的起始位置
  const lineStart = sourceFile.compilerNode.getLineStarts()[line - 1];
  if (lineStart === undefined) return undefined;

  // 计算位置（列号是从第一个非空字符开始计数的）
  const position = lineStart + column - 1;

  // 查找该位置的节点
  let node: Node | undefined = sourceFile.getDescendantAtPos(position);

  // 向上查找，直到找到我们需要的节点类型
  while (node) {
    if (
      Node.isParameterDeclaration(node) ||
      Node.isCatchClause(node) ||
      Node.isVariableDeclaration(node) ||
      Node.isBindingElement(node)
    ) {
      return node;
    }
    node = node.getParent();
  }

  return undefined;
}

// 运行
fixUnusedVariables().catch(console.error);
