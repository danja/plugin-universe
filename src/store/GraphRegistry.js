import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, dropGraphQuery } from './SPARQLHelper.js'
import QueryService from './QueryService.js'
import { SOURCE_PRECEDENCE } from '../../config/preferences.js'

/**
 * Named graphs, their provenance, and their licence.
 *
 * Every triple in this system lives in a graph that says where it came from and
 * what may be done with it. That is the whole basis of the licensing design:
 * assembling a CC0 dump is a query over the licence flag rather than an audit
 * of individual statements, and re-harvesting a source is a DROP of one graph
 * rather than a surgical delete.
 *
 * A graph created without a licence is a bug. There is no default, because a
 * wrong guess here is a licensing error rather than a runtime error, and it
 * would not surface until publication.
 *
 * See docs/architecture.md §3 and §8.
 */

/** Graph kinds, and the source-precedence class each belongs to. */
export const GRAPH_KINDS = Object.freeze({
  source: { prefix: 'graph:source', precedence: 'registry' },
  vendor: { prefix: 'graph:vendor', precedence: 'vendor' },
  user: { prefix: 'graph:user', precedence: 'user' },
  profiler: { prefix: 'graph:profiler', precedence: 'measurement' },
  discovery: { prefix: 'graph:discovery', precedence: 'discovery' },
  curated: { prefix: 'graph:curated', precedence: 'curated' },
  alignment: { prefix: 'graph:alignment', precedence: 'curated' },
  system: { prefix: 'graph:system', precedence: 'curated' }
})

/**
 * Licences a graph may carry, and whether its content may appear in the public
 * CC0 dump.
 *
 * `redistributable` answers "may this leave the building at all". `cc0Dump`
 * answers "may it go into the CC0 dataset without a notice". MIT and ISC data
 * is redistributable but carries a notice, so it needs its own dump section.
 */
export const LICENCES = Object.freeze({
  // Public-domain equivalent. These flow into the CC0 dump with nothing attached.
  'CC0-1.0': { redistributable: true, cc0Dump: true, notice: false },
  Unlicense: { redistributable: true, cc0Dump: true, notice: false },
  '0BSD': { redistributable: true, cc0Dump: true, notice: false },

  // Permissive, but the notice travels with the graph, so these need their own
  // dump section rather than being folded into the CC0 one.
  MIT: { redistributable: true, cc0Dump: false, notice: true },
  ISC: { redistributable: true, cc0Dump: false, notice: true },
  'BSD-2-Clause': { redistributable: true, cc0Dump: false, notice: true },
  'BSD-3-Clause': { redistributable: true, cc0Dump: false, notice: true },
  'Apache-2.0': { redistributable: true, cc0Dump: false, notice: true },
  'BSL-1.0': { redistributable: true, cc0Dump: false, notice: true },
  Zlib: { redistributable: true, cc0Dump: false, notice: true },
  'MPL-2.0': { redistributable: true, cc0Dump: false, notice: true },

  // Copyleft. A graph carries this flag when its content was extracted from
  // material under that licence — which says nothing about the software's terms
  // and everything about how carefully this project should redistribute what it
  // read. Extracting factual metadata from a bundle is not redistributing the
  // licensed work, but the conservative reading is the one that ships: these
  // stay out of the CC0 dump and carry their notice.
  'GPL-2.0': { redistributable: true, cc0Dump: false, notice: true },
  'GPL-3.0': { redistributable: true, cc0Dump: false, notice: true },
  'LGPL-2.1': { redistributable: true, cc0Dump: false, notice: true },
  'LGPL-3.0': { redistributable: true, cc0Dump: false, notice: true },
  'AGPL-3.0': { redistributable: true, cc0Dump: false, notice: true },

  // Content licences, for user-authored prose and for aligned vocabularies.
  //
  // `shareAlike` is not the same claim as `notice`. Attribution can travel
  // beside a file; share-alike governs what a consumer may do with anything
  // they build from it, so CC BY-SA content is published as its own dataset
  // rather than folded in with permissive material. Getting that wrong would
  // misdescribe both halves at once.
  'CC-BY-4.0': { redistributable: true, cc0Dump: false, notice: true },
  'CC-BY-SA-4.0': { redistributable: true, cc0Dump: false, notice: true, shareAlike: true },

  // Not ours to republish. Indexed as a name and a link, never as a copy.
  'proprietary-linkout': { redistributable: false, cc0Dump: false, notice: true },

  // People. <graph:system> holds accounts, and an account is personal data
  // under GDPR whatever its licence would otherwise be. Flagging it here means
  // the public dump excludes it by the same query that excludes a
  // non-redistributable source — structurally, rather than by remembering to.
  // Erasure is then a DROP of one graph.
  'personal-data': { redistributable: false, cc0Dump: false, notice: true },

  // The honest answer when a source states no terms. Deliberately not
  // redistributable: silence is not permission.
  unknown: { redistributable: false, cc0Dump: false, notice: true }
})

export class GraphError extends Error {
  constructor (message) {
    super(message)
    this.name = 'GraphError'
  }
}

export class GraphRegistry {
  constructor (client, { metadataGraph = `${NAMESPACES.pu}graphs`, queries = new QueryService() } = {}) {
    if (!client) throw new GraphError('GraphRegistry needs a SPARQLClient')
    this.client = client
    this.metadataGraph = metadataGraph
    this.queries = queries
  }

  /**
   * Build a graph IRI. Kind and id are structural; the IRI is derived, never
   * passed in, so a typo cannot create a stray graph.
   */
  static graphIri (kind, id) {
    const spec = GRAPH_KINDS[kind]
    if (!spec) {
      throw new GraphError(`Unknown graph kind "${kind}". Known: ${Object.keys(GRAPH_KINDS).join(', ')}`)
    }
    if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new GraphError(`Graph id must be lowercase alphanumeric with hyphens, got ${JSON.stringify(id)}`)
    }
    return `${spec.prefix}/${id}`
  }

  static precedenceOf (kind) {
    const spec = GRAPH_KINDS[kind]
    if (!spec) throw new GraphError(`Unknown graph kind "${kind}"`)
    return SOURCE_PRECEDENCE[spec.precedence]
  }

  /**
   * Register a graph and record its provenance. Called by a harvester before it
   * writes anything.
   *
   * @param {object} spec
   * @param {string} spec.kind - a key of GRAPH_KINDS
   * @param {string} spec.id - stable identifier for the source, e.g. 'downspout'
   * @param {string} spec.licence - a key of LICENCES. Required: there is no default.
   * @param {string} spec.derivedFrom - IRI or URL the data came from
   * @param {string} [spec.runId] - harvest run identifier
   * @param {string} [spec.comment]
   */
  async register ({ kind, id, licence, derivedFrom, runId = null, comment = null }) {
    if (!licence) {
      throw new GraphError(
        `Graph ${kind}/${id} was registered without a licence. Every graph must declare one — ` +
        'the CC0 dump is assembled by querying this field, so an unset licence is a licensing bug, ' +
        `not a missing default. Use "unknown" deliberately if that is the truth. Known: ${Object.keys(LICENCES).join(', ')}`
      )
    }
    if (!(licence in LICENCES)) {
      throw new GraphError(`Unknown licence "${licence}". Known: ${Object.keys(LICENCES).join(', ')}`)
    }
    if (!derivedFrom) {
      throw new GraphError(`Graph ${kind}/${id} must record what it was derived from`)
    }

    const graph = GraphRegistry.graphIri(kind, id)
    const now = new Date()
    const terms = LICENCES[licence]

    // Optional provenance, appended as extra predicate-object pairs so the
    // template stays one shape whether or not they are present.
    const optional = []
    if (runId) optional.push(`pu:harvestRun ${literal(runId)}`)
    if (comment) optional.push(`rdfs:comment ${literal(comment)}`)
    optional.push(`dcterms:title ${literal(id)}`)

    // Replace any previous registration, so a re-harvest updates rather than
    // accumulates.
    await this.client.update(this.queries.get('graph/deregister', {
      metadataGraph: iri(this.metadataGraph),
      graph: iri(graph)
    }))
    await this.client.update(this.queries.get('graph/register', {
      metadataGraph: iri(this.metadataGraph),
      graph: iri(graph),
      kind: literal(kind),
      identifier: literal(id),
      licence: literal(licence),
      redistributable: typedLiteral(terms.redistributable),
      inCC0Dump: typedLiteral(terms.cc0Dump),
      precedence: typedLiteral(GraphRegistry.precedenceOf(kind)),
      derivedFrom: literal(derivedFrom),
      generatedAtTime: typedLiteral(now),
      optional: optional.join(' ;\n      ') + ' .'
    }))

    return graph
  }

  /** Every registered graph with its licence terms. */
  async list () {
    return this.client.select(this.queries.get('graph/list', {
      metadataGraph: iri(this.metadataGraph)
    }))
  }

  /**
   * The graphs a CC0 dump may draw on. This is the query the whole licensing
   * design exists to make possible — note that it is one query, not a review.
   */
  async cc0DumpGraphs () {
    const rows = await this.client.select(this.queries.get('graph/cc0-dump-graphs', {
      metadataGraph: iri(this.metadataGraph)
    }))
    return rows.map(row => row.graph)
  }

  /**
   * Re-harvesting a source is a DROP of its graph, never a selective delete.
   *
   * The registration goes with it. A graph that no longer exists must not stay
   * in the registry: `list()` is what the dump and the validator iterate over,
   * so a stale row means querying a graph that is not there.
   */
  async drop (kind, id) {
    const graph = GraphRegistry.graphIri(kind, id)
    await this.client.update(dropGraphQuery(graph))
    await this.client.update(this.queries.get('graph/deregister', {
      metadataGraph: iri(this.metadataGraph),
      graph: iri(graph)
    }))
    return graph
  }

  async isRegistered (kind, id) {
    return this.client.ask(this.queries.get('graph/is-registered', {
      metadataGraph: iri(this.metadataGraph),
      graph: iri(GraphRegistry.graphIri(kind, id))
    }))
  }
}

export default GraphRegistry
