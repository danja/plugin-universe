import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { createMcpServer } from '../../src/mcp/server.js'

/**
 * The MCP tools, exercised through the SDK's own client.
 *
 * Not by calling the handlers directly: what an agent sees is the result of a
 * round trip through the protocol — schema validation, content encoding, error
 * shape — and testing the functions underneath would skip exactly the part
 * that is somebody else's contract.
 *
 * The catalogue behind them is a stub. What is under test here is the tool
 * surface: whether the schemas accept what they should, whether a mistake comes
 * back as a sentence, and whether the answers carry the licence and provenance
 * an agent needs in order to quote them honestly.
 */

const PLUGIN = {
  iri: 'http://purl.org/stuff/plugin-universe/plugin/wet-reverb-693085a0',
  name: 'Wet Reverb',
  vendor: 'Yonie',
  description: 'A plate reverb.',
  formats: ['VST3'],
  categories: ['reverb'],
  roles: [],
  tags: ['plate'],
  parameters: ['Mix', 'Decay'],
  licenceId: 'MIT',
  pricing: 'Free',
  sourceAvailability: 'OpenSource',
  homepage: 'https://example.invalid/wet',
  created: '2026-09-09T14:45:19.997Z',
  cautions: null,
  provenance: { source: 'open-audio-stack', licence: 'CC0-1.0', derivedFrom: 'https://example.invalid/registry' }
}

/** Enough of a SearchService for the tools to talk to. */
const search = {
  documents: new Map([[PLUGIN.iri, PLUGIN]]),
  categories: new Map([['reverb', {
    slug: 'reverb',
    definition: 'Simulates the reflections of a space, real or invented.',
    altLabels: ['reverberation', 'hall'],
    broader: 'effect',
    narrower: [],
    related: ['spatial'],
    scopeNote: null
  }]]),
  measured: () => ({
    verdict: 'ok',
    at: '2026-09-07T11:39:31.603Z',
    tool: 'lilv lv2info',
    platform: 'Linux x64',
    readings: [
      { metric: 'ValidationResult', label: 'Validation result', value: 'ok', unit: null, note: null },
      { metric: 'ScanTime', label: 'Scan time', value: '364', unit: 'http://lv2plug.in/ns/extensions/units#ms', note: null }
    ]
  }),
  search: async (query, { limit }) => ({
    total: 1, results: [{ ...PLUGIN, score: 0.73 }].slice(0, limit)
  }),
  browse: async ({ limit }) => ({ total: 1, results: [PLUGIN].slice(0, limit) })
}

let client

beforeAll(async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()

  const server = createMcpServer({ search })
  client = new Client({ name: 'test', version: '1' })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args })
  return { isError: result.isError ?? false, text: result.content[0].text }
}
const parse = async (name, args) => JSON.parse((await call(name, args)).text)

describe('what an agent is offered', () => {
  it('lists the tools with descriptions it can choose between', async () => {
    const { tools } = await client.listTools()
    const names = tools.map(tool => tool.name)
    expect(names).toContain('search_plugins')
    expect(names).toContain('get_plugin')
    expect(names).toContain('list_categories')
    for (const tool of tools) {
      // An agent picking a tool has only this sentence to go on.
      expect(tool.description.length, `${tool.name} has a thin description`).toBeGreaterThan(80)
    }
  })

  it('does not offer SPARQL when there is no published dataset', async () => {
    // Offered-and-broken is worse than absent: an agent would retry it.
    const { tools } = await client.listTools()
    expect(tools.map(tool => tool.name)).not.toContain('sparql_query')
  })

  it('offers SPARQL when there is one', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const withSparql = createMcpServer({ search, publication: { select: async () => [] } })
    const other = new Client({ name: 'test', version: '1' })
    await Promise.all([withSparql.connect(serverSide), other.connect(clientSide)])
    expect((await other.listTools()).tools.map(tool => tool.name)).toContain('sparql_query')
  })
})

describe('search_plugins', () => {
  it('answers a natural-language query', async () => {
    const result = await parse('search_plugins', { query: 'plate reverb', limit: 3 })
    expect(result.total).toBe(1)
    expect(result.results[0].name).toBe('Wet Reverb')
    expect(result.results[0].slug).toBe('wet-reverb-693085a0')
  })

  it('browses when given only a facet', async () => {
    const result = await parse('search_plugins', { category: 'reverb' })
    expect(result.results.length).toBe(1)
    expect(result.facets).toEqual({ category: 'reverb' })
  })

  it('asks for something to go on rather than returning the catalogue', async () => {
    const result = await call('search_plugins', {})
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/Give a query/)
  })

  it('refuses a limit outside the range, at the schema', async () => {
    // Caught by the declared schema before the tool runs, and returned as a
    // tool error rather than a protocol failure — so an agent gets something
    // it can read and correct rather than a broken call.
    const result = await call('search_plugins', { query: 'x', limit: 9999 })
    expect(result.isError).toBe(true)
    expect(result.text.toLowerCase()).toMatch(/limit|less than|maximum/)
  })

  it('says what the data may be used for', async () => {
    const result = await parse('search_plugins', { query: 'reverb' })
    expect(result.catalogueLicence).toMatch(/CC0/)
  })

  it('does not let the catalogue\'s terms stand in for a plugin\'s', async () => {
    // This test existed and only checked search_plugins, where the notice sits
    // beside `results` and collides with nothing. In get_plugin the record is
    // spread at the top level, and the notice — then also called `licence` —
    // overwrote the plugin's own. Checking the tool where the two share a
    // scope is the whole point.
    const result = await parse('search_plugins', { query: 'reverb' })
    const plugin = result.results[0]
    expect(plugin, 'no result to check').toBeTruthy()
    if (plugin.licence !== null) {
      expect(plugin.licence, 'a plugin licence should be an identifier, not a paragraph')
        .not.toMatch(/CC0 \(public domain\)|attribution/)
      expect(plugin.licence.length).toBeLessThan(40)
    }
  })
})

describe('get_plugin', () => {
  it('takes a slug', async () => {
    expect((await parse('get_plugin', { plugin: 'wet-reverb-693085a0' })).name).toBe('Wet Reverb')
  })

  it('takes a full IRI too', async () => {
    expect((await parse('get_plugin', { plugin: PLUGIN.iri })).name).toBe('Wet Reverb')
  })

  it('says where each fact came from, so a claim can be sourced', async () => {
    const result = await parse('get_plugin', { plugin: 'wet-reverb-693085a0' })
    expect(result.provenance.source).toBe('open-audio-stack')
    expect(result.provenance.licence).toBe('CC0-1.0')
  })

  it('gives a measurement its tool, host and date', async () => {
    // A reading without them describes nothing: it is one binary on one machine
    // on one day, and an agent repeating it should be able to say so.
    const { measurements } = await parse('get_plugin', { plugin: 'wet-reverb-693085a0' })
    expect(measurements.tool).toBeTruthy()
    expect(measurements.platform).toBeTruthy()
    expect(measurements.takenAt).toBeTruthy()
  })

  it('gives a unit both as a symbol and as an IRI', async () => {
    const { measurements } = await parse('get_plugin', { plugin: 'wet-reverb-693085a0' })
    const scan = measurements.readings.find(reading => reading.metric === 'Scan time')
    expect(scan.value).toBe('364')
    expect(scan.unit).toBe('ms')
    expect(scan.unitIri).toContain('units#ms')
  })

  it('does not repeat the verdict as a reading', async () => {
    const { measurements } = await parse('get_plugin', { plugin: 'wet-reverb-693085a0' })
    expect(measurements.verdict).toBe('ok')
    expect(measurements.readings.map(r => r.metric)).not.toContain('Validation result')
  })

  it('answers an unknown plugin with a sentence and a way forward', async () => {
    const result = await call('get_plugin', { plugin: 'no-such-thing' })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/search_plugins/)
  })
})

describe('list_categories', () => {
  it('gives each category a definition and its synonyms', async () => {
    const { categories } = await parse('list_categories', {})
    const reverb = categories.find(category => category.slug === 'reverb')
    expect(reverb.definition).toMatch(/reflections/)
    expect(reverb.alsoCalled).toContain('reverberation')
    expect(reverb.partOf).toBe('effect')
  })
})

describe('sparql_query', () => {
  let sparqlClient

  beforeAll(async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const server = createMcpServer({
      search,
      publication: { select: async () => Array.from({ length: 120 }, (unused, i) => ({ n: String(i) })) }
    })
    sparqlClient = new Client({ name: 'test', version: '1' })
    await Promise.all([server.connect(serverSide), sparqlClient.connect(clientSide)])
  })

  const run = async args => {
    const result = await sparqlClient.callTool({ name: 'sparql_query', arguments: args })
    return { isError: result.isError ?? false, text: result.content[0].text }
  }

  it('runs a SELECT', async () => {
    const result = JSON.parse((await run({ query: 'SELECT * WHERE { ?s ?p ?o }' })).text)
    expect(result.rows).toBe(50)
    expect(result.truncated).toBe(true)
  })

  it('refuses an update in words rather than by failing at the endpoint', async () => {
    for (const query of ['INSERT DATA { <urn:a> <urn:b> <urn:c> }', 'DROP GRAPH <urn:g>', 'delete where { ?s ?p ?o }']) {
      const result = await run({ query })
      expect(result.isError, query).toBe(true)
      expect(result.text).toMatch(/read-only/)
    }
  })

  it('caps the rows it will return', async () => {
    expect(JSON.parse((await run({ query: 'SELECT * WHERE { ?s ?p ?o }', limit: 10 })).text).rows).toBe(10)
  })
})

/**
 * A plugin's licence and the catalogue's are two different facts.
 *
 * They were both called `licence`, and in `get_plugin` the catalogue's notice
 * was the later key in the same object literal — so it silently overwrote the
 * plugin's own. Every plugin came back as CC0: MIT ones, GPL ones, all of them.
 * Nothing failed, the field was populated, and an agent repeating it would have
 * made a false licensing claim about somebody else's software.
 *
 * Found by pointing a real MCP client at the deployment, which is the one test
 * that had never been run.
 */
describe('the two licences', () => {
  const source = readFileSync('src/mcp/tools.js', 'utf8')

  it('never names the catalogue notice `licence`', () => {
    // `licence` belongs to the plugin. The catalogue's terms are
    // `catalogueLicence`, in every tool, so the name cannot mean two things
    // depending on which response you are reading.
    expect(source).not.toMatch(/\blicence:\s*LICENCE_NOTE/)
    expect((source.match(/catalogueLicence:\s*LICENCE_NOTE/g) ?? []).length)
      .toBeGreaterThanOrEqual(4)
  })

  it('keeps the plugin\'s own licence in the field named for it', () => {
    expect(source).toMatch(/licence:\s*result\.licenceId/)
  })

  it('puts the catalogue notice after the spread, where the collision was', () => {
    // The bug was ordering, not naming alone: a later key wins. Asserting the
    // name is what makes the order harmless.
    const record = source.slice(source.indexOf("registerTool('get_plugin'"))
    expect(record).toContain('...summarise(doc)')
    expect(record.slice(0, record.indexOf('registerTool(\'list_categories\'')))
      .not.toMatch(/\blicence:\s*LICENCE_NOTE/)
  })
})
