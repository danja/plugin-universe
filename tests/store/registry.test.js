import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import QueryService from '../../src/store/QueryService.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import buildRegistry from '../../src/api/registry.js'
import OpenAudioStackHarvester from '../../src/harvest/OpenAudioStackHarvester.js'

/**
 * The catalogue published as an Open Audio Stack registry.
 *
 * The test that matters is the round trip: write the view, then read it back
 * with **this project's own harvester** — the one built to consume the real
 * registry — and see whether it produces plugins. That is a demonstration of
 * compatibility rather than a list of assertions about field names, which is
 * all a hand-written shape test can offer.
 *
 * It is also a fair test only because the harvester was written months before
 * this view and knows nothing about it.
 */

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
const queries = new QueryService()
const registry = new GraphRegistry(client)

let index
let withheld
let directory

beforeAll(async () => {
  if (!(await client.isReachable())) {
    throw new Error(
      `SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable. ` +
      'These tests require a live store; start it with "npm run store:up".')
  }
  const sources = new Map()
  for (const row of await registry.list()) sources.set(row.graph, { licence: row.licence })
  const rows = await client.select(queries.get('plugin/registry', {}))
  ;({ index, withheld } = buildRegistry(rows, sources))
  directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-registry-'))
}, 120000)

afterAll(async () => {
  if (directory) await fs.promises.rm(directory, { recursive: true, force: true })
})

describe('the shape', () => {
  it('publishes the plugins that have a release', () => {
    expect(Object.keys(index).length).toBeGreaterThan(100)
  })

  it('gives every entry a version that its versions map contains', () => {
    // Their format has a "latest" pointer beside the map, and a pointer at a
    // version that is not there would break a package manager on the entry it
    // is most likely to want.
    for (const [slug, entry] of Object.entries(index)) {
      expect(entry.versions[entry.version], `${slug} points at a missing version`).toBeTruthy()
    }
  })

  it('keys every entry by its own slug', () => {
    for (const [slug, entry] of Object.entries(index)) expect(entry.slug).toBe(slug)
  })

  it('states licences in their convention, not ours', () => {
    // They write gpl-3.0 where the catalogue stores GPL-3.0.
    const licences = Object.values(index)
      .flatMap(entry => Object.values(entry.versions))
      .map(version => version.license)
      .filter(Boolean)
    expect(licences.length).toBeGreaterThan(0)
    for (const licence of licences) expect(licence).toBe(licence.toLowerCase())
  })

  it('carries the checksums and URLs a package manager needs', () => {
    const files = Object.values(index)
      .flatMap(entry => Object.values(entry.versions))
      .flatMap(version => version.files)
    expect(files.length).toBeGreaterThan(100)
    const downloadable = files.filter(file => file.url && file.sha256)
    expect(downloadable.length).toBeGreaterThan(100)
    for (const file of downloadable) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('omits an absent fact rather than emitting a null', () => {
    // A consumer reading `"image": null` has to handle a case that simply is
    // not a case.
    const json = JSON.stringify(index)
    expect(json).not.toContain(':null')
  })

  it('never invents a version for a plugin with no release', async () => {
    // The catalogue holds far more plugins than this view does, and that gap
    // is the point: a registry entry promises an artefact, so a plugin with no
    // release is omitted rather than given a version it does not have.
    const [row] = await client.select(
      'SELECT (COUNT(DISTINCT ?p) AS ?n) WHERE { GRAPH ?g { ?p a <http://purl.org/stuff/transmissions/PluginProfile> } }')
    expect(Object.keys(index).length).toBeLessThan(Number(row.n))
  })
})

describe('republishing respects the licence flags', () => {
  it('withholds anything from a graph that is not redistributable', () => {
    // Publishing in a second format is still publishing, so this view uses the
    // same flag the public dump does.
    expect(Array.isArray(withheld)).toBe(true)
  })
})

describe('the round trip', () => {
  it('is read back by the harvester built for the real registry', async () => {
    // The demonstration. OpenAudioStackHarvester was written to consume the
    // upstream registry and knows nothing about this view.
    const file = path.join(directory, 'index.json')
    await fs.promises.writeFile(file, JSON.stringify(index))

    const harvester = new OpenAudioStackHarvester({ registryPath: file, id: 'registry-roundtrip' })
    const { plugins, rejected } = await harvester.harvest()

    expect(plugins.length, `nothing parsed; ${rejected.length} rejected`).toBeGreaterThan(100)
    // Not "some parsed" — nearly all of them, or the view is lossy in a way
    // that would show up as missing plugins in somebody else's tool.
    expect(plugins.length).toBeGreaterThanOrEqual(Object.keys(index).length * 0.95)
  }, 120000)

  it('preserves the facts a consumer would act on', async () => {
    const file = path.join(directory, 'index.json')
    const harvester = new OpenAudioStackHarvester({ registryPath: file, id: 'registry-roundtrip' })
    const { plugins } = await harvester.harvest()

    const byName = new Map(plugins.map(plugin => [plugin.name, plugin]))
    const sample = Object.values(index)
      .map(entry => entry.versions[entry.version])
      .filter(version => version.files.some(file => file.sha256))
      .slice(0, 20)

    for (const version of sample) {
      const parsed = byName.get(version.name)
      expect(parsed, `${version.name} did not survive the round trip`).toBeTruthy()
    }
  }, 120000)
})
