import { describe, it, expect } from 'vitest'
import { URIMinter, URIMintError, slugify } from '../../src/rdf/URIMinter.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Pro-Q 4')).toBe('pro-q-4')
    expect(slugify('  Tape   Saturator  ')).toBe('tape-saturator')
  })

  it('strips diacritics rather than dropping the word', () => {
    expect(slugify('Crème Brûlée')).toBe('creme-brulee')
  })

  it('refuses to invent a slug for unsluggable input', () => {
    expect(() => slugify('...')).toThrow(URIMintError)
    expect(() => slugify('')).toThrow(URIMintError)
  })
})

describe('URIMinter', () => {
  const minter = new URIMinter()

  it('mints under the purl.org namespace, not a serving domain', () => {
    const uri = minter.mintPlugin({ name: 'Drift', vendor: 'danja', bundleName: 'drift.vst3' })
    expect(uri.startsWith(NAMESPACES.pu)).toBe(true)
    expect(uri).toContain('/plugin/drift-')
  })

  it('is idempotent: the same plugin mints the same IRI', () => {
    const args = { name: 'Drift', vendor: 'danja', bundleName: 'drift.vst3' }
    expect(minter.mintPlugin(args)).toBe(minter.mintPlugin({ ...args }))
  })

  it('distinguishes plugins that differ only in vendor', () => {
    const a = minter.mintPlugin({ name: 'Reverb', vendor: 'alpha', bundleName: 'reverb.vst3' })
    const b = minter.mintPlugin({ name: 'Reverb', vendor: 'beta', bundleName: 'reverb.vst3' })
    expect(a).not.toBe(b)
  })

  it('cannot be confused by tuple parts running together', () => {
    const a = minter.mint('plugin', 'x', ['ab', 'c'])
    const b = minter.mint('plugin', 'x', ['a', 'bc'])
    expect(a).not.toBe(b)
  })

  it('refuses to mint for a plugin with no identifying facts', () => {
    expect(() => minter.mintPlugin({ name: 'Orphan' })).toThrow(URIMintError)
  })

  it('distinguishes plugins that share a name but have distinct canonical IRIs', () => {
    // Six flues bundles share doap:name "Flues Synthesizers". Identity from
    // vendor alone collapsed them into one catalogue entry; the LV2 plugin's
    // own IRI is what tells them apart.
    const a = minter.mintPlugin({
      name: 'Flues Synthesizers', vendor: 'Danny Ayers',
      sourceIri: 'https://danja.github.io/flues/plugins/ants'
    })
    const b = minter.mintPlugin({
      name: 'Flues Synthesizers', vendor: 'Danny Ayers',
      sourceIri: 'https://danja.github.io/flues/plugins/bassgen'
    })
    expect(a).not.toBe(b)
  })

  it('prefers bundle name over canonical IRI, so one VST3 from two sources dedupes', () => {
    const fromProfile = minter.mintPlugin({
      name: 'Drift', vendor: 'danja', bundleName: 'drift.vst3',
      sourceIri: 'http://purl.org/stuff/transmissions/plugins/downspout/drift'
    })
    const fromScan = minter.mintPlugin({ name: 'Drift', vendor: 'danja', bundleName: 'drift.vst3' })
    expect(fromProfile).toBe(fromScan)
  })

  it('refuses an identity tuple with an empty part, since it would be unstable', () => {
    expect(() => minter.mint('plugin', 'x', ['a', ''])).toThrow(URIMintError)
  })

  it('rejects an unknown resource type rather than inventing a path', () => {
    expect(() => minter.mint('sandwich', 'x', ['a'])).toThrow(URIMintError)
  })

  it('treats two runs of the same measurement at different times as different', () => {
    const base = {
      subject: 'http://purl.org/stuff/plugin-universe/plugin/drift-88b3b09d',
      tool: 'pluginval 1.0.3',
      metric: 'CpuLoad',
      platform: 'linux-x64'
    }
    const a = minter.mintMeasurement({ ...base, timestamp: '2026-09-06T12:00:00Z' })
    const b = minter.mintMeasurement({ ...base, timestamp: '2026-09-06T13:00:00Z' })
    expect(a).not.toBe(b)
  })
})
