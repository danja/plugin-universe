import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  toSpdx, sourceAvailabilityFor, OPEN_SOURCE, FREE, PAID,
  OPEN_SOURCE_LICENCES, OTHER_LICENCES, LICENCE_IDS, UNVERSIONED,
  NOASSERTION, PRICING
} from '../../src/harvest/Licensing.js'
import { normalisePlugin } from '../../src/harvest/Normaliser.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * "Can I see the source" and "do I have to pay" are the two questions asked
 * most often about a plugin, and they are separate axes. Ardour is the case
 * that keeps them separate: GPL-3.0, unambiguously open source, and its
 * official binaries are sold. Anything that collapses the two into one
 * enumeration gets Ardour wrong.
 */

const plugin = extra => normalisePlugin({ name: 'Test', ...extra })

describe('licence identifiers', () => {
  it('normalises the URL form LV2 bundles use', () => {
    expect(toSpdx('https://opensource.org/licenses/MIT')).toBe('MIT')
    expect(toSpdx('http://www.gnu.org/licenses/agpl-3.0.html')).toBe('AGPL-3.0')
    expect(toSpdx('https://creativecommons.org/publicdomain/zero/1.0/')).toBe('CC0-1.0')
  })

  it('folds case so "mit" and "MIT" are one licence', () => {
    expect(toSpdx('mit')).toBe('MIT')
  })

  it('keeps an unrecognised licence rather than discarding it', () => {
    // The raw statement is still the most accurate thing known. What catches
    // it is the sh:in list in the shapes, not a silent drop here.
    expect(toSpdx('some-bespoke-licence')).toBe('some-bespoke-licence')
    expect(LICENCE_IDS.has('some-bespoke-licence')).toBe(false)
  })

  it('resolves a spelling only where it is unambiguous', () => {
    expect(toSpdx('GPLv3')).toBe('GPL-3.0')
    expect(toSpdx('GPL3')).toBe('GPL-3.0')
    expect(toSpdx('apache2')).toBe('Apache-2.0')
    // A bare BSD does not say two-clause or three-clause, so it is left alone
    // rather than resolved to whichever is more common.
    expect(toSpdx('BSD')).toBe('BSD')
  })

  it('reads the identifier out of an SPDX URL rather than tabulating them', () => {
    expect(toSpdx('https://spdx.org/licenses/MIT')).toBe('MIT')
    expect(toSpdx('http://spdx.org/licenses/GPL-3.0-or-later.html')).toBe('GPL-3.0-or-later')
    // An identifier we do not know still comes out of the URL, as itself.
    expect(toSpdx('https://spdx.org/licenses/Beerware')).toBe('Beerware')
  })

  it('does not invent a version the source did not state', () => {
    // A DOAP licence URL names the family. 59 plugins in the catalogue say
    // exactly this, and calling them GPL-3.0 would be a claim about somebody
    // else's licensing that nobody made.
    expect(toSpdx('http://usefulinc.com/doap/licenses/gpl')).toBe('GPL')
    expect(toSpdx('http://usefulinc.com/doap/licenses/lgpl')).toBe('LGPL')
    expect(toSpdx('GNU GPL')).toBe('GPL')
    for (const token of UNVERSIONED) {
      expect(token, token).not.toMatch(/\d/)
      // Still open source: every version of the GPL is.
      expect(sourceAvailabilityFor(token), token).toBe(OPEN_SOURCE)
    }
  })

  it('records "we could not identify it" as NOASSERTION, not as a licence', () => {
    // GitHub's API says `other` when it finds a LICENSE file it cannot read.
    // That is neither a licence name nor the absence of one.
    expect(toSpdx('other')).toBe(NOASSERTION)
    expect(toSpdx('unknown')).toBe(NOASSERTION)
    expect(sourceAvailabilityFor('other')).toBeNull()
    expect(OPEN_SOURCE_LICENCES.has(NOASSERTION)).toBe(false)
  })

  /**
   * Every distinct pu:licenceId in the live catalogue on 2026-09-11, with the
   * number of plugins carrying it. Twenty-three spellings of nineteen
   * licences — the facet listed GPL-3.0 three times, MIT three times, and
   * `?licence=GPL-3.0` missed 86 of the plugins under it.
   *
   * Kept as data rather than prose because the next harvest will add to it, and
   * a value that stops normalising should fail here rather than appear as a
   * facet nobody recognises.
   */
  const OBSERVED = Object.freeze([
    ['GPL-3.0', 'GPL-3.0'],
    ['MIT', 'MIT'],
    ['http://usefulinc.com/doap/licenses/gpl', 'GPL'],
    ['GPLv3', 'GPL-3.0'],
    ['https://spdx.org/licenses/MIT', 'MIT'],
    ['other', NOASSERTION],
    ['Apache-2.0', 'Apache-2.0'],
    ['BSD-3-Clause', 'BSD-3-Clause'],
    ['GPL-2.0', 'GPL-2.0'],
    ['ISC', 'ISC'],
    ['LGPL-3.0', 'LGPL-3.0'],
    ['CC0-1.0', 'CC0-1.0'],
    ['MPL-2.0', 'MPL-2.0'],
    ['Unlicense', 'Unlicense'],
    ['BSD-2-Clause', 'BSD-2-Clause'],
    ['AGPL-3.0', 'AGPL-3.0'],
    ['Zlib', 'Zlib'],
    ['GPL3', 'GPL-3.0'],
    ['http://spdx.org/licenses/GPL-3.0-or-later.html', 'GPL-3.0-or-later'],
    ['https://opensource.org/licenses/MIT', 'MIT'],
    ['LGPL-2.1', 'LGPL-2.1'],
    ['CC-BY-SA-4.0', 'CC-BY-SA-4.0'],
    ['EUPL-1.2', 'EUPL-1.2']
  ])

  it('recognises every licence string in the live catalogue', () => {
    for (const [raw, expected] of OBSERVED) {
      expect(toSpdx(raw), raw).toBe(expected)
      expect(LICENCE_IDS.has(toSpdx(raw)), raw).toBe(true)
    }
  })

  it('collapses those twenty-three spellings to nineteen licences', () => {
    // The number that matters: it is how many entries the licence facet has.
    // Four of the twenty-three were a second or third spelling of MIT or
    // GPL-3.0, which is why `?licence=GPL-3.0` was missing 86 plugins.
    const distinct = new Set(OBSERVED.map(([raw]) => toSpdx(raw)))
    expect(distinct.size).toBe(19)
  })
})

/**
 * The list in the code and the list in the shapes.
 *
 * Adding licences to one and not the other is the mistake this project has made
 * most often — 136 SHACL violations after a GitHub sweep, from exactly this
 * pair. A test asserting two lists match is worth more than either being
 * carefully reviewed.
 */
describe('the shapes enumerate what the code enumerates', () => {
  const shapes = readFileSync(new URL('../../vocabs/shapes.ttl', import.meta.url), 'utf8')

  /** The sh:in list attached to pu:licenceId, as the strings it contains. */
  function licencesInShapes () {
    const block = shapes.slice(shapes.indexOf('sh:path pu:licenceId'))
    const list = block.slice(block.indexOf('sh:in ('), block.indexOf(') ;'))
    return new Set([...list.matchAll(/"([^"]+)"/g)].map(m => m[1]))
  }

  it('lists exactly LICENCE_IDS, in both directions', () => {
    const inShapes = licencesInShapes()
    expect([...inShapes].sort()).toEqual([...LICENCE_IDS].sort())
  })

  it('covers every licence the normaliser can produce from live data', () => {
    const inShapes = licencesInShapes()
    for (const licence of [...OPEN_SOURCE_LICENCES, ...OTHER_LICENCES]) {
      expect(inShapes.has(licence), licence).toBe(true)
    }
  })

  it('warns rather than rejects, because the list will always be incomplete', () => {
    const block = shapes.slice(shapes.indexOf('sh:path pu:licenceId'))
    expect(block.slice(0, block.indexOf('] .'))).toContain('sh:severity sh:Warning')
  })

  it('has nothing to say about an absent licence', () => {
    expect(toSpdx(null)).toBeNull()
    expect(toSpdx('  ')).toBeNull()
  })
})

describe('source availability', () => {
  it('is derived from an OSI-approved licence', () => {
    for (const licence of ['MIT', 'GPL-3.0', 'AGPL-3.0', 'Apache-2.0', 'BSD-3-Clause']) {
      expect(sourceAvailabilityFor(licence), licence).toBe(OPEN_SOURCE)
    }
  })

  it('treats public-domain dedications as open source', () => {
    expect(sourceAvailabilityFor('CC0-1.0')).toBe(OPEN_SOURCE)
    expect(sourceAvailabilityFor('Unlicense')).toBe(OPEN_SOURCE)
  })

  it('says nothing when the licence does not settle it', () => {
    // Unknown is not proprietary. Nobody has said, and the catalogue should not
    // invent an answer.
    expect(sourceAvailabilityFor('other')).toBeNull()
    expect(sourceAvailabilityFor(null)).toBeNull()
    expect(sourceAvailabilityFor('some-bespoke-licence')).toBeNull()
  })

  it('excludes CC-BY-SA, which is a content licence and not a software one', () => {
    expect(OPEN_SOURCE_LICENCES.has('CC-BY-SA-4.0')).toBe(false)
    expect(sourceAvailabilityFor('CC-BY-SA-4.0')).toBeNull()
  })
})

describe('pricing is asserted, never derived', () => {
  it('is not inferred from an open-source licence', () => {
    // The Ardour case: GPL and sold. A licence grants the source, not a build.
    const ardourish = plugin({ licence: 'GPL-3.0' })
    expect(ardourish.sourceAvailability).toBe(OPEN_SOURCE)
    expect(ardourish.pricing).toBeNull()
  })

  it('is carried when a harvester states it', () => {
    expect(plugin({ licence: 'GPL-3.0', pricing: PAID }).pricing).toBe(PAID)
    expect(plugin({ licence: 'MIT', pricing: FREE }).pricing).toBe(FREE)
  })

  it('refuses a value outside the enumeration', () => {
    // A harvester inventing "cheap" gets nothing, not a new facet value.
    expect(plugin({ pricing: 'cheap' }).pricing).toBeNull()
    expect(plugin({ pricing: `${NAMESPACES.pu}Bargain` }).pricing).toBeNull()
    expect(PRICING.has(`${NAMESPACES.pu}Bargain`)).toBe(false)
  })
})

describe('the normalised record', () => {
  it('carries the SPDX form alongside what the source said', () => {
    const record = plugin({ licence: 'https://opensource.org/licenses/MIT' })
    expect(record.licence).toBe('https://opensource.org/licenses/MIT')
    expect(record.licenceId).toBe('MIT')
  })

  it('leaves all three absent when nothing is known', () => {
    const record = plugin({})
    expect(record.licence).toBeNull()
    expect(record.licenceId).toBeNull()
    expect(record.sourceAvailability).toBeNull()
    expect(record.pricing).toBeNull()
  })
})
