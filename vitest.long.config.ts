import { defineConfig } from 'vitest/config';
import { LONG_TEST_FILES } from './vitest.tiers';

export default defineConfig({
  test: {
    setupFiles: ['./src/testSetup.ts'],
    include: [...LONG_TEST_FILES],
  },
});
