import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    // Every test starts a fresh in-memory Postgres (ADR 0001), which can take a few seconds on a
    // busy machine or CI runner. Generous limits keep slow starts from failing the suite.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
