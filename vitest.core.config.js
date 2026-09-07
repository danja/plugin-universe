import { defineConfig } from 'vitest/config'

// Core tests: no external services required.
export default defineConfig({
  test: {
    include: [
      'tests/rdf/**/*.test.js',
      'tests/vectors/**/*.test.js',
      'tests/harvest/**/*.test.js',
      'tests/auth/**/*.test.js',
      'tests/embeddings/**/*.test.js',
      'tests/profiler/**/*.test.js',
      'tests/api/**/*.test.js',
      'tests/search/**/*.test.js'
    ],
    environment: 'node'
  }
})
