import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { negotiate, prefersPage, FACET_NAMES, facetsFrom } from '../../src/api/server.js'
import {
  renderLandingPage, renderSearchPage, renderBrowsePage, pager,
  renderSubmitPage, renderModerationPage
} from '../../src/api/render.js'
import { SUBMITTABLE, PLUGIN_FORMATS } from '../../src/contrib/Submissions.js'

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

/**
 * Submitting a plugin, and reviewing what was submitted.
 *
 * The form is built from `SUBMITTABLE` rather than written out, so the inputs,
 * the validator and the triples a submission becomes cannot drift apart. These
 * assert that binding, and the two things about the page that are not about
 * layout: that a refusal hands back what was typed, and that a duplicate is
 * linked rather than only refused.
 */
describe('the submit form', () => {
  const render = extra => renderSubmitPage(SUBMITTABLE, { csrfToken: 'tok', ...extra })

  it('has an input for every submittable field, and no others', () => {
    const html = render({})
    for (const name of Object.keys(SUBMITTABLE)) {
      expect(html, `no input for ${name}`).toContain(`name="${name}"`)
    }
    const inputs = [...html.matchAll(/<input[^>]*name="([a-zA-Z]+)"/g)].map(m => m[1])
      .filter(name => name !== 'csrf')
    expect(new Set(inputs)).toEqual(new Set(Object.keys(SUBMITTABLE)))
  })

  it('offers every format as a checkbox, because a plugin is built for several', () => {
    const html = render({})
    const form = html.slice(html.indexOf('<form method="post" action="/submit"'))
    for (const format of PLUGIN_FORMATS) {
      expect(form, `no checkbox for ${format}`).toContain(`value="${format}"`)
    }
    // Counted inside the form: the browse panel's own toggle is a checkbox too.
    expect((form.match(/type="checkbox"/g) ?? []).length).toBe(PLUGIN_FORMATS.length)
  })

  it('refuses to render a required group with nothing to tick', () => {
    // An unfillable form looks like it should work, which is worse than an
    // error. The options travel on the field so this cannot happen by
    // forgetting to pass them, and this proves the guard rather than the
    // plumbing.
    expect(() => renderSubmitPage(
      { format: { ...SUBMITTABLE.format, choices: [] } }, { csrfToken: 'tok' }
    )).toThrow(/no choices to offer/)
  })

  it('ticks back the formats that were chosen when it refuses', () => {
    const html = render({
      error: 'Homepage is needed.',
      values: { format: ['VST3', 'CLAP'] }
    })
    expect(html).toMatch(/value="VST3" checked/)
    expect(html).toMatch(/value="CLAP" checked/)
    expect(html).not.toMatch(/value="LV2" checked/)
  })

  it('carries the way back into the catalogue', () => {
    // Somebody who has just been told their plugin is already here wants a
    // route onwards, not a dead end.
    const html = render({ facetValues: { format: [{ value: 'VST3', count: 9 }] }, corpus: 645 })
    expect(html).toContain('class="side"')
    expect(html).toContain('class="site-links"')
    expect(html).not.toContain('<footer>')
  })

  it('marks the required fields required, in the markup as well as the label', () => {
    const html = render({})
    for (const [name, spec] of Object.entries(SUBMITTABLE)) {
      // A checkbox group cannot use the attribute — on a checkbox `required`
      // means *that* box must be ticked, not that one of them must be. "At
      // least one" is enforced by the validator, which is tested separately.
      if (!spec.required || spec.multiple) continue
      const field = html.slice(html.indexOf(`name="${name}"`))
      expect(field.slice(0, 80), `${name} is not marked required`).toContain('required')
    }
  })

  it('shows the help text the error messages quote', () => {
    // Same string in both places: the help beside the homepage field explains
    // why it is required, and the error repeats it when it is missing.
    expect(render({})).toContain(SUBMITTABLE.homepage.help)
  })

  it('hands back what was typed when it refuses', () => {
    // A form that empties itself when it refuses is a form people fill in once.
    const html = render({ error: 'Format is needed.', values: { name: 'Moka', vendor: 'danja' } })
    expect(html).toContain('value="Moka"')
    expect(html).toContain('value="danja"')
    expect(html).toContain('Format is needed.')
  })

  it('links the plugin a duplicate turned out to be', () => {
    const html = render({
      error: 'The catalogue already has this plugin.',
      submitted: { text: 'It is already in the catalogue:', href: '/plugin/moka-1234', linkText: 'see the entry' }
    })
    expect(html).toContain('href="/plugin/moka-1234"')
  })

  it('carries the CSRF token, because it is a POST that writes', () => {
    expect(render({})).toContain('name="csrf"')
    expect(render({})).toContain('value="tok"')
  })

  it('says where contributed facts go, on the page that collects them', () => {
    expect(render({})).toContain('href="/terms"')
  })
})

describe('the moderation queue', () => {
  const submission = {
    submission: 'http://x/correction/s1',
    plugin: 'http://purl.org/stuff/plugin-universe/plugin/moka-1234',
    by: 'http://x/person/danja',
    at: '2026-09-11T12:00:00Z',
    fields: { name: 'Moka', vendor: 'danja', format: 'VST3', homepage: 'https://example.com/moka' }
  }

  it('holds corrections and proposed plugins in one queue', () => {
    const html = renderModerationPage([], { csrfToken: 'tok', submissions: [submission] })
    expect(html).toContain('New plugin: Moka')
    expect(html).toContain('1 proposed plugin')
  })

  it('counts both kinds together, because that is the size of the job', () => {
    const correction = {
      correction: 'http://x/c1', subject: 'http://purl.org/stuff/plugin-universe/plugin/x-1',
      predicate: 'http://www.w3.org/2000/01/rdf-schema#label', value: 'New name',
      by: 'http://x/person/a', at: '2026-09-11T11:00:00Z', rationale: null
    }
    const html = renderModerationPage([correction], { csrfToken: 'tok', submissions: [submission] })
    expect(html).toContain('1 correction and 1 proposed plugin')
  })

  it('says so plainly when there is nothing to do', () => {
    expect(renderModerationPage([], { csrfToken: 'tok', submissions: [] })).toContain('Nothing')
  })

  it('shows enough to decide on a plugin that has no page yet', () => {
    // There is nothing to click through to — it is not in the catalogue — so
    // the summary has to carry the decision.
    const html = renderModerationPage([], { csrfToken: 'tok', submissions: [submission] })
    expect(html).toContain('danja')
    expect(html).toContain('VST3')
    expect(html).toContain('https://example.com/moka')
  })

  it('names which thing a decision is about, so one queue can hold two kinds', () => {
    const html = renderModerationPage([], { csrfToken: 'tok', submissions: [submission] })
    expect(html).toContain('name="submission"')
    expect(html).toContain('value="http://x/correction/s1"')
  })
})
