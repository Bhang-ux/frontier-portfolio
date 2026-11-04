import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'quant',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
