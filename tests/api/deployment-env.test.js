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

  it('passes optional variables as `${VAR:-}`, which the code must read with `||`', () => {
    // `${VAR:-}` yields an empty string when unset, not an absent variable. Any
    // reader using `??` treats that empty string as a value — which is exactly
    // how an unset SITE_ORIGIN became an empty origin and a site-wide 502.
    const optional = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'SITE_ORIGIN']
    for (const name of optional) {
      expect(block, `${name} should be \${${name}:-}`).toContain(`${name}: \${${name}:-}`)
    }

    const readers = [
      'bin/serve.js', 'bin/ingest.js', 'src/auth/GitHubOAuth.js', 'src/auth/Session.js',
      // Reads BUILD_COMMIT and BUILD_TIME, which arrive as empty strings when
      // the image is built without them.
      'src/api/server.js'
    ]
    for (const file of readers) {
      const source = fs.readFileSync(file, 'utf8')
      const coalesced = [...source.matchAll(/process\.env\.([A-Z_]+)\s*\?\?/g)].map(m => m[1])
      expect(
        coalesced,
        `${file} reads ${coalesced.join(', ')} with ?? — an empty string from compose passes that ` +
        'test. Use || so an empty variable counts as unset.'
      ).toEqual([])
    }
  })

  it('carries the build stamp from the deploy script to the running container', () => {
    // Four files have to agree for /health to be able to say which code it is
    // running, and nothing else connects them: the script that computes the
    // commit, the compose build args that carry it, the Dockerfile that turns
    // the argument into an environment variable, and the code that reads it.
    // Any one of them missing and the stamp is silently null — which reads as
    // "an old image" and is indistinguishable from one.
    expect(block, 'docker-compose.yml passes no BUILD_COMMIT build arg')
      .toMatch(/args:[\s\S]*BUILD_COMMIT: \$\{BUILD_COMMIT:-\}/)
    expect(block).toMatch(/BUILD_TIME: \$\{BUILD_TIME:-\}/)

    const dockerfile = fs.readFileSync('Dockerfile', 'utf8')
    for (const name of ['BUILD_COMMIT', 'BUILD_TIME']) {
      expect(dockerfile, `Dockerfile does not declare ARG ${name}`).toMatch(new RegExp(`ARG ${name}`))
      expect(dockerfile, `Dockerfile does not export ${name}`).toMatch(new RegExp(`ENV ${name}=`))
    }

    const deploy = fs.readFileSync('bin/deploy.sh', 'utf8')
    expect(deploy, 'bin/deploy.sh does not export the stamp').toMatch(/export BUILD_COMMIT BUILD_TIME/)
    expect(deploy, 'bin/deploy.sh does not compute the commit').toMatch(/git rev-parse HEAD/)
  })

  it('leaves the auth variables optional, so a read-only deployment still starts', () => {
    // `${VAR:?}` would make them mandatory. Sign-in absent is a valid
    // configuration and must not stop the container coming up.
    for (const name of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET']) {
      expect(block, `${name} is mandatory`).not.toContain(`${name}: \${${name}:?`)
    }
  })
})
