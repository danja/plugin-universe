import { RETRIEVAL_CONFIG } from '../../config/preferences.js'
import { iri, literal } from '../store/SPARQLHelper.js'
import QueryService from '../store/QueryService.js'
import GraphRegistry from '../store/GraphRegistry.js'
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

/** Alphabetical, the default order for a browse. */
export function byName (a, b) {
  return a.name.localeCompare(b.name)
}

/**
 * Most recently added first, ties broken by name.
 *
 * A plugin with no `dcterms:created` sorts **last**. An absent date means the
 * plugin was harvested before the catalogue recorded dates, which is the
 * opposite of new; treating it as `now` — or as the epoch and reversing —
 * would put the entire pre-existing corpus at the top of a list titled
 * "recently added". Dates are xsd:dateTime strings, which sort correctly as
 * strings, so no parsing is needed to compare two of them.
 */
export function byRecency (a, b) {
  if (a.created && b.created) return b.created.localeCompare(a.created) || byName(a, b)
  if (a.created) return -1
  if (b.created) return 1
  return byName(a, b)
}

export class SearchService {
  /**
   * @param {object} deps
   * @param {SPARQLClient} deps.client
   * @param {VectorIndex} deps.index
   * @param {EmbeddingService} deps.embeddings
   */
  constructor ({ client, index, embeddings, queries = new QueryService(), registry = null }) {
    for (const [key, value] of Object.entries({ client, index, embeddings })) {
      if (!value) throw new SearchError(`SearchService needs ${key}`)
    }
    this.client = client
    this.index = index
    this.embeddings = embeddings
    this.queries = queries
    this.registry = registry ?? new GraphRegistry(client)
    /** @type {Map<string, object>} plugin IRI to its text view row */
    this.documents = new Map()
    /** @type {Map<string, object>} graph IRI to its provenance and licence */
    this.sources = new Map()
    /** @type {Map<string, object>} category slug to its concept */
    this.categories = new Map()
    /** @type {Map<string, object>} plugin IRI to its most recent profiler run */
    this.measurements = new Map()
    this.lexical = new LexicalIndex()
  }

  /**
   * Load the text views the lexical signal matches against, and that the UI
   * renders. Called once at start; the vector index is loaded separately from
   * disk and neither is rebuilt per query.
   */
  async loadDocuments () {
    // Graph provenance, keyed by graph IRI, so a plugin page can say where its
    // facts came from and under what terms. Loaded once alongside the documents
    // rather than joined per query: five graphs, 645 plugins.
    this.sources = new Map()
    for (const row of await this.registry.list()) {
      this.sources.set(row.graph, {
        graph: row.graph,
        source: row.identifier ?? row.graph,
        licence: row.licence ?? null,
        derivedFrom: row.derivedFrom ?? null
      })
    }

    // The category scheme, 28 concepts, loaded once: a category page and a
    // category document both want the same few facts about one concept, and
    // joining for them per request would be a query to answer a lookup.
    this.categories = new Map()
    const prefix = `${NAMESPACES.pu}category/`
    const list = value => (value ? value.split('|').filter(Boolean) : [])
    for (const row of await this.client.select(this.queries.get('plugin/concept-scheme', {}))) {
      if (!row.concept.startsWith(prefix)) continue
      this.categories.set(row.concept.slice(prefix.length), {
        slug: row.concept.slice(prefix.length),
        iri: row.concept,
        prefLabel: row.prefLabel,
        definition: row.definition ?? null,
        scopeNote: row.scopeNote ?? null,
        broader: row.broader ? row.broader.slice(prefix.length) : null,
        altLabels: list(row.altLabels).sort(),
        narrower: list(row.narrowerConcepts).map(c => c.slice(prefix.length)).sort(),
        related: list(row.relatedConcepts).map(c => c.slice(prefix.length)).sort(),
        closeMatches: list(row.closeMatches).sort()
      })
    }

    // What the profiler measured. Loaded here rather than joined per request
    // for the same reason as the sources and the scheme, and because the
    // profiler had been writing these since Phase 2 with nothing reading them.
    //
    // Rows arrive oldest first, so a later run replaces an earlier one whole
    // rather than merging with it: two runs on different days are two accounts
    // of the plugin, and mixing their readings would produce a description of
    // neither.
    this.measurements = new Map()
    for (const row of await this.client.select(this.queries.get('plugin/measurements', {}))) {
      let entry = this.measurements.get(row.subject)
      if (!entry || entry.run !== row.run) {
        entry = {
          run: row.run,
          at: row.at,
          tool: row.tool,
          platform: row.platform,
          verdict: null,
          readings: []
        }
        this.measurements.set(row.subject, entry)
      }
      const metric = row.metric.replace(/^.*[/#]/, '')
      entry.readings.push({
        metric,
        iri: row.metric,
        // A metric with no label in the vocabulary is shown by its local name.
        // The reading is the fact; a missing label is a gap in vocabs/, and
        // hiding the measurement would be the wrong way to report it.
        label: row.metricLabel ?? metric,
        about: row.metricComment ?? null,
        value: row.value,
        unit: row.metricUnit ?? null,
        note: row.comment ?? null
      })
      if (metric === 'ValidationResult') entry.verdict = row.value
    }

    const rows = await this.client.select(this.queries.get('plugin/text-view', {}))
    this.documents = new Map(rows.map(row => [row.plugin, {
      iri: row.plugin,
      name: row.name,
      homepage: row.homepage ?? null,
      seeAlso: row.seeAlso ?? null,
      image: row.image ?? null,
      created: row.created ?? null,
      licenceId: row.licenceId ?? null,
      sourceAvailability: row.sourceAvailability ? row.sourceAvailability.replace(/^.*\//, '') : null,
      pricing: row.pricing ? row.pricing.replace(/^.*\//, '') : null,
      provenance: this.sources.get(row.g) ?? null,
      vendor: row.vendor ?? null,
      description: row.description ?? null,
      roles: row.roles ? row.roles.split(', ').filter(Boolean) : [],
      categories: row.categories ? row.categories.split(', ').filter(Boolean) : [],
      // Synonyms for the plugin's categories. Searched, not displayed: they
      // exist so that a person typing "echo" finds a delay.
      categoryAltLabels: row.categoryAltLabels ? row.categoryAltLabels.split(', ').filter(Boolean) : [],
      formats: row.formats ? row.formats.split(', ').filter(Boolean) : [],
      tags: row.tags ? row.tags.split(', ').filter(Boolean) : [],
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
  #filterConditions ({ format, role, category, vendor, source, pricing, licence, measured }) {
    const conditions = []
    // Properties of the plugin, in the graph the plugin came from. `?g` is
    // bound by the query, so reusing it here is what keeps a facet from
    // matching across two sources by accident.
    const own = pattern => conditions.push(`GRAPH ?g { ${pattern} }`)
    if (format) own(`?plugin ${iri(NAMESPACES.trn + 'format')} ${iri(NAMESPACES.trn + format)}`)
    if (role) own(`?plugin ${iri(NAMESPACES.trn + 'role')} ${iri(NAMESPACES.trn + role)}`)
    if (category) own(`?plugin ${iri(NAMESPACES.pu + 'category')} ${iri(`${NAMESPACES.pu}category/${category}`)}`)
    if (vendor) own(`?plugin ${iri(NAMESPACES.trn + 'vendor')} ${literal(vendor)}`)
    // The availability facets. Values are local names of pu: individuals —
    // OpenSource, Free — so a URL reads as a question rather than an IRI.
    if (source) own(`?plugin ${iri(NAMESPACES.pu + 'sourceAvailability')} ${iri(NAMESPACES.pu + source)}`)
    if (pricing) own(`?plugin ${iri(NAMESPACES.pu + 'pricing')} ${iri(NAMESPACES.pu + pricing)}`)
    if (licence) own(`?plugin ${iri(NAMESPACES.pu + 'licenceId')} ${literal(licence)}`)
    // A verdict from the profiler, which lives in its own run graph and not in
    // the plugin's. A plugin measured twice matches if any run says so; which
    // reading is shown on the page is a separate question, and that one is the
    // newest.
    if (measured) {
      conditions.push(
        `GRAPH ?measurements { ?measurement ${iri(NAMESPACES.pu + 'subject')} ?plugin ; ` +
        `${iri(NAMESPACES.pu + 'metric')} ${iri(NAMESPACES.pu + 'ValidationResult')} ; ` +
        `${iri(NAMESPACES.pu + 'value')} ${literal(measured)} }`)
    }
    return conditions.length ? conditions.join('\n  ') : null
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
  /**
   * Browse without a query: facets, an order, and a page.
   *
   * `order` is `name` or `recent`. Recent is by `dcterms:created`, which the
   * ingest pipeline sets when a plugin is first seen and preserves across a
   * re-harvest. A plugin with no date sorts last rather than first — an absent
   * date means "harvested before this catalogue recorded dates", which is the
   * opposite of new, and treating a missing value as `now` would put the whole
   * pre-existing corpus at the top of a list titled "recently added".
   *
   * Paged with an offset rather than a cursor: the corpus is a few hundred
   * plugins held in memory and sorted per request, so the cost is the sort and
   * a cursor would buy nothing.
   */
  async browse ({
    facets = {}, limit = RETRIEVAL_CONFIG.defaultPageSize, offset = 0, order = 'name',
    // Only plugins that have a picture. For the landing page, where a grid of
    // grey rectangles is a worse first impression than a shorter list: about
    // three quarters of the catalogue has an image, so this narrows the pool
    // rather than emptying it. Not a facet — nobody would choose to filter a
    // search by whether a screenshot happens to exist.
    hasImage = false
  } = {}) {
    const allowed = await this.#filterSet(facets)
    const compare = order === 'recent' ? byRecency : byName
    const results = [...this.documents.values()]
      .filter(doc => !allowed || allowed.has(doc.iri))
      .filter(doc => !hasImage || Boolean(doc.image))
      .sort(compare)
    // Clamped to the last page rather than left to run off the end: `?from=`
    // is a number in a URL and `from=1e99` should show the oldest plugins, not
    // an empty page reporting "page 10001 of 65".
    const lastPage = Math.max(0, Math.floor(Math.max(0, results.length - 1) / limit) * limit)
    const from = Math.min(Math.max(0, offset), lastPage)
    return {
      results: results.slice(from, from + limit),
      total: results.length,
      offset: from,
      order
    }
  }

  /** The most recent profiler run for one plugin, or null. */
  measured (pluginIri) {
    return this.measurements.get(pluginIri) ?? null
  }

  /** One category concept, or null. */
  concept (slug) {
    return this.categories.get(slug) ?? null
  }

  /** Facet values and their counts, driven by the data. */
  async facets () {
    const rows = await this.client.select(this.queries.get('plugin/facets', {}))
    const grouped = {}
    for (const row of rows) {
      grouped[row.facet] ??= []
      grouped[row.facet].push({ value: row.value, count: Number(row.count) })
    }

    // The measured facet is counted from what was loaded rather than from a
    // seventh UNION in the facet query: the readings are in memory already,
    // and they are the only facet whose values live outside the plugin's own
    // graph. It appears only when something has actually been measured, so it
    // does not advertise an empty filter.
    const verdicts = new Map()
    for (const entry of this.measurements.values()) {
      if (entry.verdict) verdicts.set(entry.verdict, (verdicts.get(entry.verdict) ?? 0) + 1)
    }
    if (verdicts.size > 0) {
      grouped.measured = [...verdicts]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    }
    return grouped
  }

  async count () {
    const [row] = await this.client.select(this.queries.get('plugin/count', {}))
    return Number(row?.count ?? 0)
  }
}

export default SearchService
