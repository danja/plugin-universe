import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import Config from '../../src/Config.js'
import { parseTurtle } from '../../src/harvest/TurtleReader.js'
import { HARVEST_CONFIG } from '../../config/preferences.js'

/**
 * The deployed site, over the public internet.
 *
 * What this suite is for: the class of failure that cannot be reproduced
 * locally. A container that was never rebuilt. An ingest that was run on a
 * machine and not on the server. A certificate, a redirect, a reverse-proxy
 * rule. Every one of those has happened on this project, and none of them is
 * visible to a test that talks to localhost.
 *
 * Run it deliberately — `npm run test:live` — never as part of a sweep. A red
 * build should mean the code is wrong, not that somebody else's DNS is.
 *
 * It is polite by construction: a couple of dozen requests, each page fetched
 * once and shared, and the project's own honest user agent, which points at a
 * contact page that resolves.
 */

const BASE = process.env.LIVE_BASE_URL || Config.load().get('site.origin')
const AGENT = HARVEST_CONFIG.userAgent

const get = (path, { headers = {}, ...rest } = {}) =>
  fetch(path.startsWith('http') ? path : `${BASE}${path}`, {
    headers: { 'User-Agent': AGENT, ...headers },
    signal: AbortSignal.timeout(30000),
    ...rest
  })

/** Status only, without downloading a body we do not need. */
const status = async (path, options) => (await get(path, options)).status

let health
let front
let slug

beforeAll(async () => {
  let response
  try {
    response = await get('/health')
  } catch (error) {
    throw new Error(
      `${BASE} is not reachable: ${error.message}\n` +
      'These tests check the deployed site. If it is down, that is the finding.'
    )
  }
  if (!response.ok) throw new Error(`${BASE}/health returned ${response.status}`)
  health = await response.json()

  front = await (await get('/')).text()
  const search = await (await get('/search?q=reverb&limit=1')).json()
  slug = search.results[0].iri.split('/').pop()
})

describe('the service is up and is the service we think it is', () => {
  it('reports a healthy catalogue', () => {
    expect(health.status).toBe('ok')
    expect(health.plugins).toBeGreaterThan(500)
  })

  it('has a vector for every document it serves', () => {
    // These drifted apart once — 751 of 752 — and the missing one was invisible
    // in every other view.
    expect(health.index).toBe(health.plugins)
  })

  it('has sign-in configured rather than silently disabled', () => {
    // `signIn: "misconfigured"` is the state that took the site down once and
    // then looked healthy for a week. It is reported here so monitoring sees it.
    expect(health.signIn, health.signInProblem ?? '').toBe('enabled')
  })

  it('says which code it is running, not only which data', () => {
    // The site reported a healthy plugin count for an hour while serving from a
    // container that had never been rebuilt, and finding that out took four
    // commands on the server. A null commit means the image was built without
    // bin/deploy.sh, so nobody can tell what is deployed.
    expect(health.build, '/health has no build stamp — the running image predates it').toBeDefined()
    expect(health.build.commit, 'built without bin/deploy.sh; the deployed commit is unknowable')
      .toMatch(/^[0-9a-f]{40}$/)
    expect(new Date(health.build.builtAt).getTime()).not.toBeNaN()
    console.log(`    deployed: ${health.build.commit.slice(0, 8)} built ${health.build.builtAt}`)
  })

  it('says what the data may be used for, on every response', () => {
    expect(health.licence.licence).toBe('CC0-1.0')
  })
})

describe('transport', () => {
  it('redirects plain http to https', async () => {
    const response = await fetch(BASE.replace('https://', 'http://'), {
      redirect: 'manual', headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(30000)
    })
    expect([301, 308]).toContain(response.status)
    expect(response.headers.get('location')).toMatch(/^https:/)
  })

  it('asks browsers to remember that', async () => {
    const response = await get('/')
    expect(response.headers.get('strict-transport-security')).toMatch(/max-age=\d+/)
  })

  it('forbids content-type sniffing', async () => {
    expect((await get('/')).headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('does not leak the page a reader came from to a third party', async () => {
    // Plugin pages hotlink images from another host.
    expect((await get('/')).headers.get('referrer-policy')).toMatch(/strict-origin/)
  })

  it('serves the www name as well as the bare one', async () => {
    expect(await status(BASE.replace('https://', 'https://www.'))).toBe(200)
  })
})

describe('nothing that writes is exposed', () => {
  // Publishing Fuseki's update endpoint by accident is the worst mistake
  // available in this deployment, so it is checked from outside rather than
  // reasoned about from the compose file.
  it('does not answer at any Fuseki path', async () => {
    for (const path of ['/plugin-universe/update', '/plugin-universe/query', '/$/ping', '/$/server', '/fuseki']) {
      expect(await status(path), path).toBe(404)
    }
  })

  it('refuses methods that are not reads', async () => {
    expect(await status('/', { method: 'PUT' })).toBe(405)
  })

  it('will not sign anyone out with a GET', async () => {
    // A GET logout is triggerable by any page with an <img> tag.
    expect(await status('/auth/logout')).toBe(405)
  })

  it('refuses an unauthenticated correction', async () => {
    expect(await status(`/plugin/${slug}/correct`, { method: 'POST' })).toBe(401)
  })

  it('does not tell a stranger the moderation queue exists', async () => {
    // 404, not 403: the queue is not a secret, but nor is a passer-by told
    // they lack a role.
    expect(await status('/moderation')).toBe(404)
  })
})

describe('a plugin IRI dereferences', () => {
  it('returns each representation under the right content type', async () => {
    const cases = [
      ['text/html', /text\/html/],
      ['text/turtle', /text\/turtle/],
      ['application/ld\\+json', /application\/ld\+json/],
      ['application/json', /application\/json/]
    ]
    for (const [accept, expected] of cases) {
      const response = await get(`/plugin/${slug}`, { headers: { Accept: accept.replace('\\', '') } })
      expect(response.status, accept).toBe(200)
      expect(response.headers.get('content-type'), accept).toMatch(expected)
    }
  })

  it('returns Turtle that parses', async () => {
    // Served Turtle that does not parse has happened, and looks fine in a
    // browser.
    const text = await (await get(`/plugin/${slug}.ttl`)).text()
    const dataset = await parseTurtle(text)
    expect(dataset.size).toBeGreaterThan(5)
  })

  it('is reachable through the PURL chain it was minted under', async () => {
    // purl.org → hyperdata.it → plugin-universe.com, four redirects across two
    // hosts, with content negotiation surviving all of them. This is the whole
    // reason IRIs are not minted on the serving domain, and the only way to
    // know it works is to follow it.
    const response = await get(
      `http://purl.org/stuff/plugin-universe/plugin/${slug}`,
      { headers: { Accept: 'text/turtle' } })
    expect(response.status).toBe(200)
    expect(response.url).toBe(`${BASE}/plugin/${slug}`)
    expect(response.headers.get('content-type')).toMatch(/text\/turtle/)
    expect((await parseTurtle(await response.text())).size).toBeGreaterThan(5)
  }, 60000)
})

describe('the deployed data is the current data', () => {
  // Each of these fails if the code was deployed and the ingest was not, which
  // is a state that looks entirely healthy from every other angle.

  it('has the enriched category scheme, not just labels', async () => {
    const page = await (await get('/category/amp')).text()
    expect(page, 'no definition — vocabs/categories.ttl has not been ingested')
      .toMatch(/Simulates a guitar or bass amplifier/)
    expect(page, 'no scope note').toMatch(/gain stage/)
    expect(page, 'no alternative labels').toMatch(/Also called/)
    expect(page, 'no LV2 alignment').toMatch(/lv2:SimulatorPlugin/)
  })

  it('serves a category concept as Turtle that parses', async () => {
    const dataset = await parseTurtle(await (await get('/category/reverb.ttl')).text())
    const predicates = new Set([...dataset].map(quad => quad.predicate.value))
    expect(predicates).toContain('http://www.w3.org/2004/02/skos/core#altLabel')
    expect(predicates).toContain('http://www.w3.org/2004/02/skos/core#definition')
  })

  it('finds plugins by a category synonym rather than only by its name', async () => {
    // "brickwall" is an altLabel of limiter and appears in no plugin's name.
    const results = await (await get('/search?q=brickwall&limit=5')).json()
    expect(results.total).toBeGreaterThan(0)
    expect(results.results.some(r => (r.categories ?? []).includes('limiter'))).toBe(true)
  })

  it('records when plugins were first seen', async () => {
    const listing = await (await get('/plugins?limit=5&order=recent')).json()
    expect(listing.order).toBe('recent')
    const dated = listing.results.filter(r => r.created)
    expect(dated.length, 'no dcterms:created — the dated ingest has not run here')
      .toBe(listing.results.length)
    for (const result of dated) expect(new Date(result.created).getTime()).not.toBeNaN()
  })

  it('pages the front listing instead of showing everything or nothing', async () => {
    expect(front).toMatch(/page 1 of \d+/)
    const second = await (await get('/?from=10')).text()
    expect(second).toMatch(/page 2 of \d+/)
  })

  it('shows plugin images, over https only', async () => {
    expect(front, 'no thumbnails on the front page').toContain('shot-thumb')
    const sources = [...front.matchAll(/<img class="shot[^>]*src="([^"]+)"/g)].map(m => m[1])
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      // An http image on an https page is blocked as mixed content, silently.
      expect(source, source).toMatch(/^https:/)
    }
    expect(front, 'images are not lazy').toContain('loading="lazy"')
    expect(front, 'the image host is being told what the reader is looking at')
      .toContain('referrerpolicy="no-referrer"')
  })
})

describe('the promises the catalogue makes to other people', () => {
  it('answers at the address its crawler user agent gives', async () => {
    // Already advertised to every source that has seen a request from us.
    const promised = HARVEST_CONFIG.userAgent.match(/\+(https?:\/\/[^)]+)/)[1]
    expect(await status(promised)).toBe(200)
  })

  it('publishes a robots.txt rather than leaving crawlers to guess', async () => {
    // A 404 here reads as permission, so this is about being legible, not
    // restrictive — this project asks other sites to say what they permit.
    const response = await get('/robots.txt')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type'), 'text/html here is ignored by most crawlers')
      .toMatch(/^text\/plain/)
    const body = await response.text()
    expect(body).toMatch(/^User-agent:\s*\*/m)
    expect(body).toMatch(/^Allow:\s*\/$/m)
    // The deployed copy must be the one in the repository, not an older one
    // baked into an image that was never rebuilt.
    expect(body).toBe(fs.readFileSync('robots.txt', 'utf8'))
  })

  it('serves the prose pages', async () => {
    for (const path of ['/about', '/terms', '/about/crawler']) {
      expect(await status(path), path).toBe(200)
    }
  })

  it('resolves every vocabulary IRI the data uses, as parseable Turtle', async () => {
    const index = await (await get('/ns')).json()
    expect(index.vocabularies.length).toBeGreaterThan(3)
    for (const vocabulary of index.vocabularies) {
      const response = await get(vocabulary.url)
      expect(response.status, vocabulary.url).toBe(200)
      expect(response.headers.get('content-type'), vocabulary.url).toMatch(/text\/turtle/)
      const dataset = await parseTurtle(await response.text())
      expect(dataset.size, vocabulary.url).toBeGreaterThan(0)
    }
  })

  it('lets a browser call the API, and says the data is public domain', async () => {
    const response = await get('/search?q=reverb&limit=1')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toMatch(/max-age=\d+/)
    expect((await response.json()).licence.licence).toBe('CC0-1.0')
  })
})
