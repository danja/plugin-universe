import http from 'http'
import fs from 'fs'
// Imported as a bare function: the request handler binds `path` to the request
// path, which would shadow a `path` module import inside it.
import { join as pathJoin } from 'path'
import logger from 'loglevel'
import { FACET_NAMES, facetsFrom, negotiate, prefersPage, pageOffset } from './requests.js'
import {
  renderDocPage, renderLandingPage, renderSearchPage, renderBrowsePage
} from './render.js'
import loadPage, { PAGES } from './pages.js'
import { send, sendText, JSON_HEADERS, HTML } from './respond.js'
import { SUBMITTABLE, profileLabels } from '../contrib/Submissions.js'
import PageReader from '../contrib/PageReader.js'
import { handleMcp, MCP_PATH } from '../mcp/server.js'
// The route modules, in the order they are tried. Each answers or declines.
import accountRoutes from './account-routes.js'
import moderationRoutes from './moderation-routes.js'
import contributionRoutes from '../contrib/routes.js'
import metaRoutes from './meta-routes.js'
import wikiRoutes from '../wiki/routes.js'
import billingRoutes from '../billing/routes.js'
import catalogueRoutes from './catalogue-routes.js'

// Re-exported because they were part of this module's surface before the
// split, and several tests and `bin/` scripts import them from here.
export { FACET_NAMES, facetsFrom, negotiate, prefersPage, pageOffset }

/**
 * Every path that accepts a POST, besides `/auth/…` and the MCP endpoint.
 *
 * The read-only guard runs *before* any route module is reached, so a route
 * that handles a POST and is missing from this list answers 405 and its
 * handler never runs. That is a second list to keep in step with the route
 * modules, and it is exactly the shape of defect this project keeps shipping —
 * `/feedback` was written, mounted, linked and tested, and a POST to it was
 * refused by this line until somebody tried one.
 *
 * `tests/store/server-starts.test.js` now POSTs to each of these and fails on a
 * 405, which is the check that would have caught it: a real request, against
 * the running application, with no CSRF token — so the answer should be a
 * refusal from the *route* (403, or a redirect to sign in) and never from here.
 */
const POST_PATHS = Object.freeze([
  /^\/plugin\/[^/]+\/(correct|wiki|image|promote)$/,
  '/moderation',
  '/admin',
  '/submit',
  '/feedback',
  '/billing/subscribe',
  '/billing/portal',
  '/billing/webhook'
])

/**
 * The public read API.
 *
 * Deliberately dependency-free: this is a handful of read-only JSON endpoints
 * over the search service, and node:http covers it without pulling Express in
 * for routing four paths. When the write endpoints of Phase 3 arrive — sessions,
 * auth, uploads — that calculus changes and a framework earns its place.
 *
 * Every response is CC0 catalogue data, so CORS is open: a catalogue nobody can
 * call from a browser is not much of an open dataset.
 */

/**
 * The vocabulary documents, served so that the IRIs in the data resolve.
 *
 * `pu:` terms appear in every plugin description this catalogue publishes, so a
 * consumer that follows one has to arrive somewhere. Only these files are
 * reachable, by name: the list is a whitelist rather than a directory served
 * from disk, because "serve whatever is under vocabs/" is one bad symlink away
 * from serving something else.
 */
export const VOCABULARIES = Object.freeze({
  'plugin-universe': {
    file: 'vocabs/plugin-universe.ttl',
    description: 'The pu: terms: measurements, packaging, contributions and catalogue administration. Everything that had no home in an existing vocabulary.'
  },
  'trn-profile': {
    file: 'vocabs/trn-profile.ttl',
    description: 'The trn: plugin profile vocabulary — roles, signals, routing — shared with the transmission, downspout and valis projects.'
  },
  'trn-extensions': {
    file: 'vocabs/trn-extensions.ttl',
    description: 'This project\'s additions to trn:, kept separate because they are proposed upstream rather than forked.'
  },
  categories: {
    file: 'vocabs/categories.ttl',
    description: 'The category scheme: a SKOS concept scheme with definitions, alternative labels, and closeMatch links to LV2 plugin classes.'
  },
  alignment: {
    file: 'vocabs/alignment.ttl',
    description: 'skos:closeMatch mappings from trn:, lv2: and pu: to AUFX-O and schema.org, so this catalogue is legible to systems that use those.'
  },
  shapes: {
    file: 'vocabs/shapes.ttl',
    description: 'The SHACL shapes every graph is validated against before it is written. How the store is checked, rather than part of what it describes.'
  }
})

/**
 * Which code this process is running.
 *
 * Read once, at load. `||` rather than `??`: an unset Docker build argument
 * arrives as an empty string, and `??` would accept that as a value — the same
 * mistake that took the site down through `SITE_ORIGIN` once. An unstamped
 * build reports null, which is the truth and is visible; it does not report
 * "unknown", which reads like a version.
 *
 * This exists because "is my deploy live?" had no answer. The site reported a
 * plugin count and a healthy status while serving code from a container that
 * had never been rebuilt, and finding that out took four commands on the
 * server. It is now one request.
 */
export const BUILD = Object.freeze({
  commit: process.env.BUILD_COMMIT || null,
  builtAt: process.env.BUILD_TIME || null
})

/**
 * Files served verbatim from the repository, by exact path.
 *
 * A whitelist by name rather than a static directory: "serve whatever is at the
 * root" is one stray file away from serving something that was never meant to
 * leave the machine. Their existence is checked at startup, for the same reason
 * the prose pages are — `docs/` was excluded by `.dockerignore` once and the
 * only symptom was three routes returning 500 in production.
 */
export const STATIC_FILES = Object.freeze({
  '/robots.txt': { file: 'robots.txt', type: 'text/plain; charset=utf-8' },
  // The site mark. A placeholder: it is the hyperdata.it favicon, which is the
  // owner's own design, standing in until this project has one of its own.
  //
  // Both forms, because browsers ask for them differently. `<link rel="icon">`
  // in the layout points at the PNG; a browser that has not read the markup yet
  // — or a feed reader, or a bookmarking tool — asks for `/favicon.ico` at the
  // root by convention, and answering 404 to that is a needless miss.
  // The site's one script: a spinner on a submit button and nothing else.
  // Served as a file rather than inlined so a Content-Security-Policy can be
  // added later without an exception, and so a browser caches it.
  '/site.js': {
    file: 'templates/site.js',
    type: 'application/javascript; charset=utf-8',
    cache: 'public, max-age=3600'
  },
  '/favicon.png': {
    file: 'favicon.png',
    type: 'image/png',
    cache: 'public, max-age=604800'
  },
  '/favicon.ico': {
    file: 'favicon.ico',
    type: 'image/x-icon',
    cache: 'public, max-age=604800'
  }
})

export function createServer ({
  search, config, projectRoot = process.cwd(), auth = null, corrections = null,
  submissions = null, images = null, pageReader = new PageReader(), promotions = null,
  feedback = null, bundleReader = null,
  billing = null,
  // The field table with its choices filled from the profile vocabulary. The
  // bare SUBMITTABLE has `choices: null` on the profile fields, deliberately —
  // a list of roles in JavaScript would be a copy of the ontology — so a caller
  // that does not supply this gets a form that refuses to render rather than
  // one with empty checkbox groups.
  submittable = SUBMITTABLE,
  wiki: wikiService = null, publication: mcpPublication = null, authProblem = null
}) {
  if (!search) throw new Error('The API server needs a SearchService')

  // What every page with columns needs: the facet counts its sidebar is built
  // from, the corpus size it reports, and how to write a `trn:` term for a
  // reader. Assembled here rather than at each call site — it was written out
  // five times, and a sixth page would have got two of the three.
  //
  // The labels come from the same filled field table the submission form uses,
  // so a term is spelled one way across the site: a vendor ticks "Control MIDI"
  // and reads "Control MIDI" back on the plugin page.
  const profileTermLabels = profileLabels(submittable)
  const navigationFor = async () => ({
    facetValues: await search.facets(),
    corpus: search.documents.size,
    labels: profileTermLabels
  })

  // Fail at startup, not per request. A page whose source file is missing from
  // the deployment is a packaging error — it happened once, when docs/ was in
  // .dockerignore — and the symptom was a 500 on three routes while everything
  // else looked healthy. A container that will not start is far easier to
  // notice than one that is quietly broken in one corner.
  const missing = [...Object.entries(PAGES), ...Object.entries(STATIC_FILES)]
    .filter(([, page]) => !fs.existsSync(pathJoin(projectRoot, page.file)))
    .map(([route, page]) => `${route} → ${page.file}`)
  if (missing.length > 0) {
    throw new Error(
      `Prose pages are missing their source files:\n  ${missing.join('\n  ')}\n` +
      'Check that docs/ reached the deployment — .dockerignore has excluded it before.'
    )
  }

  // Every page is assembled from templates/, so an image built without them
  // starts, answers /health, and 500s on everything a person can see. Rendering
  // one page at startup proves the directory arrived and that its placeholders
  // and this code still agree.
  try {
    const empty = { facets: {}, results: [], total: 0, corpus: 0, facetValues: {} }
    renderLandingPage(empty)
    renderSearchPage({ ...empty, query: 'smoke' })
    renderBrowsePage({ ...empty, offset: 0, limit: 10 })
  } catch (error) {
    throw new Error(
      `The page templates are unusable: ${error.message}\n` +
      'Check that templates/ reached the deployment, and that every placeholder has a value.'
    )
  }

  return http.createServer(async (request, response) => {
    const started = Date.now()
    let url
    try {
      url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
    } catch {
      return send(response, 400, { error: 'Malformed URL' })
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, JSON_HEADERS)
      return response.end()
    }
    // HEAD is GET without the body, and a server that supports GET is required
    // to support it. Crawlers and link checkers use it to test a URL cheaply,
    // and a plugin IRI that answers 405 to a link checker looks broken. Node
    // suppresses the body on a HEAD response by itself, so the handler below
    // needs no branch — the headers, including Content-Length, stay correct.
    // POST reaches the auth routes only. Everything else is still read-only,
    // and says so.
    const isAuthPost = request.method === 'POST' && request.url.startsWith('/auth/')
    const isCorrectionPost = request.method === 'POST' && POST_PATHS.some(
      pattern => pattern instanceof RegExp ? pattern.test(url.pathname) : pattern === url.pathname)
    // MCP is JSON-RPC over POST. It writes no data — every tool answers a
    // question — but it is a POST, so the read-only guard has to know about it.
    const isMcp = url.pathname === MCP_PATH
    if (request.method !== 'GET' && request.method !== 'HEAD' && !isAuthPost && !isCorrectionPost && !isMcp) {
      return send(response, 405, { error: 'This API is read-only' })
    }

    try {
      const path = url.pathname.replace(/\/$/, '') || '/'
      const params = url.searchParams
      // Who is looking. One account lookup per HTML request; the JSON and RDF
      // representations do not need it and do not pay for it.
      const viewer = auth
        ? { account: await auth.currentAccount(request), signInEnabled: true }
        : { account: null, signInEnabled: false }

      // MCP first, and ahead of every route module: the transport writes the
      // response itself rather than going through this project's send helpers.
      if (path === MCP_PATH) {
        return handleMcp(request, response, { search, publication: mcpPublication })
      }

      // The prose pages, dispatched from PAGES rather than from a second list
      // of its keys. Each used to have a `case` label of its own, so adding a
      // page meant editing two places and the route was the one that got
      // forgotten — the failure this project has shipped five times.
      if (PAGES[path]) {
        const page = await loadPage(path, projectRoot)
        return sendText(response, 200, renderDocPage(page, viewer), 'text/html; charset=utf-8')
      }

      // From here down, one module per group of routes, each answering or
      // declining. The order is the order they are tried; only the catalogue's
      // `/plugin/<slug>` and the wiki's and billing's `/plugin/<slug>/…` come
      // close to overlapping, and they are anchored so they cannot.
      //
      // Signing in, signing out, and the page that says which plan an account
      // holds.
      if (await accountRoutes({
        request, response, url, path, params, viewer, auth, search, billing
      })) return

      // A contributor's own list, and the moderator's console above it.
      if (await moderationRoutes({
        request, response, path, viewer, auth, search, config,
        corrections, submissions, promotions, billing, feedback, bundleReader
      })) return

      // Submitting a plugin, correcting a fact about one, adding a picture of
      // one — the only routes that write catalogue data for a person.
      if (await contributionRoutes({
        request, response, path, viewer, auth, search,
        submissions, submittable, pageReader, images, corrections, navigationFor, feedback
      })) return

      // What the site says about itself, and the files it serves flat: the
      // health check, robots.txt, the registry view, the vocabulary documents
      // and the stored images.
      if (await metaRoutes({
        request, response, path, viewer, search, config, auth, authProblem,
        build: BUILD, projectRoot, images,
        staticFiles: STATIC_FILES, vocabularies: VOCABULARIES, negotiate
      })) return

      // The wiki, and buying a placement. Both are `/plugin/<slug>/…` paths
      // and neither overlaps the plugin IRI below, but they are mounted first
      // so that the order on the page matches the order in the file.
      if (await wikiRoutes({
        request, response, path, params, viewer, auth, wiki: wikiService, search
      })) return

      // Two routes with opposite threat models — see src/billing/routes.js.
      if (await billingRoutes(request, response, {
        path, billing, promotions, accounts: auth?.accounts, search, auth, viewer
      })) return

      // The catalogue itself: the landing page, search, browse, facets,
      // vendors, categories, and a plugin's own IRI in four representations.
      if (await catalogueRoutes({
        request, response, path, params, viewer, auth, search, started,
        corrections, images, billing, wiki: wikiService, navigationFor
      })) return

      return send(response, 404, { error: 'No such endpoint', path })
    } catch (error) {
      logger.error('[api]', error)
      return send(response, 500, { error: error.message })
    }
  })
}

export default createServer
