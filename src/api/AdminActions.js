import GraphRegistry from '../store/GraphRegistry.js'
import ShapeValidator from '../store/ShapeValidator.js'
import BackupBuilder from '../store/BackupBuilder.js'
import DumpBuilder from '../store/DumpBuilder.js'

/**
 * The operations an administrator can set off from a page.
 *
 * **Every action is a named entry in a frozen table, and none takes an
 * argument from the request.** A form that posts the name of a thing to run is
 * one string away from being a way to run anything; a form that posts a key
 * into this object is not. There is no path here from a request body to a
 * shell, a filename or a graph name.
 *
 * They call the same code the `bin/` scripts call rather than spawning them.
 * Spawning would mean a child process, an argument vector assembled from
 * somewhere, and output to parse — three things that can be got wrong — to
 * reach functions that are already imported and already under test.
 *
 * Each returns a sentence for a person, because that is what the page shows.
 * Each is also allowed to fail: an administrator who set off a backup wants to
 * be told it did not work, not to meet a stack trace.
 */

export class AdminActionError extends Error {
  constructor (message) {
    super(message)
    this.name = 'AdminActionError'
  }
}

export const ACTIONS = Object.freeze({
  validate: {
    label: 'Validate',
    describes: 'Check every registered graph against the SHACL shapes.',
    async run ({ client, config }) {
      const registry = new GraphRegistry(client)
      const validator = await ShapeValidator.load()
      const graphs = [...(await registry.list()), { graph: `${config.get('baseUri')}graphs` }]

      const failed = []
      let checked = 0
      for (const { graph } of graphs) {
        const report = await validator.validateGraph(client, graph)
        checked++
        if (!report.conforms) failed.push({ graph, count: report.results.length, first: report.results[0]?.message })
      }
      if (failed.length === 0) return `All ${checked} graphs conform.`
      return `${failed.length} of ${checked} graphs do not conform. ` +
        failed.map(f => `${f.graph}: ${f.count} violation(s), first — ${f.first}`).join(' · ')
    }
  },

  backup: {
    label: 'Back up',
    describes: 'Write an essential backup — the graphs no harvester could rebuild.',
    async run ({ client }) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      // Essential rather than full: this is the button somebody presses before
      // doing something risky, and it wants to be quick. The nightly job is
      // what takes the whole store.
      const outputDir = `data/backups/${stamp}-essential`
      const manifest = await new BackupBuilder(client).backup({ outputDir, scope: 'essential' })
      return `${manifest.graphs.length} graphs, ${manifest.triples} triples, into ${outputDir}. ` +
        'This is on the server\'s disk; the nightly job is what copies it off.'
    }
  },

  dump: {
    label: 'Rebuild dumps',
    describes: 'Write the public dataset dumps that /dumps/ serves.',
    async run ({ client }) {
      // nginx serves data/dumps straight off disk, so this is what puts
      // anything there. Without it /dumps/ is an advertised path with an empty
      // directory behind it — the same defect as a contact page that 404s,
      // which this project has already shipped once.
      const report = await new DumpBuilder(client, { outputDir: 'data/dumps' }).build()
      const parts = Object.entries(report.parts ?? {})
        .map(([name, part]) => `${name} ${part.graphs.length} graph(s)`).join(', ')
      const withheld = report.withheld?.length
        ? ` ${report.withheld.length} graph(s) withheld as not redistributable.`
        : ''
      return `Dumps rebuilt into ${report.outputDir} — ${parts}.${withheld} Served at /dumps/.`
    }
  },

  reindex: {
    label: 'Reindex',
    describes: 'Take up plugins the running app has not seen, and embed them.',
    async run ({ search }) {
      const taken = await search.takeUpNewPlugins()
      if (taken.error) throw new AdminActionError(`Indexing failed: ${taken.error}`)
      return taken.embedded === 0
        ? `Nothing new — ${taken.plugins} plugins, all embedded.`
        : `${taken.embedded} newly embedded, ${taken.plugins} plugins searchable.`
    }
  }
})

/**
 * Run one action by name.
 *
 * An unknown name is refused rather than ignored: a form that silently does
 * nothing when its button is renamed is worse than one that says it cannot.
 */
export async function runAction (name, context) {
  const action = ACTIONS[name]
  if (!action) {
    throw new AdminActionError(`No such action "${name}". Known: ${Object.keys(ACTIONS).join(', ')}.`)
  }
  try {
    return await action.run(context)
  } catch (error) {
    throw new AdminActionError(explain(error))
  }
}

/**
 * Turn a failure into something the person who pressed the button can act on.
 *
 * `EACCES: permission denied, mkdir 'data/dumps/cc0'` is accurate and tells a
 * reader nothing about what to do. It has one cause here and it is always the
 * same one: these directories are bind-mounted from the host, `docker run -v`
 * creates a missing one as root, and the app does not run as root. A message
 * that names the remedy is the difference between a five-second fix and a
 * round trip.
 */
export function explain (error) {
  const message = error?.message ?? String(error)
  if (error?.code === 'EACCES' || /EACCES/.test(message)) {
    return `${message} — the host directory is not writable by the user this ` +
      'container runs as. On the server: ./deploy/prepare-data-dirs.sh'
  }
  if (error?.code === 'ENOSPC' || /ENOSPC/.test(message)) {
    return `${message} — the disk is full.`
  }
  if (/ECONNREFUSED|fetch failed/.test(message)) {
    return `${message} — a service this needs is not answering. Check Fuseki and Ollama are up.`
  }
  return message
}

export default ACTIONS
