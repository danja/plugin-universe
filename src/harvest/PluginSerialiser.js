import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../store/SPARQLHelper.js'

/**
 * Normalised plugin records to triples.
 *
 * Parameters are emitted as lv2:port, per docs/architecture.md §2.3. Ports are
 * blank nodes: a parameter has no identity outside its plugin, and minting IRIs
 * for 914 of them would be noise in every query result.
 */

const trn = NAMESPACES.trn
const lv2 = NAMESPACES.lv2
const pu = NAMESPACES.pu
const rdf = NAMESPACES.rdf
const rdfs = NAMESPACES.rdfs
const dcterms = NAMESPACES.dcterms
const foaf = NAMESPACES.foaf
const owl = NAMESPACES.owl
const skos = NAMESPACES.skos

let blankCounter = 0
function blank (prefix) {
  blankCounter += 1
  return `_:${prefix}${blankCounter}`
}

/** Reset between ingests so labels stay short and runs are reproducible. */
export function resetBlankCounter () {
  blankCounter = 0
}

function scalarTerm (value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'boolean') return typedLiteral(value)
  return literal(String(value))
}

/**
 * @param {object} plugin - a normalised plugin record
 * @param {string} pluginIri - the minted catalogue IRI
 * @returns {string[]} triples, each a complete statement
 */
export function serialisePlugin (plugin, pluginIri) {
  const s = iri(pluginIri)
  const triples = []
  const add = (predicate, object) => {
    if (object === null || object === undefined) return
    triples.push(`${s} ${iri(predicate)} ${object} .`)
  }

  triples.push(`${s} ${iri(rdf + 'type')} ${iri(trn + 'PluginProfile')} .`)
  add(rdfs + 'label', literal(plugin.name))
  add(rdfs + 'comment', plugin.description ? literal(plugin.description) : null)
  add(trn + 'vendor', plugin.vendor ? literal(plugin.vendor) : null)
  add(trn + 'bundleName', plugin.bundleName ? literal(plugin.bundleName) : null)
  add(trn + 'vstClassId', plugin.classId ? literal(plugin.classId) : null)
  // An IRI, not a literal: foaf:homepage ranges over foaf:Document, and a
  // consumer following the link needs something to follow. The normaliser has
  // already discarded anything that is not an absolute http(s) URL.
  add(foaf + 'homepage', plugin.homepage ? iri(plugin.homepage) : null)
  add(lv2 + 'project', plugin.project ? literal(plugin.project) : null)
  add(dcterms + 'license', plugin.licence ? literal(plugin.licence) : null)
  add(pu + 'licenceId', plugin.licenceId ? literal(plugin.licenceId) : null)
  // Can I see the source, and do I have to pay. Absent means nobody has said.
  add(pu + 'sourceAvailability', plugin.sourceAvailability ? iri(plugin.sourceAvailability) : null)
  add(pu + 'pricing', plugin.pricing ? iri(plugin.pricing) : null)
  add(pu + 'slug', plugin.registryId ? literal(plugin.registryId) : null)
  // The registry entry is a document *about* the plugin, so it is seeAlso, not
  // sameAs. Only a genuine upstream IRI for the plugin itself earns sameAs.
  add(rdfs + 'seeAlso', plugin.seeAlso ? iri(plugin.seeAlso) : null)
  add(foaf + 'depiction', plugin.image ? iri(plugin.image) : null)
  add(pu + 'audioPreview', plugin.audioPreview ? iri(plugin.audioPreview) : null)
  add(pu + 'donateUrl', plugin.donateUrl ? iri(plugin.donateUrl) : null)
  add(pu + 'downloadCount',
    typeof plugin.downloadCount === 'number' ? typedLiteral(plugin.downloadCount) : null)
  if (plugin.verified) add(pu + 'verified', typedLiteral(true))

  // An upstream canonical IRI is preserved rather than replaced. LV2 plugins
  // have one by design and it is dereferenceable, so discarding it would lose
  // the link back to the authoritative description.
  if (plugin.sourceIri && plugin.sourceIri !== pluginIri) {
    add(owl + 'sameAs', iri(plugin.sourceIri))
  }

  for (const role of plugin.roles) add(trn + 'role', iri(role))
  for (const format of plugin.formats) add(trn + 'format', iri(format))
  for (const signal of plugin.accepts) add(trn + 'accepts', iri(signal))
  for (const signal of plugin.produces) add(trn + 'produces', iri(signal))
  for (const requirement of plugin.requires) add(trn + 'requires', iri(requirement))
  for (const other of plugin.recommendedBefore) add(trn + 'recommendedBefore', iri(other))
  for (const other of plugin.recommendedAfter) add(trn + 'recommendedAfter', iri(other))
  for (const caution of plugin.cautions) add(trn + 'caution', literal(caution))
  for (const genre of plugin.genres) add(trn + 'genre', literal(genre))
  for (const lv2Class of plugin.lv2Classes) {
    if (lv2Class !== `${lv2}Plugin`) add(rdf + 'type', iri(lv2Class))
  }

  // Categories are SKOS concepts, not classes: plugin categories overlap and
  // are contested, which is what a concept scheme is for.
  for (const category of plugin.categories) {
    add(pu + 'category', iri(`${pu}category/${category}`))
  }
  // Tags are the source's own keywords, kept unmapped alongside the categories
  // they produced. They cost one triple each and they are what a later mapping
  // decision gets to revisit without re-harvesting.
  for (const tag of plugin.tags ?? []) add(pu + 'tag', literal(tag))
  for (const artefact of plugin.artefacts ?? []) add(pu + 'containsArtefact', literal(artefact))

  for (const parameter of plugin.parameters) {
    const node = blank('p')
    triples.push(`${s} ${iri(lv2 + 'port')} ${node} .`)
    triples.push(`${node} ${iri(rdf + 'type')} ${iri(lv2 + 'ControlPort')} .`)
    triples.push(`${node} ${iri(rdf + 'type')} ${iri(parameter.direction === 'output' ? lv2 + 'OutputPort' : lv2 + 'InputPort')} .`)
    triples.push(`${node} ${iri(lv2 + 'symbol')} ${literal(parameter.symbol)} .`)
    triples.push(`${node} ${iri(lv2 + 'name')} ${literal(parameter.name)} .`)

    const emit = (predicate, term) => {
      if (term !== null) triples.push(`${node} ${iri(predicate)} ${term} .`)
    }
    emit(rdfs + 'comment', parameter.comment ? literal(parameter.comment) : null)
    emit(lv2 + 'default', scalarTerm(parameter.default))
    emit(lv2 + 'minimum', scalarTerm(parameter.minimum))
    emit(lv2 + 'maximum', scalarTerm(parameter.maximum))
    if (parameter.integer) emit(lv2 + 'portProperty', iri(lv2 + 'integer'))
    if (parameter.unitIri) emit(NAMESPACES.units + 'unit', iri(parameter.unitIri))
    // The label is kept even when the unit could not be typed: losing it would
    // be worse than failing to map it.
    emit(pu + 'unitLabel', parameter.unitLabel ? literal(parameter.unitLabel) : null)

    for (const point of parameter.scalePoints) {
      const pointNode = blank('sp')
      triples.push(`${node} ${iri(lv2 + 'scalePoint')} ${pointNode} .`)
      triples.push(`${pointNode} ${iri(rdfs + 'label')} ${literal(point.label ?? '')} .`)
      if (point.value !== null && point.value !== undefined) {
        triples.push(`${pointNode} ${iri(rdf + 'value')} ${typedLiteral(point.value)} .`)
      }
    }
  }

  for (const mapping of plugin.ccMappings) {
    const node = blank('cc')
    triples.push(`${s} ${iri(trn + 'ccMapping')} ${node} .`)
    const emit = (predicate, term) => {
      if (term !== null) triples.push(`${node} ${iri(predicate)} ${term} .`)
    }
    emit(trn + 'ccNumber', mapping.ccNumber !== null && mapping.ccNumber !== undefined ? typedLiteral(mapping.ccNumber) : null)
    emit(trn + 'ccRole', mapping.ccRole ? literal(mapping.ccRole) : null)
    emit(trn + 'targetParameter', mapping.targetParameter ? literal(mapping.targetParameter) : null)
    emit(trn + 'ccTriggerValue', mapping.triggerValue !== null && mapping.triggerValue !== undefined ? typedLiteral(mapping.triggerValue) : null)
    emit(rdfs + 'comment', mapping.comment ? literal(mapping.comment) : null)
  }

  triples.push(...serialisePackages(plugin, pluginIri))

  return triples
}

/**
 * Package and file triples, modelled on the Open Audio Stack manifest.
 *
 * These are what make the catalogue useful for something other than reading:
 * a checksummed download URL per platform and architecture is the difference
 * between "this plugin exists" and "here is the artefact and here is its
 * SHA-256". Packages and files are blank nodes for the same reason ports are —
 * neither has an identity outside the plugin that has it.
 */
export function serialisePackages (plugin, pluginIri) {
  const s = iri(pluginIri)
  const triples = []
  for (const pkg of plugin.packages ?? []) {
    const node = blank('pkg')
    triples.push(`${s} ${iri(pu + 'package')} ${node} .`)
    triples.push(`${node} ${iri(rdf + 'type')} ${iri(pu + 'Package')} .`)
    const emit = (predicate, term) => {
      if (term !== null) triples.push(`${node} ${iri(predicate)} ${term} .`)
    }
    emit(pu + 'packageVersion', pkg.version ? literal(pkg.version) : null)
    emit(dcterms + 'issued', pkg.releasedAt ? literal(pkg.releasedAt) : null)
    emit(rdfs + 'comment', pkg.changes ? literal(pkg.changes) : null)

    for (const file of pkg.files ?? []) {
      const fileNode = blank('file')
      triples.push(`${node} ${iri(pu + 'packageFile')} ${fileNode} .`)
      triples.push(`${fileNode} ${iri(rdf + 'type')} ${iri(pu + 'PackageFile')} .`)
      const emitFile = (predicate, term) => {
        if (term !== null) triples.push(`${fileNode} ${iri(predicate)} ${term} .`)
      }
      emitFile(pu + 'downloadUrl', file.url ? iri(file.url) : null)
      emitFile(pu + 'sha256', file.sha256 ? literal(file.sha256) : null)
      emitFile(pu + 'fileSize', typeof file.size === 'number' ? typedLiteral(file.size) : null)
      emitFile(pu + 'fileKind', file.kind ? literal(file.kind) : null)
      emitFile(pu + 'downloadCount', typeof file.downloads === 'number' ? typedLiteral(file.downloads) : null)
      if (file.attested) emitFile(pu + 'attested', typedLiteral(true))
      for (const format of file.formats ?? []) emitFile(pu + 'containsFormat', iri(format))
      for (const artefact of file.artefacts ?? []) emitFile(pu + 'containsArtefact', literal(artefact))
      for (const architecture of file.architectures ?? []) emitFile(pu + 'architecture', literal(architecture))
      for (const system of file.systems ?? []) emitFile(pu + 'operatingSystem', literal(system))
    }
  }
  return triples
}

/** The SKOS concept scheme, emitted once into the alignment graph. */
export function serialiseCategoryScheme (categories) {
  const scheme = `${pu}categories`
  const triples = [
    `${iri(scheme)} ${iri(rdf + 'type')} ${iri(skos + 'ConceptScheme')} .`,
    `${iri(scheme)} ${iri(rdfs + 'label')} ${literal('Plugin Universe categories')} .`
  ]
  const broader = {
    compressor: 'dynamics',
    limiter: 'dynamics',
    dynamics: 'effect',
    reverb: 'effect',
    delay: 'effect',
    distortion: 'effect',
    saturation: 'distortion',
    modulation: 'effect',
    eq: 'effect',
    filter: 'effect',
    spatial: 'effect',
    oscillator: 'instrument',
    synth: 'instrument',
    granular: 'synth',
    sampler: 'instrument',
    generator: 'instrument',
    drums: 'instrument',
    bass: 'instrument',
    piano: 'instrument',
    organ: 'instrument',
    sequencer: 'midi',
    amp: 'guitar',
    analysis: 'utility',
    mixing: 'utility'
  }
  // Close the set over skos:broader before emitting. Without this a scheme can
  // point at a concept it never declares, which is a dangling reference that
  // only shows up when something tries to walk the hierarchy.
  const closed = new Set(categories)
  for (const category of categories) {
    let parent = broader[category]
    while (parent && !closed.has(parent)) {
      closed.add(parent)
      parent = broader[parent]
    }
  }

  for (const category of [...closed].sort()) {
    const concept = `${pu}category/${category}`
    triples.push(`${iri(concept)} ${iri(rdf + 'type')} ${iri(skos + 'Concept')} .`)
    triples.push(`${iri(concept)} ${iri(skos + 'inScheme')} ${iri(scheme)} .`)
    triples.push(`${iri(concept)} ${iri(skos + 'prefLabel')} ${literal(category)} .`)
    if (broader[category]) {
      triples.push(`${iri(concept)} ${iri(skos + 'broader')} ${iri(`${pu}category/${broader[category]}`)} .`)
    }
  }
  return triples
}

export default serialisePlugin
