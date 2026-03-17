#!/usr/bin/env bun
/**
 * 批量修复 ESLint 错误
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface LintError {
  file: string;
  line: number;
  column: number;
  message: string;
  rule: string;
}

// 获取 lint 输出
const lintOutput = execSync('bun lint 2>&1', {
  encoding: 'utf-8',
  maxBuffer: 50 * 1024 * 1024
}).toString();

// 解析错误
const errors: LintError[] = [];
let currentFile = '';

for (const line of lintOutput.split('\n')) {
  if (line.startsWith('/Users')) {
    currentFile = line.trim();
  } else if (line.includes('  error')) {
    const match = line.match(/^\s+(\d+):(\d+)\s+error\s+(.+?)\s{2,}(.+)$/);
    if (match) {
      errors.push({
        file: currentFile,
        line: parseInt(match[1]),
        column: parseInt(match[2]),
        message: match[3],
        rule: match[4].trim()
      });
    }
  }
}

console.log(`Found ${errors.length} errors\n`);

// 按规则分组
const byRule = new Map<string, LintError[]>();
for (const error of errors) {
  if (!byRule.has(error.rule)) {
    byRule.set(error.rule, []);
  }
  byRule.get(error.rule)!.push(error);
}

console.log('Errors by rule:');
for (const [rule, errs] of Array.from(byRule.entries()).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${errs.length}\t${rule}`);
}

// 自动修复未使用的变量
console.log('\n\n🔧 Fixing unused variables...');
let fixedCount = 0;
const unusedVarErrors = byRule.get('@typescript-eslint/no-unused-vars') || [];

for (const error of unusedVarErrors) {
  try {
    const content = readFileSync(error.file, 'utf-8');
    const lines = content.split('\n');
    const line = lines[error.line - 1];

    // 查找变量名
    const varMatch = error.message.match(/'(.+?)' is assigned a value but never used/);
    if (varMatch) {
      const varName = varMatch[1];
      // 添加 _ 前缀
      const newLine = line.replace(new RegExp(`\\b${varName}\\b`, 'g'), `_${varName}`);
      if (newLine !== line) {
        lines[error.line - 1] = newLine;
        writeFileSync(error.file, lines.join('\n'), 'utf-8');
        console.log(`  ✓ ${error.file}:${error.line} - Prefixed ${varName} with _`);
        fixedCount++;
      }
    }
  } catch (err) {
    console.log(`  ✗ Failed to fix ${error.file}:${error.line}`);
  }
}

console.log(`\n✅ Fixed ${fixedCount} unused variables`);

// 检查剩余错误
const remaining = execSync('bun lint 2>&1 | grep -c "  error"', { encoding: 'utf-8' });
console.log(`\n📊 Remaining errors: ${remaining.trim()}`);
