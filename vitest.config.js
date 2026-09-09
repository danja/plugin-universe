import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    // tests/live/ hits the deployed site over the public internet. It is run
    // deliberately, by `npm run test:live`, never as part of a sweep.
    exclude: ['tests/live/**'],
    environment: 'node',
    testTimeout: 30000,
    fileParallelism: false
  }
})
