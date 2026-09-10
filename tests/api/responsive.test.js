import { describe, it, expect } from 'vitest'
import { renderSearchPage, renderPluginPage } from '../../src/api/render.js'

/**
 * The narrow-screen layout.
 *
 * A stylesheet is not something a unit test can look at, so these assert the
 * few rules whose *absence* caused a specific reported problem, and nothing
 * about how it looks. Each one is here because it broke:
 *
 *  - the account bar is absolutely positioned in the header's top-right
 *    corner, which was fine when it held one login link and collided with the
 *    title once it held two links and a button
 *  - the correction field carries min-width:16rem, which is 256px and overflows
 *    a 360px viewport once page padding is counted, dragging the whole document
 *    sideways
 *  - 15px body text is a density choice for a wide window
 *
 * Whether it now looks right is a question for a person with a phone.
 */

const DOC = {
  iri: 'http://purl.org/stuff/plugin-universe/plugin/x-1234abcd',
  name: 'Example', vendor: 'Vendor', description: 'A plugin.',
  formats: ['VST3'], categories: ['reverb'], roles: [], tags: [], parameters: []
}

const page = renderSearchPage({
  query: null, facets: {}, results: [], total: 0, corpus: 645, facetValues: {}
})

/** The contents of the narrow-screen media query. */
function narrowBlock (html) {
  const start = html.indexOf('@media (max-width: 48rem)')
  if (start === -1) return null
  let depth = 0
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1)
  }
  return null
}

describe('every page', () => {
  it('tells a phone not to pretend it is a desktop', () => {
    // Without this a phone renders at 980px and scales down, which is the
    // other way a page ends up unreadably small.
    expect(page).toContain('name="viewport"')
    expect(page).toContain('width=device-width')
  })

  it('has a narrow-screen block at all', () => {
    expect(narrowBlock(page), 'no @media (max-width: 48rem) in the stylesheet').toBeTruthy()
  })
})

describe('on a narrow screen', () => {
  const narrow = narrowBlock(page)

  it('takes the account bar out of the header corner', () => {
    // It holds a login, two links and a button now. Absolutely positioned in
    // the corner, it sat on the title.
    expect(narrow).toMatch(/\.account\s*\{[^}]*position:\s*static/)
  })

  it('lets the correction field shrink below its desktop minimum', () => {
    expect(narrow).toMatch(/min-width:\s*0/)
  })

  it('raises the type scale at the root, which is the only place that moves it', () => {
    // Setting body's font-size leaves every rem-sized caption exactly where it
    // was, because rem is relative to the root element. That is what "too
    // small on mobile" turned out to be: corrected paragraphs and 12.8px tags.
    const root = narrow.match(/:root\s*\{[^}]*font-size:\s*([\d.]+)px/)
    expect(root, 'the narrow block does not set :root font-size').toBeTruthy()
    expect(Number(root[1])).toBeGreaterThan(16)
  })

  it('does not leave the small print at desktop proportions', () => {
    // .8rem of anything is not a caption size on a handset.
    const smallest = [...narrow.matchAll(/font-size:\s*([\d.]+)rem/g)].map(match => Number(match[1]))
    expect(smallest.length).toBeGreaterThan(3)
    expect(Math.min(...smallest), 'something is still under .85rem on a phone')
      .toBeGreaterThanOrEqual(0.85)
  })

  it('gives a wide table its own scrollbar rather than the document\'s', () => {
    expect(narrow).toMatch(/table\s*\{[^}]*overflow-x:\s*auto/)
  })

  it('puts the facets two to a row rather than four across', () => {
    // Four dropdowns sharing a line with a text field leaves every one of them
    // too narrow to read its own values.
    expect(narrow).toMatch(/\.facets select\s*\{[^}]*calc\(50%/)
  })
})

describe('what the desktop layout keeps', () => {
  it('still positions the account bar in the corner on a wide screen', () => {
    const wide = page.slice(0, page.indexOf('@media (max-width: 48rem)'))
    expect(wide).toMatch(/\.account\s*\{[^}]*position:absolute/)
  })

  it('renders a plugin page with an image without a fixed width that overflows', () => {
    // A hotlinked image at its natural size is the third way a page scrolls
    // sideways.
    const plugin = renderPluginPage({ ...DOC, image: 'https://example.invalid/a.jpg' })
    expect(plugin).toMatch(/\.shot-full\s*\{[^}]*max-width/)
    expect(plugin).toMatch(/img\s*\{[^}]*max-width:\s*100%|\.shot\b/)
  })
})
