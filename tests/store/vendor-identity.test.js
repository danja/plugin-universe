import { describe, it, expect, beforeAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import QueryService from '../../src/store/QueryService.js'
import { vendorRecords } from '../../src/catalogue/VendorIdentity.js'
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
    const expected = new Set(
      vendorRecords(rows.map(row => ({ iri: row.plugin, vendor: row.vendor }))).map(r => r.iri))
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
