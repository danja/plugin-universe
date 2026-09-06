import { defineConfig } from 'vitest/config'

// Core tests: no external services required.
export default defineConfig({
  test: {
    include: ['tests/rdf/**/*.test.js', 'tests/vectors/**/*.test.js'],
    environment: 'node'
  }
})
