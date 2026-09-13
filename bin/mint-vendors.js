#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import GraphRegistry from '../src/store/GraphRegistry.js'
import QueryService from '../src/store/QueryService.js'
import ShapeValidator from '../src/store/ShapeValidator.js'
import { insertDataQuery, iri } from '../src/store/SPARQLHelper.js'
import { vendorRecords, identityTriples } from '../src/catalogue/VendorIdentity.js'

/**
 * Derive the vendor identity layer.
 *
 * Reads every `trn:vendor` string in the catalogue, folds the spellings into
 * vendors, mints an IRI for each and writes the result to one graph.
 *
 * **Why this is a script and not part of a harvest.** A harvester sees its own
 * source's graph. The identity of a vendor is a fold across sources — the same
 * maker appears in four of them — so no harvester is in a position to compute
 * it, and minting inside one would produce a different vendor resource per
 * source per name, which is the problem rather than the fix.
 *
 * **Rebuilding is safe.** The IRI is a content hash over the folded name, so
 * re-deriving the same catalogue produces the same IRIs; nothing that points
 * into this graph is invalidated by a rebuild. The graph is dropped and rewritten
 * whole, because a partial update would leave a vendor behind whose last plugin
 * had been renamed away from them.
 *
 * Usage:
 *   node bin/mint-vendors.js            derive and write
 *   node bin/mint-vendors.js --dry-run  say what it would write, and write nothing
 */

logger.setLevel('info')

const dryRun = process.argv.includes('--dry-run')
const config = await Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
const registry = new GraphRegistry(client)
const queries = new QueryService()

const GRAPH_ID = 'vendors'
const graph = GraphRegistry.graphIri('curated', GRAPH_ID)

// Every plugin and the vendor string it carries, across every graph. Asked of
// the store rather than of the search service: a plugin in a graph the search
// does not load still has a maker, and the identity layer should cover the
// catalogue rather than the index.
const rows = await client.select(queries.get('vendor/strings', {}))
logger.info(`${rows.length} plugins carry a vendor string`)

const records = vendorRecords(rows.map(row => ({ iri: row.plugin, vendor: row.vendor })))
const triples = identityTriples(records)

const merged = records.filter(record => record.spellings.length > 1)
logger.info(`${records.length} vendors, ${triples.length} triples`)
if (merged.length > 0) {
  logger.info(`${merged.length} vendor(s) with more than one spelling, folded by the key:`)
  for (const record of merged) {
    logger.info(`  ${record.name} <- ${record.spellings.slice(1).join(', ')}`)
  }
}

// The shapes, before the write rather than after. A derivation that produces
// something the store would refuse is a bug in the derivation, and finding that
// out from a validation report beats finding it out from a failed INSERT.
const validator = await ShapeValidator.load()
const report = await validator.validateTriples(triples)
if (!report.conforms) {
  logger.error('The derived identity layer does not satisfy the shapes:')
  for (const violation of report.violations.slice(0, 10)) {
    logger.error(`  ${violation.focusNode?.value ?? ''} ${violation.message?.[0]?.value ?? ''}`)
  }
  process.exit(1)
}
logger.info('Shapes: conforms')

if (dryRun) {
  logger.info('--dry-run: nothing written.')
  logger.info(`Would write ${triples.length} triples to ${graph}`)
  process.exit(0)
}

// Dropped and rewritten whole. A partial update would leave a vendor behind
// whose last plugin had been renamed away from them, and a vendor with no
// plugins is a page that exists and says nothing.
await client.update(`DROP SILENT GRAPH ${iri(graph)}`)
if (!await registry.isRegistered('curated', GRAPH_ID)) {
  await registry.register({
    kind: 'curated',
    id: GRAPH_ID,
    // Derived from the catalogue's own CC0 facts, and itself a fact: who made
    // what. It belongs in the public dump with everything else factual.
    licence: 'CC0-1.0',
    derivedFrom: `${config.get('site.origin') ?? 'urn:plugin-universe'}`,
    comment: 'Vendor identity, derived from the trn:vendor strings by bin/mint-vendors.js. Rebuildable.'
  })
}

// Batched by vendor rather than by triple count: a vendor's own triples must
// not be split across two requests, for the same reason a plugin's must not.
let written = 0
for (const record of records) {
  const group = identityTriples([record])
  await client.update(insertDataQuery(graph, group))
  written += group.length
}

logger.info(`Wrote ${written} triples to ${graph}`)
logger.info('Restart the app so the search service reads the new identities.')
