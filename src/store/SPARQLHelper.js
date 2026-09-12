/**
 * SPARQL term formatting and update-query construction.
 *
 * Ported from semem's src/services/sparql/SPARQLHelper.js, with the escaping
 * completed: the original missed the control-character cases, which is exactly
 * the kind of thing plugin descriptions contain.
 */

export class SPARQLSyntaxError extends Error {
  constructor (message) {
    super(message)
    this.name = 'SPARQLSyntaxError'
  }
}

/**
 * Escape a string for use inside a SPARQL double-quoted literal.
 * Backslash first, or the other escapes get double-escaped.
 */
export function escapeLiteral (value) {
  if (typeof value !== 'string') {
    throw new SPARQLSyntaxError(`Cannot escape a ${typeof value} as a literal`)
  }
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // Remaining C0 controls have no SPARQL escape and are never meaningful in
    // this data; a raw one would produce a syntactically invalid query.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

/**
 * An IRI is not escapable — a bad one is a bug upstream, so reject it rather
 * than silently mangle it into something that parses.
 */
export function iri (value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SPARQLSyntaxError(`IRI must be a non-empty string, got ${JSON.stringify(value)}`)
  }
  if (/[\u0000-\u0020<>"{}|^`\\]/.test(value)) {
    throw new SPARQLSyntaxError(`IRI contains characters that are illegal in a SPARQL IRIREF: ${JSON.stringify(value)}`)
  }
  return `<${value}>`
}

export function literal (value, { datatype = null, lang = null } = {}) {
  if (datatype && lang) {
    throw new SPARQLSyntaxError('A literal has a datatype or a language tag, never both')
  }
  const escaped = escapeLiteral(String(value))
  if (lang) {
    if (!/^[a-zA-Z]+(-[a-zA-Z0-9]+)*$/.test(lang)) {
      throw new SPARQLSyntaxError(`Not a valid language tag: ${lang}`)
    }
    return `"${escaped}"@${lang}`
  }
  if (datatype) return `"${escaped}"^^${iri(datatype)}`
  return `"${escaped}"`
}

const XSD = 'http://www.w3.org/2001/XMLSchema#'

export function typedLiteral (value) {
  if (typeof value === 'boolean') return literal(value, { datatype: `${XSD}boolean` })
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SPARQLSyntaxError(`Cannot represent ${value} as an RDF literal`)
    }
    return Number.isInteger(value)
      ? literal(value, { datatype: `${XSD}integer` })
      : literal(value, { datatype: `${XSD}decimal` })
  }
  if (value instanceof Date) {
    return literal(value.toISOString(), { datatype: `${XSD}dateTime` })
  }
  return literal(value)
}

/**
 * A bare integer, for the places SPARQL wants a number and not a term.
 *
 * `LIMIT` and `OFFSET` take a plain integer: `LIMIT "50"^^xsd:integer` does not
 * parse, so `typedLiteral` is the wrong tool and a query needing a limit was
 * the reason one was being assembled in JavaScript instead of loaded from a
 * file. This closes that gap, so "every value passed to QueryService came from
 * SPARQLHelper" is true rather than nearly true.
 *
 * Rejects anything that is not a non-negative safe integer, which is what makes
 * it safe to interpolate: there is no string that reaches the query.
 */
export function integer (value) {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new SPARQLSyntaxError(`Expected a non-negative integer, got ${JSON.stringify(value)}`)
  }
  return String(n)
}

/** INSERT DATA into a named graph. Triples are pre-formatted strings. */
export function insertDataQuery (graph, triples, prefixes = '') {
  if (!Array.isArray(triples) || triples.length === 0) {
    throw new SPARQLSyntaxError('insertDataQuery needs at least one triple')
  }
  return `${prefixes}
INSERT DATA {
  GRAPH ${iri(graph)} {
    ${triples.join('\n    ')}
  }
}`
}

/** DELETE the whole of a subject's description within one graph, then insert. */
export function replaceSubjectQuery (graph, subject, triples, prefixes = '') {
  const g = iri(graph)
  const s = iri(subject)
  return `${prefixes}
DELETE { GRAPH ${g} { ${s} ?p ?o } }
WHERE  { GRAPH ${g} { ${s} ?p ?o } };

INSERT DATA {
  GRAPH ${g} {
    ${triples.join('\n    ')}
  }
}`
}

export function dropGraphQuery (graph) {
  return `DROP SILENT GRAPH ${iri(graph)}`
}

export function clearGraphQuery (graph) {
  return `CLEAR SILENT GRAPH ${iri(graph)}`
}
