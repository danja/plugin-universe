import fs from 'fs'
import { Readable } from 'stream'
import { rdfParser } from 'rdf-parse'
import rdf from 'rdf-ext'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * Reading Turtle from source repositories.
 *
 * Harvesters get a dataset plus a small set of accessors, so each harvester is
 * about mapping one source's shape rather than about RDF plumbing.
 */

export class ParseError extends Error {
  constructor (message, { file = null, cause = null } = {}) {
    super(message)
    this.name = 'ParseError'
    this.file = file
    if (cause) this.cause = cause
  }
}

export async function parseTurtle (text, { baseIRI = 'http://purl.org/stuff/plugin-universe/base/', file = null } = {}) {
  const quads = []
  try {
    await new Promise((resolve, reject) => {
      rdfParser.parse(Readable.from([text]), { contentType: 'text/turtle', baseIRI })
        .on('data', quad => quads.push(quad))
        .on('error', reject)
        .on('end', resolve)
    })
  } catch (error) {
    throw new ParseError(`Could not parse Turtle${file ? ` in ${file}` : ''}: ${error.message}`, { file, cause: error })
  }
  return rdf.dataset(quads)
}

export async function parseTurtleFile (file, options = {}) {
  const text = await fs.promises.readFile(file, 'utf8')
  return parseTurtle(text, { ...options, file })
}

/**
 * Convenience accessors over a dataset. Deliberately small: harvesters need to
 * walk shapes, not run SPARQL.
 */
export class GraphView {
  constructor (dataset) {
    this.dataset = dataset
  }

  #term (value) {
    return typeof value === 'string' ? rdf.namedNode(value) : value
  }

  /** All objects of subject/predicate. */
  objects (subject, predicate) {
    return [...this.dataset.match(this.#term(subject), this.#term(predicate))].map(q => q.object)
  }

  /** First object's lexical value, or null. */
  value (subject, predicate) {
    const [first] = this.objects(subject, predicate)
    return first ? first.value : null
  }

  values (subject, predicate) {
    return this.objects(subject, predicate).map(term => term.value)
  }

  /** First object as a number, or null. Non-numeric text is an error. */
  number (subject, predicate) {
    const raw = this.value(subject, predicate)
    if (raw === null) return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) {
      throw new ParseError(`Expected a number for ${this.#term(predicate).value}, got ${JSON.stringify(raw)}`)
    }
    return parsed
  }

  /**
   * First object as whatever it actually is: number, boolean or string.
   *
   * Needed because a parameter default is not always numeric. The downspout
   * corpus has floats, integers, the string "false" for a toggle, and a file
   * path — so insisting on a number here would reject real data. Typed by
   * datatype where the source gives one, by lexical form where it does not.
   */
  scalar (subject, predicate) {
    const [term] = this.objects(subject, predicate)
    if (!term) return null
    const datatype = term.datatype?.value ?? null
    const raw = term.value

    if (datatype === `${NAMESPACES.xsd}boolean`) return raw === 'true' || raw === '1'
    if (datatype && /(integer|decimal|float|double|long|int)$/.test(datatype)) {
      const parsed = Number(raw)
      if (!Number.isFinite(parsed)) {
        throw new ParseError(`${datatype} literal is not a number: ${JSON.stringify(raw)}`)
      }
      return parsed
    }
    if (raw === 'true') return true
    if (raw === 'false') return false
    if (raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw)
    return raw
  }

  /** Subjects with rdf:type of the given class. */
  subjectsOfType (typeIri) {
    return [...this.dataset.match(null, rdf.namedNode(NAMESPACES.rdf + 'type'), rdf.namedNode(typeIri))]
      .map(q => q.subject)
  }

  hasType (subject, typeIri) {
    return this.dataset.match(this.#term(subject), rdf.namedNode(NAMESPACES.rdf + 'type'), rdf.namedNode(typeIri)).size > 0
  }

  types (subject) {
    return this.values(subject, NAMESPACES.rdf + 'type')
  }
}

export default GraphView
