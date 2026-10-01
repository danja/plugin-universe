import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import JigDawHarvester, { JigDawScreenshots } from '../../src/harvest/JigDawHarvester.js'
import ImageStore from '../../src/api/ImageStore.js'
import { HarvestError } from '../../src/harvest/Harvester.js'
import { serialisePlugin } from '../../src/harvest/PluginSerialiser.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * Screenshots of JigDAW panels.
 *
 * The rule being pinned here is the one that actually broke: a render that
 * "succeeds" — exit status 0, no error, no complaint — and writes no file.
 * `/home/danny/github/jigdaw` is a symlink, and jigdaw's own `bin/jig.js`
 * detects that it was invoked by comparing `process.argv[1]` with its resolved
 * `import.meta.url`. Through the symlink the comparison fails, `main()` never
 * runs, and the process exits 0 having done nothing at all. A test asserting
 * only on the exit status would have passed for the whole of that.
 */

const JIGDAW = process.env.JIGDAW_PATH ?? '/home/danny/github/jigdaw'
const ORIGIN = 'https://plugin-universe.com'
const haveJigdaw = fs.existsSync(JIGDAW)

describe.skipIf(!haveJigdaw)('JigDawScreenshots', () => {
  const shots = new JigDawScreenshots({ repoPath: JIGDAW })

  it('uses the screenshot jigdaw already ships, rather than re-rendering it', async () => {
    // Upstream's own picture is the same generator's output at a known size;
    // re-rendering it would only produce a different hash for the same panel
    // and leave an orphan file per plugin in data/cache.
    const { buffer, source } = await shots.forPlugin('cascade')
    expect(source).toBe('shipped')
    // Sniffed rather than trusted from the extension: what is asserted is that
    // these are real PNG bytes, because ImageStore refuses anything else.
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  })

  it('renders a panel that upstream ships no screenshot for', async () => {
    if (!shots.canRender) return
    const name = 'canticle'
    expect(shots.shippedPath(name), `${name} now ships a screenshot; this test is stale`)
      .toBeNull()

    const { buffer, source } = await shots.forPlugin(name, { ports: 12 })
    expect(source).toBe('rendered')
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(buffer.length).toBeGreaterThan(1000)
  }, 60000)

  it('reports a render that produced no file instead of returning nothing', async () => {
    // The failure this guards: jig.js exiting 0 having written no image, which
    // the earlier version of this took at face value.
    const broken = new JigDawScreenshots({
      repoPath: JIGDAW,
      chrome: '/usr/bin/google-chrome'
    })
    broken.jigCommand = () => path.join(JIGDAW, 'bin', 'check-suites.js')
    await expect(broken.render('cascade')).rejects.toThrow(/wrote no file|exited/)
  }, 60000)

  it('says so when there is no browser, rather than failing obscurely later', () => {
    const browserless = new JigDawScreenshots({ repoPath: JIGDAW, chrome: '/nonexistent/chrome' })
    expect(browserless.canRender).toBe(false)
    return expect(browserless.render('cascade')).rejects.toThrow(/CHROME_BIN/)
  })
})

describe.skipIf(!haveJigdaw)('depictions written by the JigDAW harvest', () => {
  let store
  let directory
  let result

  beforeAll(async () => {
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-jigdaw-shots-'))
    store = new ImageStore({ directory, origin: ORIGIN })
    const harvester = new JigDawHarvester({
      repoPath: JIGDAW,
      screenshots: new JigDawScreenshots({ repoPath: JIGDAW, cacheDir: path.join(directory, 'cache') }),
      imageStore: store
    })
    result = await harvester.harvest()
  }, 300000)

  afterAll(async () => {
    await fs.promises.rm(directory, { recursive: true, force: true })
  })

  it('gives every plugin a depiction', () => {
    const without = result.plugins.filter(plugin => !plugin.image).map(plugin => plugin.name)
    expect(without, 'plugins with no picture — run node bin/harvest-jigdaw.js').toEqual([])
  })

  it('points each depiction at an image this site serves', () => {
    // The whole reason the picture goes through ImageStore: documents.js
    // decides a depiction is ours by exactly this prefix, and a URL written by
    // hand would render with a caption saying it is not copied here — which
    // would be false the moment uploads started working.
    for (const plugin of result.plugins) {
      expect(plugin.image, plugin.name).toMatch(new RegExp(`^${ORIGIN}/image/[0-9a-f]{64}\\.png$`))
      expect(store.isStoredUrl(plugin.image), plugin.name).toBe(true)
    }
  })

  it('stores each panel as a file that is really there', async () => {
    // Storing the bytes is not the feature; the picture being fetchable at the
    // IRI written into the graph is. Upload had 22 passing tests and a broken
    // write path for its whole life.
    for (const plugin of result.plugins) {
      const name = plugin.image.slice(`${ORIGIN}/image/`.length)
      const { buffer, type } = await store.read(name)
      expect(buffer.length, plugin.name).toBeGreaterThan(1000)
      expect(type, plugin.name).toBe('image/png')
    }
  })

  it('serialises the depiction as foaf:depiction', () => {
    // The write path, asserted directly: the serialiser is what turns the
    // record's `image` into the triple the query and the page both read.
    const plugin = result.plugins.find(p => p.name === 'Cascade')
    const triples = serialisePlugin(plugin, 'http://example.org/plugin/cascade')
    const depiction = triples.find(t => t.includes('foaf/0.1/depiction'))
    expect(depiction, 'the picture reached no triple').toBeTruthy()
    expect(depiction).toContain(plugin.image)
  })

  it('is idempotent: a second run stores no new file', async () => {
    const before = (await store.list()).length
    const again = await new JigDawHarvester({
      repoPath: JIGDAW,
      screenshots: new JigDawScreenshots({ repoPath: JIGDAW, cacheDir: path.join(directory, 'cache') }),
      imageStore: store
    }).harvest()
    expect((await store.list()).length).toBe(before)
    // Content-addressed, so the same panel is the same IRI — which is what
    // keeps a re-harvest from orphaning a copy of every picture.
    expect(again.plugins.find(p => p.name === 'Cascade').image)
      .toBe(result.plugins.find(p => p.name === 'Cascade').image)
  }, 300000)
})

describe('the harvester without a browser', () => {
  it('harvests no depiction and says nothing about one', async () => {
    // The default. `bin/ingest.js --source jigdaw` must keep working with no
    // Chrome installed, and a plugin with no image is a plugin, not an error.
    const harvester = new JigDawHarvester({ repoPath: JIGDAW })
    const result = await harvester.harvest()
    expect(result.plugins.length).toBeGreaterThan(0)
    expect(result.plugins.every(plugin => plugin.image === null)).toBe(true)
    expect(harvester.notes).toEqual([])
  }, 120000)

  it('refuses screenshots without somewhere to keep them', () => {
    // foaf:depiction takes an IRI, and a panel rendered on this machine's disk
    // has none. Silently dropping the pictures would be worse than refusing.
    expect(() => new JigDawHarvester({
      repoPath: JIGDAW,
      screenshots: new JigDawScreenshots({ repoPath: JIGDAW })
    })).toThrow(HarvestError)
  })
})

describe('NAMESPACES', () => {
  it('still declares what the depiction is written with', () => {
    expect(NAMESPACES.foaf).toBe('http://xmlns.com/foaf/0.1/')
  })
})
