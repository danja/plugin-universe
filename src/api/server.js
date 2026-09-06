import http from 'http'
import logger from 'loglevel'
import { RETRIEVAL_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { renderSearchPage, renderPluginPage, pluginJsonLd, pluginTurtle } from './render.js'

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

export function createServer ({ search, config }) {
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
    if (request.method !== 'GET') {
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
            vendor: params.get('vendor') || null
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
            vendor: params.get('vendor')
          }
          const limit = Math.min(
            Number(params.get('limit')) || RETRIEVAL_CONFIG.defaultPageSize,
            RETRIEVAL_CONFIG.maxPageSize
          )
          if (!q && !Object.values(facets).some(Boolean)) {
            return send(response, 400, { error: 'Provide q, or at least one of format, role, category, vendor' })
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

        default: {
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
