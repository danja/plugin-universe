import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry, { GraphError, LICENCES } from '../../src/store/GraphRegistry.js'
import { insertDataQuery, iri, literal } from '../../src/store/SPARQLHelper.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

// Per project policy these tests run against the live endpoint in
// config/config.json. They are not mocked: a store layer that only works
// against a fake is not known to work.

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
const TEST_METADATA_GRAPH = `${NAMESPACES.pu}test/graphs`
const registry = new GraphRegistry(client, { metadataGraph: TEST_METADATA_GRAPH })

async function cleanup () {
  await client.update(`DROP SILENT GRAPH ${iri(TEST_METADATA_GRAPH)}`)
  for (const g of ['graph:source/test-cc0', 'graph:source/test-mit', 'graph:user/test-user']) {
    await client.update(`DROP SILENT GRAPH ${iri(g)}`)
  }
}

beforeAll(async () => {
  const reachable = await client.isReachable()
  if (!reachable) {
    throw new Error(
      `SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable. ` +
      'These tests require a live store; start it with "npm run store:up".'
    )
  }
  await cleanup()
})

afterAll(cleanup)

describe('graph IRI construction', () => {
  it('derives the IRI from kind and id rather than accepting one', () => {
    expect(GraphRegistry.graphIri('source', 'downspout')).toBe('graph:source/downspout')
    expect(GraphRegistry.graphIri('profiler', 'run-2026-09-06')).toBe('graph:profiler/run-2026-09-06')
  })

  it('rejects an unknown kind', () => {
    expect(() => GraphRegistry.graphIri('rubbish', 'x')).toThrow(GraphError)
  })

  it('rejects an id that would produce a malformed IRI', () => {
    expect(() => GraphRegistry.graphIri('source', 'Down Spout')).toThrow(GraphError)
  })

  it('orders precedence so measurement beats discovery beats user', () => {
    expect(GraphRegistry.precedenceOf('profiler')).toBeGreaterThan(GraphRegistry.precedenceOf('discovery'))
    expect(GraphRegistry.precedenceOf('discovery')).toBeGreaterThan(GraphRegistry.precedenceOf('user'))
  })
})

describe('licence flags', () => {
  it('refuses to register a graph without a licence', async () => {
    await expect(
      registry.register({ kind: 'source', id: 'test-cc0', derivedFrom: 'https://example.org' })
    ).rejects.toThrow(GraphError)
  })

  it('refuses an unrecognised licence rather than storing it', async () => {
    await expect(
      registry.register({ kind: 'source', id: 'test-cc0', licence: 'WTFPL', derivedFrom: 'https://example.org' })
    ).rejects.toThrow(GraphError)
  })

  it('refuses to register without recording where the data came from', async () => {
    await expect(
      registry.register({ kind: 'source', id: 'test-cc0', licence: 'CC0-1.0' })
    ).rejects.toThrow(GraphError)
  })

  it('marks CC0 data as dumpable and MIT data as redistributable-with-notice', () => {
    expect(LICENCES['CC0-1.0']).toEqual({ redistributable: true, cc0Dump: true, notice: false })
    expect(LICENCES.MIT.redistributable).toBe(true)
    expect(LICENCES.MIT.cc0Dump).toBe(false)
    expect(LICENCES['proprietary-linkout'].redistributable).toBe(false)
  })
})

describe('registration against the live store', () => {
  it('registers a graph and reads its provenance back', async () => {
    const graph = await registry.register({
      kind: 'source',
      id: 'test-cc0',
      licence: 'CC0-1.0',
      derivedFrom: 'https://github.com/open-audio-stack/open-audio-stack-registry',
      runId: 'test-run-1'
    })
    expect(graph).toBe('graph:source/test-cc0')
    expect(await registry.isRegistered('source', 'test-cc0')).toBe(true)

    const rows = await registry.list()
    const row = rows.find(r => r.graph === graph)
    expect(row).toBeDefined()
    expect(row.licence).toBe('CC0-1.0')
    expect(row.inCC0Dump).toBe('true')
  })

  it('re-registering updates rather than accumulating', async () => {
    await registry.register({
      kind: 'source', id: 'test-cc0', licence: 'CC0-1.0', derivedFrom: 'https://example.org/v2'
    })
    const rows = (await registry.list()).filter(r => r.graph === 'graph:source/test-cc0')
    expect(rows).toHaveLength(1)
  })

  it('assembles the CC0 dump set as one query, excluding non-CC0 graphs', async () => {
    await registry.register({
      kind: 'source', id: 'test-mit', licence: 'MIT', derivedFrom: 'https://github.com/studiorack/studiorack-registry'
    })
    await registry.register({
      kind: 'user', id: 'test-user', licence: 'CC-BY-SA-4.0', derivedFrom: 'https://plugin-universe.com/user/1'
    })

    const dumpable = await registry.cc0DumpGraphs()
    expect(dumpable).toContain('graph:source/test-cc0')
    expect(dumpable).not.toContain('graph:source/test-mit')
    expect(dumpable).not.toContain('graph:user/test-user')
  })
})

describe('re-harvest is a graph swap', () => {
  it('drops a source graph without touching another', async () => {
    const a = GraphRegistry.graphIri('source', 'test-cc0')
    const b = GraphRegistry.graphIri('source', 'test-mit')
    const triple = `${iri('http://example.org/thing')} ${iri(NAMESPACES.rdfs + 'label')} ${literal('kept')} .`
    await client.update(insertDataQuery(a, [triple]))
    await client.update(insertDataQuery(b, [triple]))

    await client.update(`DROP SILENT GRAPH ${iri(a)}`)

    expect(await client.ask(`ASK { GRAPH ${iri(a)} { ?s ?p ?o } }`)).toBe(false)
    expect(await client.ask(`ASK { GRAPH ${iri(b)} { ?s ?p ?o } }`)).toBe(true)
  })
})
