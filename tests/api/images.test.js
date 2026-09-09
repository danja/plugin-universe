import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { pluginImage, renderPluginPage, renderSearchPage } from '../../src/api/render.js'
import { pluginJsonLd, pluginTurtle } from '../../src/api/serialise.js'

/**
 * Plugin images.
 *
 * `foaf:depiction` was harvested for 560 of 645 plugins from the day the Open
 * Audio Stack harvester landed, and for as long it was displayed nowhere. That
 * is MISTAKES.md pattern 3 — data harvested but never shown, therefore never
 * verified — and the reason these assertions exist is that nothing else would
 * have noticed if the field stopped arriving.
 *
 * The images are hotlinked from the source rather than copied here, so most of
 * what follows is about not making that anyone else's problem.
 */

const DOC = {
  iri: 'http://purl.org/stuff/plugin-universe/plugin/example-1234abcd',
  name: 'Example Reverb',
  vendor: 'Example Audio',
  description: 'A plate reverb.',
  image: 'https://open-audio-stack.github.io/open-audio-stack-registry/plugins/x/x/x.jpg',
  formats: ['VST3'],
  categories: ['reverb'],
  roles: [],
  tags: [],
  parameters: []
}

describe('the image element', () => {
  const html = pluginImage(DOC)

  it('renders the depiction the source published', () => {
    expect(html).toContain(DOC.image)
    expect(html).toMatch(/^<img /)
  })

  it('refuses a plain-http image, which a browser blocks as mixed content', () => {
    // Silently: no error, no image, and nothing in any log to say why.
    expect(pluginImage({ ...DOC, image: 'http://example.invalid/x.jpg' })).toBe('')
  })

  it('refuses anything that is not a URL', () => {
    for (const bad of ['', null, undefined, 'not a url', 'javascript:alert(1)']) {
      expect(pluginImage({ ...DOC, image: bad })).toBe('')
    }
  })

  it('does not tell the image host which plugin was being read', () => {
    // Without this the referer header hands a third party the reader's browsing
    // history across the catalogue, one plugin page at a time.
    expect(html).toContain('referrerpolicy="no-referrer"')
  })

  it('is lazy and dimensioned, so a page of results is not 25 blocking requests', () => {
    expect(html).toContain('loading="lazy"')
    expect(html).toMatch(/width="\d+"/)
    expect(html).toMatch(/height="\d+"/)
  })

  it('names the plugin in alt text', () => {
    expect(html).toContain(`alt="${DOC.name}"`)
  })

  it('escapes a name that would otherwise close the attribute', () => {
    const nasty = pluginImage({ ...DOC, name: '" onerror="alert(1)' })
    expect(nasty).not.toContain('onerror="alert(1)"')
  })
})

describe('where the image appears', () => {
  it('is in a search result', () => {
    const page = renderSearchPage({
      query: 'reverb', facets: {}, results: [{ ...DOC, score: 0.9 }], total: 1, corpus: 645, facetValues: {}
    })
    expect(page).toContain(DOC.image)
    expect(page).toContain('shot-thumb')
  })

  it('is on the plugin page, larger', () => {
    const page = renderPluginPage(DOC)
    expect(page).toContain('shot-full')
  })

  it('says on the plugin page that the image is served by the source', () => {
    // Hotlinking without saying so reads as re-publication, which it is not.
    const page = renderPluginPage(DOC)
    expect(page).toMatch(/served by the source/)
    expect(page).toContain('open-audio-stack.github.io')
  })

  it('never shows the image without the attribution, or the reverse', () => {
    // They lived in different blocks once, and one of them rendered only when
    // there was provenance to show.
    const page = renderPluginPage(DOC)
    expect(page.includes('shot-full')).toBe(page.includes('served by the source'))
    const without = renderPluginPage({ ...DOC, image: null })
    expect(without).not.toMatch(/served by the source/)
  })

  it('leaves no gap for a plugin that has no image', () => {
    const page = renderPluginPage({ ...DOC, image: null })
    expect(page).not.toContain('<img')
    expect(page).toContain('Example Reverb')
  })
})

describe('the image reaches the machine-readable views too', () => {
  it('appears in the JSON-LD as schema:image', () => {
    expect(pluginJsonLd(DOC).image).toBe(DOC.image)
    expect(pluginJsonLd({ ...DOC, image: null }).image).toBeUndefined()
  })

  it('appears in the Turtle as foaf:depiction', () => {
    expect(pluginTurtle(DOC)).toContain(`foaf:depiction <${DOC.image}>`)
  })
})

describe('the field survives the whole path', () => {
  it('is selected by the query the documents are loaded from', () => {
    // The other half of pattern 3: the renderer can only show what the query
    // asked for, and nothing else connects these two files.
    const query = fs.readFileSync('sparql/queries/plugin/text-view.sparql', 'utf8')
    expect(query).toContain('foaf:depiction ?image')
    expect(query).toMatch(/SELECT[^\n]*\?image/)
    expect(query, 'an aggregated query must group by every non-aggregated variable')
      .toMatch(/GROUP BY[^\n]*\?image/)
  })

  it('is carried onto the document the renderer receives', () => {
    const service = fs.readFileSync('src/search/SearchService.js', 'utf8')
    expect(service).toMatch(/image:\s*row\.image/)
  })
})
