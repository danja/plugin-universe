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
 * A third scope, `measurements`, is not a backup at all — it is a delivery.
 * The profiler runs untrusted native code and wants a machine with room, so it
 * runs on a workstation; the catalogue is served from a small server that
 * should not be profiling while it serves. Measurements carry their platform
 * and timestamp precisely so that they are portable, and this is what carries
 * them. It selects the profiler run graphs and nothing else, so restoring one
 * on the server adds readings without touching a single harvested graph.
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

/** Graphs written by a profiler run. One graph per run, droppable on its own. */
export const MEASUREMENT_PREFIX = 'graph:profiler/'

export function isMeasurement (graph) {
  return graph.startsWith(MEASUREMENT_PREFIX)
}

export const SCOPES = Object.freeze(['full', 'essential', 'measurements'])

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
    if (!SCOPES.includes(scope)) {
      throw new BackupError(`Unknown backup scope "${scope}"; use ${SCOPES.join(', ')}`)
    }
    const all = await this.graphs()
    if (all.length === 0) throw new BackupError('The store holds no graphs; refusing to write an empty backup.')

    const select = {
      full: () => all,
      essential: () => all.filter(isIrreplaceable),
      measurements: () => all.filter(isMeasurement)
    }[scope]
    const wanted = select()
    if (wanted.length === 0) {
      throw new BackupError(
        `No graph matched the scope "${scope}"; refusing to write an empty backup.` +
        (scope === 'measurements' ? ' Nothing here has been profiled: run bin/profile.js first.' : ''))
    }

    // A measurement graph carried to another store arrives as data with no
    // index: the registry is what says what licence it holds and which run
    // made it, and the dump is assembled by querying exactly that. So each
    // one's registration travels with it, to be replayed there rather than
    // guessed at — and only its own, never the whole registry, which on the
    // receiving host describes a hundred graphs this backup knows nothing of.
    const registrations = scope === 'measurements'
      ? new Map((await this.registry.list()).map(row => [row.graph, row]))
      : new Map()

    await fs.promises.mkdir(outputDir, { recursive: true })
    const graphs = []
    for (const graph of wanted) {
      const turtle = await this.client.construct(
        `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH ${iri(graph)} { ?s ?p ?o } }`)
      const file = BackupBuilder.fileNameFor(graph)
      await fs.promises.writeFile(path.join(outputDir, file), turtle)
      const entry = { graph, file, triples: await this.#countTriples(graph), bytes: Buffer.byteLength(turtle) }
      const registration = registrations.get(graph)
      if (scope === 'measurements') {
        if (!registration) {
          throw new BackupError(
            `${graph} holds data but is not in the registry, so nothing records its licence or ` +
            'which run made it. Refusing to carry a graph that would arrive unattributable.')
        }
        entry.registration = {
          kind: registration.kind,
          id: registration.identifier,
          licence: registration.licence,
          derivedFrom: registration.derivedFrom,
          runId: registration.harvestRun ?? null,
          comment: registration.comment ?? null,
          generatedAt: registration.generatedAtTime ?? null
        }
      }
      graphs.push(entry)
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
      omitted: scope === 'full' ? [] : all.filter(graph => !wanted.includes(graph))
    }
    await fs.promises.writeFile(
      path.join(outputDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2))
    return manifest
  }

  /** Read a backup's manifest, or say clearly why it cannot be used. */
  static async readManifest (directory) {
    const file = path.join(directory, 'MANIFEST.json')
    // "No manifest" and "no such directory" are different problems and were
    // reported as the same one. Inside a container the usual cause is the
    // second: the backups live on the host and nothing mounted them.
    if (!fs.existsSync(directory)) {
      const parent = path.dirname(directory)
      const siblings = fs.existsSync(parent)
        ? fs.readdirSync(parent).filter(entry => !entry.startsWith('.')).sort().slice(-5)
        : []
      throw new BackupError(
        `${directory} does not exist.` +
        (siblings.length
          ? ` ${parent} holds: ${siblings.join(', ')}`
          : ` Neither does ${parent}. If this is running in a container, the backups are on the ` +
            'host and need mounting: docker compose run --rm -v /var/backups/plugin-universe:/backups app …'))
    }
    if (!fs.existsSync(file)) {
      // Say what is there. "No MANIFEST.json" names the thing that is missing
      // and leaves the reader to work out why, and the two usual whys are both
      // visible from a directory listing: the backup is one level down because
      // an rsync lost its trailing slash, or somebody copied the graph files
      // they wanted and left the manifest — which is the one file that says
      // which graph each of them belongs in.
      const entries = fs.readdirSync(directory, { withFileTypes: true })
      const nested = entries
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(directory, entry.name))
        .filter(child => fs.existsSync(path.join(child, 'MANIFEST.json')))
      if (nested.length === 1) {
        throw new BackupError(
          `${directory} has no MANIFEST.json, but ${nested[0]} does. ` +
          `Point at that instead — or re-copy with a trailing slash on the source ` +
          `(rsync -a <dir>/ host:${directory}/) so the contents land here rather than a directory.`)
      }
      const turtle = entries.filter(entry => entry.name.endsWith('.ttl')).map(entry => entry.name)
      if (turtle.length > 0) {
        throw new BackupError(
          `${directory} holds ${turtle.length} Turtle file(s) and no MANIFEST.json, so nothing ` +
          'says which graph each belongs in. Turtle carries no graph name; the manifest is what ' +
          'makes a restore able to put a file back where it came from. Copy the whole backup ' +
          `directory, then select what to load with --graph. Found: ${turtle.slice(0, 5).join(', ')}`)
      }
      const listing = entries.map(entry => entry.name).filter(name => !name.startsWith('.')).slice(0, 8)
      throw new BackupError(
        `${directory} has no MANIFEST.json; it is not a backup.` +
        (listing.length ? ` It holds: ${listing.join(', ')}` : ' It is empty.'))
    }
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

      // A carried measurement graph has to be registered here before it is
      // loaded, or it arrives as triples nothing can account for: no licence,
      // so the CC0 dump cannot see it, and no run, so nothing says which
      // machine produced it. register() replaces this one graph's row and
      // leaves every other graph's alone, which is what makes it safe to do on
      // a store full of data this backup has never heard of.
      if (entry.registration) {
        const { generatedAt, ...registration } = entry.registration
        await this.registry.register({
          ...registration,
          // The run's own time, not the time it was carried. A measurement is
          // an observation made on a machine at a moment, and re-stamping it
          // on arrival would make the graph claim to be newer than its own
          // readings.
          ...(generatedAt ? { generatedAt: new Date(generatedAt) } : {})
        })
      }

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
