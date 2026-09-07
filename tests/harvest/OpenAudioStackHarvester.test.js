import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import OpenAudioStackHarvester, { FORMAT_MAP, TAG_CATEGORY_MAP } from '../../src/harvest/OpenAudioStackHarvester.js'
import { HarvestError } from '../../src/harvest/Harvester.js'
import { serialisePlugin } from '../../src/harvest/PluginSerialiser.js'
import { composeText } from '../../src/embeddings/EmbeddingService.js'
import URIMinter from '../../src/rdf/URIMinter.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

const trn = NAMESPACES.trn
const pu = NAMESPACES.pu

const FIXTURE = path.resolve('tests/fixtures/oas-registry.json')
// The real registry, as cached by the last ingest. Present on a machine that
// has run one; the fixture covers the shapes the live data does not contain.
const CACHE = path.resolve('data/cache/open-audio-stack-plugins.json')

describe('OpenAudioStackHarvester', () => {
  let result
  beforeAll(async () => {
    result = await new OpenAudioStackHarvester({ registryPath: FIXTURE }).harvest()
  })

  it('needs somewhere to read the registry from', () => {
    expect(() => new OpenAudioStackHarvester({})).toThrow(HarvestError)
  })

  it('declares CC0, which is what makes this source worth having', () => {
    const harvester = new OpenAudioStackHarvester({ registryPath: FIXTURE })
    expect(harvester.licence).toBe('CC0-1.0')
    expect(harvester.kind).toBe('source')
  })

  it('reports a package it cannot resolve rather than dropping or throwing', () => {
    expect(result.plugins).toHaveLength(2)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].name).toBe('broken/dangling-version')
    expect(result.rejected[0].reason).toMatch(/does not contain/)
  })

  it('describes the version the registry points at, not an older one', () => {
    const glue = result.plugins.find(p => p.name === 'Glue Comp')
    expect(glue.packages[0].version).toBe('2.1.0')
    expect(glue.description).toContain('glueing a mix together')
    expect(glue.licence).toBe('GPL-3.0')
  })

  it('maps only unambiguous payloads to plugin formats', () => {
    const glue = result.plugins.find(p => p.name === 'Glue Comp')
    expect(glue.formats.sort()).toEqual([`${trn}CLAP`, `${trn}LV2`, `${trn}VST3`].sort())
    // "so" and "exe" are very probably a VST2 and a standalone, but "probably"
    // is not a fact — they are kept verbatim for the profiler to settle.
    expect(glue.artefacts).toEqual(['exe', 'so'])
    expect(FORMAT_MAP.so).toBeUndefined()
    expect(FORMAT_MAP.dll).toBeUndefined()
  })

  it('keeps every tag, and derives categories from the ones it knows', () => {
    const glue = result.plugins.find(p => p.name === 'Glue Comp')
    expect(glue.tags).toEqual(['compressor', 'dynamics', 'juce', 'mix bus'])
    expect(glue.categories).toContain('compressor')
    expect(glue.categories).toContain('dynamics')
    expect(glue.categories).toContain('effect')
    // An unmapped tag produces no category but is not lost.
    expect(TAG_CATEGORY_MAP['mix bus']).toBeUndefined()
    expect(glue.tags).toContain('mix bus')
  })

  it('derives roles and categories from the package type', () => {
    const forge = result.plugins.find(p => p.name === 'Wave Forge')
    expect(forge.roles).toContain(`${trn}AudioInstrument`)
    expect(forge.categories).toContain('instrument')
    expect(forge.categories).toContain('synth')
    expect(forge.categories).toContain('granular')
  })

  it('keeps a licence it cannot map rather than guessing or dropping it', () => {
    const forge = result.plugins.find(p => p.name === 'Wave Forge')
    expect(forge.licence).toBe('some-bespoke-licence')
  })

  it('carries checksummed files with their platform and architecture', () => {
    const glue = result.plugins.find(p => p.name === 'Glue Comp')
    const [linux, win] = glue.packages[0].files
    expect(linux.sha256).toHaveLength(64)
    expect(linux.systems).toEqual(['linux'])
    expect(linux.architectures).toEqual(['x64'])
    expect(linux.attested).toBe(true)
    expect(win.kind).toBe('installer')
    expect(win.attested).toBe(false)
  })

  it('links to the registry entry with seeAlso, never sameAs', () => {
    const harvester = new OpenAudioStackHarvester({
      registryUrl: 'https://example.invalid/registry/plugins/index.json'
    })
    expect(harvester.registryEntryUrl('acme/glue'))
      .toBe('https://example.invalid/registry/plugins/acme/glue/index.json')
  })

  it('serialises the packaging layer into the graph', () => {
    const glue = result.plugins.find(p => p.name === 'Glue Comp')
    const iri = new URIMinter().mintPlugin(glue)
    const triples = serialisePlugin(glue, iri)
    const joined = triples.join('\n')

    expect(joined).toContain(`<${pu}slug> "acme-audio/glue-comp"`)
    expect(joined).toContain(`<${pu}Package>`)
    expect(joined).toContain('aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888')
    expect(joined).toContain(`<${pu}operatingSystem> "linux"`)
    expect(joined).toContain(`<${pu}tag> "mix bus"`)
    // A registry entry describes the plugin; it is not the plugin.
    expect(joined).not.toContain('owl#sameAs')
  })

  it('mints a stable IRI from the registry slug alone', () => {
    const minter = new URIMinter()
    const glue = result.plugins.find(p => p.name === 'Glue Comp')
    const first = minter.mintPlugin(glue)
    // The display name beside the slug is editorial and changes; the IRI must
    // not move when it does.
    const renamed = minter.mintPlugin({ ...glue, vendor: 'Acme Audio Ltd' })
    expect(renamed).toBe(first)
    expect(first).toMatch(/^http:\/\/purl\.org\/stuff\/plugin-universe\/plugin\/glue-comp-[0-9a-f]{8}$/)
  })

  it('composes retrieval text a person could read', () => {
    const glue = result.plugins.find(p => p.name === 'Glue Comp')
    const text = composeText(glue)
    expect(text).toContain('Glue Comp')
    expect(text).toContain('AudioEffect')
    expect(text).toContain('compressor')
    // The two defects this replaced: raw IRIs and stringified port objects.
    expect(text).not.toContain('http://')
    expect(text).not.toContain('[object Object]')
  })
})

describe.skipIf(!fs.existsSync(CACHE))('OpenAudioStackHarvester against the real registry', () => {
  let result
  beforeAll(async () => {
    result = await new OpenAudioStackHarvester({ registryPath: CACHE }).harvest()
  })

  it('reads the whole registry with nothing rejected', () => {
    expect(result.plugins.length).toBeGreaterThan(500)
    expect(result.rejected).toEqual([])
  })

  it('mints a distinct IRI for every package', () => {
    const minter = new URIMinter()
    const iris = result.plugins.map(p => minter.mintPlugin(p))
    expect(new Set(iris).size).toBe(iris.length)
  })

  it('gives the catalogue the compressors the seed corpus lacked', () => {
    const compressors = result.plugins.filter(p => p.categories.includes('compressor'))
    expect(compressors.length).toBeGreaterThan(10)
  })

  it('names an author for every package and an email address for none', () => {
    expect(result.plugins.every(p => p.vendor)).toBe(true)
    const text = JSON.stringify(result.plugins)
    expect(text).not.toMatch(/"[^"]*@[^"]*\.[a-z]{2,}"/)
  })
})
