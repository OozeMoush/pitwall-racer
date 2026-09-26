import { defineConfig } from 'vitest/config';
import { PLAYTEST_TEST_FILES } from './vitest.tiers';

export default defineConfig({
  test: {
    setupFiles: ['./src/testSetup.ts'],
    include: [...PLAYTEST_TEST_FILES],
  },
});
