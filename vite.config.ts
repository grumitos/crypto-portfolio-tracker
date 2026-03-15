import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    proxy: {
      '/binance-api': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/binance-api/, '/api'),
      },
      '/binance-sapi': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/binance-sapi/, '/sapi'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    pool: 'vmThreads',
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/index.ts', 'src/main.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 78,
        branches: 70,
      },
    },
  },
});
