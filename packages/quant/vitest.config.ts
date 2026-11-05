import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'quant',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Monte Carlo property tests run tens of thousands of paths; CI runners with
    // coverage instrumentation are several times slower than a laptop.
    testTimeout: 30_000,
  },
});
