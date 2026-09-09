import { defineConfig } from 'vitest/config'

// Live tests: run against the deployed site, over the public internet.
//
// Deliberately a separate configuration and a separate npm script. These are
// the only tests in the repository that touch a production system and the only
// ones whose result depends on somebody else's DNS, so they must never be part
// of `npm test` — a red build should mean the code is wrong, not that a
// certificate expired overnight.
//
// Serial, and generous with time: one of them follows the PURL chain through
// purl.org and hyperdata.it, which is four redirects across two hosts nobody
// here controls.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.js'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false
  }
})
