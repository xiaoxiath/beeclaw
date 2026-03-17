#!/usr/bin/env bun
/**
 * 修复 ESLint 错误
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const errors = execSync('bun lint 2>&1', { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });

// 解析错误
const errorLines = errors.split('\n').filter(line => line.includes('  error'));

console.log(`Found ${errorLines.length} errors to fix\n`);

// 按文件分组
const fileErrors = new Map<string, string[]>();
let currentFile = '';

for (const line of errors.split('\n')) {
  if (line.startsWith('/Users')) {
    currentFile = line.trim();
  } else if (line.includes('  error')) {
    if (!fileErrors.has(currentFile)) {
      fileErrors.set(currentFile, []);
    }
    fileErrors.get(currentFile)!.push(line);
  }
}

console.log(`Files with errors: ${fileErrors.size}\n`);

// 分类统计
const errorTypes = new Map<string, number>();
for (const [file, errors] of fileErrors) {
  for (const error of errors) {
    const type = error.split('@typescript-eslint/').pop()?.trim() || error.split('  error')[1]?.trim();
    if (type) {
      errorTypes.set(type, (errorTypes.get(type) || 0) + 1);
    }
  }
}

console.log('Error types:');
const sorted = Array.from(errorTypes.entries()).sort((a, b) => b[1] - a[1]);
sorted.forEach(([type, count]) => console.log(`  ${count}\t${type}`));

console.log('\n\nSuggested fixes:\n');
console.log('1. Run: bun lint --fix (auto-fix what can be auto-fixed)');
console.log('2. Manual fixes needed for:');
console.log('   - no-constant-condition (while(true) loops)');
console.log('   - no-require-imports (convert to ES imports)');
console.log('   - no-unused-vars (remove or prefix with _)');
console.log('   - no-empty-object-type (use type alias instead)');
console.log('   - no-explicit-any (use proper types)');
