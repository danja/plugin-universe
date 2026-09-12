import { RETRIEVAL_CONFIG, PROMOTION_CONFIG } from '../../config/preferences.js'
import { iri, literal } from '../store/SPARQLHelper.js'
import QueryService from '../store/QueryService.js'
import GraphRegistry from '../store/GraphRegistry.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import LexicalIndex, { tokenise } from './LexicalIndex.js'
import { composeText } from '../embeddings/EmbeddingService.js'
import logger from 'loglevel'

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

/**
 * Paid placement, applied to an already-ranked list.
 *
 * A re-rank after retrieval, never a filter and never an insertion —
 * `docs/architecture.md` §7: *a promoted result may be boosted but never
 * inserted where it does not match the query*. Everything here exists to keep
 * that sentence true, and each guard is separately load-bearing:
 *
 *  1. **It only boosts what retrieval already returned.** The list in is the
 *     list out, reordered. Nothing is added, so nothing can appear in a search
 *     it did not match.
 *  2. **A multiplier, not an addition.** Anything times 1.25 is still nothing,
 *     so the boost cannot manufacture relevance out of a zero score.
 *  3. **A floor.** Scoring above zero is a low bar — one weak token in a
 *     description clears it. `floor` is the "moderate match" bar the boost
 *     needs to be worth applying at all, and below it a promoted plugin ranks
 *     exactly as it would unpromoted.
 *  4. **A rank cap**, `maxPromotedRank`, which is currently 1 — a placement may
 *     reach first place. It is the weakest of the four and always was: what
 *     keeps a search trustworthy is that a paid result cannot appear where it
 *     does not belong, not which position it takes among results that do.
 *  5. **A count cap.** At most `maxPromotedPerPage` placements in one page.
 *
 * Reaching first place is *permitted*, not bought outright: the boost is a
 * multiplier, so a substantially better match still wins. A placement scoring
 * 0.6 against a 1.4 match goes to 0.75 and stays second.
 *
 * Every result the boost touched is flagged `promoted`, which is what the label
 * on the page and the field in the JSON are rendered from. A boost that were
 * ever applied without that flag would be an undisclosed ad.
 *
 * @param {object[]} ranked - results sorted best-first, each with `score`
 * @param {Map<string, object>} promoted - live placements by plugin IRI
 * @returns {object[]} the same results, reordered, some flagged
 */
export function applyPromotion (ranked, promoted, config = PROMOTION_CONFIG) {
  if (!promoted || promoted.size === 0) return ranked

  let placed = 0
  const boosted = ranked.map((result, earnedRank) => {
    const placement = promoted.get(result.iri)
    // `earnedRank` is where retrieval put it, before any money. Kept on every
    // result because guard 4 needs to tell a place that was bought from a place
    // that was won.
    if (!placement) return { ...result, earnedRank }
    // Guard 3: below the floor a placement buys nothing at all.
    if (result.score < config.floor) return { ...result, earnedRank }
    // Guard 5.
    if (placed >= config.maxPromotedPerPage) return { ...result, earnedRank }
    placed += 1
    return {
      ...result,
      earnedRank,
      score: result.score * config.boostFactor,
      promoted: true,
      promotedUntil: placement.endsAt ?? null,
      signals: { ...result.signals, unpromotedScore: result.score }
    }
  })

  boosted.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

  // Guard 4, applied last because it is about position rather than score.
  //
  // At the current setting of 1 this loop does not run: no position is reserved
  // and a placement may reach first. The code stays because the cap is a
  // published number that may be raised, and because the rule it encodes is the
  // subtle one — the reserved places are protected from being *bought*, not
  // barred to promoted plugins. A plugin that was already the best answer keeps
  // first place whatever the cap: demoting it for having paid would make
  // promotion harmful to the thing being promoted, which is a strange thing to
  // have sold. So a result is moved down only out of a place better than the
  // one it earned, and whoever earned it comes up.
  const cap = Math.max(1, config.maxPromotedRank)
  for (let i = 0; i < Math.min(cap - 1, boosted.length); i++) {
    const here = boosted[i]
    if (!here.promoted || here.earnedRank <= i) continue
    const swapWith = boosted.findIndex((result, j) => j > i && !result.promoted)
    if (swapWith === -1) break
    const [displaced] = boosted.splice(swapWith, 1)
    boosted.splice(i, 0, displaced)
  }
  return boosted
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

/**
 * Which depiction to show, of however many a plugin has.
 *
 * A plugin can carry a harvested image and an uploaded one. The uploaded one
 * wins: somebody went to the trouble because the harvested one was missing,
 * wrong or gone, and it is served from this origin — so it cannot 404 on a
 * third party's reorganisation, and a reader's browser fetches nothing from
 * anywhere else to see it.
 */
export function pickImage (images, origin = '') {
  if (!images) return null
  const candidates = String(images).split(' ').filter(Boolean)
  if (candidates.length === 0) return null
  const local = candidates.find(url => isLocalImage(url, origin))
  return local ?? candidates[0]
}

/**
 * Is this depiction one the catalogue itself stores?
 *
 * Decided here, where the origin is known, and carried on the document — the
 * renderer has no origin and would have to be given one to work it out again.
 * It changes what a reader is told: an image served from here *is* copied here,
 * and the caption saying it was not is then simply false.
 */
export function isLocalImage (url, origin = '') {
  return Boolean(origin) && typeof url === 'string' && url.startsWith(`${origin}/image/`)
}

/**
 * A vendor's name as it appears in a URL: lower case, hyphen-separated.
 *
 * Readable, because a person reads it — `/vendor/chowdhury-dsp` says who it is
 * and `/vendor/chowdhurydsp` makes them guess.
 */
export function vendorSlug (name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The key two spellings of one vendor have in common.
 *
 * Stricter than the slug: punctuation and spacing are dropped rather than
 * turned into hyphens, so "SFZ Tools" and "SFZTools" land on `sfztools` and are
 * recognised as one vendor. Slugging alone keeps them apart, which is why there
 * are two functions — the URL wants the separators and the grouping does not.
 *
 * Of 365 vendor strings in the catalogue this merges exactly two pairs, both of
 * them genuine: "SFZ Tools"/"SFZTools" and "olegkapitonov"/"Oleg Kapitonov".
 *
 * **It is a grouping, not an identity**, and the difference is the whole of why
 * a paid vendor profile is not simply this with an edit button. "danja" and
 * "Danny Ayers" are one person and 86 plugins, and nothing derivable from the
 * strings will ever say so; a vendor who renames gets a new key and loses
 * whatever was attached to the old one. A profile somebody pays for needs a
 * minted IRI that names point at, rather than a key computed from a name — see
 * the note in TODO.md.
 */
export function vendorKey (name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export class SearchService {
  /**
   * @param {object} deps
   * @param {SPARQLClient} deps.client
   * @param {VectorIndex} deps.index
   * @param {EmbeddingService} deps.embeddings
   */
  constructor ({
    client, index, embeddings, queries = new QueryService(), registry = null,
    // This site's own origin, so a depiction it hosts can be told from one it
    // merely links to. Empty is honest — it means "nothing is local here",
    // which is true of a test and of a process with no site configured.
    origin = '',
    // Where live placements come from. Null means none — an instance with no
    // promotions configured ranks exactly as it did before this existed, which
    // is what every test and every unsold search relies on.
    promotions = null
  }) {
    for (const [key, value] of Object.entries({ client, index, embeddings })) {
      if (!value) throw new SearchError(`SearchService needs ${key}`)
    }
    this.client = client
    this.index = index
    this.embeddings = embeddings
    this.queries = queries
    this.registry = registry ?? new GraphRegistry(client)
    this.origin = String(origin).replace(/\/$/, '')
    this.promotions = promotions
    // Live placements, kept in memory: the ranking path asks "is this promoted"
    // once per candidate, which must not be a query. Refreshed with the
    // documents, and by the admin page the moment a moderator changes one.
    this.promoted = new Map()
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
      // The plugin's own canonical IRI where its author gave it one, which for
      // an LV2 plugin is always. Several is possible and rare; kept as a list
      // rather than picked between, because choosing would be the catalogue
      // deciding which of somebody's identifiers is the real one.
      sameAs: row.sameAs ? row.sameAs.split(' ').filter(Boolean) : [],
      image: pickImage(row.images, this.origin),
      imageIsLocal: isLocalImage(pickImage(row.images, this.origin), this.origin),
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
    // Vendors, grouped by key. Built from the documents that are already in
    // memory rather than asked of the store: it is a fold over 645 strings, and
    // a page listing one vendor's plugins should not be a query.
    const byKey = new Map()
    for (const doc of this.documents.values()) {
      if (!doc.vendor) continue
      const key = vendorKey(doc.vendor)
      if (!key) continue
      if (!byKey.has(key)) byKey.set(key, { key, names: new Map(), plugins: [] })
      const vendor = byKey.get(key)
      vendor.names.set(doc.vendor, (vendor.names.get(doc.vendor) ?? 0) + 1)
      vendor.plugins.push(doc.iri)
    }

    this.vendors = new Map()
    // Every spelling's slug resolves to the same vendor, so a link built from
    // one plugin's spelling and a link built from another's arrive at one page.
    this.vendorAliases = new Map()
    for (const vendor of byKey.values()) {
      // The spelling most of their plugins use. Ties go to the longer one,
      // which is how "SFZ Tools" wins over "SFZTools" and "Oleg Kapitonov" over
      // "olegkapitonov" — the separators are information, and the form with
      // them is the one somebody wrote deliberately.
      const spellings = [...vendor.names.entries()]
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      vendor.name = spellings[0][0]
      vendor.spellings = spellings.map(([name]) => name)
      vendor.count = vendor.plugins.length
      vendor.slug = vendorSlug(vendor.name)
      this.vendors.set(vendor.slug, vendor)
      for (const [name] of spellings) this.vendorAliases.set(vendorSlug(name), vendor.slug)
      this.vendorAliases.set(vendor.key, vendor.slug)
    }

    // Stamped on the document so every link the site builds is the canonical
    // one. Deriving it at render time from the plugin's own spelling would send
    // two plugins of a vendor whose name is spelled two ways to two addresses.
    for (const doc of this.documents.values()) {
      if (!doc.vendor) continue
      doc.vendorSlug = this.vendorAliases.get(vendorSlug(doc.vendor)) ?? null
    }

    // Document frequencies are corpus-wide, so they are computed once here
    // rather than per query.
    this.lexical.build(this.documents.values())
    // After the documents exist, because it stamps them.
    await this.loadPromotions()
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
  /**
   * Re-read which plugins are currently promoted.
   *
   * Called with the documents, and again the moment a moderator promotes or
   * unpromotes — a placement that needs a restart to take effect is one the
   * moderator will believe is running when it is not.
   *
   * Never throws. A store that cannot answer this should degrade to a site with
   * no paid placement, not to a site with no search.
   */
  /**
   * One vendor and their plugins, or null.
   *
   * Plugins come back as documents in name order, which is the order a person
   * scanning somebody's catalogue wants — a vendor page is a shelf, not a
   * ranking, so relevance has nothing to sort by here.
   */
  vendor (slug) {
    const canonical = this.vendorAliases?.get(slug) ?? slug
    const vendor = this.vendors?.get(canonical)
    if (!vendor) return null
    const results = vendor.plugins
      .map(iri => this.documents.get(iri))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
    return { ...vendor, results }
  }

  /** Every vendor, most plugins first. */
  vendorList () {
    return [...(this.vendors?.values() ?? [])]
      .map(({ slug, name, count }) => ({ slug, name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }

  async loadPromotions (now = new Date()) {
    if (!this.promotions) return 0
    try {
      this.promoted = await this.promotions.active(now)
    } catch (error) {
      logger.warn(`[search] could not load promotions, ranking without them: ${error.message}`)
      this.promoted = new Map()
    }
    // Stamped onto the documents as well as kept as a map, so that a plugin
    // page — which reads a document and never sees a ranking — can disclose
    // the placement too. One pass over the corpus, and it clears the flag from
    // anything no longer promoted: a stale "Promoted" label is a worse defect than a
    // missing one, because it is a claim about money that is not true.
    for (const doc of this.documents.values()) {
      const placement = this.promoted.get(doc.iri)
      if (placement) {
        doc.promoted = true
        doc.promotedUntil = placement.endsAt ?? null
      } else if (doc.promoted) {
        delete doc.promoted
        delete doc.promotedUntil
      }
    }
    return this.promoted.size
  }

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

    // Paid placement, after retrieval and after ranking — so it can reorder
    // what the query found and can never add to it. Applied to the page rather
    // than the whole list: the caps are per page, and a placement that ranked
    // 400th was never going to be seen anyway.
    const page = applyPromotion(fused.slice(0, pageSize), this.promoted)

    return {
      results: page,
      total: fused.length,
      signals: {
        vectorCandidates: vectorScores.size,
        filtered: allowed ? allowed.size : null,
        corpus: this.documents.size,
        promoted: page.filter(result => result.promoted).length
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

  /**
   * Take up whatever the store has gained since this process started.
   *
   * A plugin accepted from a submission is written straight into the
   * contributor's graph, and until this runs the running app cannot find it:
   * `documents` is read once at startup, the lexical index is built from it,
   * and the vector index is a file on disk. The plugin would be in the
   * catalogue, dereferenceable at its own IRI, and absent from every search —
   * which is the shape of defect this project has shipped three times, data
   * collected and never shown.
   *
   * Deliberately "whatever is new" rather than "this one". The same call then
   * serves a submission accepted here, a correction that added a plugin, and
   * an ingest run that happened alongside — and it cannot be given the wrong
   * IRI, because it is not given one.
   *
   * **It never throws.** The caller has already accepted the submission and
   * written it; embedding needs Ollama, which may be down, and a plugin that
   * is in the catalogue but not yet in the index is a worse outcome recorded
   * than an acceptance reversed. What is missed here is picked up by
   * `bin/ingest.js --only-new`, which is the nightly backstop.
   */
  async takeUpNewPlugins () {
    const before = this.documents.size
    try {
      // Rebuilds documents, sources and the lexical index together. Document
      // frequencies are corpus-wide, so a new plugin changes them and the
      // index has to be rebuilt rather than appended to.
      await this.loadDocuments()

      const missing = [...this.documents.values()]
        .filter(doc => !this.index.positionByIri.has(doc.iri))
      for (const doc of missing) {
        this.index.add(doc.iri, await this.embeddings.embed(composeText(doc)))
      }
      if (missing.length > 0) await this.index.save()

      return { plugins: this.documents.size, gained: this.documents.size - before, embedded: missing.length }
    } catch (error) {
      logger.warn(
        `[search] could not take up new plugins: ${error.message}. ` +
        'They are in the catalogue and will be found by the next ' +
        'bin/ingest.js --only-new; search will not show them until then.')
      return { plugins: this.documents.size, gained: this.documents.size - before, embedded: 0, error: error.message }
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
