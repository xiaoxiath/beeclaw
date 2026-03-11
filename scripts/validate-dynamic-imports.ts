#!/usr/bin/env bun
/**
 * Validate Dynamic Imports
 *
 * This script checks for problematic dynamic imports:
 * 1. Duplicate imports (static + dynamic of the same module)
 * 2. Missing modules (dynamic import of non-existent paths)
 * 3. Identifies valid vs problematic dynamic imports
 *
 * Usage:
 *   bun scripts/validate-dynamic-imports.ts
 *   bun scripts/validate-dynamic-imports.ts --fix
 */

import { readFileSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';
import { glob } from 'glob';

interface DynamicImport {
  file: string;
  line: number;
  modulePath: string;
  code: string;
  isRelative: boolean;
  staticImports: string[];
}

interface ValidationResult {
  valid: DynamicImport[];
  duplicateImports: DynamicImport[];
  missingModules: DynamicImport[];
  suspicious: DynamicImport[];
}

const SRC_DIR = join(process.cwd(), 'src');
const VALID_DYNAMIC_IMPORT_REASONS = [
  'plugin',           // Plugin system
  'circular',         // Breaking circular deps
  'optional',         // Optional dependencies
  'test',             // Test isolation
  'jiti',             // Jiti loader
  'lazy',             // Intentional lazy loading
];

async function findTypeScriptFiles(): Promise<string[]> {
  const pattern = join(SRC_DIR, '**/*.ts').replace(/\\/g, '/');
  return glob(pattern, {
    ignore: ['**/node_modules/**', '**/dist/**', '**/__tests__/**']
  });
}

function extractStaticImports(content: string): string[] {
  const staticImports: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match: import { foo } from 'module' or import foo from 'module'
    const match = line.match(/import\s+(?:\{[^}]+\}|\w+)\s+from\s+['"]([^'"]+)['"]/);
    if (match) {
      staticImports.push(match[1]);
    }
  }

  return staticImports;
}

function extractDynamicImports(content: string, filePath: string): DynamicImport[] {
  const dynamicImports: DynamicImport[] = [];
  const lines = content.split('\n');
  const staticImports = extractStaticImports(content);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Match: await import('module') or import('module')
    const matches = line.matchAll(/(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g);

    for (const match of matches) {
      const modulePath = match[1];
      const isRelative = modulePath.startsWith('.') || modulePath.startsWith('/');

      dynamicImports.push({
        file: filePath,
        line: lineNum,
        modulePath,
        code: line.trim(),
        isRelative,
        staticImports,
      });
    }
  }

  return dynamicImports;
}

function isDuplicateImport(imp: DynamicImport): boolean {
  // Check if the module is already statically imported
  return imp.staticImports.some(staticImp => {
    // Normalize paths for comparison
    const normalizedStatic = staticImp.replace(/\\/g, '/');
    const normalizedDynamic = imp.modulePath.replace(/\\/g, '/');

    // Check if they refer to the same module
    return normalizedStatic === normalizedDynamic ||
           normalizedStatic.includes(normalizedDynamic) ||
           normalizedDynamic.includes(normalizedStatic);
  });
}

function resolveRelativePath(fromFile: string, modulePath: string): string {
  const fromDir = dirname(fromFile);
  return join(fromDir, modulePath);
}

function checkModuleExists(fromFile: string, modulePath: string): boolean {
  if (!modulePath.startsWith('.')) {
    // Non-relative imports - assume they exist (node_modules or internal)
    return true;
  }

  // Try to resolve relative path
  const resolvedPath = resolveRelativePath(fromFile, modulePath);

  // Try various extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

  for (const ext of extensions) {
    const tryPath = resolvedPath + ext;
    if (existsSync(tryPath)) {
      return true;
    }
  }

  return false;
}

function hasValidReason(imp: DynamicImport): boolean {
  const content = readFileSync(imp.file, 'utf-8');
  const lines = content.split('\n');

  // Check surrounding context for comments explaining the dynamic import
  const startLine = Math.max(0, imp.line - 5);
  const endLine = Math.min(lines.length, imp.line + 2);
  const context = lines.slice(startLine, endLine).join('\n').toLowerCase();

  return VALID_DYNAMIC_IMPORT_REASONS.some(reason => context.includes(reason));
}

function categorizeImports(imports: DynamicImport[]): ValidationResult {
  const result: ValidationResult = {
    valid: [],
    duplicateImports: [],
    missingModules: [],
    suspicious: [],
  };

  for (const imp of imports) {
    // Skip test files
    if (imp.file.includes('__tests__') || imp.file.includes('.test.ts')) {
      result.valid.push(imp);
      continue;
    }

    // Check for duplicate imports
    if (isDuplicateImport(imp)) {
      result.duplicateImports.push(imp);
      continue;
    }

    // Check for missing modules
    if (imp.isRelative && !checkModuleExists(imp.file, imp.modulePath)) {
      result.missingModules.push(imp);
      continue;
    }

    // Check if it has a valid reason
    if (hasValidReason(imp)) {
      result.valid.push(imp);
    } else {
      result.suspicious.push(imp);
    }
  }

  return result;
}

function printReport(result: ValidationResult) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 Dynamic Import Validation Report');
  console.log('='.repeat(80) + '\n');

  // Summary
  const total = Object.values(result).flat().length;
  console.log(`Total dynamic imports found: ${total}\n`);

  // ✅ Valid imports
  if (result.valid.length > 0) {
    console.log(`✅ Valid dynamic imports (${result.valid.length}):`);
    console.log('-'.repeat(80));
    result.valid.forEach(imp => {
      const relPath = relative(process.cwd(), imp.file);
      console.log(`  ${relPath}:${imp.line}`);
      console.log(`    → ${imp.modulePath}`);
    });
    console.log('');
  }

  // ❌ Duplicate imports
  if (result.duplicateImports.length > 0) {
    console.log(`\n❌ DUPLICATE IMPORTS - Already statically imported (${result.duplicateImports.length}):`);
    console.log('-'.repeat(80));
    result.duplicateImports.forEach(imp => {
      const relPath = relative(process.cwd(), imp.file);
      console.log(`  ${relPath}:${imp.line}`);
      console.log(`    Dynamic: ${imp.modulePath}`);
      console.log(`    Static:  ${imp.staticImports.filter(s => s.includes(imp.modulePath) || imp.modulePath.includes(s)).join(', ')}`);
      console.log(`    Code:    ${imp.code}`);
      console.log('');
    });
  }

  // ⚠️ Missing modules
  if (result.missingModules.length > 0) {
    console.log(`\n⚠️  MISSING MODULES - May fail at runtime (${result.missingModules.length}):`);
    console.log('-'.repeat(80));
    result.missingModules.forEach(imp => {
      const relPath = relative(process.cwd(), imp.file);
      console.log(`  ${relPath}:${imp.line}`);
      console.log(`    → ${imp.modulePath} (NOT FOUND)`);
      console.log(`    Code: ${imp.code}`);
      console.log('');
    });
  }

  // ⚡ Suspicious imports
  if (result.suspicious.length > 0) {
    console.log(`\n⚡ SUSPICIOUS - No valid reason found (${result.suspicious.length}):`);
    console.log('-'.repeat(80));
    console.log('These dynamic imports have no documented reason (circular, plugin, optional, etc.)');
    console.log('Consider converting to static imports if possible.\n');
    result.suspicious.forEach(imp => {
      const relPath = relative(process.cwd(), imp.file);
      console.log(`  ${relPath}:${imp.line}`);
      console.log(`    → ${imp.modulePath}`);
      console.log(`    Code: ${imp.code}`);
      console.log('');
    });
  }

  // Final status
  console.log('='.repeat(80));
  const hasIssues = result.duplicateImports.length > 0 || result.missingModules.length > 0;

  if (hasIssues) {
    console.log('❌ VALIDATION FAILED');
    console.log(`   Found ${result.duplicateImports.length} duplicate imports`);
    console.log(`   Found ${result.missingModules.length} missing modules`);
    console.log(`   Found ${result.suspicious.length} suspicious imports`);
    process.exit(1);
  } else {
    console.log('✅ VALIDATION PASSED');
    if (result.suspicious.length > 0) {
      console.log(`   Note: ${result.suspicious.length} suspicious imports found (not errors)`);
    }
    process.exit(0);
  }
}

async function main() {
  console.log('🔍 Scanning for dynamic imports...\n');

  const files = await findTypeScriptFiles();
  console.log(`Found ${files.length} TypeScript files to check\n`);

  const allImports: DynamicImport[] = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const imports = extractDynamicImports(content, file);
    allImports.push(...imports);
  }

  console.log(`Found ${allImports.length} dynamic imports\n`);

  const result = categorizeImports(allImports);
  printReport(result);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
