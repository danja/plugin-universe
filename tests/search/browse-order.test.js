import { describe, it, expect } from 'vitest'
import { byName, byRecency } from '../../src/search/SearchService.js'
import { pager } from '../../src/api/render.js'
import { pageOffset } from '../../src/api/server.js'

/**
 * The front-page listing: what order, and which page.
 *
 * Ordering by "recently added" needed a date the catalogue did not have. The
 * one it has now is `dcterms:created`, meaning first seen *here* — no source
 * states a release date the others agree with — written by the ingest pipeline
 * and preserved across the DROP-and-reload of a re-harvest.
 */

const doc = (name, created = null) => ({ name, created })

describe('ordering', () => {
  it('puts the most recent first', () => {
    const docs = [
      doc('Old', '2026-01-01T00:00:00.000Z'),
      doc('New', '2026-09-01T00:00:00.000Z'),
      doc('Middle', '2026-05-01T00:00:00.000Z')
    ].sort(byRecency)
    expect(docs.map(d => d.name)).toEqual(['New', 'Middle', 'Old'])
  })

  it('sorts an undated plugin last, not first', () => {
    // The trap: an absent date is not "now". Every plugin harvested before the
    // catalogue recorded dates has none, and treating those as new would put
    // the entire existing corpus at the top of a list headed "recently added".
    const docs = [doc('Undated'), doc('Dated', '2026-01-01T00:00:00.000Z')].sort(byRecency)
    expect(docs.map(d => d.name)).toEqual(['Dated', 'Undated'])
  })

  it('breaks a tie by name, so the order is stable between requests', () => {
    const same = '2026-09-01T00:00:00.000Z'
    const docs = [doc('Zeta', same), doc('Alpha', same)].sort(byRecency)
    expect(docs.map(d => d.name)).toEqual(['Alpha', 'Zeta'])
  })

  it('orders undated plugins among themselves by name', () => {
    expect([doc('Zeta'), doc('Alpha')].sort(byRecency).map(d => d.name)).toEqual(['Alpha', 'Zeta'])
  })

  it('still sorts by name when that is what was asked for', () => {
    expect([doc('Zeta'), doc('Alpha')].sort(byName).map(d => d.name)).toEqual(['Alpha', 'Zeta'])
  })
})

describe('the offset in a URL', () => {
  const from = value => pageOffset(new URLSearchParams(value === null ? '' : `from=${value}`))

  it('reads a page offset', () => {
    expect(from(20)).toBe(20)
  })

  it('treats anything that is not a non-negative number as page one', () => {
    for (const bad of ['-5', 'abc', '', 'NaN', 'Infinity']) expect(from(bad)).toBe(0)
    expect(from(null)).toBe(0)
  })

  it('floors a fraction rather than passing it to slice', () => {
    expect(from('3.7')).toBe(3)
  })

  it('caps an absurd offset', () => {
    // `?from=1e99` reached Array.slice as 1e99 and the pager reported "page
    // 1e98 of 65". The service clamps to the last page; this stops the number
    // being unreasonable before it gets there.
    expect(from('1e99')).toBe(100000)
  })
})

describe('the pager', () => {
  it('is absent when everything fits on one page', () => {
    expect(pager({ total: 8, offset: 0, limit: 10 })).toBe('')
  })

  it('offers no previous link on the first page', () => {
    const html = pager({ total: 100, offset: 0, limit: 10 })
    expect(html).not.toContain('rel="prev"')
    expect(html).toContain('rel="next"')
  })

  it('offers no next link on the last page', () => {
    const html = pager({ total: 100, offset: 90, limit: 10 })
    expect(html).toContain('rel="prev"')
    expect(html).not.toContain('rel="next"')
  })

  it('counts pages from one', () => {
    expect(pager({ total: 645, offset: 10, limit: 10 })).toContain('page 2 of 65')
  })

  it('carries the facets forward, so paging does not silently drop the filter', () => {
    const html = pager({ total: 100, offset: 0, limit: 10, params: { format: 'VST3', category: null } })
    expect(html).toContain('format=VST3')
    // A facet nobody chose must not appear as an empty parameter.
    expect(html).not.toContain('category=')
  })

  it('links the first page without a from parameter', () => {
    // `/?from=0` and `/` are the same page and should not be two URLs.
    expect(pager({ total: 100, offset: 10, limit: 10 })).toContain('href="/"')
  })
})
