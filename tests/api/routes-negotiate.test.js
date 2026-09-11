import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { negotiate, prefersPage, FACET_NAMES, facetsFrom } from '../../src/api/server.js'
import { renderLandingPage, renderSearchPage, renderBrowsePage, pager } from '../../src/api/render.js'

/**
 * One URL per thing, each with its representations.
 *
 * `/` used to be the landing page, the search results and the paged browse list
 * at once, while `/search` and `/plugins` were the JSON representations of the
 * second and third — so one thing had two URLs and two URLs had one thing. The
 * rest of the site had this right all along: a plugin IRI is one address with
 * four representations, chosen from Accept.
 *
 * These assert the shape rather than the wording: that the three pages are
 * three functions, that the facet list is one list, and that a browser and a
 * program asking for the same address get different documents.
 */

const EMPTY = { facets: {}, results: [], total: 0, corpus: 0, facetValues: {} }

describe('the facet list', () => {
  it('is one list, not one per route', () => {
    // It was written out three times, and /plugins had fallen behind: it
    // accepted none of them, so ?category=reverb on the browse list was
    // silently ignored rather than refused.
    expect(FACET_NAMES).toContain('measured')
    expect(FACET_NAMES).toContain('licence')
    expect(FACET_NAMES.length).toBeGreaterThan(6)
  })

  it('reads every one of them off a request, and nothing else', () => {
    const params = new URLSearchParams('category=reverb&q=x&nonsense=1')
    const facets = facetsFrom(params)
    expect(facets.category).toBe('reverb')
    expect(facets.format).toBeNull()
    expect(Object.keys(facets).sort()).toEqual([...FACET_NAMES].sort())
    expect(facets).not.toHaveProperty('q')
    expect(facets).not.toHaveProperty('nonsense')
  })

  it('matches what the search form offers and what /services documents', () => {
    // Three copies of one list: the dropdowns, the prose, and this. A facet
    // added to the code and not to the documentation is one nobody finds.
    const services = readFileSync('docs/services.md', 'utf8')
    for (const name of FACET_NAMES) {
      expect(services, `/services does not mention the ${name} facet`).toContain(name)
    }
  })
})

describe('choosing a representation', () => {
  it('gives a browser a page at an address whose default is JSON', () => {
    expect(prefersPage('text/html,application/xhtml+xml,*/*;q=0.8')).toBe(true)
  })

  it('does not treat a bare */* or a missing header as a request for a page', () => {
    // This is the regression that would have broken every existing caller.
    // negotiate() answers 'html' for both, which is right for a plugin IRI
    // somebody pasted into a browser and wrong for a documented JSON endpoint:
    // curl sends */* and fetch() with no headers sends nothing.
    expect(prefersPage('*/*')).toBe(false)
    expect(prefersPage('')).toBe(false)
    expect(prefersPage(undefined)).toBe(false)
    expect(prefersPage('application/json')).toBe(false)
  })

  it('leaves negotiate() alone, because a plugin IRI has the other default', () => {
    expect(negotiate('', '')).toBe('html')
    expect(negotiate('.json', '')).toBe('json')
    expect(negotiate('', 'text/turtle')).toBe('turtle')
  })
})

describe('the three pages', () => {
  it('the landing page offers the services note and a way to the whole list', () => {
    const html = renderLandingPage({ ...EMPTY, corpus: 752, results: [{ iri: 'x', name: 'A' }] })
    expect(html).toContain('/services')
    expect(html).toContain('href="/plugins"')
    expect(html).toContain('752 plugins indexed')
  })

  it('a search page does not', () => {
    // Somebody who has typed a query is looking for a plugin, not an endpoint,
    // and the complete list is not what they asked for either.
    const html = renderSearchPage({ ...EMPTY, query: 'reverb', total: 3, corpus: 752 })
    expect(html).not.toContain('class="services"')
    expect(html).not.toContain('class="browse-all"')
  })

  it('the browse page pages against /plugins, not against /', () => {
    const html = renderBrowsePage({
      ...EMPTY, results: new Array(10).fill({ iri: 'x', name: 'A' }), total: 100, offset: 10, limit: 10
    })
    expect(html).toContain('/plugins?from=20')
    expect(html).not.toMatch(/href="\/\?from=/)
  })

  it('sends the form to the results page, so a search has an address', () => {
    expect(readFileSync('templates/search.html', 'utf8')).toContain('action="/search"')
  })
})

describe('the pager base', () => {
  it('still defaults to the root, which is what every other caller expects', () => {
    expect(pager({ total: 100, offset: 10, limit: 10 })).toContain('href="/"')
  })

  it('follows the page it is paging', () => {
    expect(pager({ total: 100, offset: 10, limit: 10, base: '/plugins' })).toContain('href="/plugins"')
  })
})

describe('one search, one URL', () => {
  /**
   * A browser submits every <select> in the form, including those left on
   * "any", so the search box emits `?q=reverb&format=&category=&pricing=&source=`.
   * That is what a person copies out of the address bar, and it is a different
   * string from the same search arrived at any other way — the exact
   * duplication this split was meant to remove. The route strips empties and
   * redirects once.
   */
  const tidy = search => new URLSearchParams(
    [...new URLSearchParams(search).entries()].filter(([, value]) => value !== '')
  ).toString()

  it('drops the parameters the form sends empty', () => {
    expect(tidy('q=reverb&format=&category=&pricing=&source=')).toBe('q=reverb')
  })

  it('keeps the ones that were actually chosen', () => {
    expect(tidy('q=reverb&format=VST3&category=')).toBe('q=reverb&format=VST3')
  })

  it('leaves an already-clean query string alone, so there is no second hop', () => {
    expect(tidy('q=reverb')).toBe('q=reverb')
    expect(tidy('q=reverb&format=VST3')).toBe('q=reverb&format=VST3')
  })
})
