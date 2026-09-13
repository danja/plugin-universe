import { describe, it, expect } from 'vitest'
import {
  renderLandingPage, renderSearchPage, renderBrowsePage, renderPluginPage,
  renderCategoryPage, renderVendorPage, renderVendorsPage, renderDocPage,
  renderVocabularies
} from '../../src/api/render.js'
import { PAGES } from '../../src/api/pages.js'
import Config from '../../src/Config.js'

/**
 * What a link to this site looks like when somebody posts it.
 *
 * Until now: the URL, and whatever the scraper could guess. No Open Graph, no
 * Twitter card, no canonical — so a plugin page shared anywhere was a bare
 * link, which is the difference between somebody clicking and not.
 *
 * These assert the *presence and shape* of the metadata rather than its
 * wording. A description is an editorial matter; a description that is missing,
 * or an `og:image` that is a relative path a scraper cannot resolve, is a
 * defect, and both are the kind that nobody notices from inside the site.
 */

const ORIGIN = Config.load().get('site.origin').replace(/\/$/, '')

const DOC = {
  iri: 'http://purl.org/stuff/plugin-universe/plugin/example-1234abcd',
  name: 'Example',
  vendor: 'A Vendor',
  description: 'A plugin that does a thing.',
  formats: ['VST3'], categories: ['reverb'], roles: [], tags: [],
  parameters: [], accepts: [], produces: [], requires: [], sameAs: [], cautions: null
}

const EMPTY = { facets: {}, results: [], total: 0, corpus: 645, facetValues: {} }

/** Every page type that renders a full document. */
const PAGE_TYPES = {
  landing: () => renderLandingPage({ ...EMPTY, results: [] }),
  search: () => renderSearchPage({ ...EMPTY, query: 'reverb' }),
  browse: () => renderBrowsePage({ ...EMPTY, offset: 0, limit: 20 }),
  plugin: () => renderPluginPage(DOC),
  category: () => renderCategoryPage('reverb', [DOC], 1),
  vendor: () => renderVendorPage({
    slug: 'a-vendor', name: 'A Vendor', spellings: ['A Vendor'], count: 1, results: [DOC]
  }),
  vendors: () => renderVendorsPage([{ slug: 'a-vendor', name: 'A Vendor', count: 1 }]),
  vocabularies: () => renderVocabularies({ pu: { description: 'Terms.', file: 'x.ttl' } }, {}),
  prose: () => renderDocPage({
    title: 'About', description: 'What this is.', html: '<p>Words.</p>', route: '/about'
  })
}

const tag = (html, property) =>
  (html.match(new RegExp(`(?:property|name)="${property}" content="([^"]*)"`)) ?? [])[1]

describe('every page carries a card', () => {
  it.each(Object.keys(PAGE_TYPES))('%s has the tags a scraper reads', name => {
    const html = PAGE_TYPES[name]()
    expect(tag(html, 'og:site_name'), `${name}: no og:site_name`).toBe('Plugin Universe')
    expect(tag(html, 'og:title'), `${name}: no og:title`).toBeTruthy()
    expect(tag(html, 'og:description'), `${name}: no og:description`).toBeTruthy()
    expect(tag(html, 'og:image'), `${name}: no og:image`).toBeTruthy()
    expect(tag(html, 'twitter:card'), `${name}: no twitter:card`).toBe('summary_large_image')
  })

  it.each(Object.keys(PAGE_TYPES))('%s gives og:image an absolute URL', name => {
    // A scraper has no base to resolve a relative one against; it simply shows
    // no picture, silently, on somebody else's timeline.
    const image = tag(PAGE_TYPES[name](), 'og:image')
    expect(image.startsWith('https://') || image.startsWith('http://'), image).toBe(true)
  })

  it('does not repeat the site name inside the card title', () => {
    // The document title is "Shifty — Plugin Universe" because a browser tab
    // needs the context. A card already shows the site name above the title, so
    // using it unchanged reads "Plugin Universe / Shifty — Plugin Universe".
    expect(tag(renderPluginPage(DOC), 'og:title')).toBe('Example')
    expect(renderPluginPage(DOC)).toContain('<title>Example — Plugin Universe</title>')
  })

  it('uses the plugin\'s own picture when this site stores it', () => {
    const stored = `${ORIGIN}/image/${'a'.repeat(64)}.png`
    const html = renderPluginPage({ ...DOC, image: stored, imageIsLocal: true })
    expect(tag(html, 'og:image')).toBe(stored)
    expect(tag(html, 'og:image:alt')).toBe('Example')
  })

  it('does not offer a hotlinked picture to a scraper', () => {
    // Somebody else's server, which may refuse a scraper or serve something
    // else entirely. The site card is the honest fallback.
    const html = renderPluginPage({ ...DOC, image: 'https://example.invalid/x.png', imageIsLocal: false })
    expect(tag(html, 'og:image')).toBe(`${ORIGIN}/og-image.png`)
  })
})

describe('canonical addresses', () => {
  const canonical = html => (html.match(/<link rel="canonical" href="([^"]*)"/) ?? [])[1]

  it('names itself on a page with a stable address', () => {
    expect(canonical(PAGE_TYPES.landing())).toBe(`${ORIGIN}/`)
    expect(canonical(PAGE_TYPES.plugin())).toBe(`${ORIGIN}/plugin/example-1234abcd`)
    expect(canonical(PAGE_TYPES.vendor())).toBe(`${ORIGIN}/vendor/a-vendor`)
    expect(canonical(PAGE_TYPES.category())).toBe(`${ORIGIN}/category/reverb`)
    expect(canonical(PAGE_TYPES.prose())).toBe(`${ORIGIN}/about`)
  })

  it('says nothing on a search, because a query is not a document', () => {
    // Pointing every variant of a search at itself tells a crawler nothing and
    // invites it to index a combinatorial number of near-identical pages.
    expect(canonical(PAGE_TYPES.search())).toBeUndefined()
  })

  it('canonicalises only the first page of a listing', () => {
    // Page four is not the same document as page one, and saying so would ask
    // a crawler to drop it.
    expect(canonical(renderBrowsePage({ ...EMPTY, offset: 0, limit: 20 }))).toBe(`${ORIGIN}/plugins`)
    expect(canonical(renderBrowsePage({ ...EMPTY, offset: 60, limit: 20 }))).toBeUndefined()
  })

  it('matches og:url wherever it gives one', () => {
    for (const name of Object.keys(PAGE_TYPES)) {
      const html = PAGE_TYPES[name]()
      const url = tag(html, 'og:url')
      if (url === undefined) continue
      expect(url, `${name}: og:url and rel=canonical disagree`).toBe(canonical(html))
    }
  })
})

describe('the prose pages describe themselves', () => {
  // Every one of these is a page somebody may land on from a search engine or
  // a shared link, and a missing description is a blank card.
  it.each(Object.entries(PAGES))('%s has a title and a description', (route, page) => {
    expect(page.title, `${route} has no title`).toBeTruthy()
    expect(page.description, `${route} has no description`).toBeTruthy()
    expect(page.description.length, `${route}'s description is too short to be one`)
      .toBeGreaterThan(30)
  })

  it('declares a language other than English where the page is not English', () => {
    // A screen reader given Italian prose in a document declared English reads
    // it with English phonetics.
    expect(PAGES['/leggere-prima'].lang).toBe('it')
    const html = renderDocPage({ ...PAGES['/leggere-prima'], html: '<p>Ciao.</p>' })
    expect(html).toContain('<html lang="it">')
  })
})
