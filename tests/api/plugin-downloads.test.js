import { describe, it, expect } from 'vitest'
import { renderPluginPage } from '../../src/api/render.js'
import { pluginJsonLd, pluginTurtle } from '../../src/api/serialise.js'
import { parseTurtle } from '../../src/harvest/TurtleReader.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * Downloads on the plugin page and in its machine representations.
 *
 * The harvesters have written `pu:downloadUrl` per package file since Phase 1
 * and only the registry index read it back. The page shows one link per file
 * beside the Platforms row; the JSON-LD and Turtle carry the same URLs for
 * machines; a plugin whose sources published no asset shows nothing rather
 * than a repository link dressed up as a download.
 */

const DOC = {
  iri: 'http://purl.org/stuff/plugin-universe/plugin/drift-88b3b09d',
  name: 'Drift',
  vendor: 'danja',
  vendorSlug: 'danja',
  description: 'Four-lane transport-synchronised MIDI CC modulator.',
  formats: ['VST3'],
  categories: ['midi'],
  roles: [],
  tags: [],
  parameters: [],
  platforms: ['Windows', 'MacOS'],
  homepage: 'https://example.invalid/drift/'
}

const DOWNLOADS = [
  { url: 'https://example.invalid/drift-1.0-win.zip', systems: ['win'] },
  { url: 'https://example.invalid/drift-1.0-mac.dmg', systems: ['mac'] },
  { url: 'https://example.invalid/drift-1.0-src.tar.gz', systems: [] }
]

describe('the Downloads row', () => {
  it('links each file the sources published, labelled by system', () => {
    const page = renderPluginPage({ ...DOC, downloads: DOWNLOADS })
    expect(page).toContain('Downloads')
    for (const file of DOWNLOADS) expect(page).toContain(file.url)
    expect(page).toContain('Download for Windows')
    expect(page).toContain('Download for MacOS')
    expect(page).toContain('>Download</a>')
  })

  it('shows nothing where the sources published no asset', () => {
    expect(renderPluginPage(DOC)).not.toContain('Downloads')
    expect(renderPluginPage({ ...DOC, downloads: [] })).not.toContain('Downloads')
  })

  it('escapes a URL rather than trusting it', () => {
    const page = renderPluginPage({
      ...DOC,
      downloads: [{ url: 'https://example.invalid/a?x=1&y=2', systems: [] }]
    })
    expect(page).toContain('https://example.invalid/a?x=1&amp;y=2')
  })
})

describe('downloads for machines', () => {
  it('sets schema.org downloadUrl in the JSON-LD', () => {
    const single = pluginJsonLd({ ...DOC, downloads: [DOWNLOADS[0]] })
    expect(single.downloadUrl).toBe(DOWNLOADS[0].url)
    const many = pluginJsonLd({ ...DOC, downloads: DOWNLOADS })
    expect(many.downloadUrl).toEqual(DOWNLOADS.map(file => file.url))
    expect('downloadUrl' in pluginJsonLd(DOC)).toBe(false)
  })

  it('writes one schema:downloadUrl line per file in Turtle', async () => {
    const ttl = pluginTurtle({ ...DOC, downloads: DOWNLOADS })
    for (const file of DOWNLOADS) expect(ttl).toContain(`schema:downloadUrl <${file.url}>`)
    const dataset = await parseTurtle(ttl)
    const found = [...dataset].filter(
      quad => quad.predicate.value === `${NAMESPACES.schema}downloadUrl`)
    expect(found.map(quad => quad.object.value).sort())
      .toEqual(DOWNLOADS.map(file => file.url).sort())
  })

  it('writes no download lines where there is nothing to point at', () => {
    expect(pluginTurtle(DOC)).not.toContain('downloadUrl')
  })
})
