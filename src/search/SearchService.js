import { RETRIEVAL_CONFIG } from '../../config/preferences.js'
import { iri, literal } from '../store/SPARQLHelper.js'
import QueryService from '../store/QueryService.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import LexicalIndex, { tokenise } from './LexicalIndex.js'

export { tokenise }

/**
 * Hybrid retrieval: lexical, vector and facet filter.
 *
 * The shape follows semem's DualSearch — several signals fused under tunable
 * weights — without its implementation, which is entangled with graph
 * algorithms this project does not need.
 *
 * Two rules from docs/architecture.md §5 hold here:
 *
 *  - Candidate generation goes through the vector index. Nothing pulls rows out
 *    of SPARQL to compute similarity in JavaScript.
 *  - The facet filter is a filter, not a score. A user asking for LV2 plugins
 *    does not want a VST3 ranked highly because its words matched better.
 *
 * The lexical signal exists because vector similarity alone measured recall@1
 * of 80% on the fixture corpus, and every failure was a query whose vocabulary
 * did not overlap the description.
 */

export class SearchError extends Error {
  constructor (message) {
    super(message)
    this.name = 'SearchError'
  }
}

/**
 * Combine the two scoring signals into one.
 *
 * Kept as a free function so the retrieval regression suite can measure the
 * fusion policy directly, on the same code the service runs, without standing
 * up a store.
 */
export function fuse (lexical, vector) {
  return lexical * RETRIEVAL_CONFIG.lexicalWeight + vector * RETRIEVAL_CONFIG.vectorWeight
}

export class SearchService {
  /**
   * @param {object} deps
   * @param {SPARQLClient} deps.client
   * @param {VectorIndex} deps.index
   * @param {EmbeddingService} deps.embeddings
   */
  constructor ({ client, index, embeddings, queries = new QueryService() }) {
    for (const [key, value] of Object.entries({ client, index, embeddings })) {
      if (!value) throw new SearchError(`SearchService needs ${key}`)
    }
    this.client = client
    this.index = index
    this.embeddings = embeddings
    this.queries = queries
    /** @type {Map<string, object>} plugin IRI to its text view row */
    this.documents = new Map()
    this.lexical = new LexicalIndex()
  }

  /**
   * Load the text views the lexical signal matches against, and that the UI
   * renders. Called once at start; the vector index is loaded separately from
   * disk and neither is rebuilt per query.
   */
  async loadDocuments () {
    const rows = await this.client.select(this.queries.get('plugin/text-view', {}))
    this.documents = new Map(rows.map(row => [row.plugin, {
      iri: row.plugin,
      name: row.name,
      vendor: row.vendor ?? null,
      description: row.description ?? null,
      roles: row.roles ? row.roles.split(', ').filter(Boolean) : [],
      categories: row.categories ? row.categories.split(', ').filter(Boolean) : [],
      formats: row.formats ? row.formats.split(', ').filter(Boolean) : [],
      parameters: row.parameters ? row.parameters.split(', ').filter(Boolean) : [],
      cautions: row.cautions || null
    }]))
    // Document frequencies are corpus-wide, so they are computed once here
    // rather than per query.
    this.lexical.build(this.documents.values())
    return this.documents.size
  }

  /**
   * Lexical score in 0..1, IDF-weighted against the loaded corpus.
   * Delegates to LexicalIndex so the scoring policy lives in one place.
   */
  lexicalScore (queryTokens, doc) {
    return this.lexical.score(queryTokens, doc)
  }

  /**
   * Build the SPARQL conditions for a facet filter.
   * @returns {string|null} null when no facets were requested
   */
  #filterConditions ({ format, role, category, vendor }) {
    const conditions = []
    if (format) conditions.push(`?plugin ${iri(NAMESPACES.trn + 'format')} ${iri(NAMESPACES.trn + format)} .`)
    if (role) conditions.push(`?plugin ${iri(NAMESPACES.trn + 'role')} ${iri(NAMESPACES.trn + role)} .`)
    if (category) conditions.push(`?plugin ${iri(NAMESPACES.pu + 'category')} ${iri(`${NAMESPACES.pu}category/${category}`)} .`)
    if (vendor) conditions.push(`?plugin ${iri(NAMESPACES.trn + 'vendor')} ${literal(vendor)} .`)
    return conditions.length ? conditions.join('\n    ') : null
  }

  /** The set of plugin IRIs passing a facet filter, or null for no filter. */
  async #filterSet (facets) {
    const conditions = this.#filterConditions(facets)
    if (!conditions) return null
    const rows = await this.client.select(this.queries.get('plugin/filter', { conditions }))
    return new Set(rows.map(row => row.plugin))
  }

  /**
   * @param {string} queryText
   * @param {object} [options]
   * @param {object} [options.facets] - format, role, category, vendor
   * @param {number} [options.limit]
   * @returns {Promise<{results: object[], total: number, signals: object}>}
   */
  async search (queryText, { facets = {}, limit = RETRIEVAL_CONFIG.defaultPageSize } = {}) {
    if (typeof queryText !== 'string') {
      throw new SearchError('Search needs query text; use facets alone via browse()')
    }
    const pageSize = Math.min(limit, RETRIEVAL_CONFIG.maxPageSize)
    const allowed = await this.#filterSet(facets)
    const queryTokens = tokenise(queryText)

    // Vector candidates. The index is the hot path.
    const vectorScores = new Map()
    if (queryText.trim() !== '' && this.index.size > 0) {
      const vector = await this.embeddings.embed(queryText)
      const hits = this.index.search(vector, RETRIEVAL_CONFIG.candidateLimit, {
        minScore: RETRIEVAL_CONFIG.minSimilarity
      })
      for (const hit of hits) vectorScores.set(hit.iri, hit.score)
    }

    // Lexical runs over every document: the corpus is small enough that this is
    // cheaper than maintaining an inverted index, and it catches the plugins
    // vector similarity misses entirely.
    const fused = []
    for (const [pluginIri, doc] of this.documents) {
      if (allowed && !allowed.has(pluginIri)) continue

      const lexical = this.lexicalScore(queryTokens, doc)
      const vector = vectorScores.get(pluginIri) ?? 0
      if (lexical === 0 && vector === 0) continue

      fused.push({ ...doc, score: fuse(lexical, vector), signals: { lexical, vector } })
    }

    fused.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    return {
      results: fused.slice(0, pageSize),
      total: fused.length,
      signals: {
        vectorCandidates: vectorScores.size,
        filtered: allowed ? allowed.size : null,
        corpus: this.documents.size
      }
    }
  }

  /** Facets alone, no query text. */
  async browse ({ facets = {}, limit = RETRIEVAL_CONFIG.defaultPageSize } = {}) {
    const allowed = await this.#filterSet(facets)
    const results = [...this.documents.values()]
      .filter(doc => !allowed || allowed.has(doc.iri))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { results: results.slice(0, limit), total: results.length }
  }

  /** Facet values and their counts, driven by the data. */
  async facets () {
    const rows = await this.client.select(this.queries.get('plugin/facets', {}))
    const grouped = {}
    for (const row of rows) {
      grouped[row.facet] ??= []
      grouped[row.facet].push({ value: row.value, count: Number(row.count) })
    }
    return grouped
  }

  async count () {
    const [row] = await this.client.select(this.queries.get('plugin/count', {}))
    return Number(row?.count ?? 0)
  }
}

export default SearchService
