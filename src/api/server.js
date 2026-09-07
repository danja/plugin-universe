import http from 'http'
import fs from 'fs'
// Imported as a bare function: the request handler binds `path` to the request
// path, which would shadow a `path` module import inside it.
import { join as pathJoin, isAbsolute } from 'path'
import logger from 'loglevel'
import { RETRIEVAL_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import {
  renderSearchPage, renderPluginPage, pluginJsonLd, pluginTurtle,
  renderCategoryPage, categoryTurtle, renderDocPage
} from './render.js'
import loadPage, { PAGES } from './pages.js'

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

export function createServer ({ search, config, projectRoot = process.cwd() }) {
  if (!search) throw new Error('The API server needs a SearchService')

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
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return send(response, 405, { error: 'This API is read-only' })
    }

    try {
      const path = url.pathname.replace(/\/$/, '') || '/'
      const params = url.searchParams

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
          const hasCriteria = Boolean(q) || Object.values(facets).some(Boolean)
          const outcome = hasCriteria
            ? (q ? await search.search(q, { facets, limit: 25 }) : await search.browse({ facets, limit: 25 }))
            : { results: [], total: 0 }
          const html = renderSearchPage({
            query: q,
            facets,
            results: outcome.results,
            total: outcome.total,
            corpus: search.documents.size,
            elapsedMs: hasCriteria ? Date.now() - started : undefined,
            facetValues: await search.facets()
          })
          return sendText(response, 200, html, 'text/html; charset=utf-8')
        }

        case '/health': {
          return send(response, 200, {
            status: 'ok',
            plugins: search.documents.size,
            index: search.index.size,
            embeddingModel: config?.get('embedding.model') ?? null,
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
          const outcome = await search.browse({ limit: Math.min(Number(params.get('limit')) || 50, RETRIEVAL_CONFIG.maxPageSize) })
          return send(response, 200, { total: outcome.total, results: outcome.results, licence: LICENCE })
        }

        // The prose pages. /about/crawler in particular is the address this
        // project's own crawler user agent points at, so it is a promise made
        // to every source that has ever seen a request from it.
        case '/about':
        case '/terms':
        case '/about/crawler': {
          const page = await loadPage(path, projectRoot)
          return sendText(response, 200, renderDocPage(page), 'text/html; charset=utf-8')
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
              renderCategoryPage(slug, outcome.results, outcome.total), 'text/html; charset=utf-8')
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
                return sendText(response, 200, renderPluginPage(doc), 'text/html; charset=utf-8')
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
