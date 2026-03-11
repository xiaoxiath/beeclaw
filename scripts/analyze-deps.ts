import { Project } from 'ts-morph';

const project = new Project({ tsConfigFilePath: 'tsconfig.json' });
const deps = new Map<string, Set<string>>();

console.log('Analyzing dependencies...\n');

for (const sourceFile of project.getSourceFiles('src/**/*.ts')) {
  const filePath = sourceFile.getFilePath().replace(/.*\/src\//, '');
  const from = filePath.split('/')[0];

  for (const imp of sourceFile.getImportDeclarations()) {
    const specifier = imp.getModuleSpecifierValue();

    // Only analyze internal imports
    if (specifier.startsWith('@/') || specifier.startsWith('./') || specifier.startsWith('../')) {
      let to: string;

      if (specifier.startsWith('@/')) {
        to = specifier.replace('@/', '').split('/')[0];
      } else {
        // For relative imports, resolve the path
        const resolved = sourceFile.getDirectory().getPath();
        const importPath = imp.getModuleSpecifierSourceFile()?.getFilePath();
        if (importPath) {
          to = importPath.replace(/.*\/src\//, '').split('/')[0];
        } else {
          continue;
        }
      }

      if (to !== from) {
        if (!deps.has(from)) deps.set(from, new Set());
        deps.get(from)!.add(to);
      }
    }
  }
}

// Output dependency matrix
console.log('=== Module Dependency Matrix ===\n');
const sorted = [...deps.entries()].sort((a, b) => a[0].localeCompare(b[0]));

for (const [mod, targets] of sorted) {
  const targetList = [...targets].sort().join(', ');
  console.log(`${mod.padEnd(20)} → ${targetList}`);
}

// Analyze layer assumptions
console.log('\n\n=== Layer Assumption Validation ===\n');

const infraModules = ['config', 'db', 'utils', 'store'];
const domainModules = ['agent', 'memory', 'skills', 'tools', 'search', 'research',
                       'extraction', 'subagent', 'session', 'proactive', 'providers',
                       'persona', 'evolution', 'goal', 'finance', 'sandbox'];
const adapterModules = ['feishu', 'channel', 'cli', 'web', 'mcp', 'plugins', 'hooks'];
const appModules = ['app', 'services', 'dispatcher', 'routes'];

// Check for violations
const violations: string[] = [];

for (const [from, targets] of sorted) {
  const fromLayer = infraModules.includes(from) ? 'infra' :
                    domainModules.includes(from) ? 'domain' :
                    adapterModules.includes(from) ? 'adapter' :
                    appModules.includes(from) ? 'app' : 'unknown';

  for (const to of targets) {
    const toLayer = infraModules.includes(to) ? 'infra' :
                    domainModules.includes(to) ? 'domain' :
                    adapterModules.includes(to) ? 'adapter' :
                    appModules.includes(to) ? 'app' : 'unknown';

    // Check for violations: infra should not depend on higher layers
    if (fromLayer === 'infra' && (toLayer === 'domain' || toLayer === 'adapter' || toLayer === 'app')) {
      violations.push(`❌ INFRA→DOMAIN/ADAPTER/APP: ${from} → ${to}`);
    }

    // domain should not depend on adapter or app
    if (fromLayer === 'domain' && (toLayer === 'adapter' || toLayer === 'app')) {
      violations.push(`❌ DOMAIN→ADAPTER/APP: ${from} → ${to}`);
    }

    // adapter should not depend on app
    if (fromLayer === 'adapter' && toLayer === 'app') {
      violations.push(`❌ ADAPTER→APP: ${from} → ${to}`);
    }
  }
}

if (violations.length > 0) {
  console.log('⚠️  Layer Violations Found:\n');
  violations.forEach(v => console.log(v));
} else {
  console.log('✅ No layer violations found! Layer assumptions are valid.');
}

// Specific checks mentioned in the proposal
console.log('\n\n=== Specific Cross-Layer Checks ===\n');

const checks = [
  { from: 'agent', to: 'feishu', desc: 'agent should not directly reference feishu' },
  { from: 'tools', to: 'web', desc: 'tools should not reference web' },
  { from: 'providers', to: 'feishu', desc: 'providers should not reference feishu' },
  { from: 'providers', to: 'cli', desc: 'providers should not reference cli' },
];

for (const check of checks) {
  const moduleDeps = deps.get(check.from);
  if (moduleDeps && moduleDeps.has(check.to)) {
    console.log(`❌ ${check.desc}: ${check.from} → ${check.to}`);
  } else {
    console.log(`✅ ${check.desc}`);
  }
}

console.log('\n\nAnalysis complete!');
