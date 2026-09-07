import { describe, it, expect, beforeAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import ShapeValidator, { summarise } from '../../src/store/ShapeValidator.js'
import IngestPipeline from '../../src/harvest/IngestPipeline.js'
import { Harvester } from '../../src/harvest/Harvester.js'
import { iri } from '../../src/store/SPARQLHelper.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

// Validation runs against the live store, over the graphs an ingest actually
// wrote. The core suite proves the shapes fire; this proves the pipeline
// produces data that satisfies them.

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
const registry = new GraphRegistry(client)

let validator

beforeAll(async () => {
  if (!(await client.isReachable())) {
    throw new Error(
      `SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable. ` +
      'These tests require a live store; start it with "npm run store:up".'
    )
  }
  validator = await ShapeValidator.load()
}, 30000)

describe('the harvested graphs conform to the shapes', () => {
  it('has graphs to validate', async () => {
    const graphs = await registry.list()
    expect(graphs.length).toBeGreaterThan(0)
  })

  it('validates every registered graph', async () => {
    const graphs = await registry.list()
    const failures = []
    for (const { graph } of graphs) {
      const report = await validator.validateGraph(client, graph)
      if (!report.conforms) failures.push(`${graph}\n${summarise(report)}`)
    }
    expect(failures.join('\n\n')).toBe('')
  }, 300000)

  it('validates the graph registry itself, where the licence flags live', async () => {
    const report = await validator.validateGraph(client, `${NAMESPACES.pu}graphs`)
    expect(summarise(report)).toBe('conforms')
  }, 60000)
})

/**
 * A blank node label is scoped to one INSERT DATA request, so a plugin whose
 * triples are split across two requests has its ports and package files cut in
 * half — one node carrying the lv2:port link, another carrying the symbol and
 * the range, and no query able to find a whole one. Batching by triple count
 * did exactly that. This ingests a plugin large enough to have crossed a
 * boundary and checks that it arrives whole.
 */
class OneBigPluginHarvester extends Harvester {
  constructor () {
    super({
      id: 'test-batching',
      kind: 'source',
      licence: 'CC0-1.0',
      derivedFrom: 'https://example.invalid/batching'
    })
  }

  async collect () {
    // Comfortably more triples than the pipeline's batch size, in one plugin.
    const parameters = Array.from({ length: 300 }, (unused, i) => ({
      symbol: `param_${i}`,
      name: `Param ${i}`,
      minimum: 0,
      maximum: 1
    }))
    return [{
      name: 'Batch Boundary',
      vendor: 'Test',
      registryId: 'test/batch-boundary',
      description: 'A plugin with more ports than fit in one INSERT DATA.',
      formats: [`${NAMESPACES.trn}VST3`],
      roles: [`${NAMESPACES.trn}AudioEffect`],
      parameters
    }]
  }
}

describe('writing a plugin larger than one batch', () => {
  const graph = 'graph:source/test-batching'

  it('never splits a blank node across two requests', async () => {
    const pipeline = new IngestPipeline(client)
    try {
      const report = await pipeline.run(new OneBigPluginHarvester())
      expect(report.pluginCount).toBe(1)
      expect(report.tripleCount).toBeGreaterThan(500)

      const rows = await client.select(
        `SELECT (COUNT(*) AS ?n) WHERE { GRAPH ${iri(graph)} {
           ?plugin <${NAMESPACES.lv2}port> ?port .
           FILTER NOT EXISTS { ?port <${NAMESPACES.lv2}symbol> ?symbol }
         } }`
      )
      expect(Number(rows[0].n)).toBe(0)

      const validation = await validator.validateGraph(client, graph)
      expect(summarise(validation)).toBe('conforms')
    } finally {
      await client.update(`DROP SILENT GRAPH ${iri(graph)}`)
      await registry.drop('source', 'test-batching')
    }
  }, 120000)
})
