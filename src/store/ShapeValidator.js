import fs from 'fs'
import path from 'path'
import rdf from 'rdf-ext'
import SHACLValidator from 'rdf-validate-shacl'
import { Readable } from 'stream'
import { rdfParser } from 'rdf-parse'
import { parseTurtleFile } from '../harvest/TurtleReader.js'

/**
 * SHACL validation of what a harvester is about to write, and of what is
 * already in the store.
 *
 * The shapes are in vocabs/shapes.ttl and the reasoning for each constraint is
 * beside it there. The point of validating at ingest rather than only in a
 * nightly job is that a defective harvester is caught while the graph it would
 * have written is still a variable — the pipeline drops and reloads one graph,
 * so a refusal costs nothing and an accepted bad write costs a re-harvest.
 *
 * Per CLAUDE.md, a change to the graph model updates these shapes and the query
 * regression suite in the same commit.
 */

export class ValidationError extends Error {
  constructor (message, { report = null } = {}) {
    super(message)
    this.name = 'ValidationError'
    this.report = report
  }
}

const SHAPES_FILE = path.resolve('vocabs/shapes.ttl')

/** Parse N-Triples — what PluginSerialiser emits — into a dataset. */
export async function parseTriples (triples) {
  const text = Array.isArray(triples) ? triples.join('\n') : triples
  if (text.trim() === '') return rdf.dataset()
  const quads = []
  await new Promise((resolve, reject) => {
    rdfParser.parse(Readable.from([text]), { contentType: 'application/n-triples' })
      .on('data', quad => quads.push(quad))
      .on('error', reject)
      .on('end', resolve)
  })
  return rdf.dataset(quads)
}

export class ShapeValidator {
  constructor (shapes) {
    if (!shapes) throw new ValidationError('ShapeValidator needs a shapes dataset')
    this.shapes = shapes
    // No factory override: rdf-validate-shacl needs a clownface-capable
    // factory, which rdf-ext v2 is not. Its own default is the right one.
    this.validator = new SHACLValidator(shapes)
  }

  /** Load vocabs/shapes.ttl. Its absence is an error, not an empty shape set. */
  static async load (file = SHAPES_FILE) {
    if (!fs.existsSync(file)) {
      throw new ValidationError(
        `No shapes at ${file}. Validation with no shapes passes everything, which is worse than not validating.`
      )
    }
    return new ShapeValidator(await parseTurtleFile(file))
  }

  /**
   * @param {import('@rdfjs/types').DatasetCore} data
   * @returns {Promise<{conforms: boolean, results: object[], violations: object[], warnings: object[]}>}
   */
  async validate (data) {
    const report = await this.validator.validate(data)
    const results = report.results.map(result => ({
      focusNode: result.focusNode?.value ?? null,
      path: result.path?.value ?? null,
      value: result.value?.value ?? null,
      severity: result.severity?.value?.replace(/^.*#/, '') ?? 'Violation',
      sourceShape: result.sourceShape?.value ?? null,
      message: result.message.map(m => m.value).join(' ') || 'no message'
    }))

    // `conforms` is recomputed rather than taken from the library.
    //
    // SHACL §3.6 defines it as true if and only if there are no results of
    // severity sh:Violation; rdf-validate-shacl sets it false for any result at
    // all, warnings included. Two callers refuse to write when it is false —
    // `IngestPipeline` and `Submissions` — so with the library's reading, a
    // single sh:Warning anywhere in a harvest would abort the whole harvest,
    // and `sh:severity sh:Warning` would be a declaration that does the
    // opposite of what it says. Nothing used a warning until the licence
    // enumeration did, which is why this was not visible before.
    const violations = results.filter(r => r.severity === 'Violation')
    const warnings = results.filter(r => r.severity !== 'Violation')
    return { conforms: violations.length === 0, results, violations, warnings }
  }

  /** Validate serialised triples before they are written. */
  async validateTriples (triples) {
    return this.validate(await parseTriples(triples))
  }

  /**
   * Validate one named graph from the store.
   *
   * CONSTRUCT rather than SELECT: the shapes need the triples, and pulling them
   * back as rows to reassemble in JavaScript would be the same mistake as
   * computing similarity outside the vector index.
   */
  async validateGraph (client, graph) {
    const turtle = await client.construct(
      `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${graph}> { ?s ?p ?o } }`
    )
    const quads = []
    await new Promise((resolve, reject) => {
      rdfParser.parse(Readable.from([turtle]), { contentType: 'text/turtle' })
        .on('data', quad => quads.push(quad))
        .on('error', reject)
        .on('end', resolve)
    })
    return this.validate(rdf.dataset(quads))
  }
}

/**
 * A short, readable summary of a report, grouped by message.
 *
 * Warnings are summarised alongside violations — a report that conforms but
 * has something to say is not the same as one with nothing to say, and the
 * severity is in each line.
 */
export function summarise (report, { limit = 10 } = {}) {
  if (report.results.length === 0) return 'conforms'
  const byMessage = new Map()
  for (const result of report.results) {
    const key = `${result.severity}: ${result.message}`
    byMessage.set(key, (byMessage.get(key) ?? 0) + 1)
  }
  return [...byMessage]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([message, count]) => `  ${String(count).padStart(5)}  ${message}`)
    .join('\n')
}

export default ShapeValidator
