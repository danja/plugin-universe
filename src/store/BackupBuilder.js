import fs from 'fs'
import path from 'path'
import GraphRegistry from './GraphRegistry.js'
import { loadTurtleIntoGraph } from './TurtleLoader.js'
import { iri } from './SPARQLHelper.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * Backing the store up, and putting it back.
 *
 * **This is not `bin/dump.js`.** The dump publishes what may be published and
 * deliberately withholds accounts and pending corrections — which are exactly
 * the graphs that cannot be rebuilt. A backup wants everything, and wants to be
 * restorable rather than readable.
 *
 * The distinction that shapes it: measured on the live store, 47 triples are
 * irreplaceable and 45,067 can be re-harvested from source. Accounts,
 * corrections, moderation decisions, trust levels and wiki revisions exist
 * nowhere else and a contributor whose work is lost does not contribute twice.
 * Everything else is a copy of something public.
 *
 * So there are two sizes of backup. `essential` is the part that matters, small
 * enough to copy anywhere as often as you like. `full` is the whole store, for
 * the ordinary case of undoing a bad ingest without re-harvesting for an hour.
 *
 * One Turtle file per graph plus a manifest, as with the dump: Turtle carries no
 * graph name, so the manifest is what makes a restore able to put each file back
 * where it came from.
 */

const pu = NAMESPACES.pu

export class BackupError extends Error {
  constructor (message) {
    super(message)
    this.name = 'BackupError'
  }
}

/**
 * Is this graph one that could not be rebuilt by re-running the harvesters?
 *
 * Accounts and contributions, plus the graph registry — which is metadata
 * rather than content, but it is the index over everything else, and without it
 * a restore has data and no idea what any of it is or what licence it carries.
 */
export function isIrreplaceable (graph) {
  return graph.startsWith('graph:system/') ||
    graph.startsWith('graph:user/') ||
    graph === `${pu}graphs`
}

export class BackupBuilder {
  constructor (client, { registry = new GraphRegistry(client) } = {}) {
    if (!client) throw new BackupError('BackupBuilder needs a SPARQLClient')
    this.client = client
    this.registry = registry
  }

  /**
   * Every graph in the store, asked of the store itself.
   *
   * Not the registry: a graph that failed to register, or whose registration
   * was dropped, still holds data and still needs backing up. A backup that
   * trusted an index would silently omit whatever the index had forgotten.
   */
  async graphs () {
    const rows = await this.client.select(
      'SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } } ORDER BY ?g')
    return rows.map(row => row.g)
  }

  async #countTriples (graph) {
    const [row] = await this.client.select(
      `SELECT (COUNT(*) AS ?n) WHERE { GRAPH ${iri(graph)} { ?s ?p ?o } }`)
    return Number(row?.n ?? 0)
  }

  /** A graph IRI as a filename that cannot escape the backup directory. */
  static fileNameFor (graph) {
    const name = graph.replace(/^graph:/, '').replace(/[^A-Za-z0-9._-]+/g, '-')
    if (!name || name.includes('..')) throw new BackupError(`Cannot make a filename from ${graph}`)
    return `${name}.ttl`
  }

  /**
   * Write a backup.
   *
   * @param {object} options
   * @param {string} options.outputDir
   * @param {'full'|'essential'} [options.scope]
   */
  async backup ({ outputDir, scope = 'full', now = new Date() }) {
    if (!outputDir) throw new BackupError('A backup needs somewhere to go')
    if (!['full', 'essential'].includes(scope)) {
      throw new BackupError(`Unknown backup scope "${scope}"; use full or essential`)
    }
    const all = await this.graphs()
    if (all.length === 0) throw new BackupError('The store holds no graphs; refusing to write an empty backup.')

    const wanted = scope === 'essential' ? all.filter(isIrreplaceable) : all
    if (wanted.length === 0) {
      throw new BackupError('No graph matched the requested scope; refusing to write an empty backup.')
    }

    await fs.promises.mkdir(outputDir, { recursive: true })
    const graphs = []
    for (const graph of wanted) {
      const turtle = await this.client.construct(
        `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH ${iri(graph)} { ?s ?p ?o } }`)
      const file = BackupBuilder.fileNameFor(graph)
      await fs.promises.writeFile(path.join(outputDir, file), turtle)
      graphs.push({ graph, file, triples: await this.#countTriples(graph), bytes: Buffer.byteLength(turtle) })
    }

    const manifest = {
      generatedAt: now.toISOString(),
      scope,
      // Recorded so a restore can refuse a backup written by a version whose
      // serialisation it does not understand, rather than half-loading it.
      format: 'turtle-per-graph/1',
      graphs,
      triples: graphs.reduce((total, graph) => total + graph.triples, 0),
      // What was deliberately left out, so an essential backup cannot be
      // mistaken for a whole one at the moment somebody needs it to be.
      omitted: scope === 'essential' ? all.filter(graph => !isIrreplaceable(graph)) : []
    }
    await fs.promises.writeFile(
      path.join(outputDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2))
    return manifest
  }

  /** Read a backup's manifest, or say clearly why it cannot be used. */
  static async readManifest (directory) {
    const file = path.join(directory, 'MANIFEST.json')
    if (!fs.existsSync(file)) throw new BackupError(`${directory} has no MANIFEST.json; it is not a backup.`)
    const manifest = JSON.parse(await fs.promises.readFile(file, 'utf8'))
    if (manifest.format !== 'turtle-per-graph/1') {
      throw new BackupError(`${directory} is format ${manifest.format}, which this version cannot restore.`)
    }
    return manifest
  }

  /**
   * Put a backup back.
   *
   * **Destructive by nature**: each restored graph is dropped and rewritten, so
   * anything written since the backup is gone. The caller is required to say so
   * explicitly — a restore that can be triggered by a typo is a second way to
   * lose the data it exists to protect.
   *
   * Restoring a graph at a time rather than the dataset at a time means a
   * partial restore is possible and, more importantly, that a failure part way
   * through leaves the graphs it has not reached untouched.
   */
  async restore ({ directory, confirm = false, only = null }) {
    if (!confirm) {
      throw new BackupError(
        'restore() drops each graph before rewriting it. Pass confirm: true to say that is intended.')
    }
    const manifest = await BackupBuilder.readManifest(directory)
    const wanted = only
      ? manifest.graphs.filter(graph => only.includes(graph.graph))
      : manifest.graphs
    if (wanted.length === 0) throw new BackupError('Nothing in this backup matched the graphs requested.')

    const restored = []
    for (const entry of wanted) {
      const turtle = await fs.promises.readFile(path.join(directory, entry.file), 'utf8')
      await this.client.update(`DROP SILENT GRAPH ${iri(entry.graph)}`)
      const written = await loadTurtleIntoGraph(this.client, entry.graph, turtle)
      const now = await this.#countTriples(entry.graph)
      // Checked rather than assumed. A restore that reports success without
      // counting is the same promise an untested backup makes.
      if (now !== entry.triples) {
        throw new BackupError(
          `${entry.graph} restored to ${now} triples but the backup recorded ${entry.triples}. ` +
          'The graph has been left as restored; investigate before trusting this backup.')
      }
      restored.push({ graph: entry.graph, triples: now, written })
    }
    return { directory, scope: manifest.scope, generatedAt: manifest.generatedAt, restored }
  }
}

export default BackupBuilder
