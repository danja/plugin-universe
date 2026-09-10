import fs from 'fs'
import path from 'path'
import { iri } from './SPARQLHelper.js'
import { loadTurtleIntoGraph } from './TurtleLoader.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * Loading the published dataset.
 *
 * The public SPARQL endpoint serves a **separate dataset**, built from the
 * output of `bin/dump.js`. Not a read-only view of the catalogue: a SPARQL
 * endpoint exposes every named graph it has, whatever the default graph is set
 * to, so `GRAPH <graph:system/accounts> { ?s ?p ?o }` would return a person's
 * name and avatar from any endpoint pointed at the live store.
 *
 * The strongest form of "not exposed" is "not present". The dump already
 * withholds non-redistributable graphs by the licence flag set when each was
 * harvested, so this only has to load what the dump produced and then **check
 * that nothing arrived which should not have** — because a publication step
 * that trusts its input is one refactor away from publishing the wrong thing.
 */

export class PublicationError extends Error {
  constructor (message) {
    super(message)
    this.name = 'PublicationError'
  }
}

/**
 * Graph name prefixes that must never appear in the published dataset.
 *
 * A belt-and-braces check against the dump's own selection, stated here as
 * names rather than inferred from a flag: if these two ever disagree, the
 * publish fails rather than resolving the disagreement in favour of shipping.
 */
export const NEVER_PUBLISH = Object.freeze(['graph:system/', 'graph:discovery/'])

export class Publication {
  constructor (client, { dumpDir = 'data/dumps' } = {}) {
    if (!client) throw new PublicationError('Publication needs a SPARQLClient for the target dataset')
    this.client = client
    this.dumpDir = dumpDir
  }

  /** What the dump says it produced. */
  async manifest () {
    const file = path.join(this.dumpDir, 'MANIFEST.json')
    if (!fs.existsSync(file)) {
      throw new PublicationError(
        `No dump at ${this.dumpDir}. Run bin/dump.js first — publishing reads what that wrote.`)
    }
    return JSON.parse(await fs.promises.readFile(file, 'utf8'))
  }

  /** Every graph currently in the target dataset. */
  async published () {
    const rows = await this.client.select(
      'SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } } ORDER BY ?g')
    return rows.map(row => row.g)
  }

  /**
   * Replace the published dataset with the current dump.
   *
   * Each graph is dropped and rewritten, and graphs that have gone from the
   * dump are dropped outright — a plugin removed from the catalogue, or a
   * source whose licence changed, must not linger in public because nothing
   * thought to remove it.
   */
  async publish ({ now = new Date() } = {}) {
    const manifest = await this.manifest()
    const wanted = Object.values(manifest.parts).flatMap(part => part.graphs)
    if (wanted.length === 0) throw new PublicationError('The dump contains no graphs; refusing to publish nothing.')

    for (const graph of wanted) {
      for (const forbidden of NEVER_PUBLISH) {
        if (graph.graph.startsWith(forbidden)) {
          throw new PublicationError(
            `The dump contains ${graph.graph}, which must never be published. ` +
            'Nothing has been written. Fix the dump before publishing.')
        }
      }
    }

    const before = await this.published()

    // Refuse to publish into the catalogue.
    //
    // If `storage.publication` were ever pointed at the live dataset — a typo,
    // a copied config, a container name reused — the loop below would drop
    // accounts and pending corrections as "graphs not in the dump" and the
    // first anybody would know is that they were gone. A dataset holding those
    // graphs is by definition not the publication dataset, so the presence of
    // one is proof the target is wrong.
    const catalogue = before.filter(graph =>
      NEVER_PUBLISH.some(forbidden => graph.startsWith(forbidden)))
    if (catalogue.length > 0) {
      throw new PublicationError(
        `The target dataset holds ${catalogue.join(', ')}, so it is the catalogue and not the ` +
        'publication dataset. Nothing has been written. Check storage.publication in the config.')
    }

    const keep = new Set(wanted.map(graph => graph.graph))
    const removed = before.filter(graph => !keep.has(graph))
    for (const graph of removed) {
      await this.client.update(`DROP SILENT GRAPH ${iri(graph)}`)
    }

    const loaded = []
    for (const graph of wanted) {
      const turtle = await fs.promises.readFile(path.join(this.dumpDir, graph.file), 'utf8')
      await this.client.update(`DROP SILENT GRAPH ${iri(graph.graph)}`)
      await loadTurtleIntoGraph(this.client, graph.graph, turtle)
      const [row] = await this.client.select(
        `SELECT (COUNT(*) AS ?n) WHERE { GRAPH ${iri(graph.graph)} { ?s ?p ?o } }`)
      const count = Number(row.n)
      if (count !== graph.triples) {
        throw new PublicationError(
          `${graph.graph} published ${count} triples but the dump recorded ${graph.triples}.`)
      }
      loaded.push({ graph: graph.graph, triples: count, licence: graph.licence })
    }

    const audit = await this.audit()
    if (audit.length > 0) {
      throw new PublicationError(
        `Published dataset contains graphs it must not: ${audit.join(', ')}. ` +
        'They are still there; drop them before this endpoint is reachable.')
    }

    return {
      publishedAt: now.toISOString(),
      graphs: loaded,
      triples: loaded.reduce((total, graph) => total + graph.triples, 0),
      removed
    }
  }

  /**
   * Anything in the published dataset that must not be there.
   *
   * Run after publishing, and worth running on its own: this is the question
   * "is the public endpoint exposing something it should not" asked directly of
   * the endpoint, rather than inferred from what was intended.
   */
  async audit () {
    return (await this.published()).filter(graph =>
      NEVER_PUBLISH.some(forbidden => graph.startsWith(forbidden)))
  }

  /** A VoID description of what is being served, including the union answer. */
  describe (report) {
    const dataset = `${NAMESPACES.pu}dataset`
    return [
      `@prefix void: <${NAMESPACES.void}> .`,
      `@prefix dcterms: <${NAMESPACES.dcterms}> .`,
      `@prefix rdfs: <${NAMESPACES.rdfs}> .`,
      '',
      '# What this endpoint serves.',
      '#',
      '# The default graph is the union of every named graph here, so a query',
      '# with no GRAPH clause sees the whole published dataset. That is stated',
      '# rather than left to be discovered: the alternative — an empty default',
      '# graph — makes the first query anybody types return nothing.',
      '#',
      '# This is a published copy, not the live catalogue. Accounts and pending',
      '# contributions are not withheld from it by a filter; they were never',
      '# loaded into it.',
      '',
      `<${dataset}/public> a void:Dataset ;`,
      '    rdfs:label "Plugin Universe — public SPARQL" ;',
      `    dcterms:modified "${report.publishedAt}"^^<${NAMESPACES.xsd}dateTime> ;`,
      `    void:sparqlEndpoint <https://sparql.plugin-universe.com/public/query> ;`,
      `    void:triples ${report.triples} ;`,
      `    void:uriSpace "${NAMESPACES.pu}" ;`,
      '    dcterms:license <https://creativecommons.org/publicdomain/zero/1.0/> .',
      ''
    ].join('\n')
  }
}

export default Publication
