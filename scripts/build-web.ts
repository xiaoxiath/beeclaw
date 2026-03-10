#!/usr/bin/env bun

import { $ } from 'bun';
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const args = process.argv.slice(2);
const isWatch = args.includes('--watch') || args.includes('-w');

console.log('🔨 Building Beeclaw Web UI...\n');

const distDir = './src/web/client/dist';
const indexHtmlPath = './src/web/client/index.html';

// Clean dist directory
if (existsSync(distDir)) {
  console.log('🧹 Cleaning dist directory...');
  const files = readdirSync(distDir);
  files.forEach(file => {
    if (file !== '.gitkeep') {
      rmSync(join(distDir, file), { recursive: true });
    }
  });
} else {
  mkdirSync(distDir, { recursive: true });
}

const buildOptions = {
  entrypoints: ['./src/web/client/main.tsx'],
  outdir: distDir,
  target: 'browser' as const,
  format: 'esm' as const,
  splitting: true,
  minify: false, // Disable minification
  sourcemap: 'external' as const,
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
  },
};

if (isWatch) {
  console.log('👀 Watch mode enabled - rebuilding on changes...\n');
}

const result = await Bun.build(buildOptions);

if (result.success) {
  console.log('✅ React app built successfully!\n');

  // Generate content hashes for files
  const fileHashes: Record<string, string> = {};

  result.outputs.forEach((output) => {
    const content = readFileSync(output.path);
    const hash = createHash('md5').update(content).digest('hex').substring(0, 8);
    const oldName = output.path.split('/').pop()!;
    const ext = oldName.split('.').pop()!;
    const baseName = oldName.replace(`.${ext}`, '');
    const newName = `${baseName}.${hash}.${ext}`;

    // Rename file with hash
    renameSync(output.path, join(distDir, newName));
    fileHashes[oldName] = newName;

    const relativePath = join(distDir, newName).replace(process.cwd() + '/', '');
    console.log(`  - ${relativePath} (${(output.size / 1024).toFixed(2)} KB)`);
  });

  // Also rename sourcemap files
  const allFiles = readdirSync(distDir);
  allFiles.forEach(file => {
    if (file.endsWith('.map')) {
      const baseFile = file.replace('.map', '');
      if (fileHashes[baseFile]) {
        const newMapName = fileHashes[baseFile] + '.map';
        renameSync(join(distDir, file), join(distDir, newMapName));
      }
    }
  });

  // Generate index.html with hashed file names
  let indexHtml = readFileSync(indexHtmlPath, 'utf-8');

  // Replace file names with hashed versions
  Object.entries(fileHashes).forEach(([oldName, newName]) => {
    indexHtml = indexHtml.replace(new RegExp(oldName, 'g'), newName);
  });

  writeFileSync(join(distDir, 'index.html'), indexHtml);
  console.log('\n✅ Generated index.html with content-hashed assets');
  console.log('\n🎉 Web UI build complete!');
} else {
  console.error('❌ React app build failed:\n');
  result.logs.forEach((log) => {
    console.error(log);
  });
  process.exit(1);
}

if (isWatch) {
  console.log('\n💡 Press Ctrl+C to stop watching');
}
