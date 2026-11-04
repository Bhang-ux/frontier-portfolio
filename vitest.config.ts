import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/quant', 'pipeline', 'web'],
    coverage: {
      provider: 'v8',
      include: ['packages/quant/src/**', 'pipeline/src/**'],
      reporter: ['text-summary', 'json-summary', 'html'],
    },
  },
});
