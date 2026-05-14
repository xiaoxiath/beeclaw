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
      '@bee': resolve(__dirname, 'packages/bee/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    isolate: true,
    testTimeout: 60000,
    include: ['src/**/__tests__/**/*.test.ts', 'tests/**/*.test.ts', 'packages/bee/src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'src/web/**'],
    restoreMocks: true,
    mockReset: true,
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/web/**',
        'src/test-setup.ts',
        'src/**/*.d.ts',
      ],
      // Coverage floors — set ~5pt below the current actual baseline
      // (90.2% lines / 82.1% branches / 89.8% functions / 90.9% stmts).
      // Catches real regressions but tolerates legitimate refactors that
      // drop a percentage point. Tighten over time as the suite grows.
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 75,
      },
    },
  },
});
