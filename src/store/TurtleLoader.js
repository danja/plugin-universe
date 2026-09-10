import { parseTurtle } from '../harvest/TurtleReader.js'
import { iri, literal, insertDataQuery } from './SPARQLHelper.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * Loading Turtle into a named graph.
 *
 * Extracted so there is one implementation of the rule that has already cost
 * this project a day: **a blank node label is scoped to a single INSERT DATA
 * request**. Batching a serialised graph by triple count cuts ports and package
 * files in half at the boundary, and neither half is findable by any query that
 * expects a whole one. Grouping by subject keeps a blank node's closure in one
 * request.
 *
 * A second copy of that rule would be a second chance to get it wrong, which is
 * precisely the failure mode CLAUDE.md warns about.
 */

/** Triples per INSERT DATA. Large enough to be fast, small enough not to time out. */
const BATCH_SIZE = 500

/** An RDF/JS term as a SPARQL term. Blank node labels are preserved. */
export function termToSparql (term) {
  if (term.termType === 'NamedNode') return iri(term.value)
  if (term.termType === 'BlankNode') return `_:${term.value}`
  if (term.termType === 'Literal') {
    if (term.language) return `${literal(term.value)}@${term.language}`
    if (term.datatype && term.datatype.value !== `${NAMESPACES.xsd}string`) {
      return `${literal(term.value)}^^${iri(term.datatype.value)}`
    }
    return literal(term.value)
  }
  throw new Error(`Cannot write a ${term.termType} term`)
}

/**
 * Write groups of triples, never splitting a group across two requests.
 *
 * A group larger than BATCH_SIZE is written whole rather than split.
 */
export async function writeGrouped (client, graph, groups) {
  let batch = []
  let written = 0
  const flush = async () => {
    if (batch.length === 0) return
    await client.update(insertDataQuery(graph, batch))
    written += batch.length
    batch = []
  }
  for (const group of groups) {
    if (batch.length > 0 && batch.length + group.length > BATCH_SIZE) await flush()
    batch.push(...group)
    if (batch.length >= BATCH_SIZE) await flush()
  }
  await flush()
  return written
}

/**
 * Parse Turtle and load it into one graph.
 *
 * Grouped by **connected component**, not by subject. Grouping by subject looks
 * right and is not: a blank node appears as the object of one subject's triples
 * and as the subject of its own, so the two halves land in different groups —
 * and when those groups fall either side of a batch boundary, the label no
 * longer refers to the same node. The node is silently cut in half.
 *
 * It is silent because the triple count is still correct. A restore of 6,981
 * triples returned 6,981 triples, and 114 of 594 LV2 ports had lost their
 * symbol, their type and their range. Only SHACL noticed.
 *
 * So a subject and every blank node reachable from it travel as one unit, and
 * `writeGrouped` writes an oversized unit whole rather than splitting it.
 */
export async function loadTurtleIntoGraph (client, graph, turtle) {
  const dataset = await parseTurtle(turtle)

  // Union-find over term identifiers: a triple whose object is a blank node
  // binds that node to its subject's component, transitively.
  const parent = new Map()
  const find = key => {
    if (!parent.has(key)) parent.set(key, key)
    while (parent.get(key) !== key) {
      parent.set(key, parent.get(parent.get(key)))
      key = parent.get(key)
    }
    return key
  }
  const union = (a, b) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootB, rootA)
  }

  const quads = [...dataset]
  for (const quad of quads) {
    find(quad.subject.value)
    if (quad.object.termType === 'BlankNode') union(quad.subject.value, quad.object.value)
  }

  const components = new Map()
  for (const quad of quads) {
    const root = find(quad.subject.value)
    if (!components.has(root)) components.set(root, [])
    components.get(root).push(
      `${termToSparql(quad.subject)} ${termToSparql(quad.predicate)} ${termToSparql(quad.object)} .`)
  }
  return writeGrouped(client, graph, [...components.values()])
}

export default loadTurtleIntoGraph
