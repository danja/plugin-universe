import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal } from '../store/SPARQLHelper.js'

/**
 * The machine-readable views: Turtle and JSON-LD.
 *
 * Split out of `render.js`, which had grown past the point where it had one
 * reason to change. These are not rendering: they produce the representations
 * a machine asks for by content negotiation — a plugin IRI dereferenced with
 * `Accept: text/turtle` is the reason for minting dereferenceable IRIs at all —
 * and they change when the graph model changes. The HTML changes when the
 * pages do. Two reasons to change, so two files.
 */

/**
 * Whether a value is something a link can point at.
 *
 * Lives here rather than in render.js because both serialisations need it to
 * decide whether a recorded provenance is a URL or a local path, and a local
 * path must not become an `<a href>` or an `rdfs:seeAlso`.
 */
export /** Only an http(s) URL is rendered as a link; anything else is shown as text. */
function linkable (value) {
  if (!value) return false
  try {
    return /^https?:$/.test(new URL(value).protocol)
  } catch {
    return false
  }
}

/**
 * schema.org JSON-LD for a plugin page. This is what makes the catalogue
 * legible to search engines without them parsing the RDF.
 */
export function pluginJsonLd (doc) {
  const keywords = [...(doc.formats ?? []), ...(doc.categories ?? []), ...(doc.tags ?? [])].join(', ')
  const subCategory = doc.categories?.join(', ')

  // Keys are added only when there is something to say. An `author: undefined`
  // survives in the object even though JSON.stringify drops it, and a consumer
  // reading the object directly would see a property that is not there.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': doc.iri,
    name: doc.name,
    applicationCategory: 'MultimediaApplication',
    license: 'https://creativecommons.org/publicdomain/zero/1.0/'
  }
  if (doc.description) ld.description = doc.description
  if (subCategory) ld.applicationSubCategory = subCategory
  if (doc.vendor) ld.author = { '@type': 'Organization', name: doc.vendor }
  if (doc.homepage) ld.url = doc.homepage
  if (doc.seeAlso) ld.sameAs = doc.seeAlso
  if (doc.image) ld.image = doc.image
  if (linkable(doc.provenance?.derivedFrom)) ld.isBasedOn = doc.provenance.derivedFrom
  if (keywords) ld.keywords = keywords
  return ld
}

/** Turtle for one plugin, for content-negotiated dereferencing. */
export function pluginTurtle (doc) {
  const lines = [
    `@prefix trn: <${NAMESPACES.trn}> .`,
    `@prefix pu: <${NAMESPACES.pu}> .`,
    `@prefix rdfs: <${NAMESPACES.rdfs}> .`,
    `@prefix dcterms: <${NAMESPACES.dcterms}> .`,
    `@prefix foaf: <${NAMESPACES.foaf}> .`,
    `@prefix prov: <${NAMESPACES.prov}> .`,
    '',
    `${iri(doc.iri)}`,
    `    a trn:PluginProfile ;`,
    `    rdfs:label ${literal(doc.name)} ;`
  ]
  if (doc.vendor) lines.push(`    trn:vendor ${literal(doc.vendor)} ;`)
  if (doc.description) lines.push(`    rdfs:comment ${literal(doc.description)} ;`)
  if (doc.homepage) lines.push(`    foaf:homepage ${iri(doc.homepage)} ;`)
  if (doc.seeAlso) lines.push(`    rdfs:seeAlso ${iri(doc.seeAlso)} ;`)
  if (doc.image) lines.push(`    foaf:depiction ${iri(doc.image)} ;`)
  if (linkable(doc.provenance?.derivedFrom)) {
    lines.push(`    prov:wasDerivedFrom ${iri(doc.provenance.derivedFrom)} ;`)
  }
  for (const format of doc.formats ?? []) lines.push(`    trn:format trn:${format} ;`)
  // Category IRIs are written out in full: a Turtle prefixed name may not
  // contain a slash, so pu:category/midi does not parse.
  for (const category of doc.categories ?? []) {
    lines.push(`    pu:category ${iri(`${NAMESPACES.pu}category/${category}`)} ;`)
  }
  for (const tag of doc.tags ?? []) lines.push(`    pu:tag ${literal(tag)} ;`)
  lines.push('    dcterms:license <https://creativecommons.org/publicdomain/zero/1.0/> .')
  return lines.join('\n')
}

/** Turtle for one category concept and its members. */
export function categoryTurtle (slug, results, concept = null) {
  const iriOf = `${NAMESPACES.pu}category/${slug}`
  const category = value => iri(`${NAMESPACES.pu}category/${value}`)
  const lines = [
    `@prefix pu: <${NAMESPACES.pu}> .`,
    `@prefix skos: <${NAMESPACES.skos}> .`,
    '',
    `${iri(iriOf)}`,
    '    a skos:Concept ;',
    `    skos:inScheme ${iri(`${NAMESPACES.pu}categories`)} ;`
  ]
  // Everything the scheme holds about this concept, so that dereferencing the
  // IRI returns the concept rather than a stub of it.
  for (const label of concept?.altLabels ?? []) lines.push(`    skos:altLabel ${literal(label)} ;`)
  if (concept?.definition) lines.push(`    skos:definition ${literal(concept.definition)} ;`)
  if (concept?.scopeNote) lines.push(`    skos:scopeNote ${literal(concept.scopeNote)} ;`)
  if (concept?.broader) lines.push(`    skos:broader ${category(concept.broader)} ;`)
  for (const narrower of concept?.narrower ?? []) lines.push(`    skos:narrower ${category(narrower)} ;`)
  for (const related of concept?.related ?? []) lines.push(`    skos:related ${category(related)} ;`)
  for (const match of concept?.closeMatches ?? []) lines.push(`    skos:closeMatch ${iri(match)} ;`)
  lines.push(`    skos:prefLabel ${literal(concept?.prefLabel ?? slug)} .`, '')
  for (const result of results) {
    lines.push(`${iri(result.iri)} pu:category ${iri(iriOf)} .`)
  }
  return lines.join('\n')
}
