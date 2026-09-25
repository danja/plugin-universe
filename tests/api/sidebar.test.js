import { describe, it, expect } from 'vitest'
import { sidebar } from '../../src/api/page-shell.js'

/**
 * The sidebar's links carry the listing's current selection.
 *
 * Reported by a reader: choosing Audio Unit and then Reverb from the sidebar
 * threw the format away, because every link was a fresh URL naming one facet.
 * The search form could combine them and had no second page, so "every reverb I
 * can load in Logic" was reachable by no route at all.
 */

const FACETS = {
  format: [{ value: 'VST3', count: 300 }, { value: 'AU', count: 120 }],
  category: [{ value: 'reverb', count: 40 }, { value: 'delay', count: 30 }]
}

const hrefs = html => [...html.matchAll(/href="([^"]*)"/g)].map(match => match[1].replaceAll('&amp;', '&'))

describe('sidebar', () => {
  it('starts afresh where there is no listing to carry', () => {
    const links = hrefs(sidebar(FACETS, 500))
    expect(links).toContain('/plugins?format=AU')
    expect(links).toContain('/category/reverb')
  })

  it('adds a category to a chosen format', () => {
    const links = hrefs(sidebar(FACETS, 500, { query: null, facets: { format: 'AU' } }))
    expect(links).toContain('/plugins?format=AU&category=reverb')
  })

  it('adds a format to a category page', () => {
    const links = hrefs(sidebar(FACETS, 500, { query: null, facets: { category: 'reverb' } }))
    expect(links).toContain('/plugins?category=reverb&format=AU')
  })

  it('keeps the query, and stays on search, when there is one', () => {
    const links = hrefs(sidebar(FACETS, 500, { query: 'plate', facets: { format: 'AU' } }))
    expect(links).toContain('/search?q=plate&format=AU&category=reverb')
  })

  it('turns the chosen value into the link that removes it', () => {
    const html = sidebar(FACETS, 500, { query: null, facets: { format: 'AU', category: 'reverb' } })
    expect(html).toMatch(/href="\/category\/reverb" aria-current="true"[^>]*>AU/)
    expect(html).toMatch(/href="\/plugins\?format=AU" aria-current="true"[^>]*>reverb/)
    expect(html.match(/aria-current/g)).toHaveLength(2)
  })

  it('shows a chosen category that is not among the largest, so it can be removed', () => {
    const many = {
      ...FACETS,
      category: Array.from({ length: 40 }, (_, i) => ({ value: `c${i}`, count: 100 - i }))
    }
    const html = sidebar(many, 500, { query: null, facets: { category: 'c39' } })
    expect(html).toMatch(/aria-current="true"[^>]*>c39/)
  })
})
