#!/usr/bin/env node
import path from 'path'
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import BackupBuilder from '../src/store/BackupBuilder.js'

/**
 * Back the store up.
 *
 * Not the same job as bin/dump.js: the dump publishes what may be published and
 * withholds accounts and pending contributions, which are precisely the graphs
 * that cannot be rebuilt.
 *
 * Usage:
 *   node bin/backup.js                        full, into a dated directory
 *   node bin/backup.js --scope essential      only what cannot be re-harvested
 *   node bin/backup.js --scope measurements   the profiler runs, to carry to another host
 *   node bin/backup.js --out <dir>            somewhere specific
 *
 * `measurements` is a delivery rather than a backup. The profiler runs on a
 * machine with room and the catalogue is served from one without; this is how
 * a run gets from the first to the second. Each graph carries its registration,
 * so restoring it on the server adds readings and touches nothing else.
 */

logger.setLevel('info')

const args = process.argv.slice(2)
const flag = name => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? null : args[index + 1]
}

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const scope = flag('scope') ?? 'full'
// Dated, because "the backup" is never as useful as "the backup from before
// the thing that went wrong".
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
const outputDir = flag('out') ?? path.join('data/backups', `${stamp}-${scope}`)

const manifest = await new BackupBuilder(client).backup({ outputDir, scope })

console.log(`${manifest.scope} backup: ${manifest.graphs.length} graphs, ${manifest.triples} triples` +
  (manifest.files.length
    ? `, ${manifest.files.length} image(s) (${Math.round(manifest.fileBytes / 1024)} kB)`
    : ''))
console.log(`  ${outputDir}`)

if (manifest.scope === 'measurements') {
  // Listed before the steps, not after: step 2 takes one of these IRIs.
  console.log(`\n  ${manifest.graphs.length} profiler run(s), and nothing else:`)
  for (const graph of manifest.graphs) {
    console.log(`\n    ${graph.graph}`)
    console.log(`      ${String(graph.triples).padStart(5)} triples` +
      (graph.registration?.comment ? ` — ${graph.registration.comment}` : ''))
  }
}

if (manifest.scope === 'measurements') {
  // Spelled out per machine, because it is two machines and the last attempt
  // failed twice on exactly that: a directory copied without its manifest, and
  // a dataset name guessed from here that only the server knows.
  console.log('\n── to put these on the server ' + '─'.repeat(46))
  console.log('\nON THIS MACHINE:\n')
  console.log('  ssh danny@hyperdata mkdir -p /tmp/pu-measurements')
  console.log(`  rsync -rtv ${outputDir}/ danny@hyperdata:/tmp/pu-measurements/`)
  console.log('')
  console.log('  Make the directory first, as yourself. `docker run -v /path:...` creates')
  console.log('  a missing source directory as **root**, so a failed restore attempt')
  console.log('  leaves behind somewhere you can no longer rsync into — "mkstemp ...')
  console.log('  Permission denied". If that has happened: sudo rm -rf the directory, or')
  console.log('  use a name nothing has mounted yet.')
  console.log('')
  console.log('  -rtv, not -a. The archive flag implies -o and -g, and preserving owner')
  console.log('  and group across hosts is something only root may do — it fails with')
  console.log('  "chgrp ... Operation not permitted". Nothing here needs either: these')
  console.log('  files are a handoff, and the container reads them as uid 1001, which')
  console.log('  works because /tmp is 1777 and the files land world-readable.')
  console.log('')
  console.log('  The trailing slash on the source copies the contents. Copy the whole')
  console.log('  directory: Turtle carries no graph name, so MANIFEST.json is the only')
  console.log('  thing that says which graph each file belongs in. To load a single run,')
  console.log('  select it at step 2 with --graph, not here.')
  console.log('\nON THE SERVER — ssh danny@hyperdata, then cd /home/github/plugin-universe:\n')
  console.log('  # 1. What it would do. Prints the dataset name for step 2; that name')
  console.log('  #    comes from SPARQL_DATASET in the server\'s .env and is not')
  console.log('  #    something this machine can know.')
  console.log('  docker compose run --rm -v /tmp/pu-measurements:/measurements app \\')
  console.log('    node bin/restore.js /measurements')
  console.log('')
  console.log('  # 2. Load it. Append --graph <iri> to take one run rather than all.')
  console.log('  docker compose run --rm -v /tmp/pu-measurements:/measurements app \\')
  console.log('    node bin/restore.js /measurements --into <name from step 1>')
  console.log('')
  console.log('  # 3. Metric labels live in the store\'s copy of the vocabulary, not the')
  console.log('  #    file on disk. Without this every reading shows as a bare local name.')
  console.log('  docker compose run --rm app node bin/ingest.js --vocabs-only')
  console.log('')
  console.log('  # 4. The public SPARQL endpoint is a separate copy and stays behind.')
  console.log('  docker compose run --rm app node bin/publish.js')
  console.log('')
  console.log('  # 5. The app reads measurements once, at startup.')
  console.log('  docker compose restart app')
  console.log('\nBACK HERE, to confirm it landed:\n')
  console.log('  curl -s https://plugin-universe.com/health | grep measured')
  console.log('  npm run test:live')
  console.log('')
  console.log('  "measured" is 0 until step 2 succeeds, and counts plugins once it has.')
  console.log('')
}
if (manifest.omitted.length > 0 && manifest.scope === 'essential') {
  console.log(`\n  ${manifest.omitted.length} rebuildable graph(s) omitted from an essential backup:`)
  for (const graph of manifest.omitted) console.log(`    ${graph}`)
  console.log('  Re-run the harvesters to get these back; nothing else can.')
}

