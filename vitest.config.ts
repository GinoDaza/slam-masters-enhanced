import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // the emulator comparisons run seconds of synchronous work each: separate processes, and
    // with every file in parallel 5 s per test is too tight
    pool: 'forks',
    // few emulators at a time: more workers barely finish sooner, slow each other several times,
    // and a worker busy for over 60 s misses vitest's own RPC deadline ("Timeout calling
    // onTaskUpdate") although every test passes
    minWorkers: 1,
    maxWorkers: 3,
    // and a file of them over 60 s needs a turn of the event loop between tests (the setup's)
    setupFiles: ['tools/vitest-setup.ts'],
    // a loaded machine runs them several times slower: the limits only catch a hang
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});
