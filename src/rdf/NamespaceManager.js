import namespace from '@rdfjs/namespace'

/**
 * The single registry of namespace IRIs for this project.
 *
 * Nothing else in the codebase declares a namespace IRI. This is not style: a
 * prefix defined in more than one place ends up meaning more than one thing,
 * and the resulting data is wrong in a way that is very hard to see.
 *
 * See docs/architecture.md §2.0.
 */
export const NAMESPACES = Object.freeze({
  // Core RDF/OWL
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',

  // Project vocabularies
  trn: 'http://purl.org/stuff/transmissions/',
  pu: 'http://purl.org/stuff/plugin-universe/',

  // Plugin description
  lv2: 'http://lv2plug.in/ns/lv2core#',
  units: 'http://lv2plug.in/ns/extensions/units#',
  atom: 'http://lv2plug.in/ns/ext/atom#',
  midi: 'http://lv2plug.in/ns/ext/midi#',
  time: 'http://lv2plug.in/ns/ext/time#',
  ui: 'http://lv2plug.in/ns/extensions/ui#',

  // Projects, people, products
  doap: 'http://usefulinc.com/ns/doap#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  schema: 'https://schema.org/',

  // Description, provenance, licensing
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dcterms: 'http://purl.org/dc/terms/',
  prov: 'http://www.w3.org/ns/prov#',
  spdx: 'http://spdx.org/rdf/terms#',
  void: 'http://rdfs.org/ns/void#',
  sh: 'http://www.w3.org/ns/shacl#'
})

export class NamespaceManager {
  constructor () {
    for (const [prefix, iri] of Object.entries(NAMESPACES)) {
      this[prefix] = namespace(iri)
    }
  }

  /** SPARQL PREFIX block covering every registered namespace. */
  sparqlPrefixes () {
    return Object.entries(NAMESPACES)
      .map(([prefix, iri]) => `PREFIX ${prefix}: <${iri}>`)
      .join('\n')
  }

  /** Turtle @prefix block covering every registered namespace. */
  turtlePrefixes () {
    return Object.entries(NAMESPACES)
      .map(([prefix, iri]) => `@prefix ${prefix}: <${iri}> .`)
      .join('\n')
  }

  /** Shorten an IRI to prefix:local form, or return it unchanged. */
  shrink (iri) {
    for (const [prefix, base] of Object.entries(NAMESPACES)) {
      if (iri.startsWith(base)) return `${prefix}:${iri.slice(base.length)}`
    }
    return iri
  }

  /** Expand prefix:local to a full IRI. Throws on an unregistered prefix. */
  expand (curie) {
    const colon = curie.indexOf(':')
    if (colon === -1) throw new Error(`Not a CURIE: ${curie}`)
    const prefix = curie.slice(0, colon)
    if (!(prefix in NAMESPACES)) throw new Error(`Unregistered prefix: ${prefix}`)
    return NAMESPACES[prefix] + curie.slice(colon + 1)
  }
}

export default NamespaceManager
