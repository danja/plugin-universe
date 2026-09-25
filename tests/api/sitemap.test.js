import { describe, it, expect } from 'vitest'
import { buildSitemap } from '../../src/api/sitemap.js'

/**
 * The sitemap: every address a crawler should walk.
 *
 * `/`, `/plugins` and its pages, the category pages and the plugin pages —
 * the list TODO.md decided, with `/search` staying out. Pure, so it is tested
 * without a store: the route only gathers what is already in memory and hands
 * it here. The live half — that the route answers at all — is a line in
 * `tests/store/server-starts.test.js`, because a route is not reachable until
 * a real request has reached it.
 */

const ORIGIN = 'https://plugin-universe.com'
const plugins = [
  { slug: 'wet-reverb-693085a0', created: '2026-09-09T14:45:19.997Z' },
  { slug: 'drift-88b3b09d', created: null }
]

describe('what the sitemap lists', () => {
  it('names the front page, the browse list, the categories and the plugins', () => {
    const xml = buildSitemap({ origin: ORIGIN, plugins, categories: ['reverb'], pageSize: 10 })
    for (const loc of [
      `${ORIGIN}/`,
      `${ORIGIN}/plugins`,
      `${ORIGIN}/category/reverb`,
      `${ORIGIN}/plugin/wet-reverb-693085a0`,
      `${ORIGIN}/plugin/drift-88b3b09d`
    ]) {
      expect(xml).toContain(`<loc>${loc}</loc>`)
    }
  })

  it('pages the browse list past page one', () => {
    // Twelve plugins at ten a page: /plugins, then ?from=10 only. A ?from=
    // past the end clamps rather than 404ing, so exactly the pages that hold
    // plugins and no further.
    const many = Array.from({ length: 12 }, (unused, i) => ({ slug: `p-${i}` }))
    const xml = buildSitemap({ origin: ORIGIN, plugins: many, categories: [], pageSize: 10 })
    expect(xml).toContain(`<loc>${ORIGIN}/plugins?from=10</loc>`)
    expect(xml).not.toContain('?from=20')
    expect(buildSitemap({ origin: ORIGIN, plugins: many.slice(0, 10), categories: [], pageSize: 10 }))
      .not.toContain('?from=')
  })

  it('keeps /search out', () => {
    const xml = buildSitemap({ origin: ORIGIN, plugins, categories: ['reverb'], pageSize: 10 })
    expect(xml).not.toContain('/search')
    expect(xml).not.toContain('?q=')
  })

  it('dates a plugin by when it was first seen, and undated ones not at all', () => {
    const xml = buildSitemap({ origin: ORIGIN, plugins, categories: [], pageSize: 10 })
    expect(xml).toContain('<lastmod>2026-09-09</lastmod>')
    const drift = xml.split('\n').find(line => line.includes('drift-88b3b09d'))
    expect(drift).not.toContain('lastmod')
  })

  it('is a well-formed urlset document', () => {
    const xml = buildSitemap({ origin: ORIGIN, plugins, categories: [], pageSize: 1 })
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true)
    expect(xml).toContain(`${ORIGIN}/plugins?from=1`)
  })
})

describe('what it refuses', () => {
  it('needs the origin: relative URLs are not sitemap URLs', () => {
    expect(() => buildSitemap({ origin: '', plugins })).toThrow(/origin/)
  })
})
