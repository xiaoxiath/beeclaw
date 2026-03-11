/**
 * Import Path Rewrite Script
 *
 * Automatically rewrites import paths after directory restructuring.
 * Maps old paths to new layered architecture paths.
 */

import { Project } from 'ts-morph';

const REWRITES: Record<string, string> = {
  // Layer 1: infra
  '@/config': '@/infra/config',
  '@/db': '@/infra/db',

  // utils -> infra/resilience
  '@/utils/circuit-breaker': '@/infra/resilience/circuit-breaker',
  '@/utils/retry': '@/infra/resilience/retry',
  '@/utils/retry-strategy': '@/infra/resilience/retry-strategy',
  '@/utils/unified-retry': '@/infra/resilience/unified-retry',
  '@/utils/smart-timeout': '@/infra/resilience/smart-timeout',
  '@/utils/timeout-hierarchy': '@/infra/resilience/timeout-hierarchy',
  '@/utils/session-lock': '@/infra/resilience/session-lock',
  '@/utils/loop-detector': '@/infra/resilience/loop-detector',

  // utils -> infra/observability
  '@/utils/logger': '@/infra/observability/logger',
  '@/utils/error-handler': '@/infra/observability/error-handler',
  '@/utils/error-tracker': '@/infra/observability/error-tracker',
  '@/utils/errors': '@/infra/observability/errors',
  '@/utils/observability': '@/infra/observability/metrics',
  '@/utils/provider-errors': '@/infra/observability/provider-errors',

  // utils -> infra/utils (remaining utils)
  '@/utils/atomic-fs': '@/infra/utils/atomic-fs',
  '@/utils/deduplicator': '@/infra/utils/deduplicator',
  '@/utils/graceful-shutdown': '@/infra/utils/graceful-shutdown',
  '@/utils/budget-manager': '@/infra/utils/budget-manager',
  '@/utils/parallel-tool-executor': '@/infra/utils/parallel-executor',
  '@/utils/checkpoint-manager': '@/infra/utils/checkpoint-manager',
  '@/utils/config-center': '@/infra/utils/config-center',
  '@/utils/activity-monitor': '@/infra/utils/activity-monitor',
  '@/utils/progress-aware-monitor': '@/infra/utils/progress-aware-monitor',
  '@/utils/background-tasks': '@/infra/utils/background-tasks',

  // utils -> domain/tools (business tools)
  '@/utils/weather': '@/domain/tools/weather',
  '@/utils/holiday': '@/domain/tools/holiday',
  '@/utils/timezone': '@/domain/tools/timezone',

  // queue -> infra/queue (abstraction only)
  '@/queue/manager': '@/infra/queue/manager',
  '@/queue/types': '@/infra/queue/types',

  // Layer 2: domain
  '@/agent': '@/domain/agent',
  '@/providers': '@/domain/providers',
  '@/memory': '@/domain/memory',
  '@/skills': '@/domain/skills',
  '@/tools': '@/domain/tools',
  '@/extraction': '@/domain/extraction',
  '@/subagent': '@/domain/subagent',
  '@/session': '@/domain/session',
  '@/sandbox': '@/domain/sandbox',
  '@/proactive': '@/domain/proactive',

  // Merged modules -> domain/agent subdirectories
  '@/persona': '@/domain/agent/persona',
  '@/evolution': '@/domain/agent/evolution',
  '@/goal': '@/domain/agent/goal',

  // search + research -> domain/search
  '@/search': '@/domain/search',
  '@/research': '@/domain/search/research',

  // finance -> domain/tools/categories/finance
  '@/finance': '@/domain/tools/categories/finance',

  // services/session -> domain/session
  '@/services/session': '@/domain/session/service',

  // Layer 3: adapter
  '@/feishu': '@/adapter/feishu',
  '@/channel/feishu': '@/adapter/feishu/channel',
  '@/channel/cli': '@/adapter/cli/channel',
  '@/channel': '@/adapter/channel',
  '@/cli': '@/adapter/cli',
  '@/web': '@/adapter/web',
  '@/mcp': '@/adapter/mcp',
  '@/plugins': '@/adapter/plugins',
  '@/hooks': '@/adapter/plugins/hooks',

  // Layer 4: app
  '@/services/gateway': '@/app/gateway-service',
  '@/dispatcher': '@/app/dispatcher',
  '@/routes': '@/app/routes',

  // queue handlers -> app/queue-handlers
  '@/queue/handlers': '@/app/queue-handlers/handlers',
  '@/queue/workers': '@/app/queue-handlers/workers',
};

const project = new Project({ tsConfigFilePath: 'tsconfig.json' });

console.log('🔄 Starting import path rewrite...\n');

let totalChanged = 0;
let filesChanged = 0;

for (const sourceFile of project.getSourceFiles('src/**/*.ts')) {
  let changed = false;

  for (const imp of sourceFile.getImportDeclarations()) {
    const specifier = imp.getModuleSpecifierValue();

    // Skip external packages
    if (!specifier.startsWith('@/') && !specifier.startsWith('.')) {
      continue;
    }

    // Try exact match first
    if (REWRITES[specifier]) {
      imp.setModuleSpecifier(REWRITES[specifier]);
      console.log(`  ${specifier} → ${REWRITES[specifier]}`);
      changed = true;
      totalChanged++;
      continue;
    }

    // Try prefix match for paths like @/foo/bar
    for (const [from, to] of Object.entries(REWRITES)) {
      if (specifier.startsWith(from + '/')) {
        const newSpecifier = specifier.replace(from, to);
        imp.setModuleSpecifier(newSpecifier);
        console.log(`  ${specifier} → ${newSpecifier}`);
        changed = true;
        totalChanged++;
        break;
      }
    }
  }

  if (changed) {
    filesChanged++;
  }
}

console.log(`\n✅ Rewrite complete!`);
console.log(`   Files changed: ${filesChanged}`);
console.log(`   Imports rewritten: ${totalChanged}`);

// Save all changes
project.saveSync();

console.log('\n💾 All files saved');
