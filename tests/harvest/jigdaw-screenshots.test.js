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
 * The rule being pinned here is the one that actually broke, twice, and both
 * were upstream in jigdaw rather than here:
 *
 * - A render that "succeeds" — exit status 0, no error, no complaint — and
 *   writes no file. `/home/danny/github/jigdaw` is the same directory as
 *   `/chalet/github/jigdaw` under two names, and jigdaw's `bin/jig.js` decided
 *   it had been invoked by comparing `process.argv[1]` with its resolved
 *   `import.meta.url`. Through the other name the comparison failed, `main()`
 *   never ran, and the process exited 0 having done nothing at all. Fixed
 *   upstream 2026-10-02 by comparing resolved paths; `jigCommand()` still
 *   realpaths, so a checkout reached by a symlink works either way.
 * - A panel with no dials drawn. `bin/jig.js shot` inlined only the page's own
 *   `<style>` block and never `web/panel.css`, where the panel rules live, so
 *   it photographed an unstyled page and exited 0 having written a valid PNG of
 *   it. This file worked around that by injecting a `<link>` into the generated
 *   page; upstream fixed it on 2026-10-02 and the workaround is gone, with the
 *   size assertion below left in place because it is what would notice.
 */

const JIGDAW = process.env.JIGDAW_PATH ?? '/home/danny/github/jigdaw'
const ORIGIN = 'https://plugin-universe.com'
const haveJigdaw = fs.existsSync(JIGDAW)
const directory = path.join(os.tmpdir(), 'pu-jigdaw-screenshots-test')

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

  it('finds a shipped screenshot for every plugin the harvest sees', () => {
    // The render path is a fallback, and it was one for five plugins until
    // 2026-10-02. If this starts failing because a new plugin has no picture
    // yet, that is upstream's `node bin/build-gallery.js` not having run, not a
    // reason to go back to rendering what upstream already ships.
    const names = fs.readdirSync(path.join(JIGDAW, 'plugins'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(
        path.join(JIGDAW, 'plugins', entry.name, 'profile.ttl')
      ))
      .map(entry => entry.name)
    expect(names.length).toBeGreaterThan(0)
    const without = names.filter(name => shots.shippedPath(name) === null)
    expect(without, 'plugins upstream ships no screenshot for').toEqual([])
  })

  it('renders a panel from a checkout that ships no picture for it', async () => {
    if (!shots.canRender) return
    // A small checkout holding one plugin, with its screenshot removed, so the
    // fallback is exercised without depending on which plugin upstream has
    // caught up and without copying a whole repository to do it. `node_modules`
    // is symlinked rather than copied because `bin/jig.js` imports linkedom,
    // and a fixture that cannot resolve its own imports tests nothing.
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-jigdaw-noshot-'))
    try {
      for (const part of ['bin', 'src', 'vocabs']) {
        await fs.promises.cp(path.join(JIGDAW, part), path.join(dir, part), { recursive: true })
      }
      await fs.promises.mkdir(path.join(dir, 'web', 'gallery', 'shots'), { recursive: true })
      await fs.promises.copyFile(
        path.join(JIGDAW, 'web', 'index.html'),
        path.join(dir, 'web', 'index.html')
      )
      await fs.promises.copyFile(
        path.join(JIGDAW, 'web', 'panel.css'),
        path.join(dir, 'web', 'panel.css')
      )
      await fs.promises.cp(
        path.join(JIGDAW, 'plugins', 'cascade'),
        path.join(dir, 'plugins', 'cascade'),
        { recursive: true }
      )
      await fs.promises.symlink(
        path.join(JIGDAW, 'node_modules'),
        path.join(dir, 'node_modules'),
        'dir'
      )

      const local = new JigDawScreenshots({
        repoPath: dir,
        cacheDir: path.join(dir, 'shots-cache')
      })
      expect(local.shippedPath('cascade'), 'the fixture still has a shipped shot').toBeNull()

      const { buffer, source } = await local.forPlugin('cascade')
      expect(source).toBe('rendered')
      expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(buffer.length).toBeGreaterThan(1000)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  }, 120000)

  it('reports a render that produced no file instead of returning nothing', async () => {
    // The failure this guards: Chrome exiting 0 having written no image, which
    // the earlier version of this took at face value.
    const broken = new JigDawScreenshots({
      repoPath: JIGDAW,
      chrome: path.join(directory, 'no-such-browser')
    })
    expect(broken.canRender, 'the fixture browser exists, so this tests nothing')
      .toBe(false)
    await expect(broken.render('cascade')).rejects.toThrow(/no Chrome at/)
  }, 60000)

  it('refuses to render when the panel stylesheet is not there', async () => {
    // A panel.css that is missing renders as no stylesheet at all: the
    // screenshot is still a valid PNG, the labels are still readable, and the
    // only symptom is that every dial is invisible and the layout is a single
    // left-hand column. That was what `bin/jig.js shot` produced before
    // 2026-10-02, when its `panelStyle()` inlined only the page's own <style>
    // block and never read the stylesheet that holds the panel rules.
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-jigdaw-bare-'))
    await fs.promises.mkdir(path.join(dir, 'plugins', 'cascade'), { recursive: true })
    await fs.promises.cp(
      path.join(JIGDAW, 'plugins', 'cascade'),
      path.join(dir, 'plugins', 'cascade'),
      { recursive: true }
    )
    try {
      const bare = new JigDawScreenshots({ repoPath: dir })
      await expect(bare.render('cascade')).rejects.toThrow(/panel\.css/)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })

  it('draws a panel with its controls visible, not as bare labels', async () => {
    if (!shots.canRender) return
    // The only assertion in this file that would have caught the unstyled
    // panel, and it works by size rather than by looking: an unstyled panel
    // leaves its SVG dials unpainted, and unpainted SVG compresses to almost
    // nothing. This is why the workaround that injected a `<link>` into
    // jigdaw's own generated page is gone: upstream's `panelStyle()` now
    // inlines `web/panel.css`, so `jig.js shot` produces a styled panel and
    // there is nothing here to compensate for.
    //
    // A byte-count threshold is a proxy, and it is here because the alternative
    // is a human looking at 27 pictures. It fails loudly rather than silently
    // if the panel is redesigned; that is the right way round for a check whose
    // whole purpose is to notice that something stopped being drawn.
    const { buffer } = await shots.render('cascade')
    expect(buffer.length, 'the panel rendered with no stylesheet')
      .toBeGreaterThan(20 * 1024)
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
