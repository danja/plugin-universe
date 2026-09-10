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
    // Driven by a plugin that actually has one rather than by whatever is on
    // the front page. The front page lists the most recently added, and after
    // a sweep of GitHub repositories that is a run of plugins with no image at
    // all — which made this fail while nothing was wrong.
    const withImage = (await (await get('/search?q=reverb&limit=10')).json())
      .results.find(result => result.image)
    expect(withImage, 'no plugin in the catalogue has an image to check').toBeTruthy()

    const page = await (await get(`/plugin/${withImage.iri.split('/').pop()}`)).text()
    const sources = [...page.matchAll(/<img class="shot[^>]*src="([^"]+)"/g)].map(m => m[1])
    expect(sources.length, 'a plugin with an image rendered none').toBeGreaterThan(0)
    for (const source of sources) {
      // An http image on an https page is blocked as mixed content, silently.
      expect(source, source).toMatch(/^https:/)
    }
    expect(page, 'images are not lazy').toContain('loading="lazy"')
    expect(page, 'the image host is being told what the reader is looking at')
      .toContain('referrerpolicy="no-referrer"')
  })
})

describe('the contribution surface', () => {
  // Present but closed to a stranger. Each of these is a route that exists and
  // refuses, which is different from a route that is not deployed at all — and
  // the difference is invisible without asking.
  it('offers the wiki on a plugin page, without letting a passer-by edit it', async () => {
    expect(await status(`/plugin/${slug}/wiki/history`)).toBe(200)
  })

  it('sends a signed-out reader to sign in, and back to where they were', async () => {
    // Clicking "Edit" used to return raw JSON to a person, which is neither an
    // answer nor an invitation.
    const response = await fetch(`${BASE}/plugin/${slug}/wiki/edit`, {
      redirect: 'manual',
      headers: { 'User-Agent': AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(30000)
    })
    expect(response.status).toBe(302)
    const location = response.headers.get('location')
    expect(location).toContain('/auth/login')
    expect(decodeURIComponent(location)).toContain(`/plugin/${slug}/wiki/edit`)
  })

  it('still answers a machine with 401 rather than a redirect', async () => {
    // A redirect to a sign-in page is not a useful answer to an API client.
    expect(await status(`/plugin/${slug}/wiki/edit`, { headers: { Accept: 'application/json' } }))
      .toBe(401)
  })

  it('refuses an unauthenticated wiki save', async () => {
    expect(await status(`/plugin/${slug}/wiki`, {
      method: 'POST', headers: { Accept: 'application/json' }
    })).toBe(401)
  })

  it('keeps a contributor\'s own page to themselves', async () => {
    expect(await status('/contributions', { headers: { Accept: 'application/json' } })).toBe(401)
  })

  it('renders the prose block on a plugin page', async () => {
    // Either notes or an invitation to write them — never an empty box.
    const page = await (await get(`/plugin/${slug}`)).text()
    expect(page).toMatch(/About this plugin|Nobody has written/)
  })

  it('states the prose licence, which is not the catalogue licence', async () => {
    // CC0 facts and CC BY-SA prose on one page. Nothing else would tell a
    // reader that the two halves carry different terms.
    const page = await (await get(`/plugin/${slug}`)).text()
    if (page.includes('community notes')) expect(page).toContain('CC BY-SA')
  })
})

describe('the pages are assembled from the templates that shipped', () => {
  it('leaves no unfilled placeholder anywhere a reader can see', async () => {
    // A template loaded without a value renders an empty region rather than an
    // error, and a mismatched one would leave the braces on the page.
    for (const path of ['/', `/plugin/${slug}`, '/category/reverb', '/about']) {
      const page = await (await get(path)).text()
      expect(page, `${path} has an unfilled placeholder`).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/)
      expect(page, `${path} has a leftover template literal`).not.toMatch(/\$\{[a-zA-Z0-9_]/)
    }
  })

  it('serves the stylesheet inside the page, so templates/ reached the image', () => {
    expect(front).toContain(':root')
    expect(front).toContain('--accent')
  })

  it('has the search controls in the arrangement that shipped', async () => {
    // Structural, not cosmetic: the text box and button on one row, the facets
    // in their own row beneath. This suite was green while none of the layout
    // work was deployed, because nothing here asserted any of it — the same
    // way it once went blind on links.
    expect(front, 'no .search-row — the deployed markup predates it').toContain('class="search-row"')
    expect(front, 'no .facets row — the deployed markup predates it').toContain('class="facets"')
    expect(front, 'results are not wrapped, so they cannot flow into columns')
      .toContain('class="results"')
  })

  it('scales its type from the root, where rem actually comes from', async () => {
    // A stylesheet that sets only body's font-size leaves every rem-sized
    // caption where it was. That was a real bug, fixed, and this is what
    // proves the fix is the version being served.
    const narrow = front.slice(front.indexOf('@media (max-width: 48rem)'))
    expect(front, 'no narrow-screen block at all').toContain('@media (max-width: 48rem)')
    expect(narrow.slice(0, 600), 'the narrow block does not raise :root')
      .toMatch(/:root\s*\{[^}]*font-size/)
  })
})

/**
 * Is the public SPARQL endpoint deployed yet?
 *
 * Probed once, at collection, so the checks below are **skipped** rather than
 * passing vacuously. A test that quietly returns when its subject is absent is
 * the same defect as a guard that reads the wrong file: green, and testing
 * nothing.
 */
const SPARQL = 'https://sparql.plugin-universe.com/public/query'
const sparqlLive = await fetch(`${SPARQL}?query=${encodeURIComponent('ASK {}')}`, {
  headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(15000)
}).then(response => response.ok).catch(() => false)

describe.skipIf(!sparqlLive)('the public SPARQL endpoint', () => {
  const ask = query => fetch(`${SPARQL}?query=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': AGENT, Accept: 'application/sparql-results+json' },
    signal: AbortSignal.timeout(30000)
  })

  it('serves queries', async () => {
    const response = await ask('SELECT * WHERE { ?s ?p ?o } LIMIT 1')
    expect(response.status).toBe(200)
    expect((await response.json()).results.bindings.length).toBe(1)
  })

  it('answers a query with no GRAPH clause, because the default graph is the union', async () => {
    // An empty default graph would make the first query anybody types return
    // nothing, and read as a broken endpoint.
    const results = await (await ask('SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }')).json()
    expect(Number(results.results.bindings[0].n.value)).toBeGreaterThan(1000)
  })

  it('holds no accounts and no pending contributions', async () => {
    // The assertion this whole design exists for. Asked of the endpoint
    // directly rather than inferred from what was loaded into it.
    for (const graph of ['graph:system/accounts', 'graph:system/corrections']) {
      const results = await (await ask(`SELECT * WHERE { GRAPH <${graph}> { ?s ?p ?o } } LIMIT 1`)).json()
      expect(results.results.bindings.length, `${graph} is readable from the public endpoint`).toBe(0)
    }
  })

  it('exposes no way to write', async () => {
    // The dataset behind it has no update operation defined at all, so this
    // should fail at the proxy and again at Fuseki.
    for (const path of ['/public/update', '/publication-admin/update', '/$/datasets']) {
      const response = await fetch(`https://sparql.plugin-universe.com${path}`, {
        method: 'POST',
        headers: { 'User-Agent': AGENT, 'Content-Type': 'application/sparql-update' },
        body: 'INSERT DATA { GRAPH <urn:probe> { <urn:a> <urn:b> <urn:c> } }',
        signal: AbortSignal.timeout(30000)
      }).catch(() => null)
      if (!response) continue
      expect([401, 403, 404, 405], `${path} answered ${response.status}`).toContain(response.status)
    }
  })
})

describe('the endpoint that is not there yet', () => {
  it('says so, rather than being quietly skipped without a word', () => {
    // So the suite's output names the gap even when the block above is skipped.
    if (!sparqlLive) {
      console.log('    sparql.plugin-universe.com is not serving yet — 4 checks skipped')
    }
    expect(typeof sparqlLive).toBe('boolean')
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

  it('publishes an Open Audio Stack compatible registry', async () => {
    // Federation over competition: the tooling that reads that format can read
    // this catalogue without learning a new one.
    const response = await get('/registry/plugins/index.json')
    expect(response.status).toBe(200)
    const index = await response.json()
    const entries = Object.entries(index)
    expect(entries.length).toBeGreaterThan(100)
    for (const [slug, entry] of entries.slice(0, 20)) {
      expect(entry.slug).toBe(slug)
      expect(entry.versions[entry.version], `${slug} points at a missing version`).toBeTruthy()
    }
  })

  it('lets a browser call the API, and says the data is public domain', async () => {
    const response = await get('/search?q=reverb&limit=1')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toMatch(/max-age=\d+/)
    expect((await response.json()).licence.licence).toBe('CC0-1.0')
  })
})
