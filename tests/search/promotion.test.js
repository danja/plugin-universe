import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { applyPromotion } from '../../src/search/SearchService.js'
import { isLive, daysRemaining, termEnd } from '../../src/catalogue/Promotions.js'
import { PROMOTION_CONFIG } from '../../config/preferences.js'
import { renderPluginPage, renderSearchPage } from '../../src/api/render.js'
import { PAGES } from '../../src/api/pages.js'

/**
 * Paid placement.
 *
 * These tests are the compliance claim. `docs/architecture.md` §7 commits this
 * project to a specific, bounded ranking effect and to labelling it, and
 * `/about/promotion` publishes the numbers — so every guard below is a promise
 * made to a reader, not an implementation detail. A change that breaks one is a
 * change to a published commitment.
 *
 * The sentence the whole design rests on: **a promoted result may be boosted
 * but never inserted where it does not match the query.**
 */

const result = (iri, name, score) => ({ iri, name, score, signals: {} })
const placement = { endsAt: '2027-09-12T00:00:00.000Z' }
const promoting = (...iris) => new Map(iris.map(iri => [iri, placement]))

describe('the ranking effect, and its bounds', () => {
  it('never adds a result the search did not find', () => {
    // The structural guarantee. Promotion re-ranks the list it is given; there
    // is no path by which a plugin enters a result set by being paid for.
    const found = [result('a', 'Alpha', 1.2), result('b', 'Beta', 0.9)]
    const after = applyPromotion(found, promoting('absent'))
    expect(after.map(r => r.iri)).toEqual(['a', 'b'])
  })

  it('does nothing for a plugin that barely matched', () => {
    // A promoted reverb stays out of a search for a granular synthesiser. This
    // is the floor, and it is the difference between a re-rank and an ad break.
    const found = [
      result('a', 'Alpha', 1.2),
      result('b', 'Beta', 0.9),
      result('p', 'Promo', PROMOTION_CONFIG.floor - 0.01)
    ]
    const after = applyPromotion(found, promoting('p'))
    expect(after.map(r => r.iri)).toEqual(['a', 'b', 'p'])
    expect(after.find(r => r.iri === 'p').promoted).toBeUndefined()
  })

  it('boosts a plugin that already matched well', () => {
    const found = [
      result('a', 'Alpha', 1.2), result('b', 'Beta', 0.9),
      result('p', 'Promo', 0.8), result('c', 'Gamma', 0.7)
    ]
    const after = applyPromotion(found, promoting('p'))
    expect(after.find(r => r.iri === 'p').promoted).toBe(true)
    // Above Gamma, which it outranked anyway, and now above nothing it did not.
    expect(after.indexOf(after.find(r => r.iri === 'p'))).toBeLessThan(3)
  })

  it('may reach first place, which is what a vendor is buying', () => {
    // maxPromotedRank is 1: no position is reserved. The bound that keeps the
    // search honest is the floor above, not this — being first among results
    // that genuinely match, with a label on it, is advertising working.
    const found = [
      result('a', 'Alpha', 0.90), result('b', 'Beta', 0.85),
      result('c', 'Gamma', 0.80), result('p', 'Promo', 0.79)
    ]
    const after = applyPromotion(found, promoting('p'))
    expect(after[0].iri).toBe('p')
    expect(after[0].promoted).toBe(true)
  })

  it('is permitted first place, not given it', () => {
    // The boost is a multiplier, so a substantially better match still wins.
    // Paying moves you up the list; it does not buy the top of it outright.
    const found = [
      result('a', 'Alpha', 1.40), result('p', 'Promo', 0.60), result('b', 'Beta', 0.55)
    ]
    const after = applyPromotion(found, promoting('p'))
    expect(after[0].iri).toBe('a')
    expect(after[1].iri).toBe('p')
  })

  it('honours the cap if it is ever raised again', () => {
    // The cap is a published number that may change. At 1 the guard is inert,
    // so this exercises it at 3 — otherwise the code path protecting reserved
    // positions would be untested until the day somebody relied on it.
    const found = [
      result('a', 'Alpha', 0.90), result('b', 'Beta', 0.85),
      result('c', 'Gamma', 0.80), result('p', 'Promo', 0.79)
    ]
    const after = applyPromotion(found, promoting('p'), { ...PROMOTION_CONFIG, maxPromotedRank: 3 })
    expect(after[0].iri).toBe('a')
    expect(after[1].iri).toBe('b')
    expect(after.findIndex(r => r.iri === 'p') + 1).toBeGreaterThanOrEqual(3)
  })

  it('does not demote a plugin that had earned first place', () => {
    // The cap protects the top from being *bought*, not from being occupied by
    // something that is also promoted. Pushing a genuine best match down for
    // having paid would make promotion harmful to the thing promoted, which is
    // absurd on its own terms and a strange thing to have sold.
    const found = [
      result('p', 'Promo', 1.3), result('a', 'Alpha', 1.2), result('b', 'Beta', 0.9)
    ]
    const after = applyPromotion(found, promoting('p'))
    expect(after[0].iri).toBe('p')
    expect(after[0].promoted).toBe(true)
  })

  it('shows at most two placements on a page', () => {
    // Different vendors, so only the page cap is in play.
    const found = ['p', 'q', 's', 't'].map((iri, i) =>
      ({ ...result(iri, `P${i}`, 0.9 - i * 0.01), vendorSlug: `vendor-${i}` }))
    const after = applyPromotion(found, promoting('p', 'q', 's', 't'))
    expect(after.filter(r => r.promoted)).toHaveLength(PROMOTION_CONFIG.maxPromotedPerPage)
  })

  it('gives one vendor at most one of those slots', () => {
    // A Pro subscription allows promoting every plugin a vendor owns, and the
    // largest vendors here have thirty to fifty. Without this, one subscription
    // would hold the whole promoted area of every search it matched — which is
    // selling prominence and delivering ownership.
    const found = ['a', 'b', 'c'].map((iri, i) =>
      ({ ...result(iri, `Acme ${i}`, 0.9 - i * 0.01), vendorSlug: 'acme' }))
    const after = applyPromotion(found, promoting('a', 'b', 'c'))
    expect(after.filter(r => r.promoted)).toHaveLength(PROMOTION_CONFIG.maxPromotedPerVendor)
  })

  it('still fills both slots when two vendors are promoting', () => {
    const found = [
      { ...result('a', 'Acme One', 0.90), vendorSlug: 'acme' },
      { ...result('b', 'Beta One', 0.88), vendorSlug: 'beta' },
      { ...result('c', 'Acme Two', 0.86), vendorSlug: 'acme' }
    ]
    const after = applyPromotion(found, promoting('a', 'b', 'c'))
    const placed = after.filter(r => r.promoted)
    expect(placed).toHaveLength(2)
    expect(new Set(placed.map(r => r.vendorSlug)).size).toBe(2)
  })

  it('does not treat two plugins with no vendor as one vendor', () => {
    // An absent vendor is nobody's, not a shared "unknown" allowance.
    const found = [result('a', 'One', 0.90), result('b', 'Two', 0.88)]
    const after = applyPromotion(found, promoting('a', 'b'))
    expect(after.filter(r => r.promoted)).toHaveLength(2)
  })

  it('leaves an unpromoted search exactly as it was', () => {
    // The overwhelming majority of searches. Not merely equal — the same array,
    // so there is no cost and no reordering to go subtly wrong.
    const found = [result('a', 'Alpha', 1.2), result('b', 'Beta', 0.9)]
    expect(applyPromotion(found, new Map())).toBe(found)
    expect(applyPromotion(found, null)).toBe(found)
  })

  it('keeps the unboosted score, so the effect is auditable', () => {
    const found = [result('a', 'Alpha', 1.2), result('p', 'Promo', 0.8)]
    const promoted = applyPromotion(found, promoting('p')).find(r => r.promoted)
    expect(promoted.signals.unpromotedScore).toBe(0.8)
    expect(promoted.score).toBeCloseTo(0.8 * PROMOTION_CONFIG.boostFactor, 6)
  })

  it('multiplies rather than adds, so nothing times the boost is still nothing', () => {
    // Why a multiplier: an additive bonus would lift every promoted plugin
    // toward the top of every search, including ones it does not match at all.
    expect(0 * PROMOTION_CONFIG.boostFactor).toBe(0)
    const found = [result('a', 'Alpha', 1.2), result('p', 'Promo', 0)]
    expect(applyPromotion(found, promoting('p'))[1].promoted).toBeUndefined()
  })
})

describe('when a placement is live', () => {
  const from = new Date('2026-01-01T00:00:00Z')
  const until = new Date('2027-01-01T00:00:00Z')
  const record = { startedAt: from.toISOString(), endsAt: until.toISOString() }

  it('runs from its start to its end', () => {
    expect(isLive(record, new Date('2026-06-01T00:00:00Z'))).toBe(true)
    expect(isLive(record, new Date('2025-12-31T23:59:59Z'))).toBe(false)
  })

  it('stops the instant it ends, and stays stopped', () => {
    // Read at query time rather than swept, so a lapsed placement stops being
    // applied whether or not any job ran. A sweep that failed quietly would be
    // a paid placement running on for free, indefinitely.
    expect(isLive(record, until)).toBe(false)
    expect(isLive(record, new Date('2030-01-01T00:00:00Z'))).toBe(false)
  })

  it('is inclusive at the start and exclusive at the end', () => {
    // So that ending one "now" means it is not live now, with no final instant
    // in which it is both revoked and running.
    expect(isLive(record, from)).toBe(true)
    expect(isLive({ ...record, endsAt: from.toISOString() }, from)).toBe(false)
  })

  it('runs for the configured term', () => {
    const start = new Date('2026-09-12T00:00:00Z')
    expect(daysRemaining({ endsAt: termEnd(start) }, start)).toBe(PROMOTION_CONFIG.termDays)
  })

  it('reports a lapsed placement as negative rather than zero', () => {
    expect(daysRemaining({ endsAt: until }, new Date('2027-02-01T00:00:00Z'))).toBeLessThan(0)
  })
})

/**
 * Disclosure. The half of this feature that has legal force.
 *
 * The ASA asks for disclosure that is immediate, prominent and understandable;
 * the DSA asks that an ad be identifiable and its ranking parameters published.
 * A boost applied without a label is an undisclosed advertisement, so these
 * assert the two cannot come apart.
 */
describe('every paid placement is labelled', () => {
  const doc = {
    iri: 'http://purl.org/stuff/plugin-universe/plugin/x-1234',
    name: 'X', vendor: 'v', formats: [], categories: [], roles: [], tags: [], parameters: []
  }

  it('flags every result the boost touched', () => {
    // The binding that matters: nothing is boosted without being marked, so
    // there is no path to an unlabelled ad.
    const found = [result('a', 'Alpha', 1.2), result('p', 'Promo', 0.8)]
    for (const r of applyPromotion(found, promoting('p'))) {
      const boosted = r.signals?.unpromotedScore !== undefined
      expect(boosted, r.name).toBe(Boolean(r.promoted))
    }
  })

  it('labels a promoted result in the search page', () => {
    const html = renderSearchPage({
      query: 'reverb', results: [{ ...doc, score: 1, promoted: true }],
      total: 1, corpus: 1, elapsedMs: 1
    })
    // The rendered element, not the class name — site.css is inlined into
    // every page, so `badge-ad` alone matches the stylesheet on any page.
    expect(html).toContain('<a class="badge badge-ad" href="/about/promotion"')
    expect(html).toContain(`>${PROMOTION_CONFIG.label}</a>`)
  })

  it('makes the label itself the way to the disclosure', () => {
    // Somebody who notices the label is the one person certain to want the
    // explanation, and they should not have to go looking for it.
    const html = renderSearchPage({
      query: 'reverb', results: [{ ...doc, score: 1, promoted: true }],
      total: 1, corpus: 1, elapsedMs: 1
    })
    const label = html.slice(html.indexOf('<a class="badge badge-ad"'))
    expect(label.slice(0, label.indexOf('</a>'))).toContain('/about/promotion')
    // And the word alone is not the whole disclosure: "Promoted" is softer than
    // "Ad", so the tooltip says what it means in as many words.
    expect(label.slice(0, label.indexOf('</a>'))).toMatch(/[Pp]aid/)
  })

  it('does not label an ordinary result', () => {
    const html = renderSearchPage({
      query: 'reverb', results: [{ ...doc, score: 1 }], total: 1, corpus: 1, elapsedMs: 1
    })
    expect(html).not.toContain('class="badge badge-ad"')
  })

  it('discloses on the plugin page too, where there is no ranking to see', () => {
    // Somebody arriving from a link has seen no result row and no label. The
    // placement is a fact about the listing wherever it is read.
    const html = renderPluginPage({ ...doc, promoted: true })
    expect(html).toContain('placement in search results is paid for')
    expect(html).toContain('/about/promotion')
  })

  it('says nothing on an unpromoted plugin page', () => {
    expect(renderPluginPage(doc)).not.toContain('paid for')
  })

  it('serves the page every label links to', () => {
    // The ranking effect has to be documented publicly — architecture.md §7.
    // A label pointing at a 404 is worse than no label.
    expect(Object.keys(PAGES)).toContain('/about/promotion')
  })

  it('publishes the numbers that are actually used', () => {
    // The page states the bound; the code applies it. If they drift, the
    // published commitment becomes false without anything failing.
    const page = readFileSync(PAGES['/about/promotion'].file, 'utf8')
    expect(page).toContain(String(PROMOTION_CONFIG.boostFactor))
    expect(page).toContain(String(PROMOTION_CONFIG.floor))
    expect(page).toContain(String(PROMOTION_CONFIG.maxPromotedRank))
    expect(page).toContain(String(PROMOTION_CONFIG.maxPromotedPerPage))
    expect(page).toContain(String(PROMOTION_CONFIG.maxPromotedPerVendor))
    expect(page).toContain(String(PROMOTION_CONFIG.termDays))
  })

  it('does not restate a tunable number in prose that would then drift', () => {
    // The JSON disclosure said "never takes the first two places" and was false
    // within an hour of maxPromotedRank changing from 3 to 1. It now states the
    // guarantee that does not move — applied after retrieval, never adds a
    // result — and leaves the numbers to the page that publishes them.
    const server = readFileSync('src/api/server.js', 'utf8')
    const disclosure = server.slice(
      server.indexOf('const PROMOTION_DISCLOSURE'), server.indexOf('})', server.indexOf('const PROMOTION_DISCLOSURE')))
    expect(disclosure).not.toMatch(/first two|first three|third place/i)
    expect(disclosure).toContain('/about/promotion')
  })

  it('does not call it "sponsored"', () => {
    // The ASA advises against it: readers take it to mean several things, most
    // of them not "someone paid for this".
    expect(PROMOTION_CONFIG.label.toLowerCase()).not.toContain('sponsor')
  })
})
