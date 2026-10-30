import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { seedPath } from '../../src/harvest/seedPaths.js'
import fs from 'fs'
import os from 'os'
import path from 'path'
import DownspoutHarvester from '../../src/harvest/DownspoutHarvester.js'
import { IMAGE_CONFIG } from '../../config/preferences.js'
import ImageStore from '../../src/api/ImageStore.js'
import { serialisePlugin } from '../../src/harvest/PluginSerialiser.js'

/**
 * The pictures of downspout's plugins.
 *
 * downspout generates them from the real DPF UI into
 * `docs/pages/assets/plugins/<dir>.png`; this harvester stores what is there and
 * depicts the plugin with it. Floors rather than exact counts throughout: the
 * repository grows, and a plugin added before its screenshot is a gap upstream.
 */
const ORIGIN = 'https://plugin-universe.com'
const DOWNSPOUT = seedPath('downspout')

describe.skipIf(!fs.existsSync(DOWNSPOUT))('depictions written by the downspout harvest', () => {
  let store
  let directory
  let result
  let harvester

  beforeAll(async () => {
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-downspout-shots-'))
    store = new ImageStore({ directory, origin: ORIGIN })
    harvester = new DownspoutHarvester({ repoPath: DOWNSPOUT, imageStore: store })
    result = await harvester.harvest()
  })

  afterAll(async () => {
    await fs.promises.rm(directory, { recursive: true, force: true })
  })

  it('depicts most plugins', () => {
    const depicted = result.plugins.filter(plugin => plugin.image)
    expect(depicted.length, 'plugins with a picture').toBeGreaterThanOrEqual(50)
  })

  it('refuses a blank screenshot rather than publishing it', () => {
    // gater.png upstream is 90 bytes: a valid PNG of nothing. Skips when the
    // checkout no longer has one, so a regenerated picture does not fail this.
    const file = path.join(DOWNSPOUT, 'docs', 'pages', 'assets', 'plugins', 'gater.png')
    if (!fs.existsSync(file) || fs.statSync(file).size >= IMAGE_CONFIG.minHarvestedBytes) return
    expect(result.plugins.find(p => p.name === 'Gater').image).toBeNull()
    expect(harvester.notes.some(n => n.startsWith('gater:') && n.includes('blank'))).toBe(true)
  })

  it('names every plugin it left without one', () => {
    const without = result.plugins.filter(plugin => !plugin.image).length
    const noted = harvester.notes.filter(note => note.includes('no screenshot')).length
    expect(noted, 'a missing picture nothing reports').toBeGreaterThanOrEqual(without)
  })

  it('points each depiction at an image this site serves', () => {
    for (const plugin of result.plugins.filter(p => p.image)) {
      expect(store.isStoredUrl(plugin.image), plugin.name).toBe(true)
    }
  })

  it('stores each picture as a file that is really there', async () => {
    // Storing the bytes is not the feature; being fetchable at the IRI written
    // into the graph is.
    for (const plugin of result.plugins.filter(p => p.image)) {
      const name = plugin.image.slice(`${ORIGIN}/image/`.length)
      const { buffer, type } = await store.read(name)
      expect(buffer.length, plugin.name).toBeGreaterThanOrEqual(IMAGE_CONFIG.minHarvestedBytes)
      expect(type, plugin.name).toBe('image/png')
    }
  })

  it('serialises the depiction as foaf:depiction', () => {
    // The write path: the serialiser turns the record's `image` into the triple
    // the query and the page both read.
    const plugin = result.plugins.find(p => p.image)
    const triples = serialisePlugin(plugin, 'http://example.org/plugin/x')
    const depiction = triples.find(t => t.includes('foaf/0.1/depiction'))
    expect(depiction, 'the picture reached no triple').toBeTruthy()
    expect(depiction).toContain(plugin.image)
  })

  it('harvests no pictures, and says nothing about them, without an image store', async () => {
    const plain = new DownspoutHarvester({ repoPath: DOWNSPOUT })
    const bare = await plain.harvest()
    expect(bare.plugins.every(plugin => !plugin.image)).toBe(true)
    expect(plain.notes).toEqual([])
  })
})
