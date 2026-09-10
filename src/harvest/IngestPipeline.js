import logger from 'loglevel'
import GraphRegistry from '../store/GraphRegistry.js'
import QueryService from '../store/QueryService.js'
import URIMinter from '../rdf/URIMinter.js'
import { insertDataQuery, iri, literal } from '../store/SPARQLHelper.js'
import { serialisePlugin, resetBlankCounter } from './PluginSerialiser.js'
import CategoryScheme from '../rdf/CategoryScheme.js'
import { parseTurtleFile } from './TurtleReader.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { termToSparql } from '../store/TurtleLoader.js'

/**
 * Runs a harvester end to end: register the graph, drop what was there, write
 * what is there now.
 *
 * Re-harvesting is a graph swap. The DROP happens after the harvest succeeds,
 * so a source that fails to parse leaves the previous data in place rather than
 * emptying the catalogue.
 */

export class IngestError extends Error {
  constructor (message, { cause = null } = {}) {
    super(message)
    this.name = 'IngestError'
    if (cause) this.cause = cause
  }
}

/** Triples per INSERT DATA. Large enough to be fast, small enough not to time out. */
const BATCH_SIZE = 500

export class IngestPipeline {
  /**
   * @param {SPARQLClient} client
   * @param {object} [options]
   * @param {ShapeValidator|null} [options.validator] - when supplied, the
   *   serialised triples are validated against vocabs/shapes.ttl before
   *   anything is written, and a violation stops the ingest. Explicitly opt-in:
   *   validation costs a parse and a SHACL run over the whole source, which is
   *   right for an ingest and wrong for a unit test that writes three triples.
   */
  constructor (client, {
    registry = new GraphRegistry(client),
    minter = new URIMinter(),
    validator = null,
    queries = new QueryService()
  } = {}) {
    if (!client) throw new IngestError('IngestPipeline needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
    this.validator = validator
    this.queries = queries
  }

  /**
   * Write groups of triples, never splitting a group across two requests.
   *
   * The grouping is not an optimisation, it is a correctness requirement.
   * Blank node labels in an INSERT DATA are scoped to that request: `_:p42` in
   * one request and `_:p42` in the next are two different nodes. Batching by
   * triple count therefore cut ports and package files in half at every
   * boundary — one node holding the lv2:port link and the type, another holding
   * the symbol, the range and the unit — and neither half was findable by any
   * query that expected a whole one. A group is one plugin, or one concept, so
   * a blank node's whole closure travels in a single request.
   *
   * A group larger than BATCH_SIZE is written whole rather than split.
   *
   * @param {string} graph
   * @param {string[][]} groups
   */
  async #writeGrouped (graph, groups) {
    let batch = []
    let written = 0
    const flush = async () => {
      if (batch.length === 0) return
      await this.client.update(insertDataQuery(graph, batch))
      written += batch.length
      batch = []
    }
    for (const group of groups) {
      if (batch.length > 0 && batch.length + group.length > BATCH_SIZE) await flush()
      batch.push(...group)
      if (batch.length >= BATCH_SIZE) await flush()
    }
    await flush()
    return written
  }

  /**
   * @param {Harvester} harvester
   * @returns {Promise<object>} a run report
   */
  async run (harvester) {
    const started = Date.now()
    const runId = `${harvester.id}-${new Date().toISOString()}`

    const { plugins, rejected } = await harvester.harvest()
    if (plugins.length === 0 && rejected.length > 0) {
      throw new IngestError(
        `Harvester ${harvester.id} produced no usable records from ${rejected.length} candidates. ` +
        'Refusing to drop the existing graph for an empty result.'
      )
    }

    // Read before the drop, or there is nothing left to read. Re-harvesting is
    // a graph swap, so a first-seen date written by a previous run is destroyed
    // by the DROP below unless it is carried across — and a date that resets on
    // every run makes "recently added" a list of whatever was harvested last,
    // which is the opposite of what it claims.
    const firstSeen = await this.#firstSeen()
    const runTime = new Date()

    // Drop only now that the harvest has succeeded, then re-register so the
    // graph's provenance records this run rather than the previous one.
    await this.registry.drop(harvester.kind, harvester.id)
    const graph = await this.registry.register({
      kind: harvester.kind,
      id: harvester.id,
      licence: harvester.licence,
      derivedFrom: harvester.derivedFrom,
      runId
    })

    resetBlankCounter()
    // One entry per plugin, kept apart so that a plugin's blank nodes are
    // never split across two INSERT DATA requests.
    const groups = []
    const minted = []
    const categories = new Set()
    // Two records minting the same IRI silently become one plugin in the store.
    // That is invisible without a check — it cost 21 of 57 flues plugins once —
    // so collisions are collected and reported rather than left to be noticed
    // in a facet count that does not add up.
    const seen = new Map()
    const collisions = []

    for (const plugin of plugins) {
      let pluginIri
      try {
        pluginIri = this.minter.mintPlugin({
          name: plugin.name,
          vendor: plugin.vendor,
          bundleName: plugin.bundleName,
          classId: plugin.classId,
          sourceIri: plugin.sourceIri,
          registryId: plugin.registryId
        })
      } catch (error) {
        // A plugin with nothing stable to hash cannot get an idempotent IRI.
        // Recording why is more useful than a silent omission.
        rejected.push({ name: plugin.name, reason: error.message })
        continue
      }
      const previous = seen.get(pluginIri)
      if (previous) {
        collisions.push({
          iri: pluginIri,
          names: [previous.name, plugin.name],
          sources: [previous.sourceIri, plugin.sourceIri]
        })
        continue
      }
      seen.set(pluginIri, plugin)

      minted.push({ iri: pluginIri, plugin })
      groups.push(serialisePlugin(plugin, pluginIri, {
        created: firstSeen.get(pluginIri) ?? runTime
      }))
      for (const category of plugin.categories) categories.add(category)
    }

    if (collisions.length > 0) {
      throw new IngestError(
        `Harvester ${harvester.id} minted ${collisions.length} colliding IRIs, which would have ` +
        'silently merged distinct plugins. Fix the identity tuple rather than ingesting. First: ' +
        `${collisions[0].iri} claimed by ${JSON.stringify(collisions[0].names)} ` +
        `from ${JSON.stringify(collisions[0].sources)}`
      )
    }

    // Validate before writing. The graph has already been dropped by this
    // point, but nothing has replaced it, so a refusal here leaves an empty
    // graph rather than a wrong one — and the next run rebuilds it.
    if (this.validator) {
      const report = await this.validator.validateTriples(groups.flat())
      if (!report.conforms) {
        throw new IngestError(
          `Harvester ${harvester.id} produced ${report.results.length} SHACL violations. ` +
          `First: ${report.results[0].message} at ${report.results[0].focusNode} ` +
          `(${report.results[0].path ?? 'no path'})`
        )
      }
    }

    const written = await this.#writeGrouped(graph, groups)

    logger.info(`[ingest] ${harvester.id}: ${minted.length} plugins, ${written} triples`)

    return {
      source: harvester.id,
      graph,
      runId,
      licence: harvester.licence,
      plugins: minted,
      pluginCount: minted.length,
      tripleCount: written,
      categories: [...categories],
      rejected,
      collisions,
      elapsedMs: Date.now() - started
    }
  }

  /**
   * When each plugin already in the store was first seen, keyed by IRI.
   *
   * Across every graph, not just the one about to be replaced: the IRI is
   * minted from the plugin's identity, not from its source, so a plugin that
   * turns up in a second source is the same plugin and keeps its date.
   */
  async #firstSeen () {
    const rows = await this.client.select(this.queries.get('plugin/first-seen', {}))
    const dates = new Map()
    for (const row of rows) {
      const when = new Date(row.created)
      if (Number.isNaN(when.getTime())) continue
      // Oldest wins, in the case a plugin somehow carries two.
      const existing = dates.get(row.plugin)
      if (!existing || when < existing) dates.set(row.plugin, when)
    }
    return dates
  }

  /**
   * Every category any plugin in the store refers to.
   *
   * Read back rather than accumulated from the run, because writing the scheme
   * is a DROP and reload of its graph: a run over one source would otherwise
   * delete every concept the other sources contribute.
   */
  async storedCategories () {
    const rows = await this.client.select(this.queries.get('plugin/categories', {}))
    const prefix = `${NAMESPACES.pu}category/`
    return rows
      .map(row => row.category)
      .filter(category => category.startsWith(prefix))
      .map(category => category.slice(prefix.length))
  }

  /**
   * Write the category concept scheme into the alignment graph. Called once
   * after the harvesters, with the union of every category in the store.
   */
  async writeCategoryScheme (categories, { file = 'vocabs/categories.ttl' } = {}) {
    const scheme = await CategoryScheme.load(file)
    const used = [...categories].sort()

    await this.registry.drop('alignment', 'categories')
    const graph = await this.registry.register({
      kind: 'alignment',
      id: 'categories',
      licence: 'CC0-1.0',
      derivedFrom: `${NAMESPACES.pu}categories`,
      comment: 'SKOS concept scheme for plugin categories, from vocabs/categories.ttl'
    })
    const triples = scheme.triples(used)
    // The scheme has no blank nodes, but it goes through the same path so
    // there is only one way to write into a graph.
    const written = await this.#writeGrouped(graph, triples.map(triple => [triple]))
    // A category in the data that the vocabulary does not describe is written
    // with a label and nothing else. Reported rather than dropped: it is a real
    // facet value that plugins are using, and the vocabulary is what needs
    // extending, not the data that needs discarding.
    const undescribed = scheme.undescribed(used)
    if (undescribed.length > 0) {
      logger.warn(
        `[ingest] ${undescribed.length} categories are in the data but not in ${file}: ` +
        `${undescribed.join(', ')}. They have a label and no definition, synonyms or alignment.`
      )
    }
    return { graph, tripleCount: written, undescribed, unused: scheme.unused(used) }
  }

  /**
   * Load a Turtle file — an alignment, a vocabulary — into its own graph.
   *
   * Grouped by subject so that a file containing blank nodes survives the trip,
   * for the same reason plugin triples are grouped.
   */
  async writeTurtleFile (file, { kind, id, licence, derivedFrom, comment = null }) {
    const dataset = await parseTurtleFile(file)
    const bySubject = new Map()
    for (const quad of dataset) {
      const key = quad.subject.value
      if (!bySubject.has(key)) bySubject.set(key, [])
      bySubject.get(key).push(`${termToSparql(quad.subject)} ${termToSparql(quad.predicate)} ${termToSparql(quad.object)} .`)
    }

    await this.registry.drop(kind, id)
    const graph = await this.registry.register({ kind, id, licence, derivedFrom, comment })
    const written = await this.#writeGrouped(graph, [...bySubject.values()])
    return { graph, tripleCount: written }
  }
}

export default IngestPipeline
