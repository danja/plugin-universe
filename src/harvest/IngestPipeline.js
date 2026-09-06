import logger from 'loglevel'
import GraphRegistry from '../store/GraphRegistry.js'
import URIMinter from '../rdf/URIMinter.js'
import { insertDataQuery } from '../store/SPARQLHelper.js'
import { serialisePlugin, serialiseCategoryScheme, resetBlankCounter } from './PluginSerialiser.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

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
  constructor (client, { registry = new GraphRegistry(client), minter = new URIMinter() } = {}) {
    if (!client) throw new IngestError('IngestPipeline needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
  }

  async #writeBatched (graph, triples) {
    for (let i = 0; i < triples.length; i += BATCH_SIZE) {
      await this.client.update(insertDataQuery(graph, triples.slice(i, i + BATCH_SIZE)))
    }
    return triples.length
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
    const triples = []
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
          sourceIri: plugin.sourceIri
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
      triples.push(...serialisePlugin(plugin, pluginIri))
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

    const written = await this.#writeBatched(graph, triples)

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
   * Write the category concept scheme into the alignment graph. Called once
   * after the harvesters, with the union of every category they produced.
   */
  async writeCategoryScheme (categories) {
    await this.registry.drop('alignment', 'categories')
    const graph = await this.registry.register({
      kind: 'alignment',
      id: 'categories',
      licence: 'CC0-1.0',
      derivedFrom: `${NAMESPACES.pu}categories`,
      comment: 'SKOS concept scheme for plugin categories, derived from harvested roles and LV2 classes'
    })
    const triples = serialiseCategoryScheme([...categories].sort())
    await this.#writeBatched(graph, triples)
    return { graph, tripleCount: triples.length }
  }
}

export default IngestPipeline
