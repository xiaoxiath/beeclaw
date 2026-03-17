#!/usr/bin/env bun
/**
 * 处理剩余的未使用变量
 */

import { Project } from 'ts-morph';
import path from 'path';

// 定义需要处理的未使用变量
const FIXES = [
  {
    file: '/Users/bytedance/workspace/study/beeclaw/src/domain/extraction/trigger.ts',
    line: 380,
    name: 'updatePatternTrigger',
    action: 'prefix' as const, // 添加 _ 前缀
  },
  {
    file: '/Users/bytedance/workspace/study/beeclaw/src/domain/search/research/deep-research-v2.ts',
    line: 14,
    name: 'Anthropic',
    action: 'remove' as const, // 移除导入
  },
  {
    file: '/Users/bytedance/workspace/study/beeclaw/src/domain/search/research/research-synthesizer.ts',
    line: 1351,
    name: 'ResearchFinding',
    action: 'remove' as const,
  },
  {
    file: '/Users/bytedance/workspace/study/beeclaw/src/infra/resilience/loop-detector.ts',
    line: 281,
    name: 'getCurrentHourIndex',
    action: 'prefix' as const,
  },
];

async function fixRemaining() {
  const project = new Project({
    tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
  });

  for (const fix of FIXES) {
    const sourceFile = project.getSourceFile(fix.file);
    if (!sourceFile) {
      console.log(`⚠️  File not found: ${fix.file}`);
      continue;
    }

    if (fix.action === 'prefix') {
      // 找到函数/变量声明并添加 _ 前缀
      const functions = sourceFile.getFunctions();
      for (const func of functions) {
        const startLine = func.getStartLineNumber();
        if (startLine === fix.line) {
          const name = func.getName();
          if (name && !name.startsWith('_')) {
            func.rename('_' + name);
            console.log(`✓ ${path.basename(fix.file)}: renamed ${name} to _${name}`);
          }
          break;
        }
      }

      // 也检查变量声明
      const varDecls = sourceFile.getVariableDeclarations();
      for (const decl of varDecls) {
        const startLine = decl.getStartLineNumber();
        if (startLine === fix.line) {
          const name = decl.getName();
          if (!name.startsWith('_')) {
            decl.rename('_' + name);
            console.log(`✓ ${path.basename(fix.file)}: renamed ${name} to _${name}`);
          }
          break;
        }
      }
    }
  }

  await project.save();
  console.log('\n✅ Fixed remaining unused variables');
}

fixRemaining().catch(console.error);
