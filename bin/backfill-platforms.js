#!/usr/bin/env node
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import QueryService from '../src/store/QueryService.js'
import { iri } from '../src/store/SPARQLHelper.js'
import { PLATFORMS, toPlatform, platformsInName } from '../src/harvest/Platforms.js'

/**
 * Derive pu:supportedPlatform for plugins already in the store.
 *
 * The catalogue has held this fact since Phase 1 and could not show it. 559
 * plugins carry `pu:operatingSystem` — "win", "mac", "linux" — on their package
 * files, three blank nodes below the plugin, where no facet can filter and no
 * document can reach; `grep -rn 'operatingSystem' sparql/queries/` returned one
 * query, the registry index. Another 21 publish release assets whose filenames
 * say the same thing. The serialiser now writes the plugin-level triple at
 * harvest time, and this is how the plugins harvested before that get it.
 *
 * **A recomputation, not a re-harvest**, for the same reason as
 * `renormalise-licences.js`: the evidence never left the graph, so re-deriving
 * from it costs no source any traffic and cannot silently pick up a change the
 * source has made since. A re-harvest would do both, and for the GitHub sources
 * it would be a hundred repositories' worth of API calls to recover a fact
 * already in the store.
 *
 * It is idempotent and a no-op once a source has been re-harvested: the
 * serialiser derives the same platforms from the same packages through the same
 * functions, so a harvest and this agree by construction.
 *
 * Dry run by default. Usage:
 *   node bin/backfill-platforms.js            # report what would change
 *   node bin/backfill-platforms.js --apply    # write it
 */

const apply = process.argv.includes('--apply')

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
const queries = new QueryService()

if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const rows = await client.select(queries.get('plugin/package-platforms'))

// One entry per plugin. The query returns a row per file per statement, so a
// plugin with three downloads and three declared systems arrives nine times.
const plugins = new Map()
for (const row of rows) {
  const { graph, plugin, system = null, url = null, derived = null } = row
  if (!plugins.has(plugin)) {
    plugins.set(plugin, { graph, plugin, stated: new Set(), named: new Set(), derived: new Set() })
  }
  const entry = plugins.get(plugin)
  if (derived) entry.derived.add(derived)
  // A stated system beats a filename, so they are collected apart and only the
  // filenames of a plugin that stated nothing are read. Deciding per file, as
  // `platformsFromPackages` does, is not possible here: the SELECT flattens the
  // file away, and a plugin whose manifest states systems states them for every
  // file. The one case this differs on — a plugin with one manifest-described
  // file and one bare release asset — does not exist in the catalogue.
  if (system) {
    const platform = toPlatform(system)
    if (platform) entry.stated.add(platform)
  }
  if (url) for (const platform of platformsInName(url)) entry.named.add(platform)
}

const changes = []
let unchanged = 0
let noEvidence = 0
let statedElsewhere = 0
const unrecognised = new Map()
for (const row of rows) {
  if (row.system && !toPlatform(row.system)) {
    unrecognised.set(row.system, (unrecognised.get(row.system) ?? 0) + 1)
  }
}

for (const entry of plugins.values()) {
  const found = entry.stated.size > 0 ? entry.stated : entry.named
  // Fixed order, so a second run produces the same triples as the first.
  const wanted = PLATFORMS.filter(platform => found.has(platform))
  const current = PLATFORMS.filter(platform => entry.derived.has(platform))
  if (wanted.length === 0) {
    // Nothing to derive. Two different situations, and telling them apart is
    // the difference between a true sentence and a false one: a plugin whose
    // harvester *stated* its platforms — flues says Linux, because its author
    // does — has them and is not silent, and must not be emptied by a script
    // that only knows how to read packages. Skipping is what protects it.
    if (current.length > 0) statedElsewhere += 1
    else noEvidence += 1
    continue
  }
  if (current.join(' ') === wanted.join(' ')) {
    unchanged += 1
    continue
  }
  changes.push({ ...entry, wanted, current })
}

console.log(`${plugins.size} plugins in the store.`)
console.log(`  ${unchanged} already carry the right platforms.`)
console.log(`  ${changes.length} would change.`)
console.log(`  ${statedElsewhere} were stated by their harvester, not derived here — left alone.`)
// Said plainly rather than left as a subtraction. This is the honest half of
// the answer and the number somebody will want to reduce: a plugin with no
// package and no release asset has nothing to derive from, and the catalogue
// says nothing rather than guessing from its format.
console.log(`  ${noEvidence} have no platform evidence at all, and stay silent.`)

const byPlatforms = new Map()
for (const change of changes) {
  const key = change.wanted.map(one => one.replace(/^.*\//, '')).join(' + ')
  byPlatforms.set(key, (byPlatforms.get(key) ?? 0) + 1)
}
console.log('')
for (const [combination, count] of [...byPlatforms].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${combination}`)
}

if (unrecognised.size) {
  console.log('\nSystem strings no platform was recognised in:')
  for (const [value, count] of [...unrecognised].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${value}`)
  }
  console.log('  Add the token to PLATFORM_TOKENS in src/harvest/Platforms.js and run this again.')
}

if (changes.length === 0) {
  console.log('\nNothing to change.')
  process.exit(0)
}

if (!apply) {
  console.log(`\nRe-run with --apply to write. Restart the app afterwards so the search`)
  console.log('service reloads its documents — the facet is built at startup.')
  process.exit(0)
}

let written = 0
for (const change of changes) {
  await client.update(queries.get('plugin/set-platforms', {
    graph: iri(change.graph),
    plugin: iri(change.plugin),
    platforms: change.wanted.map(iri).join(' , ')
  }))
  written += 1
  if (written % 100 === 0) console.log(`  ${written}/${changes.length}`)
}

// The question asked of the consumer, not of the artefact: read it back through
// the query the facet is actually built from, rather than trusting the writes.
const after = await client.select(queries.get('plugin/facets', { conditions: '' }))
const counts = after.filter(row => row.facet === 'platform')
console.log(`\n${written} plugins rewritten. The platform facet now counts:`)
for (const row of counts) console.log(`  ${String(row.count).padStart(4)}  ${row.value}`)
if (counts.length === 0) {
  console.error('  nothing — the writes did not land where plugin/facets.sparql reads.')
  process.exit(1)
}
console.log('\nRestart the app so the search service reloads its documents.')
