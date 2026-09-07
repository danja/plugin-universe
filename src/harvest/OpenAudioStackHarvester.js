import fs from 'fs'
import { Harvester, HarvestError } from './Harvester.js'
import HttpSource from './HttpSource.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

const trn = NAMESPACES.trn

/**
 * Harvests the Open Audio Stack registry.
 *
 * The registry is a static JSON API generated from YAML in git, published under
 * CC0-1.0 and built explicitly for third-party integration — "an open API
 * (static JSON) you can integrate into your own products". It is the cleanest
 * external source available: CC0 in, CC0 out, no notice to carry and no
 * database-right analysis to do (docs/resources.md §4).
 *
 * The registry is also the model for this project's packaging layer, so its
 * manifest maps onto pu:Package and pu:PackageFile with no invention.
 *
 * Two things the registry supplies that the seed corpus does not: checksummed
 * download URLs with platform and architecture coverage, and 559 plugins by
 * authors other than the catalogue's own.
 */

/**
 * Registry payload kinds to plugin formats.
 *
 * `contains` mixes plugin formats with raw binary and installer payloads. Only
 * the unambiguous plugin formats are mapped; the rest are recorded verbatim as
 * pu:containsArtefact. A bare "dll" or "so" is very probably a VST2, but
 * "probably" is not a fact, and the catalogue's own rule is that a scan wins
 * over a guess — so it waits for the profiler rather than being asserted here.
 */
export const FORMAT_MAP = Object.freeze({
  vst3: `${trn}VST3`,
  vst: `${trn}VST2`,
  clap: `${trn}CLAP`,
  lv2: `${trn}LV2`,
  component: `${trn}AudioUnit`,
  au: `${trn}AudioUnit`,
  auv2: `${trn}AudioUnit`,
  aax: `${trn}AAX`,
  app: `${trn}Standalone`
})

/**
 * Registry package types to roles and categories.
 *
 * The registry's "tool" covers analysers, meters and utilities; "generator"
 * covers tone and noise sources, which are instruments that take no notes.
 */
export const TYPE_MAP = Object.freeze({
  effect: { roles: [`${trn}AudioEffect`], categories: ['effect'] },
  instrument: { roles: [`${trn}AudioInstrument`, `${trn}Instrument`], categories: ['instrument'] },
  sampler: { roles: [`${trn}AudioInstrument`, `${trn}Instrument`], categories: ['instrument', 'sampler'] },
  generator: { roles: [`${trn}AudioInstrument`], categories: ['instrument', 'generator'] },
  tool: { roles: [`${trn}Utility`], categories: ['utility'] }
})

/**
 * Registry tags to catalogue categories.
 *
 * Deliberately partial. A tag with no entry here is not discarded — it is kept
 * as a pu:tag literal and still feeds retrieval — so the cost of leaving a tag
 * unmapped is small, and the cost of mapping one wrongly is a facet that lies.
 * Tags describing implementation ("juce", "dsp", "gen") or format ("vst3",
 * "lv2") are intentionally absent: the format is already a fact of the package.
 */
export const TAG_CATEGORY_MAP = Object.freeze({
  reverb: ['effect', 'reverb'],
  delay: ['effect', 'delay'],
  echo: ['effect', 'delay'],
  distortion: ['effect', 'distortion'],
  saturation: ['effect', 'distortion', 'saturation'],
  fuzz: ['effect', 'distortion'],
  overdrive: ['effect', 'distortion'],
  bitcrusher: ['effect', 'distortion'],
  waveshaper: ['effect', 'distortion'],
  compressor: ['effect', 'dynamics', 'compressor'],
  compression: ['effect', 'dynamics', 'compressor'],
  limiter: ['effect', 'dynamics', 'limiter'],
  dynamics: ['effect', 'dynamics'],
  gate: ['effect', 'dynamics'],
  expander: ['effect', 'dynamics'],
  eq: ['effect', 'eq'],
  equalizer: ['effect', 'eq'],
  equaliser: ['effect', 'eq'],
  filter: ['effect', 'filter'],
  modulation: ['effect', 'modulation'],
  chorus: ['effect', 'modulation'],
  phaser: ['effect', 'modulation'],
  flanger: ['effect', 'modulation'],
  tremolo: ['effect', 'modulation'],
  vibrato: ['effect', 'modulation'],
  spatial: ['effect', 'spatial'],
  stereo: ['effect', 'spatial'],
  panner: ['effect', 'spatial'],
  midi: ['midi'],
  'midi effect': ['midi'],
  sequencer: ['midi', 'sequencer'],
  arpeggiator: ['midi', 'sequencer'],
  synthesizer: ['instrument', 'synth'],
  synthesiser: ['instrument', 'synth'],
  synth: ['instrument', 'synth'],
  wavetable: ['instrument', 'synth'],
  fm: ['instrument', 'synth'],
  additive: ['instrument', 'synth'],
  subtractive: ['instrument', 'synth'],
  granular: ['instrument', 'synth', 'granular'],
  sampler: ['instrument', 'sampler'],
  sfz: ['instrument', 'sampler'],
  drums: ['instrument', 'drums'],
  'drum machine': ['instrument', 'drums'],
  bass: ['instrument', 'bass'],
  piano: ['instrument', 'piano'],
  organ: ['instrument', 'organ'],
  guitar: ['guitar'],
  amp: ['guitar', 'amp'],
  pedal: ['guitar', 'amp'],
  cabinet: ['guitar', 'amp'],
  analyzer: ['utility', 'analysis'],
  analyser: ['utility', 'analysis'],
  spectrogram: ['utility', 'analysis'],
  spectrum: ['utility', 'analysis'],
  oscilloscope: ['utility', 'analysis'],
  visualizer: ['utility', 'analysis'],
  meter: ['utility', 'analysis'],
  loudness: ['utility', 'analysis'],
  tuner: ['utility', 'analysis'],
  utility: ['utility'],
  mixer: ['utility', 'mixing']
})

/**
 * Registry licence slugs (choosealicense.com naming) to SPDX identifiers.
 *
 * This is the *plugin's* licence and has nothing to do with the graph's: the
 * registry metadata is CC0 whatever the software it describes is licensed
 * under. Conflating the two would put a GPL flag on a CC0 fact.
 */
export const LICENCE_MAP = Object.freeze({
  '0bsd': '0BSD',
  'afl-3.0': 'AFL-3.0',
  'agpl-3.0': 'AGPL-3.0',
  'apache-2.0': 'Apache-2.0',
  'artistic-2.0': 'Artistic-2.0',
  'bsd-2-clause': 'BSD-2-Clause',
  'bsd-3-clause': 'BSD-3-Clause',
  'bsl-1.0': 'BSL-1.0',
  'cc-by-4.0': 'CC-BY-4.0',
  'cc-by-sa-4.0': 'CC-BY-SA-4.0',
  'cc0-1.0': 'CC0-1.0',
  'epl-2.0': 'EPL-2.0',
  'eupl-1.2': 'EUPL-1.2',
  'gpl-2.0': 'GPL-2.0',
  'gpl-3.0': 'GPL-3.0',
  isc: 'ISC',
  'lgpl-2.1': 'LGPL-2.1',
  'lgpl-3.0': 'LGPL-3.0',
  'mit': 'MIT',
  'mpl-2.0': 'MPL-2.0',
  unlicense: 'Unlicense',
  zlib: 'Zlib'
})

export class OpenAudioStackHarvester extends Harvester {
  /**
   * @param {object} spec
   * @param {string} spec.registryUrl - the static JSON endpoint
   * @param {string|null} [spec.cachePath] - where to keep the fetched body
   * @param {number} [spec.maxCacheAgeMs]
   * @param {string|null} [spec.registryPath] - read a local file instead of
   *   fetching. Used by the tests, so they neither need the network nor cost
   *   the source anything.
   */
  constructor ({
    registryUrl = null,
    registryPath = null,
    cachePath = null,
    maxCacheAgeMs = 24 * 60 * 60 * 1000,
    id = 'open-audio-stack'
  } = {}) {
    super({
      id,
      kind: 'source',
      // Verified 2026-09-06 and re-checked at implementation: the repository's
      // GitHub licence metadata is CC0-1.0. See docs/resources.md §4.
      licence: 'CC0-1.0',
      derivedFrom: registryUrl ?? registryPath ?? 'https://github.com/open-audio-stack/open-audio-stack-registry'
    })
    if (!registryUrl && !registryPath) {
      throw new HarvestError('OpenAudioStackHarvester needs registryUrl or registryPath')
    }
    this.registryUrl = registryUrl
    this.registryPath = registryPath
    this.cachePath = cachePath
    this.http = new HttpSource({ maxCacheAgeMs })
  }

  async load () {
    if (this.registryPath) {
      if (!fs.existsSync(this.registryPath)) {
        throw new HarvestError(`No registry file at ${this.registryPath}`, { source: this.registryPath })
      }
      return JSON.parse(await fs.promises.readFile(this.registryPath, 'utf8'))
    }
    return this.http.fetchJson(this.registryUrl, this.cachePath)
  }

  /** The IRI of the registry's own entry for a package, for rdfs:seeAlso. */
  registryEntryUrl (slug) {
    const base = (this.registryUrl ?? '').replace(/\/index\.json$/, '')
    return base ? `${base}/${slug}/index.json` : null
  }

  /**
   * One registry package to a raw record.
   *
   * Only the latest version is described as the plugin. Older versions remain
   * in the registry and could be modelled as further pu:Package resources; that
   * is history, and history is not what a catalogue query asks for.
   */
  #readPackage (slug, pkg) {
    const version = pkg.versions?.[pkg.version]
    if (!version) {
      throw new HarvestError(`Registry package ${slug} names version ${pkg.version}, which it does not contain`)
    }

    const formats = new Set()
    const artefacts = new Set()
    const files = []
    for (const file of version.files ?? []) {
      const fileFormats = []
      for (const payload of file.contains ?? []) {
        const format = FORMAT_MAP[payload]
        if (format) {
          formats.add(format)
          fileFormats.push(format)
        } else {
          artefacts.add(payload)
        }
      }
      files.push({
        url: file.url ?? null,
        sha256: file.sha256 ?? null,
        size: typeof file.size === 'number' ? file.size : null,
        kind: file.type ?? null,
        formats: fileFormats,
        artefacts: (file.contains ?? []).filter(payload => !FORMAT_MAP[payload]),
        architectures: file.architectures ?? [],
        systems: (file.systems ?? []).map(system => system.type).filter(Boolean),
        attested: file.attested === true,
        downloads: typeof file.downloads === 'number' ? file.downloads : null
      })
    }

    const typeMapping = TYPE_MAP[version.type]
    const categories = new Set(typeMapping?.categories ?? [])
    const tags = []
    for (const raw of version.tags ?? []) {
      const tag = String(raw).trim().toLowerCase()
      if (!tag) continue
      tags.push(tag)
      for (const category of TAG_CATEGORY_MAP[tag] ?? []) categories.add(category)
    }

    // The plugin's own licence. Unmapped values — including the registry's
    // literal "other" — are kept as written rather than guessed at or dropped.
    const licence = version.license ? (LICENCE_MAP[version.license] ?? version.license) : null

    return {
      registryId: slug,
      name: version.name,
      description: version.description ?? null,
      vendor: version.author ?? null,
      homepage: version.url ?? null,
      licence,
      formats: [...formats],
      artefacts: [...artefacts],
      roles: typeMapping?.roles ?? [],
      categories: [...categories],
      tags,
      seeAlso: this.registryEntryUrl(slug),
      image: version.image ?? null,
      audioPreview: version.audio ?? null,
      donateUrl: version.donate ?? null,
      downloadCount: typeof pkg.downloads === 'number' ? pkg.downloads : null,
      verified: version.verified === true,
      packages: [{
        version: pkg.version,
        releasedAt: version.date ?? null,
        changes: version.changes ?? null,
        files
      }]
    }
  }

  async collect () {
    const registry = await this.load()
    if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
      throw new HarvestError('The registry index must be an object keyed by package slug')
    }

    const records = []
    const rejected = []
    for (const [slug, pkg] of Object.entries(registry)) {
      // A package the registry cannot resolve is reported, not skipped in
      // silence and not allowed to block the rest of the ingest.
      try {
        records.push(this.#readPackage(slug, pkg))
      } catch (error) {
        rejected.push({ name: slug, reason: error.message })
      }
    }
    return { records, rejected }
  }
}

export default OpenAudioStackHarvester
