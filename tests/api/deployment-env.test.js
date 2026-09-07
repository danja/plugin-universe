import { describe, it, expect } from 'vitest'
import fs from 'fs'

/**
 * Every environment variable the code reads must reach the container.
 *
 * `docker-compose.yml` enumerates the app's environment explicitly, so a
 * variable set in `.env` and not named there simply is not present at runtime.
 * There is no error: `process.env.X` is `undefined`, the feature that depends
 * on it turns itself off, and the deployment looks healthy.
 *
 * That is exactly how sign-in came to be disabled in production while working
 * locally — `bin/serve.js` reads the process environment directly, so a
 * developer running it by hand sees `.env` and a container does not.
 *
 * This is the fourth instance of the pattern in CLAUDE.md: two files that have
 * to agree, with nothing connecting them. So here is the thing connecting them.
 */

const COMPOSE = fs.readFileSync('docker-compose.yml', 'utf8')

/** Read directly from process.env by the application, not by a CLI. */
const REQUIRED_BY_APP = [
  'SPARQL_URL_BASE',
  'SPARQL_DATASET',
  'SPARQL_USER',
  'SPARQL_PASSWORD',
  'OLLAMA_URL',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'SESSION_SECRET',
  'SITE_ORIGIN'
]

/** The block between `app:` and the next top-level service. */
function appEnvironment () {
  const app = COMPOSE.slice(COMPOSE.indexOf('\n  app:'))
  const end = app.indexOf('\n  nginx:')
  return end === -1 ? app : app.slice(0, end)
}

describe('the app container receives what the app reads', () => {
  const block = appEnvironment()

  it('finds the app service', () => {
    expect(block).toContain('container_name: plugin-universe-app')
  })

  it('passes every variable the application reads', () => {
    const missing = REQUIRED_BY_APP.filter(name => !block.includes(`${name}:`))
    expect(
      missing,
      `docker-compose.yml does not pass ${missing.join(', ')} to the app. ` +
      'A variable in .env that is not named there does not reach the container, and the ' +
      'feature depending on it turns itself off without an error.'
    ).toEqual([])
  })

  it('documents each of them in .env.example', () => {
    // The other half: a variable the container passes but nobody knows to set.
    const example = fs.readFileSync('.env.example', 'utf8')
    const undocumented = REQUIRED_BY_APP.filter(name => !example.includes(name))
    expect(undocumented, `not in .env.example: ${undocumented.join(', ')}`).toEqual([])
  })

  it('leaves the auth variables optional, so a read-only deployment still starts', () => {
    // `${VAR:?}` would make them mandatory. Sign-in absent is a valid
    // configuration and must not stop the container coming up.
    for (const name of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET']) {
      expect(block, `${name} is mandatory`).not.toContain(`${name}: \${${name}:?`)
    }
  })
})
