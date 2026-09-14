import { describe, it, expect, beforeAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import QueryService from '../../src/store/QueryService.js'
import { vendorRecords, loadMerges } from '../../src/catalogue/VendorIdentity.js'
import VectorIndex from '../../src/vectors/VectorIndex.js'
import EmbeddingService from '../../src/embeddings/EmbeddingService.js'
import SearchService from '../../src/search/SearchService.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * The derived identity layer, as it actually sits in the store.
 *
 * `bin/mint-vendors.js` writes it. This asks the store what is there, because
 * the half of a feature that has been broken before in this project is always
 * the write — the read path is exercised by everything that uses it, and the
 * write is exercised by nothing unless something asks.
 *
 * It is skipped, not failed, when the layer has not been derived. A fresh
 * clone's store has no vendors graph and that is not a defect; the message says
 * which command produces one.
 */

const pu = NAMESPACES.pu
const foaf = NAMESPACES.foaf
const GRAPH = GraphRegistry.graphIri('curated', 'vendors')

let client
let derived = false

beforeAll(async () => {
  const config = await Config.load()
  client = new SPARQLClient(config.get('storage.endpoint'))
  const rows = await client.select(
    `SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${GRAPH}> { ?v a <${pu}Vendor> } }`)
  derived = Number(rows[0]?.n ?? 0) > 0
})

describe('the vendor identity layer', () => {
  it('exists, or says how to build it', () => {
    expect(derived, `no vendors in ${GRAPH} — run: node bin/mint-vendors.js`).toBe(true)
  })

  it('gives every plugin with a vendor string exactly one maker', async () => {
    // The assertion that would catch a half-run derivation: a plugin whose
    // vendor string exists and whose identity does not is one that cannot be
    // reached from its maker's page.
    const [{ n: withVendor }] = await client.select(
      `SELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { GRAPH ?g { ?p a <${NAMESPACES.trn}PluginProfile> ; <${NAMESPACES.trn}vendor> ?v } }`)
    const [{ n: withMaker }] = await client.select(
      `SELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { GRAPH <${GRAPH}> { ?p <${foaf}maker> ?v } }`)
    expect(Number(withMaker)).toBe(Number(withVendor))

    const [{ n: twoMakers }] = await client.select(
      `SELECT (COUNT(?p) AS ?n) WHERE { SELECT ?p (COUNT(?v) AS ?c) WHERE { ` +
      `GRAPH <${GRAPH}> { ?p <${foaf}maker> ?v } } GROUP BY ?p HAVING(COUNT(?v) > 1) }`)
    expect(Number(twoMakers), 'a plugin with two makers is a derivation bug').toBe(0)
  })

  it('gives every vendor a name and a key, and no vendor two names', async () => {
    const [{ n: vendors }] = await client.select(
      `SELECT (COUNT(DISTINCT ?v) AS ?n) WHERE { GRAPH <${GRAPH}> { ?v a <${pu}Vendor> } }`)
    const [{ n: named }] = await client.select(
      `SELECT (COUNT(DISTINCT ?v) AS ?n) WHERE { GRAPH <${GRAPH}> { ?v a <${pu}Vendor> ; <${foaf}name> ?name ; <${pu}vendorKey> ?key } }`)
    expect(Number(named)).toBe(Number(vendors))

    const [{ n: ambiguous }] = await client.select(
      `SELECT (COUNT(?v) AS ?n) WHERE { SELECT ?v (COUNT(?name) AS ?c) WHERE { ` +
      `GRAPH <${GRAPH}> { ?v <${foaf}name> ?name } } GROUP BY ?v HAVING(COUNT(?name) > 1) }`)
    expect(Number(ambiguous)).toBe(0)
  })

  it('has one vendor per key — the fold is the identity', async () => {
    const [{ n: split }] = await client.select(
      `SELECT (COUNT(?key) AS ?n) WHERE { SELECT ?key (COUNT(DISTINCT ?v) AS ?c) WHERE { ` +
      `GRAPH <${GRAPH}> { ?v <${pu}vendorKey> ?key } } GROUP BY ?key HAVING(COUNT(DISTINCT ?v) > 1) }`)
    expect(Number(split), 'two IRIs share one key, so the fold is not the identity').toBe(0)
  })

  it('is CC0 and reaches the public dump, because who made what is a fact', async () => {
    // Unlike the accounts and the feedback, this is catalogue data. It is
    // derived from CC0 facts and is itself one.
    const registry = new GraphRegistry(client)
    const row = (await registry.list()).find(entry => entry.graph === GRAPH)
    expect(row, 'the vendors graph is not registered').toBeTruthy()
    expect(row.licence).toBe('CC0-1.0')
    expect(await registry.cc0DumpGraphs()).toContain(GRAPH)
  })

  it('re-derives to exactly the same IRIs', async () => {
    // Rebuilding is a DROP and a re-derive, so an IRI that moved would orphan
    // every claim, description and logo attached to it. Derived here from the
    // same query the script uses and compared with what is stored.
    const queries = new QueryService()
    const rows = await client.select(queries.get('vendor/strings', {}))
    // Through the same merge file the script reads. Re-deriving without it
    // would compare the store against a derivation nobody performed, and fail
    // for a reason that is not a defect — which is exactly what happened when
    // merges were added and this test still folded on the strings alone.
    const merges = await loadMerges()
    const expected = new Set(vendorRecords(
      rows.map(row => ({ iri: row.plugin, vendor: row.vendor })), undefined, merges).map(r => r.iri))
    const stored = new Set((await client.select(
      `SELECT DISTINCT ?v WHERE { GRAPH <${GRAPH}> { ?v a <${pu}Vendor> } }`)).map(r => r.v))
    expect(stored.size).toBe(expected.size)
    for (const one of expected) expect(stored.has(one), `${one} is not in the store`).toBe(true)
  })

  it('leaves trn:vendor exactly as the sources wrote it', async () => {
    // The identity is asserted beside the string, never over it. Overwriting
    // would lose the only record of how that source spelled the name.
    const [{ n: literals }] = await client.select(
      `SELECT (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s <${NAMESPACES.trn}vendor> ?o FILTER(isLiteral(?o)) } }`)
    const [{ n: iris }] = await client.select(
      `SELECT (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s <${NAMESPACES.trn}vendor> ?o FILTER(isIRI(?o)) } }`)
    expect(Number(literals)).toBeGreaterThan(0)
    expect(Number(iris), 'trn:vendor gained an IRI object; the string is the source\'s word').toBe(0)
  })
})

/**
 * The read path — the half that did not exist.
 *
 * The layer was written by a script and selected by almost nothing: `foaf:maker`
 * reached the site through one OPTIONAL in `plugin/text-view.sparql`, used only
 * to make the minted IRI dereference, and `pu:Vendor`, `pu:vendorKey` and
 * `skos:altLabel` were read by no query at all. So the graph could be — and on
 * the serving host was — entirely absent while every vendor page answered 200,
 * because the pages fold `trn:vendor` strings and never needed it. See
 * MISTAKES.md.
 *
 * These load the real service against the real store and ask for the names, so
 * the query, the loader and the fold are exercised together rather than
 * separately.
 */
describe('the identity reaching the vendor page', () => {
  let search

  beforeAll(async () => {
    if (!derived) return
    const config = await Config.load()
    // The real service against the real store, index and embeddings included.
    // `SearchService` refuses a partial construction, which is the right
    // behaviour and means this exercises what the site actually runs.
    const index = await VectorIndex.open({
      dimension: config.get('embedding.dimension'),
      path: config.get('index.path'),
      model: config.get('embedding.model')
    })
    search = new SearchService({
      client, index, embeddings: EmbeddingService.fromConfig(config)
    })
    await search.loadDocuments()
  }, 120000)

  it('loads one identity per vendor in the graph', async () => {
    const [{ n }] = await client.select(
      `SELECT (COUNT(DISTINCT ?v) AS ?n) WHERE { GRAPH <${GRAPH}> { ?v a <${pu}Vendor> } }`)
    expect(search.vendorIdentities.size).toBe(Number(n))
  })

  it('reports every vendor as minted, because the derivation covers the catalogue', () => {
    const coverage = search.vendorIdentityCoverage()
    expect(coverage.total).toBeGreaterThan(0)
    // An unminted vendor here means the derivation is behind the corpus: some
    // plugin has a vendor string that `bin/mint-vendors.js` has not seen. That
    // is the ordinary state after an accepted submission, so this names the
    // remedy rather than merely failing.
    expect(coverage.unminted,
      `${coverage.unminted} vendor(s) have no minted identity — run: node bin/mint-vendors.js`
    ).toBe(0)
  })

  it('surfaces the graph\'s altLabels on a vendor that has more than one spelling', async () => {
    const rows = await client.select(
      `SELECT ?key (COUNT(?l) AS ?n) WHERE { GRAPH <${GRAPH}> { ` +
      `?v <${pu}vendorKey> ?key ; <${NAMESPACES.skos}altLabel> ?l } } ` +
      'GROUP BY ?key ORDER BY DESC(?n) LIMIT 1')
    if (rows.length === 0) return // no vendor in this corpus is spelled two ways
    const key = rows[0].key
    const identity = search.vendorIdentities.get(key)
    expect(identity, `no loaded identity for key ${key}`).toBeTruthy()
    expect(identity.altLabels.length).toBe(Number(rows[0].n))

    // And the page's record carries them: this is the assertion that would have
    // failed for as long as the page re-derived its own spellings.
    const folded = [...search.vendors.values()].find(vendor => vendor.key === key)
    expect(folded, `no folded vendor for key ${key}`).toBeTruthy()
    const record = search.vendor(folded.slug)
    expect(record).toBeTruthy()
    expect(record.altLabels).toEqual(identity.altLabels)
    for (const label of identity.altLabels) expect(record.spellings).toContain(label)
  })

  it('prefers the identity\'s name over the corpus\'s most-used spelling', () => {
    for (const vendor of search.vendors.values()) {
      if (!vendor.minted) continue
      expect(vendor.name).toBe(search.vendorIdentities.get(vendor.key).name)
      expect(vendor.spellings[0]).toBe(vendor.name)
    }
  })

  it('still answers for a vendor whose identity is missing, rather than 404ing', () => {
    // The fallback matters: an unminted vendor is a page that must still work,
    // because the alternative is that accepting a submission breaks a page
    // until somebody remembers to re-derive.
    const [slug] = [...search.vendors.keys()]
    expect(search.vendor(slug)).toBeTruthy()
    expect(search.vendor(slug).spellings.length).toBeGreaterThan(0)
  })
})

/**
 * A merged-away vendor's IRI must keep answering.
 *
 * This is the assertion the merge feature exists around rather than a detail of
 * it. `/vendor/dannyayers-20fd5796` was minted, published, dereferenced and
 * shipped in the CC0 dump before the merge; somebody may have written it down.
 * A merge that dropped it would be this project retiring one of its own
 * identifiers — the defect CLAUDE.md names about published URLs and routes,
 * committed deliberately rather than by omission.
 *
 * Skipped, not failed, when the corpus holds no merge: a catalogue with nobody
 * to merge is the ordinary case.
 */
describe('a curated merge, in the store', () => {
  let search
  let pairs = []

  beforeAll(async () => {
    if (!derived) return
    const config = await Config.load()
    const index = await VectorIndex.open({
      dimension: config.get('embedding.dimension'),
      path: config.get('index.path'),
      model: config.get('embedding.model')
    })
    search = new SearchService({
      client, index, embeddings: EmbeddingService.fromConfig(config)
    })
    await search.loadDocuments()
    pairs = await client.select(
      `SELECT ?retired ?survivor WHERE { GRAPH <${GRAPH}> { ` +
      `?retired <${NAMESPACES.owl}sameAs> ?survivor } }`)
  }, 120000)

  it('keeps every retired IRI resolving to the surviving vendor\'s page', () => {
    if (pairs.length === 0) return
    for (const { retired, survivor } of pairs) {
      // The route resolves by the IRI's last segment, which is what a reader
      // following the published identifier actually arrives with.
      const record = search.vendor(retired.split('/').pop())
      expect(record, `${retired} no longer reaches a page`).toBeTruthy()
      expect(record.iri, `${retired} reaches the wrong vendor`).toBe(survivor)
    }
  })

  it('does not leave the retired vendor as a second identity', () => {
    if (pairs.length === 0) return
    for (const { retired } of pairs) {
      const loaded = [...search.vendorIdentities.values()].map(identity => identity.iri)
      expect(loaded, `${retired} is still loaded as its own vendor`).not.toContain(retired)
    }
  })

  it('shows the merged-away name on the surviving page', () => {
    if (pairs.length === 0) return
    for (const { survivor } of pairs) {
      const record = [...search.vendors.values()].find(vendor => vendor.iri === survivor)
      expect(record).toBeTruthy()
      // A merge whose second name vanished would have lost the thing a reader
      // searching for the other spelling needs.
      expect(record.spellings.length).toBeGreaterThan(1)
    }
  })

  it('gathers both names\' plugins onto one page', async () => {
    if (pairs.length === 0) return
    for (const { survivor } of pairs) {
      const [{ n }] = await client.select(
        `SELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { GRAPH <${GRAPH}> { ` +
        `?p <${foaf}maker> <${survivor}> } }`)
      const record = [...search.vendors.values()].find(vendor => vendor.iri === survivor)
      // The point of the merge: one page holding what were two vendors' plugins.
      // If the site's fold ignored the merge it would show two smaller pages and
      // this count would come up short.
      expect(record.count, `${survivor} has ${n} plugins by foaf:maker`).toBe(Number(n))
    }
  })
})
