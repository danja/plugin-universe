import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import ShapeValidator, { parseTriples, summarise } from '../../src/store/ShapeValidator.js'
import { LICENCES } from '../../src/store/GraphRegistry.js'
import { LICENCE_IDS } from '../../src/harvest/Licensing.js'
import { serialisePlugin } from '../../src/harvest/PluginSerialiser.js'
import { normalisePlugin } from '../../src/harvest/Normaliser.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

const trn = NAMESPACES.trn
const pu = NAMESPACES.pu
const lv2 = NAMESPACES.lv2
const rdfs = NAMESPACES.rdfs
const rdf = NAMESPACES.rdf

/**
 * The shapes exist to catch defects that are otherwise invisible, so the thing
 * worth testing is that they fire — a shape file that passes everything is
 * worse than no shape file, because it looks like validation.
 */

const IRI = `${pu}plugin/test-00000000`

describe('the shapes and the code agree about licences', () => {
  /**
   * GraphRegistry.LICENCES decides what a harvester may declare; the SHACL
   * shape decides what validates. Nothing keeps a Turtle list and a JavaScript
   * object in step except a test, and when they drifted the symptom was 136
   * violations in production — every graph the GitHub harvester registered
   * under a copyleft licence, because the shape still listed only the six the
   * seed corpus happened to use.
   */
  it('allows exactly the licences the registry accepts', () => {
    const shapes = fs.readFileSync('vocabs/shapes.ttl', 'utf8')
    const block = shapes.match(/sh:in \(([^)]*)\)\s*;\s*\n\s*sh:message "Every graph declares a licence/)
    expect(block, 'could not find the graph licence sh:in list').not.toBeNull()
    const allowed = [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]).sort()
    expect(allowed).toEqual(Object.keys(LICENCES).sort())
  })
})

describe('the validation shapes', () => {
  let validator
  beforeAll(async () => { validator = await ShapeValidator.load() })

  const validate = async triples => validator.validate(await parseTriples(triples))

  it('accepts a well-formed plugin', async () => {
    const plugin = normalisePlugin({
      name: 'Test Verb',
      vendor: 'Acme',
      description: 'A plate reverb.',
      formats: [`${trn}VST3`],
      roles: [`${trn}AudioEffect`],
      tags: ['reverb'],
      categories: ['effect', 'reverb'],
      parameters: [{ symbol: 'decay', name: 'Decay', minimum: 0, maximum: 10, unit: 's' }]
    })
    const report = await validate(serialisePlugin(plugin, IRI))
    expect(summarise(report)).toBe('conforms')
  })

  it('rejects a plugin with no label', async () => {
    const report = await validate([`<${IRI}> <${rdf}type> <${trn}PluginProfile> .`])
    expect(report.conforms).toBe(false)
    expect(report.results.some(r => r.path === `${rdfs}label`)).toBe(true)
  })

  it('rejects a format IRI that is not one of the known individuals', async () => {
    // A typo here creates a facet that matches nothing, silently.
    const report = await validate([
      `<${IRI}> <${rdf}type> <${trn}PluginProfile> .`,
      `<${IRI}> <${rdfs}label> "Typo" .`,
      `<${IRI}> <${trn}format> <${trn}VST4> .`
    ])
    expect(report.conforms).toBe(false)
    expect(report.results.some(r => r.value === `${trn}VST4`)).toBe(true)
  })

  it('rejects a category outside the concept scheme', async () => {
    const report = await validate([
      `<${IRI}> <${rdf}type> <${trn}PluginProfile> .`,
      `<${IRI}> <${rdfs}label> "Stray" .`,
      `<${IRI}> <${pu}category> <https://example.invalid/tags/reverb> .`
    ])
    expect(report.conforms).toBe(false)
  })

  it('rejects an upper-case tag, because tags are folded at normalisation', async () => {
    const report = await validate([
      `<${IRI}> <${rdf}type> <${trn}PluginProfile> .`,
      `<${IRI}> <${rdfs}label> "Shouty" .`,
      `<${IRI}> <${pu}tag> "Reverb" .`
    ])
    expect(report.conforms).toBe(false)
  })

  it('rejects a port whose minimum exceeds its maximum', async () => {
    const report = await validate([
      `<${IRI}> <${rdf}type> <${trn}PluginProfile> .`,
      `<${IRI}> <${rdfs}label> "Backwards" .`,
      `<${IRI}> <${lv2}port> _:p1 .`,
      `_:p1 <${rdf}type> <${lv2}ControlPort> .`,
      `_:p1 <${lv2}symbol> "gain" .`,
      `_:p1 <${lv2}name> "Gain" .`,
      `_:p1 <${lv2}minimum> "10"^^<${NAMESPACES.xsd}decimal> .`,
      `_:p1 <${lv2}maximum> "0"^^<${NAMESPACES.xsd}decimal> .`
    ])
    expect(report.conforms).toBe(false)
  })

  it('rejects a port that is a label rather than an identifier', async () => {
    const report = await validate([
      `<${IRI}> <${rdf}type> <${trn}PluginProfile> .`,
      `<${IRI}> <${rdfs}label> "Spaced" .`,
      `<${IRI}> <${lv2}port> _:p1 .`,
      `_:p1 <${rdf}type> <${lv2}ControlPort> .`,
      `_:p1 <${lv2}symbol> "Duck Depth" .`,
      `_:p1 <${lv2}name> "Duck Depth" .`
    ])
    expect(report.conforms).toBe(false)
  })

  it('rejects a half-written port, which is what a split blank node looks like', async () => {
    // A blank node label is scoped to one INSERT DATA request. Splitting a
    // plugin's triples across two requests cut its ports in two: this is the
    // shape of the wreckage, and this shape is what catches it.
    const report = await validate([
      `<${IRI}> <${rdf}type> <${trn}PluginProfile> .`,
      `<${IRI}> <${rdfs}label> "Halved" .`,
      `<${IRI}> <${lv2}port> _:p1 .`,
      `_:p1 <${rdf}type> <${lv2}ControlPort> .`
    ])
    expect(report.conforms).toBe(false)
    expect(report.results.some(r => r.path === `${lv2}symbol`)).toBe(true)
  })

  it('rejects a malformed checksum, which is worse than no checksum', async () => {
    const report = await validate([
      `_:f1 <${rdf}type> <${pu}PackageFile> .`,
      `_:f1 <${pu}downloadUrl> <https://example.invalid/x.zip> .`,
      `_:f1 <${pu}sha256> "not-a-hash" .`
    ])
    expect(report.conforms).toBe(false)
  })

  it('rejects an operating system outside the registry vocabulary', async () => {
    const report = await validate([
      `_:f1 <${rdf}type> <${pu}PackageFile> .`,
      `_:f1 <${pu}downloadUrl> <https://example.invalid/x.zip> .`,
      `_:f1 <${pu}operatingSystem> "windows" .`
    ])
    expect(report.conforms).toBe(false)
  })

  it('rejects a graph registration with no licence flag', async () => {
    const report = await validate([
      `<graph:source/x> <${rdf}type> <${pu}SourceGraph> .`,
      `<graph:source/x> <${NAMESPACES.prov}wasDerivedFrom> "somewhere" .`
    ])
    expect(report.conforms).toBe(false)
    expect(report.results.some(r => r.path === `${NAMESPACES.dcterms}license`)).toBe(true)
  })
})

/**
 * The licence enumeration, and what a warning is for.
 *
 * `sh:severity sh:Warning` was a declaration that did nothing until this shape
 * used it: `rdf-validate-shacl` reports `conforms: false` for any result at
 * all, and two callers refuse to write when that is false. A harvest of 753
 * plugins aborting because one repository has an odd licence string is the
 * opposite of what a warning means, so `ShapeValidator` recomputes `conforms`
 * the way SHACL §3.6 defines it.
 */
describe('licence identifiers', () => {
  let validator
  beforeAll(async () => { validator = await ShapeValidator.load() })
  const validate = async triples => validator.validate(await parseTriples(triples))

  const withLicence = licence => validate([
    `<${IRI}> <${rdf}type> <${trn}PluginProfile> .`,
    `<${IRI}> <${rdfs}label> "Licensed" .`,
    `<${IRI}> <${pu}licenceId> "${licence}" .`
  ])

  it('accepts every identifier the code can produce', async () => {
    for (const licence of LICENCE_IDS) {
      const report = await withLicence(licence)
      expect(report.results, licence).toEqual([])
    }
  })

  it('accepts the unversioned forms, which are not SPDX identifiers', async () => {
    // A DOAP licence URL names the family and not the version. Recording that
    // is the honest answer; recording GPL-3.0 would be a claim nobody made.
    for (const licence of ['GPL', 'LGPL', 'AGPL']) {
      expect((await withLicence(licence)).results, licence).toEqual([])
    }
  })

  it('warns about a spelling it does not recognise', async () => {
    const report = await withLicence('gpl3-ish')
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0].value).toBe('gpl3-ish')
    expect(report.warnings[0].message).toMatch(/Licensing\.js/)
  })

  it('does not let that warning stop a harvest', async () => {
    // The two callers that write to the store refuse when conforms is false.
    const report = await withLicence('gpl3-ish')
    expect(report.conforms).toBe(true)
    expect(report.violations).toEqual([])
  })

  it('still reports a warning in the summary of a conforming graph', async () => {
    // 'conforms' would hide it, and a warning nobody sees is not a warning.
    const report = await withLicence('gpl3-ish')
    expect(summarise(report)).toContain('Warning')
  })

  it('separates a warning from a violation in one report', async () => {
    const report = await validate([
      `<${IRI}> <${rdf}type> <${trn}PluginProfile> .`,
      `<${IRI}> <${rdfs}label> "Both" .`,
      `<${IRI}> <${pu}licenceId> "gpl3-ish" .`,
      `<${IRI}> <${trn}format> <${trn}VST4> .`
    ])
    expect(report.conforms).toBe(false)
    expect(report.violations).toHaveLength(1)
    expect(report.warnings).toHaveLength(1)
  })
})
