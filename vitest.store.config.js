import { defineConfig } from 'vitest/config'

// Store tests: require a live SPARQL endpoint as configured in config/config.json.
// Per project policy these are not mocked.
export default defineConfig({
  test: {
    include: ['tests/store/**/*.test.js'],
    environment: 'node',
    testTimeout: 30000,
    fileParallelism: false
  }
})
