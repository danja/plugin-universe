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

  it('pages the browse list instead of showing everything or nothing', async () => {
    // Paging moved off the front page: `/` is a landing page with a glimpse of
    // ten, and `/plugins` is the complete list. The front page must therefore
    // *not* page, and must say where the rest is.
    expect(front, 'the front page still has a pager').not.toMatch(/page 1 of \d+/)
    expect(front, 'the front page does not link the full list').toContain('href="/plugins"')

    const list = await (await get('/plugins', { headers: { Accept: 'text/html' } })).text()
    expect(list).toMatch(/page 1 of \d+/)
    const second = await (await get('/plugins?from=10', { headers: { Accept: 'text/html' } })).text()
    expect(second).toMatch(/page 2 of \d+/)
    expect(second, 'the pager still points at the old home').toContain('/plugins?from=')
  })

  it('sends the URL shapes that moved to where they went', async () => {
    // `/?q=` and `/?from=` were the search and the browse list until each got
    // its own address. Every bookmark, shared link and crawler index still
    // holds the old shape, so they redirect rather than 404 or silently show
    // something else.
    const search = await get('/?q=reverb', { headers: { Accept: 'text/html' }, redirect: 'manual' })
    expect(search.status).toBe(302)
    expect(search.headers.get('location')).toBe('/search?q=reverb')

    const paged = await get('/?from=10', { headers: { Accept: 'text/html' }, redirect: 'manual' })
    expect(paged.status).toBe(302)
    expect(paged.headers.get('location')).toBe('/plugins?from=10')
  })

  it('answers /search and /plugins in whichever language was asked for', async () => {
    // Both are documented JSON endpoints that gained a page. A caller sending
    // no Accept header — curl, fetch() with no options — must still get JSON,
    // because that is what it has always got.
    for (const path of ['/search?q=reverb', '/plugins?limit=5']) {
      const json = await get(path)
      expect(json.headers.get('content-type'), path).toMatch(/application\/json/)
      expect(json.headers.get('vary'), `${path} does not vary on Accept`).toMatch(/accept/i)

      const html = await get(path, { headers: { Accept: 'text/html' } })
      expect(html.headers.get('content-type'), path).toMatch(/text\/html/)
    }
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

/**
 * Personal data must not be readable from anywhere on the public internet.
 *
 * **Not gated on the endpoint being deployed.** This assertion was written
 * inside the skipped block above, on the reasoning that there is nothing to
 * check until the endpoint exists — and while it sat there skipped, an older
 * nginx server block was proxying `sparql.` straight to the live catalogue and
 * serving `graph:system/accounts` to anyone who asked for it by name.
 *
 * "The feature is not deployed" is not a reason to stop asking whether data is
 * exposed. It is the state in which nobody is looking.
 */
describe('nothing anywhere serves personal data', () => {
  // Every path a SPARQL endpoint has plausibly been mounted at on this host,
  // whether or not this project put it there.
  const CANDIDATES = [
    'https://sparql.plugin-universe.com/public/query',
    'https://sparql.plugin-universe.com/plugin-universe/query',
    'https://sparql.plugin-universe.com/query',
    `${BASE}/plugin-universe/query`,
    `${BASE}/sparql`
  ]
  const PRIVATE = ['graph:system/accounts', 'graph:system/corrections']

  it('returns no account or contribution data from any SPARQL path', async () => {
    const exposed = []
    for (const endpoint of CANDIDATES) {
      for (const graph of PRIVATE) {
        const query = `SELECT * WHERE { GRAPH <${graph}> { ?s ?p ?o } } LIMIT 1`
        const response = await fetch(`${endpoint}?query=${encodeURIComponent(query)}`, {
          headers: { 'User-Agent': AGENT, Accept: 'application/sparql-results+json' },
          signal: AbortSignal.timeout(20000)
        }).catch(() => null)
        // Unreachable is the right answer, and so is a refusal.
        if (!response || !response.ok) continue
        const body = await response.json().catch(() => null)
        if (body?.results?.bindings?.length > 0) exposed.push(`${endpoint} -> ${graph}`)
      }
    }
    expect(exposed, `personal data is readable at: ${exposed.join(', ')}`).toEqual([])
  }, 60000)
})

describe('the MCP face', () => {
  const rpc = (body, url = `${BASE}/mcp`) => fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': AGENT,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  })

  it('initializes and negotiates a protocol version', async () => {
    const response = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'live-check', version: '1' } }
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.serverInfo.name).toBe('plugin-universe')
    expect(body.result.capabilities.tools).toBeTruthy()
  })

  it('offers the catalogue tools', async () => {
    const body = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })).json()
    const names = body.result.tools.map(tool => tool.name)
    expect(names).toContain('search_plugins')
    expect(names).toContain('get_plugin')
    expect(names).toContain('list_categories')
  })

  it('answers a search', async () => {
    const body = await (await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'search_plugins', arguments: { query: 'reverb', limit: 3 } }
    })).json()
    const payload = JSON.parse(body.result.content[0].text)
    expect(payload.results.length).toBeGreaterThan(0)
    expect(payload.licence).toMatch(/CC0/)
  })

  it('refuses a GET with an explanation rather than an empty stream', async () => {
    // A stateless server has no SSE channel; an agent should be told so.
    const response = await get('/mcp')
    expect(response.status).toBe(405)
    expect((await response.json()).error.message).toMatch(/stateless/i)
  })

  it('has no tool that writes', async () => {
    // Contributions are attributed to a person, and an agent is not one.
    const body = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} })).json()
    for (const tool of body.result.tools) {
      expect(tool.name, `${tool.name} looks like it writes`)
        .not.toMatch(/create|update|delete|edit|write|submit|correct/i)
    }
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

  it('tells a reader how to get at the data, from the front page', async () => {
    // An endpoint nobody can find is not an endpoint. /services is the one
    // page that names all of them, and the front page points at it.
    expect(front, 'the front page does not link /services').toContain('href="/services"')

    const page = await (await get('/services')).text()
    for (const endpoint of [
      'sparql.plugin-universe.com', 'mcp.plugin-universe.com', '/registry/plugins/index.json'
    ]) {
      expect(page, `/services does not mention ${endpoint}`).toContain(endpoint)
    }
  })

  it('serves the prose pages', async () => {
    for (const path of ['/about', '/terms', '/about/crawler', '/about/sparql', '/about/mcp', '/services']) {
      expect(await status(path), path).toBe(200)
    }
  })

  it('resolves every vocabulary IRI the data uses, as parseable Turtle', async () => {
    // Ask for the representation this test wants. /ns became an HTML page for
    // people and kept the JSON for machines, and this went on requesting
    // neither — so it received the page and failed parsing it as JSON. It had
    // been broken since that change, and was not caught because test:live is
    // deliberately not part of a sweep.
    const index = await (await get('/ns', { headers: { Accept: 'application/json' } })).json()
    expect(index.vocabularies.length).toBeGreaterThan(3)
    for (const vocabulary of index.vocabularies) {
      const response = await get(vocabulary.url)
      expect(response.status, vocabulary.url).toBe(200)
      expect(response.headers.get('content-type'), vocabulary.url).toMatch(/text\/turtle/)
      const dataset = await parseTurtle(await response.text())
      expect(dataset.size, vocabulary.url).toBeGreaterThan(0)
    }
  })

  it('gives a person reading /ns a page, and a machine the index', async () => {
    // The change that broke the test above, now asserted rather than assumed.
    const page = await get('/ns', { headers: { Accept: 'text/html' } })
    expect(page.headers.get('content-type')).toMatch(/text\/html/)
    expect(await page.text()).toContain('Plugin Universe')

    const index = await get('/ns', { headers: { Accept: 'application/json' } })
    expect(index.headers.get('content-type')).toMatch(/application\/json/)
    expect((await index.json()).vocabularies.length).toBeGreaterThan(3)
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
