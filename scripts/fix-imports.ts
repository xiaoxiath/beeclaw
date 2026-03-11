/**
 * Smart Import Fixer
 *
 * Intelligently fixes relative imports after directory restructuring.
 * Calculates correct relative paths based on file locations.
 */

import { Project, SourceFile } from 'ts-morph';
import { relative, dirname } from 'path';

const project = new Project({ tsConfigFilePath: 'tsconfig.json' });

// Module location map: old name -> new location (relative to src/)
const MODULE_MAP: Record<string, string> = {
  // Layer 1: infra
  'config': 'infra/config',
  'db': 'infra/db',

  // infra/resilience
  'utils/circuit-breaker': 'infra/resilience/circuit-breaker',
  'utils/retry': 'infra/resilience/retry',
  'utils/retry-strategy': 'infra/resilience/retry-strategy',
  'utils/unified-retry': 'infra/resilience/unified-retry',
  'utils/smart-timeout': 'infra/resilience/smart-timeout',
  'utils/timeout-hierarchy': 'infra/resilience/timeout-hierarchy',
  'utils/session-lock': 'infra/resilience/session-lock',
  'utils/loop-detector': 'infra/resilience/loop-detector',

  // infra/observability
  'utils/logger': 'infra/observability/logger',
  'utils/error-handler': 'infra/observability/error-handler',
  'utils/error-tracker': 'infra/observability/error-tracker',
  'utils/errors': 'infra/observability/errors',
  'utils/observability': 'infra/observability/metrics',
  'utils/provider-errors': 'infra/observability/provider-errors',

  // infra/utils
  'utils/atomic-fs': 'infra/utils/atomic-fs',
  'utils/deduplicator': 'infra/utils/deduplicator',
  'utils/graceful-shutdown': 'infra/utils/graceful-shutdown',
  'utils/budget-manager': 'infra/utils/budget-manager',
  'utils/parallel-tool-executor': 'infra/utils/parallel-executor',
  'utils/checkpoint-manager': 'infra/utils/checkpoint-manager',
  'utils/config-center': 'infra/utils/config-center',
  'utils/activity-monitor': 'infra/utils/activity-monitor',
  'utils/progress-aware-monitor': 'infra/utils/progress-aware-monitor',
  'utils/background-tasks': 'infra/utils/background-tasks',

  // domain/tools (business utils)
  'utils/weather': 'domain/tools/weather',
  'utils/holiday': 'domain/tools/holiday',
  'utils/timezone': 'domain/tools/timezone',

  // Layer 2: domain
  'agent': 'domain/agent',
  'providers': 'domain/providers',
  'memory': 'domain/memory',
  'skills': 'domain/skills',
  'tools': 'domain/tools',
  'extraction': 'domain/extraction',
  'subagent': 'domain/subagent',
  'session': 'domain/session',
  'sandbox': 'domain/sandbox',
  'proactive': 'domain/proactive',

  // Merged into domain/agent
  'persona': 'domain/agent/persona',
  'evolution': 'domain/agent/evolution',
  'goal': 'domain/agent/goal',

  // Merged into domain/search
  'search': 'domain/search',
  'research': 'domain/search/research',

  // Merged into domain/tools/categories
  'finance': 'domain/tools/categories/finance',

  // services
  'services/session': 'domain/session/service',

  // Layer 3: adapter
  'feishu': 'adapter/feishu',
  'channel/feishu': 'adapter/feishu/channel',
  'channel/cli': 'adapter/cli/channel',
  'cli': 'adapter/cli',
  'web': 'adapter/web',
  'mcp': 'adapter/mcp',
  'plugins': 'adapter/plugins',
  'hooks': 'adapter/plugins/hooks',

  // Layer 4: app
  'services/gateway': 'app/gateway-service',
  'dispatcher': 'app/dispatcher',
  'routes': 'app/routes',
  'queue/handlers': 'app/queue-handlers/handlers',
  'queue/workers': 'app/queue-handlers/workers',
};

/**
 * Calculate the relative path from a source file to a target module
 */
function calculateRelativePath(sourceFile: SourceFile, targetModule: string): string {
  const sourcePath = sourceFile.getFilePath();
  const sourceDir = dirname(sourcePath.replace(/.*\/src\//, 'src/'));

  // Find the target module's new location
  let targetLocation = MODULE_MAP[targetModule];
  if (!targetLocation) {
    // Try prefix match
    for (const [prefix, location] of Object.entries(MODULE_MAP)) {
      if (targetModule.startsWith(prefix + '/')) {
        targetLocation = targetModule.replace(prefix, location);
        break;
      }
    }
  }

  if (!targetLocation) {
    return null; // No mapping found
  }

  // Calculate relative path
  const targetPath = `src/${targetLocation}`;
  let relativePath = relative(sourceDir, targetPath);

  // Ensure it starts with ./ or ../
  if (!relativePath.startsWith('.')) {
    relativePath = './' + relativePath;
  }

  return relativePath;
}

console.log('🔧 Fixing import paths...\n');

let totalFixed = 0;
let filesFixed = 0;

for (const sourceFile of project.getSourceFiles('src/**/*.ts')) {
  let fileChanged = false;
  const filePath = sourceFile.getFilePath();

  for (const imp of sourceFile.getImportDeclarations()) {
    const specifier = imp.getModuleSpecifierValue();

    // Skip external packages and absolute imports
    if (!specifier.startsWith('.') || specifier.startsWith('@/')) {
      continue;
    }

    // Extract module name from relative path
    const sourceDir = dirname(filePath.replace(/.*\/src\//, ''));

    // Resolve the actual module path
    let modulePath = specifier
      .replace(/^\.\.\//, '')
      .replace(/^\.\//, '');

    // Count parent directory references
    const parentCount = (specifier.match(/\.\.\//g) || []).length;

    // Build the absolute module path from the relative import
    const sourceParts = sourceDir.split('/');
    for (let i = 0; i < parentCount && sourceParts.length > 0; i++) {
      sourceParts.pop();
    }

    const absoluteModulePath = sourceParts.length > 0
      ? sourceParts.join('/') + '/' + modulePath
      : modulePath;

    // Check if this module has been moved
    const newRelativePath = calculateRelativePath(sourceFile, absoluteModulePath.replace(/\.ts$/, ''));

    if (newRelativePath && newRelativePath !== specifier) {
      const newPathWithExt = newRelativePath + (specifier.endsWith('.ts') ? '.ts' : '');
      imp.setModuleSpecifier(newRelativePath);

      console.log(`  ${filePath.split('/').slice(-2).join('/')}: ${specifier} → ${newRelativePath}`);
      fileChanged = true;
      totalFixed++;
    }
  }

  if (fileChanged) {
    filesFixed++;
  }
}

console.log(`\n✅ Fixed ${totalFixed} imports in ${filesFixed} files`);
console.log('💾 Saving changes...');

project.saveSync();

console.log('✨ Import fix complete!');
