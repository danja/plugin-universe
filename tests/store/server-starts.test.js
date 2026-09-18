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
    // `ok` is a claim about consistency as well as about serving: it means the
    // catalogue and the vector index agree, and sign-in is not half configured.
    expect(health.problems, JSON.stringify(health.problems)).toEqual([])
    expect(health.status).toBe('ok')
    expect(health.plugins).toBeGreaterThan(0)
    expect(health.unindexed).toBe(0)
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

  it('serves a profile for a real plugin, as a file to host', async () => {
    // A route is not reachable until a request has reached it. This one is
    // regex-dispatched under /plugin/, so it sits in front of the plugin page's
    // own pattern — get the order wrong and `/plugin/x/profile.ttl` is a
    // 404 for a plugin called "x/profile.ttl", which looks like missing data.
    const [first] = (await (await fetch(`${BASE}/plugins?limit=1`)).json()).results
    const slug = first.iri.split('/').pop()
    const response = await fetch(`${BASE}/plugin/${slug}/profile.ttl`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/turtle')
    expect(response.headers.get('content-disposition')).toContain(`${slug}-profile.ttl`)

    // Parsed, not merely received: a served file that does not parse is the
    // defect this feature already had once.
    const { parseTurtle } = await import('../../src/harvest/TurtleReader.js')
    const dataset = await parseTurtle(await response.text())
    expect(dataset.size).toBeGreaterThan(2)
  })

  it('404s a profile for a plugin that does not exist', async () => {
    const response = await fetch(`${BASE}/plugin/no-such-plugin/profile.ttl`)
    expect(response.status).toBe(404)
  })

  it('links the profile from the plugin page that offers it', async () => {
    // Both directions: the route exists and the page points at it.
    const [first] = (await (await fetch(`${BASE}/plugins?limit=1`)).json()).results
    const slug = first.iri.split('/').pop()
    const page = await (await fetch(`${BASE}/plugin/${slug}`, {
      headers: { Accept: 'text/html' }
    })).text()
    expect(page).toContain(`/plugin/${slug}/profile.ttl`)
  })

  it('sends an anonymous visitor to sign in rather than 500ing', async () => {
    // These live in three different route modules and all three depend on the
    // viewer being resolved before they are reached.
    for (const path of ['/submit', '/submit/profile', '/account', '/contributions']) {
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

  /**
   * The preflight a browser sends before any of those POSTs.
   *
   * A handler that works and a preflight that says `GET, OPTIONS` add up to an
   * endpoint no browser can call, and nothing on this side of the wire notices:
   * the browser simply never sends the request. So this asks the running
   * process the question a browser asks.
   */
  it.each([...WRITE_PATHS, '/mcp'])('tells a browser it may POST to %s', async path => {
    const response = await fetch(`${BASE}${path}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.org',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
      }
    })
    expect(response.status, `${path} preflight`).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods'), path).toContain('POST')
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase(), path)
      .toContain('content-type')
  })

  it('still refuses a POST to a route that only reads', async () => {
    // The guard has to keep doing its job: the list is what may be written to,
    // not a switch that turns the check off.
    for (const path of ['/plugins', '/search', '/facets', '/health']) {
      const response = await fetch(`${BASE}${path}`, { method: 'POST', body: 'probe=1' })
      expect(response.status, path).toBe(405)
    }
  })

  it('dereferences a pu: term IRI, which the published data is written in', async () => {
    // The PURL sends the whole namespace here, so `pu:supportedPlatform`
    // arrives as this path. It answered 404 with a JSON body until 2026-09-18 —
    // every term in the vocabulary did — and the route that fixes it is mounted
    // after every other module, which is exactly the kind of ordering a unit
    // test cannot see.
    const response = await fetch(`${BASE}/supportedPlatform`, {
      headers: { Accept: 'text/turtle' }, redirect: 'manual'
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/ns/plugin-universe.ttl')

    // And the far end of the hop exists, which is the half a redirect test
    // usually forgets: a 303 to a 404 is still a term that does not resolve.
    const document = await fetch(`${BASE}/ns/plugin-universe.ttl`)
    expect(document.status).toBe(200)
    expect(document.headers.get('content-type')).toContain('text/turtle')
    expect(await document.text()).toContain('supportedPlatform')
  })

  it('still 404s a path that is not a term', async () => {
    // The route runs last and must stay that way: if it ever answered more
    // than the vocabulary, a mistyped URL would become a redirect.
    const response = await fetch(`${BASE}/notAVocabularyTerm`, { redirect: 'manual' })
    expect(response.status).toBe(404)
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
