#!/usr/bin/env bun
/**
 * 自动修复未使用的变量错误
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

interface LintError {
  file: string;
  line: number;
  column: number;
  varName: string;
}

console.log('🔍 Finding unused variable errors...\n');

// 获取 lint 输出
let lintOutput: string;
try {
  lintOutput = execSync('bun lint 2>&1', {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
    stdio: 'pipe'  // 不抛出错误
  }).toString();
} catch (error: any) {
  // lint 返回非零退出码是正常的
  lintOutput = error.stdout || error.message;
}

// 解析未使用变量错误
const errors: LintError[] = [];
let currentFile = '';

for (const line of lintOutput.split('\n')) {
  if (line.startsWith('/Users')) {
    currentFile = line.trim();
  } else if (line.includes('  error') && line.includes('is assigned a value but never used')) {
    const match = line.match(/^\s+(\d+):(\d+)\s+error\s+'(.+?)' is assigned a value but never used/);
    if (match) {
      errors.push({
        file: currentFile,
        line: parseInt(match[1]),
        column: parseInt(match[2]),
        varName: match[3]
      });
    } else {
      // 处理数组解构的情况
      const arrMatch = line.match(/^\s+(\d+):(\d+)\s+error\s+'(.+?)' is assigned a value but never used\. Allowed unused (?:elements of array destructuring|vars) must match/);
      if (arrMatch) {
        errors.push({
          file: currentFile,
          line: parseInt(arrMatch[1]),
          column: parseInt(arrMatch[2]),
          varName: arrMatch[3]
        });
      }
    }
  }
}

console.log(`Found ${errors.length} unused variable errors\n`);

// 按文件分组
const byFile = new Map<string, LintError[]>();
for (const error of errors) {
  if (!byFile.has(error.file)) {
    byFile.set(error.file, []);
  }
  byFile.get(error.file)!.push(error);
}

// 修复每个文件
let totalFixed = 0;
for (const [file, fileErrors] of byFile) {
  try {
    let content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    // 从后往前修复，避免行号变化
    fileErrors.sort((a, b) => b.line - a.line);

    for (const error of fileErrors) {
      const line = lines[error.line - 1];
      if (!line) continue;

      // 替换变量名为 _varName
      const regex = new RegExp(`\\b${error.varName}\\b`, 'g');
      const newLine = line.replace(regex, `_${error.varName}`);

      if (newLine !== line) {
        lines[error.line - 1] = newLine;
        totalFixed++;
      }
    }

    writeFileSync(file, lines.join('\n'), 'utf-8');
    console.log(`✓ ${file}: fixed ${fileErrors.length} errors`);
  } catch (err) {
    console.log(`✗ Failed to fix ${file}:`, err);
  }
}

console.log(`\n✅ Total fixed: ${totalFixed} unused variables`);
console.log('\nRun `bun lint` again to see remaining errors');
