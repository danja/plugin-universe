import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * Source shapes to the catalogue's graph model.
 *
 * This is where the vocabulary defects identified in docs/suggestions.md §3 get
 * fixed rather than inherited. Every mapping here is deliberate and reversible:
 * the original source graph is untouched, so a mapping decided wrongly can be
 * changed and the source re-harvested.
 *
 * Source quirks belong in the harvesters. This module sees the common shape.
 */

export class NormaliseError extends Error {
  constructor (message) {
    super(message)
    this.name = 'NormaliseError'
  }
}

const trn = NAMESPACES.trn
const lv2 = NAMESPACES.lv2
const units = NAMESPACES.units

/**
 * Deprecated parameter predicates and their lv2: equivalents.
 *
 * Downspout uses trn:min/trn:max (17 occurrences) and trn:minimum/trn:maximum
 * (13) for the same thing. Rather than pick a winner between two bespoke terms,
 * both are retired in favour of lv2:, which flues and valis already use — so
 * all three sources land on one parameter shape with no translation for the LV2
 * side at all.
 *
 * This is a record of that decision, not the mechanism that implements it: the
 * harvesters read both spellings into one raw record and `normaliseParameter`
 * reconciles them by field name. Kept because the list of retired terms is
 * worth having written down — it is what the upstream proposal to the
 * transmission repo has to say — but do not reach for it expecting a lookup
 * table that something consults.
 */
export const PARAMETER_ALIASES = Object.freeze({
  [`${trn}min`]: `${lv2}minimum`,
  [`${trn}minimum`]: `${lv2}minimum`,
  [`${trn}max`]: `${lv2}maximum`,
  [`${trn}maximum`]: `${lv2}maximum`,
  [`${trn}default`]: `${lv2}default`,
  [`${trn}symbol`]: `${lv2}symbol`
})

/** One-off typos in the seed corpus, corrected on the way in. */
export const TERM_CORRECTIONS = Object.freeze({
  [`${trn}MIDI`]: `${trn}Midi`,
  [`${trn}hasParameter`]: `${trn}parameter`,
  [`${trn}comment`]: `${NAMESPACES.rdfs}comment`
})

/**
 * Unit strings seen in downspout profiles, mapped to the LV2 units vocabulary.
 * An unrecognised unit is preserved verbatim rather than dropped — losing it
 * would be worse than failing to type it.
 */
export const UNIT_MAP = Object.freeze({
  '%': `${units}pc`,
  ms: `${units}ms`,
  s: `${units}s`,
  Hz: `${units}hz`,
  hz: `${units}hz`,
  kHz: `${units}khz`,
  dB: `${units}db`,
  db: `${units}db`,
  st: `${units}semitone12TET`,
  semitones: `${units}semitone12TET`,
  cents: `${units}cent`,
  bpm: `${units}bpm`,
  deg: `${units}degree`,
  oct: `${units}oct`
})

/**
 * LV2 plugin classes to trn: roles and to catalogue category concepts.
 *
 * LV2's class hierarchy is a taxonomy of what a plugin *is*; the SKOS scheme is
 * how the catalogue lets people find it. Mapping to both keeps the LV2 fact and
 * gains the searchable concept.
 */
export const LV2_CLASS_MAP = Object.freeze({
  [`${lv2}Plugin`]: { roles: [], categories: [] },
  [`${lv2}InstrumentPlugin`]: { roles: [`${trn}AudioInstrument`, `${trn}Instrument`], categories: ['instrument'] },
  [`${lv2}AudioPlugin`]: { roles: [`${trn}AudioEffect`], categories: [] },
  [`${lv2}EffectPlugin`]: { roles: [`${trn}AudioEffect`], categories: ['effect'] },
  [`${lv2}UtilityPlugin`]: { roles: [`${trn}Utility`], categories: ['utility'] },
  [`${lv2}DelayPlugin`]: { roles: [`${trn}AudioEffect`], categories: ['effect', 'delay'] },
  [`${lv2}ReverbPlugin`]: { roles: [`${trn}AudioEffect`], categories: ['effect', 'reverb'] },
  [`${lv2}DistortionPlugin`]: { roles: [`${trn}AudioEffect`], categories: ['effect', 'distortion'] },
  [`${lv2}DynamicsPlugin`]: { roles: [`${trn}AudioEffect`], categories: ['effect', 'dynamics'] },
  [`${lv2}CompressorPlugin`]: { roles: [`${trn}AudioEffect`], categories: ['effect', 'dynamics', 'compressor'] },
  [`${lv2}LimiterPlugin`]: { roles: [`${trn}AudioEffect`], categories: ['effect', 'dynamics', 'limiter'] },
  [`${lv2}EQPlugin`]: { roles: [`${trn}AudioEffect`], categories: ['effect', 'eq'] },
  [`${lv2}FilterPlugin`]: { roles: [`${trn}AudioEffect`], categories: ['effect', 'filter'] },
  [`${lv2}ModulatorPlugin`]: { roles: [`${trn}AudioEffect`], categories: ['effect', 'modulation'] },
  [`${lv2}OscillatorPlugin`]: { roles: [`${trn}AudioInstrument`], categories: ['instrument', 'oscillator'] },
  [`${lv2}SpatialPlugin`]: { roles: [`${trn}AudioEffect`], categories: ['effect', 'spatial'] },
  [`${lv2}GeneratorPlugin`]: { roles: [`${trn}AudioInstrument`], categories: ['instrument'] },
  [`${lv2}AnalyserPlugin`]: { roles: [`${trn}Utility`], categories: ['utility', 'analysis'] },
  [`${lv2}MIDIPlugin`]: { roles: [`${trn}MidiProcessor`], categories: ['midi'] }
})

/** trn: roles to catalogue category concepts, for non-LV2 sources. */
export const ROLE_CATEGORY_MAP = Object.freeze({
  [`${trn}AudioEffect`]: ['effect'],
  [`${trn}AudioInstrument`]: ['instrument'],
  [`${trn}Instrument`]: ['instrument'],
  [`${trn}DrumInstrument`]: ['instrument', 'drums'],
  [`${trn}BassInstrument`]: ['instrument', 'bass'],
  [`${trn}MidiGenerator`]: ['midi'],
  [`${trn}MidiProcessor`]: ['midi'],
  [`${trn}Controller`]: ['midi', 'modulation'],
  [`${trn}Utility`]: ['utility'],
  [`${trn}AudioMixer`]: ['utility', 'mixing']
})

export function correctTerm (iri) {
  return TERM_CORRECTIONS[iri] ?? iri
}

export function normaliseUnit (raw) {
  if (!raw) return { iri: null, label: null }

  // An LV2 bundle states its unit as a units: IRI already — that is the target
  // of this whole mapping, so it passes through rather than being treated as an
  // unrecognised string. Without this the units vocabulary arrives as a label
  // reading "http://lv2plug.in/ns/extensions/units#hz" and no typed unit at
  // all, which is the opposite of what harvesting LV2 is supposed to give.
  if (raw.startsWith(units)) {
    return { iri: raw, label: raw.slice(units.length) }
  }

  const iri = UNIT_MAP[raw] ?? UNIT_MAP[raw.trim()] ?? null
  return { iri, label: raw }
}

/**
 * Normalise one parameter onto the lv2: shape.
 *
 * Accepts either vocabulary's spelling and emits one. A parameter with no
 * symbol is an error: the symbol is how a CC mapping, a measurement or a user
 * refers to it, so an unnamed parameter cannot be referenced and is not worth
 * storing.
 */
export function normaliseParameter (raw, { context = 'unknown plugin' } = {}) {
  const symbol = raw.symbol ?? raw.name ?? null
  if (!symbol) {
    throw new NormaliseError(`A parameter of ${context} has neither a symbol nor a name`)
  }
  const minimum = raw.minimum ?? raw.min ?? null
  const maximum = raw.maximum ?? raw.max ?? null

  if (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum) {
    throw new NormaliseError(
      `Parameter "${symbol}" of ${context} has minimum ${minimum} above maximum ${maximum}`
    )
  }

  const { iri: unitIri, label: unitLabel } = normaliseUnit(raw.unit)

  return {
    symbol,
    name: raw.name ?? symbol,
    comment: raw.comment ?? null,
    default: raw.default ?? null,
    minimum,
    maximum,
    unitIri,
    unitLabel,
    integer: raw.integer === true,
    scalePoints: (raw.scalePoints ?? []).map(point => ({
      label: point.label,
      value: point.value
    })),
    direction: raw.direction ?? 'input'
  }
}

/**
 * Normalise a whole plugin record. Harvesters produce the raw shape; this
 * produces what the serialiser and the embedding pipeline consume.
 */
export function normalisePlugin (raw) {
  if (!raw.name) throw new NormaliseError('A plugin record needs a name')
  const context = raw.name

  const roles = [...new Set((raw.roles ?? []).map(correctTerm))]
  const categories = new Set(raw.categories ?? [])

  for (const lv2Class of raw.lv2Classes ?? []) {
    const mapping = LV2_CLASS_MAP[lv2Class]
    if (!mapping) continue
    for (const role of mapping.roles) roles.push(role)
    for (const category of mapping.categories) categories.add(category)
  }
  for (const role of roles) {
    for (const category of ROLE_CATEGORY_MAP[role] ?? []) categories.add(category)
  }

  // Tags are folded and de-duplicated but never mapped away: a tag the
  // TAG_CATEGORY_MAP does not know still belongs to the plugin, and still
  // carries retrieval signal.
  const tags = [...new Set((raw.tags ?? []).map(tag => String(tag).trim().toLowerCase()).filter(Boolean))].sort()

  return {
    sourceIri: raw.sourceIri ?? null,
    registryId: raw.registryId ?? null,
    name: raw.name,
    vendor: raw.vendor ?? null,
    bundleName: raw.bundleName ?? null,
    classId: raw.classId ?? null,
    description: raw.description ?? null,
    homepage: raw.homepage ?? null,
    seeAlso: raw.seeAlso ?? null,
    image: raw.image ?? null,
    audioPreview: raw.audioPreview ?? null,
    donateUrl: raw.donateUrl ?? null,
    downloadCount: raw.downloadCount ?? null,
    verified: raw.verified === true,
    project: raw.project ?? null,
    licence: raw.licence ?? null,
    maintainer: raw.maintainer ?? null,
    formats: [...new Set(raw.formats ?? [])],
    roles: [...new Set(roles)],
    accepts: [...new Set((raw.accepts ?? []).map(correctTerm))],
    produces: [...new Set((raw.produces ?? []).map(correctTerm))],
    requires: [...new Set((raw.requires ?? []).map(correctTerm))],
    recommendedBefore: raw.recommendedBefore ?? [],
    recommendedAfter: raw.recommendedAfter ?? [],
    cautions: raw.cautions ?? [],
    genres: raw.genres ?? [],
    categories: [...categories].sort(),
    tags,
    artefacts: [...new Set(raw.artefacts ?? [])].sort(),
    packages: raw.packages ?? [],
    ccMappings: raw.ccMappings ?? [],
    parameters: (raw.parameters ?? []).map(p => normaliseParameter(p, { context })),
    lv2Classes: raw.lv2Classes ?? []
  }
}

export default normalisePlugin
