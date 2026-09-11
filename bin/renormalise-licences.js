#!/usr/bin/env node
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import QueryService from '../src/store/QueryService.js'
import { iri, literal } from '../src/store/SPARQLHelper.js'
import { toSpdx, LICENCE_IDS } from '../src/harvest/Licensing.js'

/**
 * Bring every stored pu:licenceId up to date with toSpdx().
 *
 * The catalogue held 23 spellings of 19 licences: GPL-3.0 three ways, MIT
 * three ways, and 59 plugins carrying a DOAP URL. The facet listed each
 * spelling separately and `?licence=GPL-3.0` missed 86 plugins that were
 * under it.
 *
 * **This is a recomputation, not a re-harvest.** `dcterms:license` holds what
 * the source actually said and never leaves the graph; `pu:licenceId` is
 * derived from it by `toSpdx()`. So the fix reads the stated licence back out
 * of the store and re-derives, which costs no source any traffic and cannot
 * pick up a change the source has made since — a re-harvest would silently do
 * both. Nothing a source said is edited here.
 *
 * Where a plugin has no dcterms:license — a submission, where the contributor
 * typed an identifier and not a licence document — the current identifier is
 * itself the input, and toSpdx is idempotent on one it already recognises.
 *
 * Dry run by default. Usage:
 *   node bin/renormalise-licences.js            # report what would change
 *   node bin/renormalise-licences.js --apply    # write it
 */

const apply = process.argv.includes('--apply')

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
const queries = new QueryService()

if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const rows = await client.select(queries.get('plugin/licences'))
console.log(`${rows.length} plugins carry a licence.\n`)

const changes = []
const unrecognised = new Map()
for (const row of rows) {
  // SPARQLClient.select flattens bindings to plain strings — an unbound
  // OPTIONAL is an absent key, not a null one.
  const { graph, plugin, stated = null, current = null } = row

  const wanted = toSpdx(stated ?? current)
  if (!wanted || wanted === current) continue
  if (!LICENCE_IDS.has(wanted)) {
    unrecognised.set(wanted, (unrecognised.get(wanted) ?? 0) + 1)
    continue
  }
  changes.push({ graph, plugin, from: current, to: wanted })
}

// Grouped, because the interesting number is how many plugins move, not which.
const byMove = new Map()
for (const change of changes) {
  const key = `${change.from ?? '(none)'} → ${change.to}`
  byMove.set(key, (byMove.get(key) ?? 0) + 1)
}
for (const [move, count] of [...byMove].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${move}`)
}

if (unrecognised.size) {
  console.log('\nLeft alone, because toSpdx does not recognise them:')
  for (const [value, count] of [...unrecognised].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${value}`)
  }
  console.log('  Add them to OPEN_SOURCE_LICENCES or OTHER_LICENCES in')
  console.log('  src/harvest/Licensing.js, regenerate the sh:in list in')
  console.log('  vocabs/shapes.ttl, and run this again.')
}

if (changes.length === 0) {
  console.log('\nNothing to change.')
  process.exit(0)
}

if (!apply) {
  console.log(`\n${changes.length} plugins would change. Re-run with --apply to write.`)
  process.exit(0)
}

let written = 0
for (const change of changes) {
  await client.update(queries.get('plugin/relicence', {
    graph: iri(change.graph),
    plugin: iri(change.plugin),
    licenceId: literal(change.to)
  }))
  written += 1
  if (written % 50 === 0) console.log(`  ${written}/${changes.length}`)
}

// The question asked of the consumer, not of the artefact: read it back.
const after = await client.select(queries.get('plugin/licences'))
const distinct = new Set(after.map(r => r.current).filter(Boolean))
console.log(`\n${written} plugins rewritten.`)
console.log(`${distinct.size} distinct licence identifiers now in the store:`)
for (const value of [...distinct].sort()) {
  console.log(`  ${LICENCE_IDS.has(value) ? ' ' : '!'} ${value}`)
}
