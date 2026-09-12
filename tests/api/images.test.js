import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { readFileSync } from 'fs'
import { pluginImage, renderPluginPage, renderSearchPage } from '../../src/api/render.js'
import { pickImage } from '../../src/search/SearchService.js'
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
    expect(query).toContain('foaf:depiction ?anyImage')
    expect(query).toMatch(/GROUP_CONCAT\(DISTINCT \?anyImage[^)]*\) AS \?images/)
  })

  it('looks for a depiction in every graph, not only the plugin\'s own', () => {
    // An image uploaded here lands in the contributor's graph. Scoped to the
    // graph that declares the plugin — which is where every other OPTIONAL in
    // this query lives — it was invisible: the picture would be in the
    // catalogue and on no page.
    const query = fs.readFileSync('sparql/queries/plugin/text-view.sparql', 'utf8')
    const own = query.indexOf('?plugin a trn:PluginProfile')
    const closesOwnGraph = query.indexOf('\n  }', own)
    expect(query.indexOf('foaf:depiction ?anyImage')).toBeGreaterThan(closesOwnGraph)
  })

  it('is carried onto the document the renderer receives', () => {
    const service = fs.readFileSync('src/search/SearchService.js', 'utf8')
    expect(service).toMatch(/image:\s*pickImage\(row\.images/)
  })
})

describe('choosing between two depictions', () => {
  it('prefers the one this site hosts', () => {
    // Somebody uploaded it because the harvested one was missing, wrong or
    // gone — and a local image cannot 404 on a third party's reorganisation,
    // nor make a reader's browser fetch from anywhere else.
    const chosen = pickImage(
      'https://elsewhere.invalid/a.png https://plugin-universe.com/image/abc.png',
      'https://plugin-universe.com')
    expect(chosen).toBe('https://plugin-universe.com/image/abc.png')
  })

  it('takes the harvested one when there is no local one', () => {
    expect(pickImage('https://elsewhere.invalid/a.png', 'https://plugin-universe.com'))
      .toBe('https://elsewhere.invalid/a.png')
  })

  it('is null for a plugin with no picture at all', () => {
    expect(pickImage('', 'https://plugin-universe.com')).toBeNull()
    expect(pickImage(undefined, 'https://plugin-universe.com')).toBeNull()
  })

  it('does not mistake another site\'s path for ours', () => {
    expect(pickImage('https://evil.invalid/image/x.png', 'https://plugin-universe.com'))
      .toBe('https://evil.invalid/image/x.png')
  })
})

/**
 * What the caption under a picture claims.
 *
 * There is one, it has legal content, and until uploads started working there
 * was only ever one kind of image to caption — a hotlinked third-party one. So
 * the text said "not copied here, and its author's", which was true of every
 * image the catalogue had. The first uploaded picture made it false: that one
 * *is* copied here.
 *
 * Two things are being asserted. That each caption is shown for the right kind
 * of image, and — the part that failed — that neither says something untrue of
 * the other.
 */
describe('the caption under a picture', () => {
  const base = {
    iri: 'http://purl.org/stuff/plugin-universe/plugin/x-1', name: 'X', vendor: 'v',
    formats: [], categories: [], roles: [], tags: [], parameters: []
  }
  const local = {
    ...base,
    image: `https://plugin-universe.com/image/${'a'.repeat(64)}.png`,
    imageIsLocal: true
  }
  const remote = { ...base, image: 'https://cdn.example.org/shot.png', imageIsLocal: false }

  it('does not tell a reader a hosted image was not copied here', () => {
    // The bug, exactly. Reported once a picture finally uploaded.
    expect(renderPluginPage(local)).not.toContain('not copied here')
  })

  it('says where a hosted image came from instead', () => {
    const html = renderPluginPage(local)
    expect(html).toContain('served from here')
    // And still does not claim the picture: the contributor terms cover facts
    // and prose, and an image is neither.
    expect(html).toMatch(/its author's/)
  })

  it('keeps the source note, and the host, for one served elsewhere', () => {
    const html = renderPluginPage(remote)
    expect(html).toContain('not copied here')
    expect(html).toContain('cdn.example.org')
  })

  it('never shows both captions', () => {
    for (const doc of [local, remote]) {
      const html = renderPluginPage(doc)
      const captions = (html.match(/<figcaption>/g) ?? []).length
      expect(captions, doc.image).toBe(1)
    }
  })

  it('shows no caption when there is no picture', () => {
    expect(renderPluginPage(base)).not.toContain('<figcaption>')
  })

  it('treats a missing imageIsLocal as not local, which is the safe claim', () => {
    // A document built before the flag existed must not be captioned as hosted
    // here — saying "we copied this" of something we did not is the worse error.
    const older = { ...base, image: 'https://cdn.example.org/shot.png' }
    expect(renderPluginPage(older)).toContain('not copied here')
  })
})

/**
 * Scaling, not cropping.
 *
 * `object-fit: cover` inside a forced square threw away the left and right of
 * every screenshot — which for a mixer strip, a rack or an EQ curve is where
 * the picture is. The full-size image also declared itself square in HTML,
 * so the browser reserved a square box before the bytes arrived.
 */
describe('how a picture is fitted', () => {
  const css = readFileSync('templates/site.css', 'utf8')

  it('contains the whole image rather than covering the box', () => {
    const shot = css.slice(css.indexOf('.shot {'), css.indexOf('.shot-thumb'))
    expect(shot).toContain('object-fit:contain')
    expect(shot).not.toContain('object-fit:cover')
  })

  it('lets the full-size image keep its own shape', () => {
    const full = css.slice(css.indexOf('.shot-full'), css.indexOf('.shot-figure'))
    // A forced 1:1 is what a wide screenshot was being squeezed into.
    expect(full).not.toContain('aspect-ratio')
    // Capped height, so a tall picture cannot push the profile off the page.
    expect(full).toContain('max-height')
  })

  it('declares dimensions for the thumbnail and not for the full image', () => {
    const doc = {
      iri: 'http://purl.org/stuff/plugin-universe/plugin/x-1', name: 'X',
      image: `https://plugin-universe.com/image/${'a'.repeat(64)}.png`
    }
    // True, and it stops the result row reflowing as thumbnails arrive.
    expect(pluginImage(doc, { size: 'thumb' })).toMatch(/width="72" height="72"/)
    // Not true of an image whose shape is unknown, so it is not claimed.
    expect(pluginImage(doc, { size: 'full' })).not.toMatch(/width=/)
  })
})
