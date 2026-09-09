import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import IngestPipeline from '../../src/harvest/IngestPipeline.js'
import { Harvester } from '../../src/harvest/Harvester.js'
import { iri } from '../../src/store/SPARQLHelper.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * `dcterms:created` — when a plugin was first seen by this catalogue.
 *
 * The property that matters is not that it gets written, it is that it
 * **survives a re-harvest**. Re-harvesting is a DROP and reload of a source
 * graph, so a date written by the previous run is destroyed unless it is read
 * before the drop and carried across. A date that resets on every run makes
 * "recently added" a list of whatever was harvested last, which is the exact
 * opposite of what the front page claims to show.
 *
 * Against the live store, because the thing under test is what survives a
 * DROP, and nothing that stands in for a store can tell you that.
 */

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
const registry = new GraphRegistry(client)
const GRAPH = 'graph:source/test-first-seen'
const dcterms = NAMESPACES.dcterms

class ListHarvester extends Harvester {
  constructor (names) {
    super({
      id: 'test-first-seen',
      kind: 'source',
      licence: 'CC0-1.0',
      derivedFrom: 'https://example.invalid/first-seen'
    })
    this.names = names
  }

  async collect () {
    return this.names.map(name => ({
      name,
      vendor: 'Test',
      registryId: `test/${name.toLowerCase()}`,
      description: `A plugin called ${name}.`,
      formats: [`${NAMESPACES.trn}VST3`],
      roles: [`${NAMESPACES.trn}AudioEffect`],
      parameters: []
    }))
  }
}

/** First-seen dates in the test graph, keyed by plugin label. */
async function dates () {
  const rows = await client.select(`
    SELECT ?label ?created WHERE {
      GRAPH ${iri(GRAPH)} {
        ?plugin ${iri(NAMESPACES.rdfs + 'label')} ?label ;
                ${iri(dcterms + 'created')} ?created .
      }
    }`)
  return Object.fromEntries(rows.map(row => [row.label, row.created]))
}

async function cleanup () {
  await client.update(`DROP SILENT GRAPH ${iri(GRAPH)}`)
  await registry.drop('source', 'test-first-seen').catch(() => {})
}

beforeAll(async () => {
  if (!(await client.isReachable())) {
    throw new Error(
      `SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable. ` +
      'These tests require a live store; start it with "npm run store:up".'
    )
  }
  await cleanup()
}, 30000)

afterAll(cleanup)

describe('first-seen dates across a re-harvest', () => {
  let firstRun

  it('dates a plugin the catalogue has not seen before', async () => {
    const pipeline = new IngestPipeline(client)
    await pipeline.run(new ListHarvester(['Alpha', 'Beta']))
    firstRun = await dates()

    expect(Object.keys(firstRun).sort()).toEqual(['Alpha', 'Beta'])
    for (const created of Object.values(firstRun)) {
      expect(new Date(created).getTime()).not.toBeNaN()
    }
  }, 120000)

  it('keeps the original date when the same plugin is harvested again', async () => {
    // The whole point. The graph is dropped between these two runs.
    const pipeline = new IngestPipeline(client)
    await pipeline.run(new ListHarvester(['Alpha', 'Beta']))
    const secondRun = await dates()
    expect(secondRun.Alpha).toBe(firstRun.Alpha)
    expect(secondRun.Beta).toBe(firstRun.Beta)
  }, 120000)

  it('dates a plugin that appears for the first time in a later run', async () => {
    const pipeline = new IngestPipeline(client)
    await pipeline.run(new ListHarvester(['Alpha', 'Beta', 'Gamma']))
    const thirdRun = await dates()

    expect(thirdRun.Alpha).toBe(firstRun.Alpha)
    expect(thirdRun.Gamma).toBeDefined()
    expect(new Date(thirdRun.Gamma).getTime())
      .toBeGreaterThanOrEqual(new Date(firstRun.Alpha).getTime())
  }, 120000)

  it('writes exactly one date per plugin', async () => {
    // Two would mean a run added a date beside the old one rather than
    // carrying it, which the shapes also refuse.
    const rows = await client.select(`
      SELECT ?plugin (COUNT(?created) AS ?n) WHERE {
        GRAPH ${iri(GRAPH)} { ?plugin ${iri(dcterms + 'created')} ?created }
      } GROUP BY ?plugin`)
    expect(rows.map(row => Number(row.n))).toEqual(rows.map(() => 1))
    expect(rows.length).toBe(3)
  }, 60000)
})
