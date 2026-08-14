import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@trading-auto/domain': source('./packages/domain/src/index.ts'),
      '@trading-auto/calendars': source('./packages/calendars/src/index.ts'),
      '@trading-auto/indicators': source('./packages/indicators/src/index.ts'),
      '@trading-auto/strategy-ichimoku': source(
        './packages/strategy-ichimoku/src/index.ts',
      ),
      '@trading-auto/risk': source('./packages/risk/src/index.ts'),
      '@trading-auto/execution': source('./packages/execution/src/index.ts'),
      '@trading-auto/test-helpers': source(
        './packages/test-helpers/src/index.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/index.ts', 'packages/**/*.test.ts'],
    },
  },
});
