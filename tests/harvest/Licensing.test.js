import { describe, it, expect } from 'vitest'
import {
  toSpdx, sourceAvailabilityFor, OPEN_SOURCE, FREE, PAID,
  OPEN_SOURCE_LICENCES, PRICING
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
    // The raw statement is still the most accurate thing known.
    expect(toSpdx('some-bespoke-licence')).toBe('some-bespoke-licence')
    expect(toSpdx('other')).toBe('other')
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
