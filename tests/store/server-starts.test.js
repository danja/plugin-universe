import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'child_process'

/**
 * The application starts, and answers.
 *
 * Nothing else in any suite does this, and the hole has now cost twice:
 *
 *  - `const submittable` was declared below the line that used it. `node
 *    --check` passed, every test passed, and `bin/serve.js` died on a temporal
 *    dead zone.
 *  - `src/api/server.js` was split into route modules and its imports pruned.
 *    `renderLandingPage` was still called by the startup template check and no
 *    longer imported. 867 tests passed against an application that could not
 *    boot.
 *
 * Both are the same shape: **every unit worked and the wiring did not**, and
 * the wiring is `bin/serve.js` — which no test had ever run. So this runs it,
 * as a process, the way the deployment does.
 *
 * It lives in the store suite because that is honest: the app needs Fuseki and
 * a vector index to start at all, and a fake of either would be testing
 * something other than the thing that broke.
 */

const PORT = 4137
const BASE = `http://127.0.0.1:${PORT}`

let child
let startupLog = ''

beforeAll(async () => {
  child = spawn('node', ['bin/serve.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', chunk => { startupLog += chunk })
  child.stderr.on('data', chunk => { startupLog += chunk })

  const deadline = Date.now() + 60000
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`bin/serve.js exited with ${child.exitCode} before listening:\n${startupLog}`)
    }
    try {
      const response = await fetch(`${BASE}/health`)
      if (response.ok) break
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error(`bin/serve.js never listened:\n${startupLog}`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}, 90000)

afterAll(() => {
  child?.kill('SIGTERM')
})

describe('bin/serve.js', () => {
  it('starts and reports itself healthy', async () => {
    const health = await (await fetch(`${BASE}/health`)).json()
    expect(health.status).toBe('ok')
    expect(health.plugins).toBeGreaterThan(0)
  })

  it('renders the pages it checks at startup', () => {
    // The check itself is the thing that broke: createServer renders a landing,
    // search and browse page before listening, so a missing import or a
    // template that lost a placeholder refuses to start rather than 500ing on
    // every page a person can see. Reaching /health at all proves it passed.
    expect(startupLog).not.toMatch(/page templates are unusable/)
  })

  /**
   * One request per route module, so that a module which fails to mount is a
   * failure here rather than a 404 somebody meets on the site. The point is
   * the breadth, not the bodies — what each page *says* is tested elsewhere.
   */
  const ROUTES = [
    ['/', 200, 'catalogue'],
    ['/plugins', 200, 'catalogue'],
    ['/search?q=reverb', 200, 'catalogue'],
    ['/facets', 200, 'catalogue'],
    ['/vendors', 200, 'catalogue'],
    ['/health', 200, 'meta'],
    ['/robots.txt', 200, 'meta'],
    ['/ns', 200, 'meta'],
    ['/ns/trn-profile.ttl', 200, 'meta'],
    ['/registry/plugins/index.json', 200, 'meta'],
    ['/about/profiles', 200, 'prose'],
    ['/terms', 200, 'prose'],
    ['/nonsense', 404, 'the fall-through']
  ]

  it.each(ROUTES)('answers %s with %i (%s)', async (path, status) => {
    const response = await fetch(`${BASE}${path}`, { headers: { Accept: 'text/html' } })
    expect(response.status).toBe(status)
  })

  it('sends an anonymous visitor to sign in rather than 500ing', async () => {
    // These live in three different route modules and all three depend on the
    // viewer being resolved before they are reached.
    for (const path of ['/submit', '/account', '/contributions']) {
      const response = await fetch(`${BASE}${path}`, {
        headers: { Accept: 'text/html' }, redirect: 'manual'
      })
      expect([302, 401], `${path} answered ${response.status}`).toContain(response.status)
    }
  })

  /**
   * Every write route accepts a POST at all.
   *
   * The read-only guard runs before any route module is reached, from a list of
   * paths that is separate from the modules themselves — so a route can be
   * written, mounted, linked and unit-tested while every POST to it is refused
   * by one line in `server.js`. That is not hypothetical: `/billing/webhook`,
   * `/billing/subscribe`, `/billing/portal` and `/plugin/<slug>/promote` all
   * answered 405, so no payment could ever have completed, and `/feedback`
   * joined them the day it was built.
   *
   * These POSTs carry no CSRF token and no session, so the *right* answer is a
   * refusal from the route — 401, 403, or a redirect to sign in. The only
   * failure this asserts is 405, which means the request never got that far.
   */
  const WRITE_PATHS = [
    '/submit',
    '/feedback',
    '/admin',
    '/moderation',
    '/billing/subscribe',
    '/billing/portal',
    '/billing/webhook',
    '/plugin/anything-00000000/correct',
    '/plugin/anything-00000000/image',
    '/plugin/anything-00000000/promote'
  ]

  it.each(WRITE_PATHS)('accepts a POST to %s rather than refusing the method', async path => {
    const response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'probe=1',
      redirect: 'manual'
    })
    expect(response.status, `${path} is in no POST list, so its handler never runs`).not.toBe(405)
  })

  it('still refuses a POST to a route that only reads', async () => {
    // The guard has to keep doing its job: the list is what may be written to,
    // not a switch that turns the check off.
    for (const path of ['/plugins', '/search', '/facets', '/health']) {
      const response = await fetch(`${BASE}${path}`, { method: 'POST', body: 'probe=1' })
      expect(response.status, path).toBe(405)
    }
  })

  it('resolves a plugin IRI in all four representations', async () => {
    const list = await (await fetch(`${BASE}/plugins?limit=1`)).json()
    const slug = list.results[0].iri.replace(/^.*\/plugin\//, '')
    const types = {
      '': 'text/html',
      '.json': 'application/json',
      '.ttl': 'text/turtle',
      '.jsonld': 'application/ld+json'
    }
    for (const [suffix, type] of Object.entries(types)) {
      const response = await fetch(`${BASE}/plugin/${slug}${suffix}`, {
        headers: { Accept: 'text/html' }
      })
      expect(response.status, `/plugin/${slug}${suffix}`).toBe(200)
      expect(response.headers.get('content-type')).toContain(type)
    }
  })
})
