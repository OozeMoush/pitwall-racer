import { configDefaults, defineConfig } from 'vitest/config';
import { LONG_TEST_FILES, PLAYTEST_TEST_FILES } from './vitest.tiers';

export default defineConfig({
  test: {
    setupFiles: ['./src/testSetup.ts'],
    exclude: [
      ...configDefaults.exclude,
      ...PLAYTEST_TEST_FILES,
      ...LONG_TEST_FILES,
    ],
  },
});
