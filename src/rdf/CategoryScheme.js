import { parseTurtleFile } from '../harvest/TurtleReader.js'
import { NAMESPACES } from './NamespaceManager.js'
import { iri, literal } from '../store/SPARQLHelper.js'

/**
 * The category concept scheme, read from `vocabs/categories.ttl`.
 *
 * The taxonomy is an ontology, not a data structure: it lived as a JavaScript
 * object literal inside the serialiser holding parent links and nothing else,
 * which is why the scheme in the store had four predicates and could not say
 * what a category meant, what else it is called, or what it corresponds to in
 * LV2. Moving it into `vocabs/` follows the project's own rule — new RDF terms
 * go in the vocabulary first and the code follows the ontology.
 *
 * A category that appears in harvested data but not in the file is still
 * written, with a label and nothing else, and reported. Dropping it would
 * silently lose a facet value that plugins are using; inventing a definition
 * for it would be worse.
 */

const skos = NAMESPACES.skos
const rdf = NAMESPACES.rdf
const pu = NAMESPACES.pu
const SCHEME = `${pu}categories`
const PREFIX = `${pu}category/`

/** The properties carried across from the file, and how many of each. */
const SINGLE = { prefLabel: 'prefLabel', definition: 'definition', scopeNote: 'scopeNote' }
const MULTIPLE = { altLabel: 'altLabels', closeMatch: 'closeMatches', related: 'related' }

export class CategorySchemeError extends Error {
  constructor (message) {
    super(message)
    this.name = 'CategorySchemeError'
  }
}

export class CategoryScheme {
  constructor (concepts) {
    /** @type {Map<string, object>} slug to concept */
    this.concepts = concepts
  }

  static async load (file = 'vocabs/categories.ttl') {
    const dataset = await parseTurtleFile(file)
    const concepts = new Map()
    const of = slug => {
      if (!concepts.has(slug)) {
        concepts.set(slug, {
          slug, prefLabel: slug, definition: null, scopeNote: null,
          broader: null, altLabels: [], closeMatches: [], related: []
        })
      }
      return concepts.get(slug)
    }

    for (const quad of dataset) {
      if (!quad.subject.value.startsWith(PREFIX)) continue
      const concept = of(quad.subject.value.slice(PREFIX.length))
      const term = quad.predicate.value.startsWith(skos)
        ? quad.predicate.value.slice(skos.length)
        : null
      if (!term) continue
      if (SINGLE[term]) concept[SINGLE[term]] = quad.object.value
      else if (MULTIPLE[term]) concept[MULTIPLE[term]].push(quad.object.value)
      else if (term === 'broader') concept.broader = quad.object.value.slice(PREFIX.length)
    }

    if (concepts.size === 0) {
      throw new CategorySchemeError(`${file} defines no concepts under ${PREFIX}`)
    }
    return new CategoryScheme(concepts)
  }

  get (slug) {
    return this.concepts.get(slug) ?? null
  }

  /** Categories named in the file that no plugin uses. */
  unused (used) {
    const inUse = new Set(used)
    return [...this.concepts.keys()].filter(slug => !inUse.has(slug)).sort()
  }

  /** Categories plugins use that the file does not describe. */
  undescribed (used) {
    return [...new Set(used)].filter(slug => !this.concepts.has(slug)).sort()
  }

  /**
   * The scheme as triples, for the categories in use.
   *
   * Closed over `skos:broader` first: without that the scheme can point at a
   * parent it never declares, a dangling reference that only shows up when
   * something walks the hierarchy. `skos:narrower` is asserted in the same
   * pass — SKOS says the two are inverses but nothing in the store infers, so
   * a category page that wants its children has to be able to ask for them.
   */
  triples (used) {
    const closed = new Set(used)
    for (const slug of used) {
      let parent = this.get(slug)?.broader
      while (parent && !closed.has(parent)) {
        closed.add(parent)
        parent = this.get(parent)?.broader
      }
    }

    const triples = [
      `${iri(SCHEME)} ${iri(rdf + 'type')} ${iri(skos + 'ConceptScheme')} .`,
      `${iri(SCHEME)} ${iri(NAMESPACES.rdfs + 'label')} ${literal('Plugin Universe categories')} .`
    ]
    for (const slug of [...closed].sort()) {
      const concept = this.get(slug)
      const s = iri(`${PREFIX}${slug}`)
      const emit = (predicate, object) => triples.push(`${s} ${iri(skos + predicate)} ${object} .`)

      triples.push(`${s} ${iri(rdf + 'type')} ${iri(skos + 'Concept')} .`)
      emit('inScheme', iri(SCHEME))
      emit('prefLabel', literal(concept?.prefLabel ?? slug))
      if (!concept) continue

      for (const label of concept.altLabels) emit('altLabel', literal(label))
      if (concept.definition) emit('definition', literal(concept.definition))
      if (concept.scopeNote) emit('scopeNote', literal(concept.scopeNote))
      for (const match of concept.closeMatches) emit('closeMatch', iri(match))
      // Only within the emitted set: a related concept nothing uses would be
      // another dangling reference.
      for (const other of concept.related) {
        const slugOf = other.slice(PREFIX.length)
        if (closed.has(slugOf)) emit('related', iri(other))
      }
      if (concept.broader && closed.has(concept.broader)) {
        emit('broader', iri(`${PREFIX}${concept.broader}`))
        triples.push(
          `${iri(`${PREFIX}${concept.broader}`)} ${iri(skos + 'narrower')} ${s} .`)
      } else if (!concept.broader) {
        emit('topConceptOf', iri(SCHEME))
        triples.push(`${iri(SCHEME)} ${iri(skos + 'hasTopConcept')} ${s} .`)
      }
    }
    return triples
  }
}

export default CategoryScheme
