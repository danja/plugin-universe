import http from 'http'
import fs from 'fs'
// Imported as a bare function: the request handler binds `path` to the request
// path, which would shadow a `path` module import inside it.
import { join as pathJoin, isAbsolute } from 'path'
import logger from 'loglevel'
import { RETRIEVAL_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import {
  renderSearchPage, renderPluginPage, renderCategoryPage, renderDocPage, renderModerationPage
} from './render.js'
import { pluginJsonLd, pluginTurtle, categoryTurtle } from './serialise.js'
import loadPage, { PAGES } from './pages.js'
import { readForm, BodyError } from './body.js'
import { CORRECTABLE, CorrectionError } from '../contrib/Corrections.js'
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

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=60'
}

function sendText (response, status, body, contentType) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body)
  })
  response.end(body)
}

/**
 * Decide the representation to return for a plugin IRI.
 *
 * An explicit .ttl or .jsonld suffix wins; otherwise the Accept header decides,
 * defaulting to HTML because the common case is a person following a link.
 */
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

function send (response, status, body) {
  const payload = JSON.stringify(body, null, 2)
  response.writeHead(status, { ...JSON_HEADERS, 'Content-Length': Buffer.byteLength(payload) })
  response.end(payload)
}

/**
 * Licence and attribution, on every response.
 *
 * The dataset is CC0 and attribution is requested rather than required, so
 * saying so in the payload costs nothing and means a consumer never has to go
 * looking for the terms.
 */
const LICENCE = {
  licence: 'CC0-1.0',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attribution: 'Plugin Universe — https://plugin-universe.com (requested, not required)'
}

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
  'plugin-universe': 'vocabs/plugin-universe.ttl',
  'trn-extensions': 'vocabs/trn-extensions.ttl',
  'trn-profile': 'vocabs/trn-profile.ttl',
  alignment: 'vocabs/alignment.ttl',
  shapes: 'vocabs/shapes.ttl'
})

export function createServer ({
  search, config, projectRoot = process.cwd(), auth = null, corrections = null, authProblem = null
}) {
  if (!search) throw new Error('The API server needs a SearchService')

  // Fail at startup, not per request. A page whose source file is missing from
  // the deployment is a packaging error — it happened once, when docs/ was in
  // .dockerignore — and the symptom was a 500 on three routes while everything
  // else looked healthy. A container that will not start is far easier to
  // notice than one that is quietly broken in one corner.
  const missing = Object.entries(PAGES)
    .filter(([, page]) => !fs.existsSync(pathJoin(projectRoot, page.file)))
    .map(([route, page]) => `${route} → ${page.file}`)
  if (missing.length > 0) {
    throw new Error(
      `Prose pages are missing their source files:\n  ${missing.join('\n  ')}\n` +
      'Check that docs/ reached the deployment — .dockerignore has excluded it before.'
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
      (/^\/plugin\/[^/]+\/correct$/.test(url.pathname) || url.pathname === '/moderation')
    if (request.method !== 'GET' && request.method !== 'HEAD' && !isAuthPost && !isCorrectionPost) {
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

      switch (path) {
        case '/': {
          // The search page. Same service, same signals as the JSON endpoint.
          const q = params.get('q')
          const facets = {
            format: params.get('format') || null,
            category: params.get('category') || null,
            role: params.get('role') || null,
            vendor: params.get('vendor') || null,
            source: params.get('source') || null,
            pricing: params.get('pricing') || null,
            licence: params.get('licence') || null
          }
          // One rule: a query is ranked and capped, because relevance past the
          // first screen is noise; anything else is a browse — most recently
          // added first, a page at a time, facets or no facets. An unsearched
          // front page that lists nothing tells a first-time visitor nothing
          // about what is in here, and a facet chosen from the dropdown is a
          // browse whether or not it is also a filter.
          const browsing = q
            ? null
            : { limit: RETRIEVAL_CONFIG.browsePageSize, offset: pageOffset(params) }
          const outcome = q
            ? await search.search(q, { facets, limit: 25 })
            : await search.browse({ ...browsing, facets, order: 'recent' })
          const html = renderSearchPage({
            query: q,
            facets,
            results: outcome.results,
            total: outcome.total,
            corpus: search.documents.size,
            elapsedMs: (q || Object.values(facets).some(Boolean)) ? Date.now() - started : undefined,
            facetValues: await search.facets(),
            // The offset the service actually used, which is not necessarily
            // the one that was asked for.
            browsing: browsing ? { ...browsing, offset: outcome.offset } : null,
            viewer
          })
          return sendText(response, 200, html, 'text/html; charset=utf-8')
        }

        case '/health': {
          return send(response, 200, {
            status: 'ok',
            plugins: search.documents.size,
            index: search.index.size,
            embeddingModel: config?.get('embedding.model') ?? null,
            // So a half-configured sign-in is visible to monitoring rather than
            // only to whoever reads the container log at startup.
            signIn: auth ? 'enabled' : (authProblem ? 'misconfigured' : 'disabled'),
            ...(authProblem ? { signInProblem: authProblem } : {}),
            licence: LICENCE
          })
        }

        case '/search': {
          const q = params.get('q')
          const facets = {
            format: params.get('format'),
            role: params.get('role'),
            category: params.get('category'),
            vendor: params.get('vendor'),
            source: params.get('source'),
            pricing: params.get('pricing'),
            licence: params.get('licence')
          }
          const limit = Math.min(
            Number(params.get('limit')) || RETRIEVAL_CONFIG.defaultPageSize,
            RETRIEVAL_CONFIG.maxPageSize
          )
          if (!q && !Object.values(facets).some(Boolean)) {
            return send(response, 400, { error: 'Provide q, or at least one of format, role, category, vendor, source, pricing, licence' })
          }
          const outcome = q
            ? await search.search(q, { facets, limit })
            : await search.browse({ facets, limit })
          return send(response, 200, {
            query: q ?? null,
            facets: Object.fromEntries(Object.entries(facets).filter(([, v]) => v)),
            total: outcome.total,
            count: outcome.results.length,
            elapsedMs: Date.now() - started,
            results: outcome.results,
            signals: outcome.signals ?? null,
            licence: LICENCE
          })
        }

        case '/facets': {
          return send(response, 200, { facets: await search.facets(), licence: LICENCE })
        }

        case '/plugins': {
          const outcome = await search.browse({
            limit: Math.min(Number(params.get('limit')) || 50, RETRIEVAL_CONFIG.maxPageSize),
            offset: pageOffset(params),
            order: params.get('order') === 'recent' ? 'recent' : 'name'
          })
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
        case '/about':
        case '/terms':
        case '/about/crawler': {
          const page = await loadPage(path, projectRoot)
          return sendText(response, 200, renderDocPage(page, viewer), 'text/html; charset=utf-8')
        }

        case '/moderation': {
          if (!auth || !corrections) return send(response, 404, { error: 'Moderation is not enabled' })
          const moderator = viewer.account
          // Not 403 for a signed-out visitor: the existence of the queue is not
          // a secret, but nor is it worth telling a stranger they lack a role.
          if (!moderator || moderator.trustLevel !== TRUST.MODERATOR) {
            return send(response, 404, { error: 'No such endpoint', path })
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
            try {
              const outcome = await corrections.review({
                correctionIri: form.get('correction'),
                moderator,
                accept: form.get('decision') === 'accept',
                accounts: auth.accounts
              })
              message = outcome.status === 'accepted'
                ? `Accepted.${outcome.promoted ? ` ${outcome.contributor} is now trusted — their corrections go live from here.` : ''}`
                : 'Rejected. Nothing was written to a public graph.'
            } catch (error) {
              if (!(error instanceof CorrectionError)) throw error
              message = error.message
            }
          }

          return sendText(response, 200, renderModerationPage(await corrections.pending(), {
            csrfToken: auth.session.csrfToken(moderator.iri),
            message,
            viewer
          }), 'text/html; charset=utf-8')
        }

        case '/ns': {
          return send(response, 200, {
            vocabularies: Object.keys(VOCABULARIES).map(name => ({
              name, url: `/ns/${name}.ttl`
            })),
            licence: LICENCE
          })
        }

        default: {
          // /ns/<name>.ttl — the vocabulary documents. These are what the pu:
          // IRIs in every published description resolve to.
          const vocab = path.match(/^\/ns\/([a-z0-9-]+)\.ttl$/)
          if (vocab) {
            const file = VOCABULARIES[vocab[1]]
            if (!file) return send(response, 404, { error: 'No such vocabulary', name: vocab[1] })
            const body = await fs.promises.readFile(isAbsolute(file) ? file : pathJoin(projectRoot, file), 'utf8')
            return sendText(response, 200, body, 'text/turtle; charset=utf-8')
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
            if (negotiate(category[2], request.headers.accept) === 'turtle') {
              return sendText(response, 200, categoryTurtle(slug, outcome.results), 'text/turtle; charset=utf-8')
            }
            if (category[2] === '.json') {
              return send(response, 200, {
                category: slug,
                iri: `${NAMESPACES.pu}category/${slug}`,
                total: outcome.total,
                results: outcome.results,
                licence: LICENCE
              })
            }
            return sendText(response, 200,
              renderCategoryPage(slug, outcome.results, outcome.total, viewer), 'text/html; charset=utf-8')
          }

          // Suggesting a correction. The only route that writes catalogue data
          // on behalf of a person, so every guard is here: signed in, not
          // suspended, a CSRF token bound to that account, and a predicate from
          // the whitelist. The value itself is checked by the validator.
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

            const render = extra => sendText(response, extra.status ?? 200,
              renderPluginPage(doc, viewer, {
                account,
                csrfToken: auth.session.csrfToken(account.iri),
                correctable: CORRECTABLE,
                ...extra
              }), 'text/html; charset=utf-8')

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
                return send(response, 200, { ...doc, licence: LICENCE })
              default:
                return sendText(response, 200, renderPluginPage(doc, viewer,
                  corrections
                    ? {
                        account: viewer.account,
                        csrfToken: viewer.account ? auth.session.csrfToken(viewer.account.iri) : null,
                        correctable: CORRECTABLE
                      }
                    : null), 'text/html; charset=utf-8')
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
