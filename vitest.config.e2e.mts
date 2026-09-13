import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Phase 7.9's own e2e spec (`test/platform.e2e-spec.ts`) is the 17th file that boots a full
    // Nest app + its own Prisma connection pool against the same local Postgres/Redis — running
    // the whole suite (vitest's default: every file in parallel) started intermittently timing
    // out a couple of otherwise-reliable tests in `fees`/`library` on the default 5s budget under
    // that combined load, even though every one of those files passes cleanly run on its own or
    // in a smaller batch. Real I/O against real infra deserves more slack than vitest's
    // unit-test-sized default regardless — raising it here (e2e config only, not
    // `vitest.config.mts`'s unit tests) rather than trying to force full serialization, which
    // would make an already-slow full e2e run much slower to work around a timeout that isn't a
    // real correctness bug.
    testTimeout: 20_000,
  },
});
