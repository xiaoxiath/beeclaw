#!/usr/bin/env bun
/**
 * 手动处理剩余的未使用变量
 *
 * 这些主要是未使用的导入，需要手动检查并移除
 */

import { Project, SourceFile, SyntaxKind } from 'ts-morph';
import { execSync } from 'child_process';
import path from 'path';

async function fixRemainingUnused() {
  console.log('🔍 Analyzing remaining unused variables...\n');

  const lintOutput = execSync('bun lint 2>&1', {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024
  }).toString();

  const lines = lintOutput.split('\n');
  const fixes: Array<{ file: string; line: number; name: string }> = [];

  let currentFile = '';
  for (const line of lines) {
    if (line.startsWith('/')) {
      currentFile = line.trim();
      continue;
    }

    const match = line.match(/^\s+(\d+):(\d+)\s+error\s+'(.+?)' is defined but never used/);
    if (match) {
      const [, lineStr, , name] = match;
      fixes.push({
        file: currentFile,
        line: parseInt(lineStr, 10),
        name,
      });
    }
  }

  console.log(`Found ${fixes.length} unused variables to analyze:\n`);

  // 按文件分组显示
  const byFile = new Map<string, string[]>();
  for (const fix of fixes) {
    if (!byFile.has(fix.file)) {
      byFile.set(fix.file, []);
    }
    byFile.get(fix.file)!.push(`  Line ${fix.line}: ${fix.name}`);
  }

  for (const [file, vars] of byFile) {
    console.log(`\n${file}`);
    vars.forEach(v => console.log(v));
  }

  console.log('\n\n📝 These are likely unused imports or type definitions.');
  console.log('   Please review each file and remove the unused imports manually.\n');

  // 生成建议的修复命令
  console.log('💡 Suggested manual fixes:\n');
  for (const [file, vars] of byFile) {
    console.log(`# ${file}`);
    for (const v of vars) {
      const match = v.match(/Line (\d+): (.+)/);
      if (match) {
        const [, line, name] = match;
        console.log(`#   - Remove or prefix with '_': ${name} (line ${line})`);
      }
    }
    console.log('');
  }
}

fixRemainingUnused().catch(console.error);
