import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import ShapeValidator from '../../src/store/ShapeValidator.js'
import { insertDataQuery, iri } from '../../src/store/SPARQLHelper.js'
import { typeAsPlugins, additions } from '../../src/contrib/BundleReader.js'
import { parseTurtleFile } from '../../src/harvest/TurtleReader.js'
import { readBundleDataset } from '../../src/harvest/Lv2Bundle.js'
import { portTriples } from '../../src/harvest/PluginSerialiser.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * A bundle read, written and read back.
 *
 * The half that has been broken before in this project is always the write.
 * Image upload had twenty-two passing tests covering bytes, types, refusals and
 * rendering, and none covering the triple it was supposed to produce — which is
 * the half that did not work, for as long as the route existed. So this puts
 * the ports in a real store and asks for them again.
 *
 * The shapes matter here more than usual. A port is a blank node with a symbol,
 * a range, a unit and scale points, and `vocabs/shapes.ttl` has had a
 * `pu:PortShape` since Phase 0 — written for the harvester. Anything this route
 * writes goes through the same constraints, because a fact from a URL somebody
 * emailed in is not a different kind of fact.
 */

const GRAPH_ID = 'bundle-read-test'
const GRAPH = GraphRegistry.graphIri('user', GRAPH_ID)
const PLUGIN = `${NAMESPACES.pu}plugin/bundle-read-fixture-00000000`
const lv2 = 'http://lv2plug.in/ns/lv2core#'

let client
let record

beforeAll(async () => {
  const config = await Config.load()
  client = new SPARQLClient(config.get('storage.endpoint'))
  await client.update(`DROP SILENT GRAPH <${GRAPH}>`)
  record = readBundleDataset(typeAsPlugins(
    await parseTurtleFile('tests/fixtures/lv2/plugin.ttl')))[0]
})

afterAll(async () => {
  await client.update(`DROP SILENT GRAPH <${GRAPH}>`)
})

describe('what a read writes', () => {
  it('satisfies the shapes the harvester writes through', async () => {
    // Before the store, not after: a derivation that produces something the
    // store would refuse is a bug in the derivation, and a validation report
    // names it better than a failed INSERT does.
    const validator = await ShapeValidator.load()
    const triples = [
      `${iri(PLUGIN)} <${NAMESPACES.rdf}type> <${NAMESPACES.trn}PluginProfile> .`,
      `${iri(PLUGIN)} <${NAMESPACES.rdfs}label> "Fixture Delay" .`,
      ...portTriples(iri(PLUGIN), record.parameters)
    ]
    const report = await validator.validateTriples(triples)
    expect(report.conforms, JSON.stringify(report.violations?.slice(0, 2))).toBe(true)
  })

  it('puts the ports in the store, and they come back whole', async () => {
    const triples = portTriples(iri(PLUGIN), record.parameters)
    // One update, not one per port. A blank node label is scoped to a request,
    // so splitting these would cut every port in half — the defect that made
    // IngestPipeline batch by group rather than by triple count.
    await client.update(insertDataQuery(GRAPH, triples))

    const ports = await client.select(
      `SELECT ?symbol ?name WHERE { GRAPH <${GRAPH}> { ` +
      `<${PLUGIN}> <${lv2}port> ?p . ?p <${lv2}symbol> ?symbol ; <${lv2}name> ?name } }`)
    expect(ports.map(row => row.symbol).sort()).toEqual(['feedback', 'mode'])
    expect(ports.find(row => row.symbol === 'feedback').name).toBe('Feedback')
  })

  it('keeps a range, a default and a scale point with the port they belong to', async () => {
    // The part a form would have got wrong: these are properties of one port,
    // not of the plugin, and a blank node is what holds them together.
    const [row] = await client.select(
      `SELECT ?min ?max ?default WHERE { GRAPH <${GRAPH}> { ` +
      `<${PLUGIN}> <${lv2}port> ?p . ?p <${lv2}symbol> "feedback" ; ` +
      `<${lv2}minimum> ?min ; <${lv2}maximum> ?max ; <${lv2}default> ?default } }`)
    expect(Number(row.min)).toBe(0)
    expect(Number(row.max)).toBe(1)
    expect(Number(row.default)).toBeCloseTo(0.4)

    const points = await client.select(
      `SELECT ?label WHERE { GRAPH <${GRAPH}> { ` +
      `<${PLUGIN}> <${lv2}port> ?p . ?p <${lv2}symbol> "mode" ; ` +
      `<${lv2}scalePoint> ?sp . ?sp <${NAMESPACES.rdfs}label> ?label } }`)
    expect(points.map(row => row.label).sort()).toEqual(['Clean', 'Tape'])
  })

  it('never writes over a fact the catalogue already holds', async () => {
    // Additive only, decided before anything reaches the store. A plugin that
    // already has parameters gets none from a read, however good the bundle is:
    // a URL somebody sent in is not discovery, and this is the line.
    const held = {
      parameters: [{ symbol: 'already-here' }],
      accepts: ['urn:midi'],
      produces: [],
      requires: []
    }
    const added = additions(record, held)
    expect(portTriples(iri(PLUGIN), added.parameters)).toEqual([])
    expect(added.accepts).toEqual([])
    expect(added.skipped.parameters).toBe(1)
    // What it does not hold still comes through.
    expect(added.produces.length).toBeGreaterThan(0)
  })
})
