import http from 'http'
import fs from 'fs'
// Imported as a bare function: the request handler binds `path` to the request
// path, which would shadow a `path` module import inside it.
import { join as pathJoin, isAbsolute } from 'path'
import logger from 'loglevel'
import { RETRIEVAL_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import {
  renderLandingPage, renderSearchPage, renderBrowsePage,
  renderPluginPage, renderCategoryPage, renderDocPage, renderAdminPage,
  renderContributionsPage, renderVocabularies, renderSubmitPage,
  renderVendorPage, renderVendorsPage
} from './render.js'
import { pluginJsonLd, pluginTurtle, categoryTurtle } from './serialise.js'
import loadPage, { PAGES } from './pages.js'
import { send, sendText, redirect, needsSignIn, JSON_HEADERS, LICENCE, HTML } from './respond.js'
import { readForm, readMultipart, BodyError } from './body.js'
import { ACTIONS, runAction, AdminActionError } from './AdminActions.js'
import ImageStore, { ImageError } from './ImageStore.js'
import { IMAGE_CONFIG } from '../../config/preferences.js'
import { CORRECTABLE, CorrectionError } from '../contrib/Corrections.js'
import { PROMOTION_CONFIG } from '../../config/preferences.js'
import { SUBMITTABLE, SubmissionError } from '../contrib/Submissions.js'
import PageReader, { PageReadError } from '../contrib/PageReader.js'
import { PromotionError, daysRemaining } from '../catalogue/Promotions.js'
import billingRoutes from '../billing/routes.js'

/**
 * What a `promoted` result is, said in the response rather than only on a page.
 *
 * The DSA asks that the main parameters used to rank an advertisement be
 * disclosed. For a JSON consumer that means here: a link is the disclosure, and
 * the numbers behind it are on the page it points at.
 */
const PROMOTION_DISCLOSURE = Object.freeze({
  note: 'Results marked "promoted" are paid placements, boosted in ranking and labelled as such.',
  // The bound that is actually load-bearing, and the one that will not change:
  // a placement may reach first place, but only among results the query already
  // returned. Deliberately says nothing about position — that is a published
  // number which may be tuned, and a sentence here repeating it is a second
  // copy to keep true. It was wrong within an hour of being written.
  bounded: 'A placement is applied after retrieval and only to a result that already matched: it re-ranks, and never adds a plugin to a search it does not match.',
  url: 'https://plugin-universe.com/about/promotion'
})
import buildRegistry from './registry.js'
import { handleMcp, MCP_PATH } from '../mcp/server.js'
import wikiRoutes from '../wiki/routes.js'
import { renderWikiBlock } from '../wiki/render.js'
import { TRUST } from '../auth/Accounts.js'

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
 * Decide the representation to return for a plugin IRI.
 *
 * An explicit .ttl or .jsonld suffix wins; otherwise the Accept header decides,
 * defaulting to HTML because the common case is a person following a link.
 */
/**
 * The facets a caller may filter by, in one place.
 *
 * This list was written out three times — in `/`, in `/search` and in
 * `/plugins` — and `/plugins` had silently fallen behind: it accepted none of
 * them, so `?category=reverb` on the browse list was ignored rather than
 * refused. It is also the list `/services` documents and the one the search
 * form's dropdowns are built from, so it is exactly the shape of thing this
 * project keeps getting wrong by copying.
 */
export const FACET_NAMES = Object.freeze([
  'format', 'category', 'role', 'vendor', 'source', 'pricing', 'licence', 'measured'
])

/** The facet filter a request is asking for; null for each one it is not. */
export function facetsFrom (params) {
  return Object.fromEntries(FACET_NAMES.map(name => [name, params.get(name) || null]))
}

export function negotiate (suffix, acceptHeader = '') {
  if (suffix === '.ttl') return 'turtle'
  if (suffix === '.jsonld') return 'jsonld'
  if (suffix === '.json') return 'json'
  const accept = acceptHeader.toLowerCase()
  if (accept.includes('text/turtle')) return 'turtle'
  if (accept.includes('application/ld+json')) return 'jsonld'
  if (accept.includes('application/json')) return 'json'
  if (accept.includes('text/html')) return 'html'
  return 'html'
}

/**
 * Whether this caller asked for a page, on a route whose default is JSON.
 *
 * The inverse default from negotiate(), and deliberately a separate function
 * rather than a flag on it. `/plugin/<slug>` is a page that gained machine
 * representations, so no Accept header at all means HTML — somebody pasted an
 * IRI into a browser. `/search` and `/plugins` are the opposite: documented
 * JSON endpoints that have gained a page. curl sends a wildcard Accept and
 * `fetch()` with no headers sends none at all; both have been receiving JSON
 * since the API was written down in docs/services.md, and both must keep
 * receiving it. Only an explicit text/html changes the answer.
 */
export function prefersPage (acceptHeader = '') {
  return String(acceptHeader).toLowerCase().includes('text/html')
}

/**
 * The `from` parameter of a listing, as a non-negative integer.
 *
 * Anything else is page one. A paging parameter is the easiest thing on a page
 * for a stranger to put a negative number, a float or a word into, and none of
 * those should reach `Array.slice` to be interpreted for us.
 */
export function pageOffset (params) {
  const raw = Number(params.get('from'))
  if (!Number.isFinite(raw) || raw < 0) return 0
  return Math.min(Math.floor(raw), 100000)
}


/**
 * Licence and attribution, on every response.
 *
 * The dataset is CC0 and attribution is requested rather than required, so
 * saying so in the payload costs nothing and means a consumer never has to go
 * looking for the termocabulary documents, served so that the IRIs in the data resolve.
 *
 * `pu:` terms appear in every plugin description this catalogue publishes, so a
 * consumer that follows one has to arrive somewhere. Only the shapes: 'vocabs/shapes.ttl'
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

export const STATIC_FILES = Object.freeze({
  '/robots.txt': { file: 'robots.txt', type: 'text/plain; charset=utf-8' }
})

export function createServer ({
  search, config, projectRoot = process.cwd(), auth = null, corrections = null,
  submissions = null, images = null, pageReader = new PageReader(), promotions = null,
  billing = null,
  wiki: wikiService = null, publication: mcpPublication = null, authProblem = null
}) {
  if (!search) throw new Error('The API server needs a SearchService')

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
    const isCorrectionPost = request.method === 'POST' &&
      (/^\/plugin\/[^/]+\/(correct|wiki|image)$/.test(url.pathname) ||
        url.pathname === '/moderation' || url.pathname === '/admin' ||
        url.pathname === '/submit')
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

      // MCP first, and outside the switch: the transport writes the response
      // itself rather than going through this project's send helpers.
      if (path === MCP_PATH) {
        return handleMcp(request, response, { search, publication: mcpPublication })
      }

      // The prose pages, dispatched from PAGES rather than from a second list of
      // its keys. The switch below used to name them, so adding a page meant
      // editing two places and the route was the one that got forgotten —
      // which is the failure this project has shipped five times.
      if (PAGES[path]) {
        const page = await loadPage(path, projectRoot)
        return sendText(response, 200, renderDocPage(page, viewer), 'text/html; charset=utf-8')
      }

      switch (path) {
        case '/': {
          // `/` used to be the landing page, the search results and the paged
          // browse list at once, told apart by which parameters arrived. Each
          // now has its own address, so the old shapes are sent to their new
          // homes rather than answered here — otherwise every bookmark, every
          // shared link and every crawler's index breaks on deploy.
          if (params.get('q') || FACET_NAMES.some(name => params.get(name))) {
            return redirect(response, `/search?${params.toString()}`)
          }
          if (params.get('from')) {
            return redirect(response, `/plugins?${params.toString()}`)
          }

          // Only plugins with a picture. A grid of grey rectangles is a worse
          // first impression than a shorter list, and about three quarters of
          // the catalogue has an image, so this narrows the pool rather than
          // emptying it. The complete list, pictures or not, is /plugins.
          const outcome = await search.browse({
            limit: RETRIEVAL_CONFIG.browsePageSize, offset: 0, hasImage: true
          })
          return sendText(response, 200, renderLandingPage({
            corpus: search.documents.size,
            results: outcome.results,
            facetValues: await search.facets(),
            viewer
          }), HTML)
        }

        case '/health': {
          return send(response, 200, {
            status: 'ok',
            plugins: search.documents.size,
            index: search.index.size,
            // How many plugins carry a profiler reading, and when the newest
            // run was. Here because measurements are made on one machine and
            // carried to another, and until this existed there was no way to
            // ask the deployment whether a delivery had landed — the first one
            // did not, and the symptom was an absent facet, which looks exactly
            // like a feature nobody built.
            measured: search.measurements.size,
            measuredAt: [...search.measurements.values()]
              .map(entry => entry.at).sort().pop() ?? null,
            embeddingModel: config?.get('embedding.model') ?? null,
            // Which code, not just which data. Null means the image was built
            // without a stamp, not that the build is old.
            build: BUILD,
            // So a half-configured sign-in is visible to monitoring rather than
            // only to whoever reads the container log at startup.
            signIn: auth ? 'enabled' : (authProblem ? 'misconfigured' : 'disabled'),
            ...(authProblem ? { signInProblem: authProblem } : {}),
            licence: LICENCE
          })
        }

        case '/search': {
          const q = params.get('q')
          const facets = facetsFrom(params)
          const asked = Boolean(q) || Object.values(facets).some(Boolean)
          const wantsHtml = prefersPage(request.headers.accept)

          // A browser submits every <select> in the form, including the ones
          // left on "any", so the search box produces
          // `?q=reverb&format=&category=&pricing=&source=`. That is the URL a
          // person copies and shares, and four empty parameters make it a
          // different string from the same search reached any other way —
          // which is the duplication this whole split exists to remove. Strip
          // them once and settle on the short form. No loop: nothing empty
          // survives the cleaning.
          const tidy = new URLSearchParams(
            [...params.entries()].filter(([, value]) => value !== '')
          )
          if (wantsHtml && tidy.toString() !== params.toString()) {
            return redirect(response, tidy.toString() ? `/search?${tidy}` : '/')
          }

          if (!asked) {
            // Nothing to search for. A person gets the page with the search box
            // on it; a program gets told what it left out.
            if (wantsHtml) return redirect(response, '/')
            return send(response, 400, {
              error: 'Provide q, or at least one of format, role, category, vendor, source, pricing, licence, measured'
            })
          }

          const limit = wantsHtml
            ? RETRIEVAL_CONFIG.htmlPageSize
            : Math.min(
              Number(params.get('limit')) || RETRIEVAL_CONFIG.defaultPageSize,
              RETRIEVAL_CONFIG.maxPageSize
            )
          const outcome = q
            ? await search.search(q, { facets, limit })
            : await search.browse({ facets, limit, order: 'recent' })

          if (wantsHtml) {
            return sendText(response, 200, renderSearchPage({
              query: q,
              facets,
              results: outcome.results,
              total: outcome.total,
              corpus: search.documents.size,
              elapsedMs: Date.now() - started,
              facetValues: await search.facets(),
              viewer
            }), HTML)
          }

          return send(response, 200, {
            query: q ?? null,
            facets: Object.fromEntries(Object.entries(facets).filter(([, v]) => v)),
            total: outcome.total,
            count: outcome.results.length,
            elapsedMs: Date.now() - started,
            results: outcome.results,
            signals: outcome.signals ?? null,
            // Only when there is one to disclose, and then in the envelope as
            // well as on the result. A consumer that re-publishes these results
            // needs to know a placement was paid for without having to know
            // that `promoted` is a field it should have looked for.
            ...(outcome.results.some(result => result.promoted) ? { promotion: PROMOTION_DISCLOSURE } : {}),
            licence: LICENCE
          })
        }

        case '/facets': {
          return send(response, 200, { facets: await search.facets(), licence: LICENCE })
        }

        case '/plugins': {
          const wantsHtml = prefersPage(request.headers.accept)
          const facets = facetsFrom(params)
          // The page a person reads is a fixed size; the JSON is the caller's
          // to choose, up to the cap. Ordering differs for the same reason the
          // two exist: a person browsing wants what is new, a program paging
          // through the whole catalogue wants a stable order.
          const outcome = await search.browse({
            limit: wantsHtml
              ? RETRIEVAL_CONFIG.browsePageSize
              : Math.min(Number(params.get('limit')) || 50, RETRIEVAL_CONFIG.maxPageSize),
            offset: pageOffset(params),
            facets,
            order: wantsHtml
              ? (params.get('order') === 'name' ? 'name' : 'recent')
              : (params.get('order') === 'recent' ? 'recent' : 'name')
          })

          if (wantsHtml) {
            return sendText(response, 200, renderBrowsePage({
              results: outcome.results,
              total: outcome.total,
              offset: outcome.offset,
              limit: RETRIEVAL_CONFIG.browsePageSize,
              facets,
              facetValues: await search.facets(),
              corpus: search.documents.size,
              viewer
            }), HTML)
          }

          return send(response, 200, {
            total: outcome.total,
            offset: outcome.offset,
            order: outcome.order,
            count: outcome.results.length,
            results: outcome.results,
            licence: LICENCE
          })
        }

        case '/auth/login':
        case '/auth/callback':
        case '/auth/logout': {
          if (!auth) return send(response, 404, { error: 'Sign-in is not configured on this instance' })
          if (path === '/auth/logout' && request.method !== 'POST') {
            // A GET logout is triggerable by any page with an <img> tag.
            return send(response, 405, { error: 'Sign out with POST' })
          }
          const outcome = path === '/auth/login'
            ? auth.login(request, url)
            : path === '/auth/callback'
              ? await auth.callback(request, url)
              : auth.logout(request)
          response.writeHead(outcome.status, {
            ...(outcome.headers ?? {}),
            ...(outcome.body ? { 'Content-Type': 'text/plain; charset=utf-8' } : {})
          })
          return response.end(outcome.body ?? '')
        }

        // The prose pages. /about/crawler in particular is the address this
        // project's own crawler user agent points at, so it is a promise made
        // to every source that has ever seen a request from it.


        case '/contributions': {
          if (!auth || !corrections) return send(response, 404, { error: 'Contributions are not enabled' })
          // 401, not 404: unlike the moderation queue this is not a role
          // anyone might not have — it is simply nobody's page until you sign
          // in, and saying so is the useful answer.
          if (!viewer.account) {
            return needsSignIn(request, response, {
              returnTo: '/contributions',
              message: 'Sign in to see your contributions'
            })
          }
          const rows = await corrections.byAccount(viewer.account.iri)
          return sendText(response, 200, renderContributionsPage(rows, {
            viewer,
            correctable: CORRECTABLE,
            trustLevel: viewer.account.trustLevel
          }), 'text/html; charset=utf-8')
        }

        case '/moderation':
          // Moved. Every moderator's bookmark and the account bar's old link
          // still work, and there is one page rather than two that drift.
          return redirect(response, '/admin')

        case '/admin': {
          if (!auth || !corrections) return send(response, 404, { error: 'Moderation is not enabled' })
          const moderator = viewer.account
          // Not 403 for a signed-out visitor: the existence of the queue is not
          // a secret, but nor is it worth telling a stranger they lack a role.
          if (!moderator || moderator.trustLevel !== TRUST.MODERATOR) {
            return send(response, 404, { error: 'No such endpoint', path })
          }

          // Read fresh on every render, including after a POST: a moderator who
          // has just promoted something must see it in the list, or they will
          // press the button again.
          const promotionState = async () => {
            if (!promotions) return null
            const live = [...(await promotions.active()).values()]
              .map(row => ({
                ...row,
                name: search.documents.get(row.plugin)?.name ?? null,
                daysRemaining: daysRemaining(row)
              }))
            return { live, expiring: live.filter(row => row.daysRemaining <= PROMOTION_CONFIG.expiringWithinDays) }
          }

          let message = null
          if (request.method === 'POST') {
            let form
            try {
              form = await readForm(request)
            } catch (error) {
              return send(response, error.status ?? 400, { error: error.message })
            }
            if (!auth.session.verifyCsrf(form.get('csrf'), moderator.iri)) {
              return send(response, 403, { error: 'That page has expired. Reload and try again.' })
            }

            // Promote or end a placement. Separate from the action table
            // because both take a subject, and the action table is deliberately
            // a list of verbs that take none.
            if (form.get('promote') || form.get('unpromote')) {
              if (!promotions) return send(response, 404, { error: 'Promotion is not enabled' })
              const slug = String(form.get('slug') ?? '').trim().replace(/^.*\/plugin\//, '')
              const pluginIri = `${NAMESPACES.pu}plugin/${slug}`
              const doc = search.documents.get(pluginIri)
              if (!doc) {
                message = `No plugin with the slug "${slug}". It is the last part of the plugin page's address.`
              } else {
                try {
                  if (form.get('promote')) {
                    const result = await promotions.promote({ moderator, pluginIri })
                    message = result.created
                      ? `${doc.name} is promoted until ${String(result.endsAt).slice(0, 10)}. Its results now carry a Promoted label.`
                      : `${doc.name} was already promoted, until ${String(result.endsAt).slice(0, 10)}. Nothing changed — pressing the button twice does not extend a placement.`
                  } else {
                    const result = await promotions.unpromote({ moderator, pluginIri })
                    message = result.ended
                      ? `${doc.name} is no longer promoted. The record is kept, ended as of now.`
                      : `${doc.name} was not promoted. Nothing to end.`
                  }
                  // The ranking reads a map held in memory, so a placement that
                  // needed a restart to take effect would be one the moderator
                  // believes is running when it is not.
                  await search.loadPromotions()
                } catch (error) {
                  if (!(error instanceof PromotionError)) throw error
                  message = error.message
                }
              }
              return sendText(response, 200, renderAdminPage(await corrections.pending(), {
                csrfToken: auth.session.csrfToken(moderator.iri),
                message,
                viewer,
                submissions: submissions ? await submissions.pending() : [],
                actions: ACTIONS,
                facetValues: await search.facets(),
                corpus: search.documents.size,
                promotions: await promotionState()
              }), HTML)
            }
            // An action, or a review decision. Which one is decided by which
            // field the form carried. The action's *name* is a key into a
            // frozen table and never reaches a shell, a filename or a graph
            // name — see src/api/AdminActions.js.
            if (form.get('action')) {
              try {
                message = await runAction(form.get('action'), { client: search.client, config, search })
              } catch (error) {
                // Shown rather than turned into a 500: the administrator
                // pressed the button and is owed the answer. runAction has
                // already translated the common causes into a remedy.
                logger.warn(`[admin] ${form.get('action')} failed: ${error.message}`)
                message = `${form.get('action')} failed: ${error.message}`
              }
              return sendText(response, 200, renderAdminPage(await corrections.pending(), {
                csrfToken: auth.session.csrfToken(moderator.iri),
                message,
                viewer,
                submissions: submissions ? await submissions.pending() : [],
                actions: ACTIONS,
                facetValues: await search.facets(),
                corpus: search.documents.size,
                promotions: await promotionState()
              }), HTML)
            }

            const accept = form.get('decision') === 'accept'
            // One queue, two kinds of thing in it. Which one this decision is
            // about is decided by which field the form carried, not by a mode
            // the page has to remember.
            try {
              const outcome = form.get('submission')
                ? await submissions.review({
                  submissionIri: form.get('submission'), moderator, accept, accounts: auth.accounts
                })
                : await corrections.review({
                  correctionIri: form.get('correction'), moderator, accept, accounts: auth.accounts
                })
              // An accepted submission is a plugin the running app has never
              // heard of: documents are read at startup and the vector index
              // is a file. Without this it is in the catalogue, dereferenceable
              // at its own IRI, and absent from every search.
              const taken = outcome.status === 'accepted' && form.get('submission')
                ? await search.takeUpNewPlugins()
                : null
              message = outcome.status === 'accepted'
                ? `Accepted.${outcome.promoted ? ` ${outcome.contributor} is now trusted — their contributions go live from here.` : ''}` +
                  (taken?.error ? ' It is in the catalogue but not yet searchable — indexing failed, and the nightly run will pick it up.' : '') +
                  (taken?.embedded ? ` Indexed and searchable — ${taken.plugins} plugins.` : '')
                : 'Rejected. Nothing was written to a public graph.'
            } catch (error) {
              if (!(error instanceof CorrectionError) && !(error instanceof SubmissionError)) throw error
              message = error.message
            }
          }

          return sendText(response, 200, renderAdminPage(await corrections.pending(), {
            csrfToken: auth.session.csrfToken(moderator.iri),
            message,
            viewer,
            submissions: submissions ? await submissions.pending() : [],
            actions: ACTIONS,
            facetValues: await search.facets(),
            corpus: search.documents.size,
            promotions: await promotionState()
          }), HTML)
        }

        case '/vendors': {
          return sendText(response, 200, renderVendorsPage(search.vendorList(), viewer, {
            facetValues: await search.facets(), corpus: search.documents.size
          }), HTML)
        }

        case '/submit': {
          if (!submissions) return send(response, 404, { error: 'Submissions are not enabled on this instance' })
          if (!viewer.account) {
            return needsSignIn(request, response, {
              returnTo: '/submit',
              message: 'Sign in to submit a plugin'
            })
          }
          const account = viewer.account
          const facetValues = await search.facets()
          // Moderators only, and checked here as well as in the renderer: the
          // form not being drawn is a decision about a page, not a control.
          // docs/resources.md §4 rule 8 — the request has to stay attributable
          // to a named person, or it is an open proxy.
          const mayRead = account.trustLevel === TRUST.MODERATOR
          const render = extra => sendText(response, extra.status ?? 200,
            renderSubmitPage(SUBMITTABLE, {
              csrfToken: auth.session.csrfToken(account.iri),
              viewer,
              facetValues,
              corpus: search.documents.size,
              mayRead,
              ...extra
            }), HTML)

          if (request.method !== 'POST') return render({})

          let form
          try {
            form = await readForm(request)
          } catch (error) {
            return send(response, error.status ?? 400, { error: error.message })
          }
          if (!auth.session.verifyCsrf(form.get('csrf'), account.iri)) {
            return send(response, 403, { error: 'That form has expired. Reload the page and try again.' })
          }

          // Whatever was typed, so an error hands the form back filled in
          // rather than empty. A form that empties itself when it refuses is a
          // form people fill in once.
          const values = Object.fromEntries(Object.entries(SUBMITTABLE).map(([name, spec]) =>
            [name, spec.multiple ? form.getAll(name) : (form.get(name) ?? '')]))

          // "Read the page" — one fetch, at this moderator's request, into a
          // draft they then check. It writes nothing: the draft comes back as
          // a filled-in form and the ordinary Submit button is still what
          // saves it. See src/contrib/PageReader.js for the four refusals that
          // keep this from being a crawler.
          if (form.get('read')) {
            const pageUrl = String(form.get('pageUrl') ?? '').trim()
            if (!mayRead) {
              return send(response, 403, {
                error: 'Reading a page by URL is for moderators. Fill the form in instead.'
              })
            }
            if (!pageUrl) {
              return render({ error: 'Paste the address of the page to read.', values, status: 400 })
            }
            try {
              const draft = await pageReader.read(pageUrl)
              return render({
                // The draft fills the form; anything already typed that the
                // page did not mention is kept, so a half-filled form is not
                // wiped by pressing Read.
                values: { ...values, ...draft.fields },
                draft,
                pageUrl
              })
            } catch (error) {
              if (!(error instanceof PageReadError)) throw error
              return render({ error: error.message, values, pageUrl, status: 400 })
            }
          }

          try {
            const result = await submissions.submit({ account, fields: values })
            // Written straight into the catalogue for a trusted contributor,
            // so it has to reach the index now or it is a plugin nobody can
            // find. Never throws; a failure here leaves it for the nightly
            // --only-new and says so in the log.
            if (result.status === 'accepted') await search.takeUpNewPlugins()
            return render({
              submitted: result.status === 'accepted'
                ? {
                    text: 'Thank you — added to the catalogue and attributed to you.',
                    href: result.plugin.replace(NAMESPACES.pu, '/'),
                    linkText: 'See it'
                  }
                : {
                    text: 'Thank you — queued for review. It joins the catalogue once a moderator accepts it.',
                    href: '/contributions',
                    linkText: 'Your contributions'
                  }
            })
          } catch (error) {
            if (!(error instanceof SubmissionError)) throw error
            return render({
              error: error.message,
              // A duplicate is the one refusal worth linking: the person came
              // to add a plugin and it is already here.
              submitted: error.existing
                ? {
                    text: 'It is already in the catalogue:',
                    href: error.existing.replace(NAMESPACES.pu, '/'),
                    linkText: 'see the entry'
                  }
                : null,
              values,
              status: 400
            })
          }
        }

        case '/robots.txt': {
          const served = STATIC_FILES[path]
          const body = await fs.promises.readFile(pathJoin(projectRoot, served.file), 'utf8')
          return sendText(response, 200, body, served.type)
        }

        // The catalogue as an Open Audio Stack registry, so the tooling that
        // already reads that format can consume this one. Federation over
        // competition, from docs/suggestions.md.
        case '/registry/plugins/index.json': {
          const rows = await search.client.select(search.queries.get('plugin/registry', {}))
          const { index, withheld } = buildRegistry(rows, search.sources)
          if (withheld.length > 0) {
            logger.info(`[registry] ${withheld.length} plugin(s) withheld: not redistributable`)
          }
          return send(response, 200, index)
        }

        case '/ns': {
          // Negotiated, like a plugin IRI. It is linked from the footer of
          // every page, and a JSON blob is not an answer to a person who
          // followed a link called "Vocabularies".
          if (negotiate('', request.headers.accept) !== 'html') {
            return send(response, 200, {
              vocabularies: Object.entries(VOCABULARIES).map(([name, vocabulary]) => ({
                name, url: `/ns/${name}.ttl`, description: vocabulary.description
              })),
              licence: LICENCE
            })
          }
          return sendText(response, 200, renderVocabularies(VOCABULARIES, viewer), 'text/html; charset=utf-8')
        }

        default: {
          // /ns/<name>.ttl — the vocabulary documents. These are what the pu:
          // IRIs in every published description resolve to.
          const vocab = path.match(/^\/ns\/([a-z0-9-]+)\.ttl$/)
          if (vocab) {
            const file = VOCABULARIES[vocab[1]]?.file
            if (!file) return send(response, 404, { error: 'No such vocabulary', name: vocab[1] })
            const body = await fs.promises.readFile(isAbsolute(file) ? file : pathJoin(projectRoot, file), 'utf8')
            return sendText(response, 200, body, 'text/turtle; charset=utf-8')
          }

          // /vendor/<slug> — everything the catalogue holds by one maker.
          //
          // The slug is a fold of the vendor's name, not a minted identity:
          // `trn:vendor` is free text and there is nothing else to key on. That
          // is fine for a listing and is *not* enough to hang a claimable,
          // editable profile on — see the note in TODO.md before selling one.
          const vendor = path.match(/^\/vendor\/([a-z0-9-]+?)(\.json)?$/)
          if (vendor) {
            const record = search.vendor(vendor[1])
            if (!record) return send(response, 404, { error: 'No such vendor', vendor: vendor[1] })
            if (vendor[2] === '.json') {
              return send(response, 200, {
                vendor: record.name,
                slug: record.slug,
                // Every spelling the catalogue met, because a consumer
                // reconciling this against their own data needs the variants
                // rather than our pick of them.
                names: record.spellings,
                total: record.count,
                results: record.results,
                licence: LICENCE
              })
            }
            return sendText(response, 200, renderVendorPage(record, viewer, {
              facetValues: await search.facets(), corpus: search.documents.size
            }), HTML)
          }

          // /category/<slug> — a SKOS concept from the category scheme, and the
          // browsable facet page for it. One IRI, negotiated like a plugin.
          const category = path.match(/^\/category\/([a-z0-9-]+?)(\.ttl|\.json)?$/)
          if (category) {
            const slug = category[1]
            const facets = await search.facets()
            const known = (facets.category ?? []).find(value => value.value === slug)
            if (!known) return send(response, 404, { error: 'No such category', category: slug })

            const outcome = await search.browse({ facets: { category: slug }, limit: 200 })
            const concept = search.concept(slug)
            if (negotiate(category[2], request.headers.accept) === 'turtle') {
              return sendText(response, 200, categoryTurtle(slug, outcome.results, concept), 'text/turtle; charset=utf-8')
            }
            if (category[2] === '.json') {
              return send(response, 200, {
                category: slug,
                iri: `${NAMESPACES.pu}category/${slug}`,
                concept,
                total: outcome.total,
                results: outcome.results,
                licence: LICENCE
              })
            }
            return sendText(response, 200,
              renderCategoryPage(slug, outcome.results, outcome.total, viewer, concept,
                { facetValues: facets, corpus: search.documents.size }),
              'text/html; charset=utf-8')
          }

          // Suggesting a correction. The only route that writes catalogue data
          // on behalf of a person, so every guard is here: signed in, not
          // suspended, a CSRF token bound to that account, and a predicate from
          // the whitelist. The value itself is checked by the validator.
          if (await wikiRoutes({
            request, response, path, params, viewer, auth, wiki: wikiService, search
          })) return

          // Buying a placement, and Stripe telling us it was bought. Two routes
          // with opposite threat models — see src/billing/routes.js.
          if (await billingRoutes(request, response, {
            path, billing, promotions, accounts: auth?.accounts, search, auth, viewer
          })) return

          // Uploading a picture of a plugin.
          //
          // Trusted contributors and moderators only, and deliberately without
          // a queued state. A correction can wait in a queue because nobody
          // sees it meanwhile; a picture is public the instant it is served and
          // cannot be un-seen, so the useful question is whether this person is
          // trusted — which this site already measures — rather than whether
          // somebody will get round to looking.
          const picturing = path.match(/^\/plugin\/([A-Za-z0-9-]+)\/image$/)
          if (picturing && images && corrections) {
            const pluginIri = `${NAMESPACES.pu}plugin/${picturing[1]}`
            const doc = search.documents.get(pluginIri)
            if (!doc) return send(response, 404, { error: 'No such plugin', iri: pluginIri })
            if (request.method !== 'POST') return redirect(response, `/plugin/${picturing[1]}`)

            const account = viewer.account
            if (!account) {
              return needsSignIn(request, response, {
                returnTo: `/plugin/${picturing[1]}`,
                message: 'Sign in to add a picture'
              })
            }
            const mayUpload = account.trustLevel === TRUST.TRUSTED || account.trustLevel === TRUST.MODERATOR
            if (!mayUpload) {
              return send(response, 403, {
                error: 'Pictures can be added by trusted contributors. Accepted corrections earn that.'
              })
            }

            const navigation = { facetValues: await search.facets(), corpus: search.documents.size }
            const render = extra => sendText(response, extra.status ?? 200,
              renderPluginPage(doc, viewer, {
                account,
                csrfToken: auth.session.csrfToken(account.iri),
                correctable: CORRECTABLE,
                mayUploadImage: true,
                ...extra
              }, search.measured(pluginIri), '', navigation), HTML)

            let form
            try {
              form = await readMultipart(request, { maxBytes: IMAGE_CONFIG.maxBytes })
            } catch (error) {
              if (!(error instanceof BodyError)) throw error
              return render({ imageError: error.message, status: error.status ?? 400 })
            }
            if (!auth.session.verifyCsrf(form.get('csrf'), account.iri)) {
              return send(response, 403, { error: 'That form has expired. Reload the page and try again.' })
            }

            const uploaded = form.files?.get('image')
            try {
              const stored = await images.store(uploaded?.buffer ?? Buffer.alloc(0))
              await corrections.submit({
                account,
                subject: pluginIri,
                predicate: `${NAMESPACES.foaf}depiction`,
                value: stored.url,
                rationale: `Uploaded ${stored.type}, ${stored.bytes} bytes.`
              })
              // The document in memory has to learn about it too, or the page
              // this renders still shows the old picture — or none.
              await search.takeUpNewPlugins()
              const refreshed = search.documents.get(pluginIri) ?? doc
              return sendText(response, 200,
                renderPluginPage(refreshed, viewer, {
                  account,
                  csrfToken: auth.session.csrfToken(account.iri),
                  correctable: CORRECTABLE,
                  mayUploadImage: true,
                  imageDone: 'Added, and attributed to you.'
                }, search.measured(pluginIri), '', navigation), HTML)
            } catch (error) {
              if (error instanceof ImageError || error instanceof CorrectionError) {
                return render({ imageError: error.message, status: 400 })
              }
              throw error
            }
          }

          const correcting = path.match(/^\/plugin\/([A-Za-z0-9-]+)\/correct$/)
          if (correcting) {
            if (!auth || !corrections) return send(response, 404, { error: 'Contributions are not enabled' })
            const pluginIri = `${NAMESPACES.pu}plugin/${correcting[1]}`
            const doc = search.documents.get(pluginIri)
            if (!doc) return send(response, 404, { error: 'No such plugin' })

            const account = viewer.account
            if (!account) return send(response, 401, { error: 'Sign in to suggest a correction' })

            let form
            try {
              form = await readForm(request)
            } catch (error) {
              return send(response, error.status ?? 400, { error: error.message })
            }

            if (!auth.session.verifyCsrf(form.get('csrf'), account.iri)) {
              // Stale token, or a post that did not come from a page we served.
              return send(response, 403, { error: 'That form has expired. Reload the page and try again.' })
            }

            // Read once, not per render: the helper below is called on both
            // the success and the failure path.
            const navigation = { facetValues: await search.facets(), corpus: search.documents.size }
            const render = extra => sendText(response, extra.status ?? 200,
              renderPluginPage(doc, viewer, {
                account,
                csrfToken: auth.session.csrfToken(account.iri),
                correctable: CORRECTABLE,
                ...extra
              }, search.measured(pluginIri), '', navigation), HTML)

            try {
              const result = await corrections.submit({
                account,
                subject: pluginIri,
                predicate: form.get('predicate'),
                value: form.get('value'),
                rationale: form.get('rationale'),
                currentValue: doc[CORRECTABLE[form.get('predicate')]?.docField] ?? null
              })
              return render({
                submitted: result.status === 'accepted'
                  ? 'Thank you — applied, and attributed to you.'
                  : 'Thank you — queued for review.'
              })
            } catch (error) {
              if (error instanceof CorrectionError) return render({ error: error.message, status: 400 })
              throw error
            }
          }

          // /plugin/<slug>-<hash> resolves the catalogue IRI it denotes.
          // An uploaded image, served from this origin so that nobody's
          // browser has to fetch a picture from a third party to read a plugin
          // page.
          //
          // The type is sniffed from the bytes on every read rather than taken
          // from the extension, and `nosniff` stops a browser second-guessing
          // it — between them there is no way for a file on disk to be served
          // as anything but what it actually is. Immutable, because the name
          // is the hash of the content: a different picture is a different URL,
          // so this can never be stale.
          const picture = path.match(/^\/image\/([0-9a-f]{64}\.(?:png|jpg|gif|webp))$/)
          if (picture) {
            if (!images) return send(response, 404, { error: 'Images are not enabled on this instance' })
            let held
            try {
              held = await images.read(picture[1])
            } catch (error) {
              if (error instanceof ImageError) return send(response, 404, { error: error.message })
              if (error.code === 'ENOENT') return send(response, 404, { error: 'No such image' })
              throw error
            }
            response.writeHead(200, {
              'Content-Type': held.type,
              'Content-Length': held.buffer.length,
              'X-Content-Type-Options': 'nosniff',
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*'
            })
            return response.end(held.buffer)
          }

          const match = path.match(/^\/plugin\/([A-Za-z0-9-]+?)(\.ttl|\.jsonld|\.json)?$/)
          if (match) {
            const iri = `${NAMESPACES.pu}plugin/${match[1]}`
            const doc = search.documents.get(iri)
            if (!doc) return send(response, 404, { error: 'No such plugin', iri })

            switch (negotiate(match[2], request.headers.accept)) {
              case 'turtle':
                return sendText(response, 200, pluginTurtle(doc), 'text/turtle; charset=utf-8')
              case 'jsonld':
                return sendText(response, 200, JSON.stringify(pluginJsonLd(doc), null, 2), 'application/ld+json')
              case 'json':
                return send(response, 200, {
                  ...doc,
                  measured: search.measured(iri),
                  licence: LICENCE
                })
              default:
                return sendText(response, 200, renderPluginPage(doc, viewer,
                  corrections
                    ? {
                        account: viewer.account,
                        csrfToken: viewer.account ? auth.session.csrfToken(viewer.account.iri) : null,
                        correctable: CORRECTABLE,
                        // The only place the upload form appears. Without this
                        // the route at /plugin/<slug>/image worked and nothing
                        // on the site reached it — a route with no link, which
                        // is the failure in CLAUDE.md's table and which this
                        // shipped as.
                        mayUploadImage: Boolean(images) && (
                          viewer.account?.trustLevel === TRUST.TRUSTED ||
                          viewer.account?.trustLevel === TRUST.MODERATOR)
                      }
                    : null,
                  search.measured(iri),
                  wikiService
                    ? renderWikiBlock(await wikiService.current(iri), match[1])
                    : '',
                  { facetValues: await search.facets(), corpus: search.documents.size }), HTML)
            }
          }
          return send(response, 404, { error: 'No such endpoint', path })
        }
      }
    } catch (error) {
      logger.error('[api]', error)
      return send(response, 500, { error: error.message })
    }
  })
}

export default createServer
