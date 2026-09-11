import GraphRegistry from '../store/GraphRegistry.js'
import QueryService from '../store/QueryService.js'
import { insertDataQuery } from '../store/SPARQLHelper.js'
import { platformDescription } from './MeasurementSerialiser.js'

/**
 * Attaching a run's readings to the catalogue, and writing them down.
 *
 * Two tools now produce measurements — lilv through Lv2Scanner, pluginval
 * through PluginvalScanner — and they identify a plugin differently. lilv
 * reports the plugin's own upstream IRI; pluginval is pointed at a file and can
 * only report the file. Everything else about a run is the same, so the part
 * that differs is the resolver and the part that does not lives here.
 *
 * The rule both share: **a reading that cannot be attached to a catalogue
 * plugin is reported and dropped, never written against a guess.** A CPU figure
 * filed under the wrong plugin is worse than a missing one, because it looks
 * like an answer.
 *
 * Every run gets its own graph. If the host turns out to have been
 * misconfigured — the wrong sample rate, a machine under load, a tool built
 * differently — its readings can be dropped whole without touching anything
 * else, which is not true of measurements written into a shared graph.
 */

export class ProfilerRun {
  constructor (client, {
    registry = new GraphRegistry(client),
    queries = new QueryService()
  } = {}) {
    this.client = client
    this.registry = registry
    this.queries = queries
  }

  /**
   * Catalogue plugins by the upstream IRI they preserve with owl:sameAs.
   * How an LV2 scan finds the plugin it scanned.
   */
  async byUpstreamIri () {
    const rows = await this.client.select(this.queries.get('plugin/upstream-iris', {}))
    return new Map(rows.map(row => [row.upstream, row.plugin]))
  }

  /**
   * Catalogue plugins by bundle file name. How a validated file finds its
   * plugin.
   *
   * Case-folded, because a file system's idea of "the same name" and a
   * catalogue's are not reliably the same, and two bundles differing only in
   * case would be a naming collision upstream rather than two plugins. A name
   * claimed by two plugins is dropped from the map rather than resolved
   * arbitrarily — the ambiguity is the finding.
   */
  async byBundleName () {
    const rows = await this.client.select(this.queries.get('plugin/bundle-names', {}))
    const byName = new Map()
    const ambiguous = new Set()
    for (const row of rows) {
      const key = row.bundleName.toLowerCase()
      const existing = byName.get(key)
      if (existing && existing !== row.plugin) ambiguous.add(key)
      byName.set(key, row.plugin)
    }
    for (const key of ambiguous) byName.delete(key)
    return { byName, ambiguous: [...ambiguous] }
  }

  /**
   * Write a run's triples into a graph of their own.
   *
   * @param {object} spec
   * @param {string} spec.id - graph id, unique to this run
   * @param {string} spec.runId
   * @param {string[]} spec.triples
   * @param {string} spec.baseUri
   * @param {string} spec.comment
   */
  async write ({ id, runId, triples, baseUri, comment }) {
    await this.registry.drop('profiler', id)
    const graph = await this.registry.register({
      kind: 'profiler',
      id,
      // Measurements are this project's own observations, made with its own
      // equipment. Nobody else's terms attach to them.
      licence: 'CC0-1.0',
      derivedFrom: `${baseUri}profiler/${id}`,
      runId,
      comment: `${comment} on ${platformDescription()}`
    })
    await this.client.update(insertDataQuery(graph, triples))
    return graph
  }
}

export default ProfilerRun
