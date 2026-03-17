#!/usr/bin/env bun
/**
 * 移除剩余的未使用导入
 *
 * 专门处理：
 * 1. 未使用的类型导入
 * 2. 未使用的函数/变量导入
 */

import { Project, SourceFile, ImportSpecifier } from 'ts-morph';
import path from 'path';

// 手动定义需要移除的未使用导入
const REMOVALS = [
  { file: '/Users/bytedance/workspace/study/beeclaw/src/adapter/feishu/ws-client.ts', imports: ['FeishuUserId', 'FeishuOperator', 'FeishuMember', 'FeishuReceiveIdType'] },
  { file: '/Users/bytedance/workspace/study/beeclaw/src/cli.ts', imports: ['getCompressionEngine', 'getOrCreateSession', 'Session'] },
  { file: '/Users/bytedance/workspace/study/beeclaw/src/bot.ts', imports: ['getExtractionManagerInstance', 'getScheduler'] },
  { file: '/Users/bytedance/workspace/study/beeclaw/src/domain/agent/index.ts', imports: ['promptEnhanced'] },
  { file: '/Users/bytedance/workspace/study/beeclaw/src/domain/agent/parallel-executor.ts', imports: ['isParallelTool'] },
  { file: '/Users/bytedance/workspace/study/beeclaw/src/domain/extraction/index.ts', imports: ['getExtractionTrigger', 'initKnowledgeExtractor', 'getKnowledgeExtractor', 'getKnowledgeDeduper', 'initKnowledgeStore', 'getKnowledgeStore'] },
  { file: '/Users/bytedance/workspace/study/beeclaw/src/domain/extraction/trigger.ts', imports: ['updatePatternTrigger'] },
  { file: '/Users/bytedance/workspace/study/beeclaw/src/domain/search/research/deep-research.ts', imports: ['Anthropic'] },
  { file: '/Users/bytedance/workspace/study/beeclaw/src/domain/search/research/research-synthesizer.ts', imports: ['ResearchFinding'] },
  { file: '/Users/bytedance/workspace/study/beeclaw/src/infra/resilience/loop-detector.ts', imports: ['getCurrentHourIndex'] },
];

async function removeUnusedImports() {
  const project = new Project({
    tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json'),
  });

  let totalRemoved = 0;

  for (const removal of REMOVALS) {
    const sourceFile = project.getSourceFile(removal.file);
    if (!sourceFile) {
      console.log(`⚠️  File not found: ${removal.file}`);
      continue;
    }

    let removed = 0;
    for (const importName of removal.imports) {
      const namedImport = findNamedImport(sourceFile, importName);
      if (namedImport) {
        namedImport.remove();
        removed++;
        totalRemoved++;
      }
    }

    if (removed > 0) {
      console.log(`✓ ${path.relative(process.cwd(), removal.file)}: removed ${removed} unused imports`);
    }
  }

  if (totalRemoved > 0) {
    await project.save();
    console.log(`\n✅ Total removed ${totalRemoved} unused imports`);
  } else {
    console.log('No unused imports found');
  }
}

function findNamedImport(sourceFile: SourceFile, name: string): ImportSpecifier | undefined {
  for (const importDecl of sourceFile.getImportDeclarations()) {
    for (const namedImport of importDecl.getNamedImports()) {
      if (namedImport.getName() === name) {
        return namedImport;
      }
    }
  }
  return undefined;
}

removeUnusedImports().catch(console.error);
