#!/usr/bin/env bun

import { $ } from 'bun';

console.log('🔨 Building Beeclaw Web UI...\n');

// Build React app
const result = await Bun.build({
  entrypoints: ['./src/web/client/main.tsx'],
  outdir: './src/web/client/dist',
  target: 'browser',
  format: 'esm',
  splitting: true,
  minify: false, // Disable minification for debugging
  sourcemap: 'external',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  external: [],
});

if (result.success) {
  console.log('✅ React app built successfully!\n');
  console.log('Outputs:');
  result.outputs.forEach((output) => {
    console.log(`  - ${output.path} (${(output.size / 1024).toFixed(2)} KB)`);
  });
} else {
  console.error('❌ React app build failed:\n');
  result.logs.forEach((log) => {
    console.error(log);
  });
  process.exit(1);
}

// Copy index.html to dist
await $`cp src/web/client/index.html src/web/client/dist/index.html`;
console.log('\n✅ Copied index.html to dist/');

console.log('\n🎉 Web UI build complete!');
