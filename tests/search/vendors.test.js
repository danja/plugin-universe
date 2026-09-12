import { describe, it, expect } from 'vitest'
import { vendorSlug, vendorKey } from '../../src/search/SearchService.js'
import { renderVendorPage, renderVendorsPage } from '../../src/api/render.js'

/**
 * Vendor pages.
 *
 * A vendor in this catalogue is a string. `trn:vendor` is a literal, one per
 * plugin, free text from whatever harvested it — there are 365 of them across
 * 645 plugins and no identity behind any of them. Everything here follows from
 * that, including what it cannot do.
 *
 * Two functions rather than one is the crux: the URL wants separators and the
 * grouping does not.
 */

describe('grouping a vendor by name', () => {
  it('makes a URL a person can read', () => {
    expect(vendorSlug('Chowdhury DSP')).toBe('chowdhury-dsp')
    expect(vendorSlug('Guillermo Moñino Cánovas')).toBe('guillermo-monino-canovas')
  })

  it('groups two spellings of one vendor together', () => {
    // The pairs actually in the catalogue. Slugging alone keeps them apart —
    // "sfz-tools" and "sfztools" — which is why the key drops separators
    // instead of turning them into hyphens.
    expect(vendorKey('SFZ Tools')).toBe(vendorKey('SFZTools'))
    expect(vendorKey('Oleg Kapitonov')).toBe(vendorKey('olegkapitonov'))
    expect(vendorSlug('SFZ Tools')).not.toBe(vendorSlug('SFZTools'))
  })

  it('does not group two vendors that merely look alike', () => {
    expect(vendorKey('ZL Audio')).not.toBe(vendorKey('ZLAudio Pro'))
    expect(vendorKey('Airwindows')).not.toBe(vendorKey('Air Windows Ltd'))
  })

  it('survives a name that reduces to nothing', () => {
    // A vendor recorded as "—" or "???" has no key, and must not become the
    // page every unnamed vendor shares.
    expect(vendorKey('???')).toBe('')
    expect(vendorSlug('  ')).toBe('')
    expect(vendorKey(null)).toBe('')
  })

  it('is stable under accents and case, which harvesters disagree about', () => {
    expect(vendorKey('MeldaProduction')).toBe(vendorKey('meldaproduction'))
    expect(vendorSlug('Émilie')).toBe('emilie')
  })
})

describe('the vendor page', () => {
  const plugin = name => ({
    iri: `http://purl.org/stuff/plugin-universe/plugin/${vendorSlug(name)}-1`,
    name, vendor: 'Chowdhury DSP', vendorSlug: 'chowdhury-dsp',
    formats: [], categories: [], roles: [], tags: [], parameters: []
  })
  const vendor = {
    slug: 'chowdhury-dsp', name: 'Chowdhury DSP', spellings: ['Chowdhury DSP'],
    count: 2, results: [plugin('BYOD'), plugin('CHOW')]
  }

  it('lists the vendor’s plugins, linked', () => {
    const html = renderVendorPage(vendor)
    expect(html).toContain('BYOD')
    expect(html).toContain('CHOW')
    expect(html).toContain('href="/plugin/')
  })

  it('says the page is assembled, not written by the vendor', () => {
    // It is harvested facts under somebody's name. Reading like a profile they
    // wrote would be putting words in their mouth — and it is the note a paid
    // profile would replace.
    expect(renderVendorPage(vendor)).toContain('not written by')
  })

  it('shows other spellings only when there are some', () => {
    expect(renderVendorPage(vendor)).not.toContain('Also written')
    const merged = { ...vendor, spellings: ['SFZ Tools', 'SFZTools'], name: 'SFZ Tools' }
    const html = renderVendorPage(merged)
    expect(html).toContain('Also written')
    expect(html).toContain('SFZTools')
  })

  it('counts in words that read correctly for one plugin', () => {
    expect(renderVendorPage({ ...vendor, count: 1, results: [plugin('BYOD')] }))
      .toContain('1 plugin in the catalogue')
    expect(renderVendorPage(vendor)).toContain('2 plugins in the catalogue')
  })
})

describe('the vendor index', () => {
  const vendors = [
    { slug: 'danja', name: 'danja', count: 50 },
    { slug: 'sfz-tools', name: 'SFZ Tools', count: 2 }
  ]

  it('links every vendor to their page', () => {
    const html = renderVendorsPage(vendors)
    expect(html).toContain('href="/vendor/danja"')
    expect(html).toContain('href="/vendor/sfz-tools"')
  })

  it('says how many plugins each has', () => {
    const html = renderVendorsPage(vendors)
    expect(html).toContain('50 plugins')
    expect(html).toContain('2 plugins')
  })
})
