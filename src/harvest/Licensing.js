import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * What a plugin's licence tells a person deciding whether to install it.
 *
 * Two questions, and they are the two most-asked about any plugin: **can I see
 * the source** and **do I have to pay**. They are modelled as separate axes
 * because they genuinely are independent, and Ardour is the case that proves
 * it — GPL-3.0, unambiguously open source, and its official binaries cost
 * money. A single "free/paid/open" enumeration collapses that into a lie.
 *
 * Source availability is *derived* from the licence, because an SPDX identifier
 * is exactly the statement that the software is under those terms. Pricing is
 * not derivable from a licence and is never guessed here: an open-source
 * licence guarantees the right to obtain and redistribute the source, not that
 * anyone gives you a build for nothing. It is asserted only by a harvester
 * whose source actually states it, and it carries that source's provenance.
 */

const pu = NAMESPACES.pu

/** Source availability. */
export const OPEN_SOURCE = `${pu}OpenSource`
export const SOURCE_AVAILABLE = `${pu}SourceAvailable`
export const PROPRIETARY = `${pu}Proprietary`

/** Pricing. */
export const FREE = `${pu}Free`
export const DONATIONWARE = `${pu}Donationware`
export const FREEMIUM = `${pu}Freemium`
export const PAID = `${pu}Paid`

/**
 * Licence identifiers that mean the source is open.
 *
 * OSI-approved licences, plus the public-domain dedications that are free by
 * any reasonable reading. CC0 is included deliberately although OSI declined to
 * approve it: for a catalogue answering "can I see and reuse the source", a
 * public-domain dedication is a yes, and 15 plugins here use it.
 *
 * CC-BY-SA-4.0 is deliberately *absent*. It is a free content licence, not a
 * software licence — the FSF advises against it for software because it has no
 * source-code provision — so it is left unclassified rather than called
 * something it is not.
 */
export const OPEN_SOURCE_LICENCES = Object.freeze(new Set([
  '0BSD', 'AFL-3.0', 'AGPL-3.0', 'Apache-2.0', 'Artistic-2.0',
  'BSD-2-Clause', 'BSD-3-Clause', 'BSL-1.0', 'CC0-1.0',
  'EPL-2.0', 'EUPL-1.2', 'GPL-2.0', 'GPL-3.0', 'ISC',
  'LGPL-2.1', 'LGPL-3.0', 'MIT', 'MPL-2.0', 'Unlicense', 'Zlib'
]))

/**
 * Licence strings seen in the wild that denote an SPDX identifier.
 *
 * LV2 bundles state `doap:license` as a URL, which is correct for RDF and
 * useless for comparison. Normalising them here means the classification below
 * sees one vocabulary rather than three.
 */
const LICENCE_URL_PATTERNS = Object.freeze([
  [/opensource\.org\/licenses\/MIT/i, 'MIT'],
  [/opensource\.org\/licenses\/ISC/i, 'ISC'],
  [/opensource\.org\/licenses\/Apache-2\.0/i, 'Apache-2.0'],
  [/opensource\.org\/licenses\/BSD-3-Clause/i, 'BSD-3-Clause'],
  [/opensource\.org\/licenses\/BSD-2-Clause/i, 'BSD-2-Clause'],
  [/opensource\.org\/licenses\/GPL-3\.0/i, 'GPL-3.0'],
  [/opensource\.org\/licenses\/GPL-2\.0/i, 'GPL-2.0'],
  [/opensource\.org\/licenses\/LGPL-3\.0/i, 'LGPL-3.0'],
  [/opensource\.org\/licenses\/LGPL-2\.1/i, 'LGPL-2.1'],
  [/gnu\.org\/licenses\/agpl/i, 'AGPL-3.0'],
  [/gnu\.org\/licenses\/gpl-3/i, 'GPL-3.0'],
  [/gnu\.org\/licenses\/gpl-2/i, 'GPL-2.0'],
  [/gnu\.org\/licenses\/lgpl/i, 'LGPL-3.0'],
  [/creativecommons\.org\/publicdomain\/zero/i, 'CC0-1.0'],
  [/unlicense\.org/i, 'Unlicense']
])

/**
 * A licence string reduced to an SPDX identifier where one is recognisable.
 *
 * Returns the input unchanged when it is not recognised — the raw statement is
 * still the most accurate thing known, and discarding it to force a taxonomy
 * would lose information the source did provide.
 */
export function toSpdx (raw) {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  for (const [pattern, spdx] of LICENCE_URL_PATTERNS) {
    if (pattern.test(trimmed)) return spdx
  }

  // Case-insensitive match against the known set, so "mit" becomes "MIT".
  for (const known of OPEN_SOURCE_LICENCES) {
    if (known.toLowerCase() === trimmed.toLowerCase()) return known
  }
  return trimmed
}

/**
 * Whether a licence means the source is open.
 *
 * @returns {string|null} an availability IRI, or null when the licence does not
 *   settle the question. Null is the honest answer for "other", for a bespoke
 *   licence, and for no licence at all — none of which means proprietary, only
 *   that nobody has said.
 */
export function sourceAvailabilityFor (licence) {
  const spdx = toSpdx(licence)
  if (!spdx) return null
  return OPEN_SOURCE_LICENCES.has(spdx) ? OPEN_SOURCE : null
}

/** The set of pricing IRIs a harvester may assert. */
export const PRICING = Object.freeze(new Set([FREE, DONATIONWARE, FREEMIUM, PAID]))

/** The set of availability IRIs a harvester may assert. */
export const AVAILABILITY = Object.freeze(new Set([OPEN_SOURCE, SOURCE_AVAILABLE, PROPRIETARY]))
