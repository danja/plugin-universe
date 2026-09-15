import { RETRIEVAL_CONFIG } from '../../config/preferences.js'
import { iri } from '../store/SPARQLHelper.js'
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
// The scoring, facet and document-shape policies, split out when this file
// passed 780 lines. Re-exported because they were part of this module's
// surface before the split and are imported from here by the routes, the
// retrieval regression suite and a dozen other tests.
import { FACET_PATTERNS } from './facets.js'
import { fuse, applyPromotion, byName, byRecency } from './ranking.js'
import { pickImage, isLocalImage, vendorSlug, vendorKey } from './documents.js'
import { vendorNames } from '../catalogue/VendorIdentity.js'
export { FACET_PATTERNS, fuse, applyPromotion, byName, byRecency }
export { pickImage, isLocalImage, vendorSlug, vendorKey }

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
    /** @type {Map<string, object>} vendor key to its minted identity */
    this.vendorIdentities = new Map()
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

    // The minted vendor identity, keyed by the same fold the documents group by.
    //
    // Loaded here rather than joined per request for the same reason as the
    // scheme and the measurements — and, like the measurements, because it had
    // been written by a script and read back by almost nothing: `foaf:maker`
    // reached the site through a single OPTIONAL and the names the layer
    // asserts were on no page at all. `skos:altLabel` is where a *person's*
    // judgement that two spellings are one maker will be recorded, so a page
    // that re-derived its spellings from the corpus could never show one.
    this.vendorIdentities = new Map()
    for (const row of await this.client.select(this.queries.get('vendor/identities', {}))) {
      this.vendorIdentities.set(row.key, {
        iri: row.vendor,
        key: row.key,
        name: row.name,
        altLabels: row.altLabels ? row.altLabels.split('|').filter(Boolean).sort() : [],
        // IRIs of vendors merged into this one. Published identifiers that must
        // keep resolving; they become aliases onto this vendor's page below.
        retiredIris: row.retiredIris ? row.retiredIris.split('|').filter(Boolean) : []
      })
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
      // The minted identity behind that string, where the derived layer has
      // one. Null until `bin/mint-vendors.js` has run, so every reader of it
      // has to cope with its absence — the string is what the catalogue has
      // always had and the IRI is what it can now point at.
      vendorIri: row.makers ? row.makers.split(' ').filter(Boolean)[0] ?? null : null,
      description: row.description ?? null,
      roles: row.roles ? row.roles.split(', ').filter(Boolean) : [],
      // The behavioural half of a profile: what goes in, what comes out, and
      // what the host has to provide. These are what make "what should I put
      // before this?" answerable, which is the question a list of names cannot
      // answer at all — and they were being harvested into the store and read
      // by nothing.
      accepts: row.accepts ? row.accepts.split(', ').filter(Boolean) : [],
      produces: row.produces ? row.produces.split(', ').filter(Boolean) : [],
      requires: row.requires ? row.requires.split(', ').filter(Boolean) : [],
      // Local names — `Windows`, `MacOS`, `Linux`. Deliberately not fed to the
      // lexical index or the composed text: see the note in `LexicalIndex.fields`
      // about `accepts` and `produces`, which applies here with more force.
      // These three tokens would appear on three quarters of the corpus, and the
      // question "does it run on Windows" is a filter with an exact answer
      // rather than a word match with an approximate one.
      platforms: row.platforms ? row.platforms.split(', ').filter(Boolean) : [],
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
      if (!byKey.has(key)) byKey.set(key, { key, names: new Map(), plugins: [], iri: null })
      const vendor = byKey.get(key)
      vendor.names.set(doc.vendor, (vendor.names.get(doc.vendor) ?? 0) + 1)
      vendor.plugins.push(doc.iri)
      // The minted identity, where the derived layer has been built. One per
      // key by construction — `bin/mint-vendors.js` folds by the same key this
      // does — so the first one wins and a second would be a derivation bug.
      vendor.iri = vendor.iri ?? doc.vendorIri ?? null
    }

    // Second pass: groups the curated merges say are one maker.
    //
    // The fold above groups by the *string*, so "danja" and "Danny Ayers" land
    // in two groups however firmly a person has said they are one person. The
    // merge is expressed in `data/curation/vendor-merges.json` and applied by
    // `bin/mint-vendors.js`, which writes one `foaf:maker` per plugin — so every
    // plugin of both spellings already points at the surviving vendor, and the
    // merge arrives here as two groups sharing an identity IRI.
    //
    // Reading the merge file here as well would be a second copy of a list, and
    // a list copied is a list that goes out of step: the graph would say one
    // vendor and the site would show two. The store is the single source, and
    // this is a regrouping of what it already said.
    const byIdentity = new Map()
    for (const vendor of byKey.values()) {
      const groupBy = vendor.iri ?? vendor.key
      const existing = byIdentity.get(groupBy)
      if (!existing) { byIdentity.set(groupBy, vendor); continue }
      for (const [name, count] of vendor.names) {
        existing.names.set(name, (existing.names.get(name) ?? 0) + count)
      }
      existing.plugins.push(...vendor.plugins)
      // The surviving key is whichever of them the identity layer kept, so ask
      // it rather than guessing from counts: the retired key has no identity.
      if (this.vendorIdentities.has(vendor.key)) existing.key = vendor.key
    }

    this.vendors = new Map()
    // Every spelling's slug resolves to the same vendor, so a link built from
    // one plugin's spelling and a link built from another's arrive at one page.
    this.vendorAliases = new Map()
    for (const vendor of byIdentity.values()) {
      // The spelling most of their plugins use. Ties go to the longer one,
      // which is how "SFZ Tools" wins over "SFZTools" and "Oleg Kapitonov" over
      // "olegkapitonov" — the separators are information, and the form with
      // them is the one somebody wrote deliberately.
      const spellings = [...vendor.names.entries()]
        .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
      const folded = {
        name: spellings[0][0],
        spellings: spellings.map(([name]) => name)
      }
      // The minted identity is the authority for a vendor's names where it
      // exists: it was derived over the whole store rather than over the loaded
      // documents, and it is where a human assertion that two spellings are one
      // maker lands. The fold stays in the union so that a plugin accepted
      // since the last derivation does not lose its spelling.
      const identity = this.vendorIdentities.get(vendor.key) ?? null
      const names = vendorNames(folded, identity)
      vendor.name = names.name
      vendor.spellings = names.spellings
      vendor.altLabels = names.altLabels
      vendor.minted = names.minted
      vendor.staleSpellings = names.stale
      vendor.count = vendor.plugins.length
      vendor.slug = vendorSlug(vendor.name)
      // Prefer the identity's own IRI over the one stamped on a document by
      // `foaf:maker`: they are the same IRI when both exist, and the identity
      // has one even for a vendor whose plugins are all in graphs the search
      // does not load.
      vendor.iri = identity?.iri ?? vendor.iri
      this.vendors.set(vendor.slug, vendor)
      for (const [name] of spellings) this.vendorAliases.set(vendorSlug(name), vendor.slug)
      this.vendorAliases.set(vendor.key, vendor.slug)
      // The minted IRI has to dereference, or it is an identifier this project
      // published and cannot answer for — the defect CLAUDE.md names as a URL
      // that resolves to no route. `pu:vendor/danja-ba40c9e0` therefore reaches
      // the same page as `/vendor/danja`.
      if (vendor.iri) this.vendorAliases.set(vendor.iri.split('/').pop(), vendor.slug)
      // And the IRIs of vendors merged into this one, for the same reason with
      // more force: those were published, they are in the CC0 dump, and somebody
      // may have written one down. A merge that silently retired them would be
      // this project's own identifiers going dark — the exact defect the minted
      // IRI above is aliased to avoid.
      for (const retired of identity?.retiredIris ?? []) {
        this.vendorAliases.set(retired.split('/').pop(), vendor.slug)
      }
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
  #filterConditions (facets) {
    const conditions = []
    for (const [name, value] of Object.entries(facets)) {
      if (!value) continue
      // A facet named in FACET_NAMES with no entry here would have been read
      // off the request and then quietly ignored — which is precisely what
      // `/plugins` did with `?category=` for as long as the list was copied.
      // `tests/search/facet-coverage.test.js` binds the two, so this throw is
      // the belt to that test's braces rather than the only guard.
      const build = FACET_PATTERNS[name]
      if (!build) throw new SearchError(`No filter is defined for the ${name} facet`)
      conditions.push(build(value))
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

  /**
   * How much of the vendor identity layer this instance is actually holding.
   *
   * Here because of how its absence was found. `bin/mint-vendors.js` had never
   * been run on the serving host, so there were no `pu:Vendor` resources at
   * all — and every vendor page answered 200 throughout, because they were
   * folded from `trn:vendor` strings and did not need the graph. A layer
   * nothing reads is a layer whose absence costs nothing, and this is the site
   * asking the question rather than waiting to be asked.
   *
   * `unminted` is expected to be small and non-zero: a plugin accepted since
   * the last derivation has a vendor the identity has not met. `total > 0 &&
   * minted === 0` is the different case — the derivation has not run here.
   */
  vendorIdentityCoverage () {
    const vendors = [...(this.vendors?.values() ?? [])]
    const minted = vendors.filter(vendor => vendor.minted)
    return {
      total: vendors.length,
      minted: minted.length,
      unminted: vendors.length - minted.length,
      // Vendors carrying a spelling the identity layer has not met yet.
      stale: vendors.filter(vendor => (vendor.staleSpellings?.length ?? 0) > 0).length
    }
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

  /**
   * Plugins the catalogue holds and the vector index does not.
   *
   * The hole this closes: `takeUpNewPlugins()` never throws, by design, because
   * a plugin that is in the catalogue and not yet embedded is still a plugin —
   * refusing the whole submission over a failed embedding would be worse. But
   * the consequence is that an embedding failure leaves a plugin findable
   * lexically, invisible to semantic search, and reported nowhere but a line in
   * a log nobody reads.
   *
   * `/health` printed both counts and compared nothing, which is the shape of
   * defect this project has written down more than once: two numbers side by
   * side, and no assertion that they agree.
   *
   * Returns IRIs rather than a count, because "three are missing" is a fact and
   * "these three are missing" is something somebody can act on.
   */
  unindexed () {
    const missing = []
    for (const iri of this.documents.keys()) {
      if (!this.index.has(iri)) missing.push(iri)
    }
    return missing
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
