import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@infra': resolve(__dirname, 'src/infra'),
      '@domain': resolve(__dirname, 'src/domain'),
      '@adapter': resolve(__dirname, 'src/adapter'),
      '@app': resolve(__dirname, 'src/app'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    isolate: true,
    testTimeout: 30000,
    include: ['src/**/__tests__/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'src/web/**'],
    restoreMocks: true,
    mockReset: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
