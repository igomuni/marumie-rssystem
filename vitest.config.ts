import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // data/ holds local work products (data/work may be a symlink into another checkout): never scan it for tests
    exclude: ['node_modules', '.next', 'data/**'],
  },
});
