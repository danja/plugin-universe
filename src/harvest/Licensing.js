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
  'EPL-2.0', 'EUPL-1.2', 'GPL-2.0', 'GPL-3.0', 'GPL-3.0-or-later', 'ISC',
  'LGPL-2.1', 'LGPL-3.0', 'MIT', 'MPL-2.0', 'Unlicense', 'Zlib',
  // Unversioned. Not SPDX identifiers — SPDX has none for "GPL, version
  // unstated" — and deliberately kept apart from GPL-3.0 rather than folded
  // into it. See UNVERSIONED below: the version is a fact the source did not
  // give, and inventing one is a claim about somebody's licensing.
  'GPL', 'LGPL', 'AGPL'
]))

/**
 * Licences whose version the source did not state.
 *
 * `doap:license` in an LV2 bundle is commonly
 * `http://usefulinc.com/doap/licenses/gpl` — "the GNU GPL", with no version.
 * 59 plugins in the catalogue say exactly that. Mapping them to `GPL-3.0`
 * would make the catalogue assert a version nobody claimed, about somebody
 * else's software; leaving them as a URL makes them incomparable with
 * everything else and gives the licence facet three names for one licence.
 *
 * So they normalise to a token that says exactly what the source said, and it
 * stays a facet value of its own because it is a different claim. It is open
 * source either way — every version of the GPL is — so the availability
 * classification is unaffected, and a reader who needs the version has the
 * plugin's homepage.
 */
export const UNVERSIONED = Object.freeze(new Set(['GPL', 'LGPL', 'AGPL']))

/**
 * `NOASSERTION` — SPDX's own token for "a licence exists and we could not
 * identify it".
 *
 * GitHub's API says `other` when it finds a LICENSE file whose text it does not
 * recognise. That is not "no licence" and not a licence name either; it is the
 * absence of an identification. Six plugins here carry it. Storing the word
 * `other` makes it a facet entry that reads like a licence; storing null loses
 * the fact that there *is* a licence file. SPDX has a token for precisely this
 * state, so use it.
 */
export const NOASSERTION = 'NOASSERTION'

/**
 * Identifiers that are recognised but do not mean the source is open.
 *
 * Kept apart from {@link OPEN_SOURCE_LICENCES} because the two sets answer
 * different questions: this one and that one together are what the catalogue
 * accepts as a licence identifier, while that one alone decides source
 * availability. A commercial plugin with a stated licence must be recordable
 * without being called open source.
 */
export const OTHER_LICENCES = Object.freeze(new Set([
  'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-SA-4.0', 'CC-BY-ND-4.0',
  'Proprietary', NOASSERTION
]))

/**
 * Every identifier the catalogue recognises.
 *
 * `vocabs/shapes.ttl` enumerates this same list in `sh:in`, and
 * `tests/harvest/Licensing.test.js` binds the two together — adding a licence
 * here and forgetting the shape produced 136 SHACL violations once already.
 */
export const LICENCE_IDS = Object.freeze(
  new Set([...OPEN_SOURCE_LICENCES, ...OTHER_LICENCES])
)

/**
 * Spellings of a licence that are not its identifier.
 *
 * Only entries whose meaning is unambiguous. `GPLv3` is GPL-3.0 because there
 * is nothing else it could be; a bare `BSD` is deliberately absent, because the
 * two-clause and three-clause licences are different and the string does not
 * say which. Where a spelling omits the version, the entry maps to the
 * unversioned token rather than to a guess.
 *
 * Keys are lower-cased; lookup lower-cases the input.
 */
const SPELLINGS = Object.freeze(new Map([
  ['gplv3', 'GPL-3.0'], ['gpl3', 'GPL-3.0'], ['gpl v3', 'GPL-3.0'],
  ['gpl-3', 'GPL-3.0'], ['gpl 3.0', 'GPL-3.0'], ['gnu gplv3', 'GPL-3.0'],
  ['gplv3+', 'GPL-3.0-or-later'], ['gpl-3.0+', 'GPL-3.0-or-later'],
  ['gplv2', 'GPL-2.0'], ['gpl2', 'GPL-2.0'], ['gpl-2', 'GPL-2.0'],
  ['lgplv3', 'LGPL-3.0'], ['lgpl3', 'LGPL-3.0'], ['lgpl-3', 'LGPL-3.0'],
  ['lgplv2.1', 'LGPL-2.1'], ['lgpl-2', 'LGPL-2.1'],
  ['agplv3', 'AGPL-3.0'], ['agpl3', 'AGPL-3.0'], ['agpl-3', 'AGPL-3.0'],
  ['apache 2.0', 'Apache-2.0'], ['apache2', 'Apache-2.0'], ['apache-2', 'Apache-2.0'],
  ['mit license', 'MIT'], ['mit licence', 'MIT'], ['the mit license', 'MIT'],
  ['bsd-3', 'BSD-3-Clause'], ['bsd-2', 'BSD-2-Clause'],
  ['cc0', 'CC0-1.0'], ['zlib/libpng', 'Zlib'],
  // "The GNU General Public License", version unstated.
  ['gnu gpl', 'GPL'], ['gnu general public license', 'GPL'],
  ['gnu lgpl', 'LGPL'], ['gnu agpl', 'AGPL'],
  // Not licences: statements that the licence was not identified.
  ['other', NOASSERTION], ['unknown', NOASSERTION], ['unrecognised', NOASSERTION],
  ['noassertion', NOASSERTION]
]))

/**
 * Licence strings seen in the wild that denote an SPDX identifier.
 *
 * LV2 bundles state `doap:license` as a URL, which is correct for RDF and
 * useless for comparison. Normalising them here means the classification below
 * sees one vocabulary rather than three.
 */
const LICENCE_URL_PATTERNS = Object.freeze([
  // SPDX's own URLs name the identifier, so capture it rather than listing one
  // pattern per licence. `https://spdx.org/licenses/MIT` and
  // `http://spdx.org/licenses/GPL-3.0-or-later.html` are both in the data.
  [/spdx\.org\/licenses\/([A-Za-z0-9.+-]+?)(?:\.html)?$/i, null],
  // DOAP's vocabulary, which LV2 bundles use. Unversioned by construction.
  [/usefulinc\.com\/doap\/licenses\/lgpl/i, 'LGPL'],
  [/usefulinc\.com\/doap\/licenses\/agpl/i, 'AGPL'],
  [/usefulinc\.com\/doap\/licenses\/gpl/i, 'GPL'],
  [/usefulinc\.com\/doap\/licenses\/mit/i, 'MIT'],
  [/usefulinc\.com\/doap\/licenses\/apache/i, 'Apache-2.0'],
  [/usefulinc\.com\/doap\/licenses\/bsd/i, 'BSD-3-Clause'],
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
 * Canonical casing for an identifier the catalogue already knows.
 *
 * Sources disagree about case — `mit`, `Mit`, `MIT` — and a facet that lists a
 * licence three times is the symptom. Returns null when the identifier is not
 * one of ours, which is how the caller tells "known, recased" from "unknown".
 */
function canonical (value) {
  const lower = value.toLowerCase()
  for (const known of LICENCE_IDS) {
    if (known.toLowerCase() === lower) return known
  }
  return null
}

/**
 * A licence string reduced to an identifier where one is recognisable.
 *
 * Three passes, in order: a URL that names a licence, a known spelling, then
 * the identifier itself in whatever case it arrived in.
 *
 * Returns the input unchanged when none of them recognise it — the raw
 * statement is still the most accurate thing known, and discarding it to force
 * a taxonomy would lose information the source did provide. What catches it
 * instead is the `sh:in` list in `vocabs/shapes.ttl`: an unrecognised spelling
 * is reported by `npm run validate`, naming the graph it came from, rather than
 * quietly becoming a facet value of one.
 */
export function toSpdx (raw) {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim().replace(/[.,;]+$/, '')
  if (!trimmed) return null

  for (const [pattern, spdx] of LICENCE_URL_PATTERNS) {
    const match = pattern.exec(trimmed)
    if (!match) continue
    // A null mapping means the pattern captured the identifier itself — SPDX's
    // own URLs carry it, so there is no table to keep in step with SPDX.
    if (spdx !== null) return spdx
    return canonical(match[1]) ?? match[1]
  }

  const spelling = SPELLINGS.get(trimmed.toLowerCase())
  if (spelling) return spelling

  return canonical(trimmed) ?? trimmed
}

/**
 * The same normalisation, but refusing what it does not recognise.
 *
 * A harvest and a form want opposite things from an unrecognised licence. A
 * harvest keeps it: the raw statement is the only thing anyone said, and there
 * is nobody to ask. A form has somebody there who can fix it, and letting them
 * type `gpl3` into the catalogue creates exactly the facet-splitting this
 * module exists to prevent — from the one source where it is avoidable.
 *
 * @returns {string|null} a recognised identifier, or null. Null means "not one
 *   of ours", not "absent" — the caller has the raw value and says so.
 */
export function toKnownSpdx (raw) {
  const id = toSpdx(raw)
  return id && LICENCE_IDS.has(id) ? id : null
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
