import { describe, it, expect, beforeAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import QueryService from '../../src/store/QueryService.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * The profiler's readings as they come out of the store.
 *
 * Two things are being checked that only a live store can show: that the
 * metric labels resolve — they live in `vocabs/plugin-universe.ttl`, which was
 * not loaded into the graph at all until this was written, so every `pu:` IRI
 * in the published data pointed at a document the endpoint holding the data
 * could not read — and that a measurement filter reaches across graphs, since
 * a run writes its own graph and the plugin lives in another.
 */

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
const queries = new QueryService()
const pu = NAMESPACES.pu

let rows

beforeAll(async () => {
  if (!(await client.isReachable())) {
    throw new Error(
      `SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable. ` +
      'These tests require a live store; start it with "npm run store:up".'
    )
  }
  rows = await client.select(queries.get('plugin/measurements', {}))
}, 60000)

describe('the vocabulary is in the store, not only on disk', () => {
  it('resolves the label of every metric that has a reading', () => {
    // The gap this found: /ns/plugin-universe.ttl served the ontology from disk
    // while the store held none of it, so nothing could ask what pu:ScanTime
    // meant — including the code that had to display it.
    const unlabelled = [...new Set(rows.filter(row => !row.metricLabel).map(row => row.metric))]
    expect(
      unlabelled,
      `no rdfs:label for ${unlabelled.join(', ')}. Either the metric is missing from ` +
      'vocabs/plugin-universe.ttl, or the ontology graph was not loaded — run bin/ingest.js.'
    ).toEqual([])
  })

  it('holds the ontology as a graph of its own', async () => {
    const [row] = await client.select(`
      SELECT (COUNT(*) AS ?n) WHERE {
        GRAPH <graph:alignment/ontology-plugin-universe> { ?s ?p ?o }
      }`)
    expect(Number(row.n)).toBeGreaterThan(100)
  })

  it('states a unit for the metrics that have one', () => {
    // "364" was on the page and only the vocabulary knew it was milliseconds.
    const scanTime = rows.find(row => row.metric === `${pu}ScanTime`)
    if (scanTime) expect(scanTime.metricUnit).toBe(`${NAMESPACES.units}ms`)
  })
})

describe('filtering by a measurement crosses graphs', () => {
  it('finds the plugins a run passed', async () => {
    // The plugin is in a source graph and the verdict is in a run graph. The
    // filter used to assume one graph for everything, which could not express
    // this at all.
    const conditions =
      `GRAPH ?measurements { ?m <${pu}subject> ?plugin ; ` +
      `<${pu}metric> <${pu}ValidationResult> ; <${pu}value> "ok" }`
    const passing = await client.select(queries.get('plugin/filter', { conditions }))
    const measured = new Set(rows.map(row => row.subject))
    expect(passing.length).toBeGreaterThan(0)
    for (const row of passing) expect(measured.has(row.plugin)).toBe(true)
  })

  it('still filters on the plugin\'s own properties', async () => {
    // The same change rewrote every other facet's condition; a regression here
    // would silently return the whole catalogue for every filter.
    const conditions = `GRAPH ?g { ?plugin <${NAMESPACES.trn}format> <${NAMESPACES.trn}VST3> }`
    const vst3 = await client.select(queries.get('plugin/filter', { conditions }))
    const all = await client.select(queries.get('plugin/filter', {
      conditions: `GRAPH ?g { ?plugin <${NAMESPACES.rdfs}label> ?anyLabel }`
    }))
    expect(vst3.length).toBeGreaterThan(0)
    expect(vst3.length).toBeLessThan(all.length)
  })
})

describe('a plugin measured twice', () => {
  it('has its readings grouped by run, each with a time', () => {
    // Two runs are two accounts of the plugin. Merging their readings would
    // describe neither, so the loader keeps the newest run whole.
    for (const row of rows) {
      expect(row.run, 'a measurement with no run cannot be dated').toBeTruthy()
      expect(new Date(row.at).getTime()).not.toBeNaN()
    }
  })

  it('returns them oldest first, which is what the loader relies on', () => {
    const bySubject = new Map()
    for (const row of rows) {
      const previous = bySubject.get(row.subject)
      if (previous) expect(row.at >= previous, `${row.subject} out of order`).toBe(true)
      bySubject.set(row.subject, row.at)
    }
  })
})
