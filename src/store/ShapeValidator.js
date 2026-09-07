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
   * @returns {Promise<{conforms: boolean, results: object[]}>} violations in a plain shape
   */
  async validate (data) {
    const report = await this.validator.validate(data)
    return {
      conforms: report.conforms,
      results: report.results.map(result => ({
        focusNode: result.focusNode?.value ?? null,
        path: result.path?.value ?? null,
        value: result.value?.value ?? null,
        severity: result.severity?.value?.replace(/^.*#/, '') ?? 'Violation',
        sourceShape: result.sourceShape?.value ?? null,
        message: result.message.map(m => m.value).join(' ') || 'no message'
      }))
    }
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

/** A short, readable summary of a report, grouped by message. */
export function summarise (report, { limit = 10 } = {}) {
  if (report.conforms) return 'conforms'
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
