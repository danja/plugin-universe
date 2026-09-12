import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import QueryService from '../../src/store/QueryService.js'

/**
 * SPARQL lives in files, and this is what keeps it there.
 *
 * CLAUDE.md has said "do not inline SPARQL as template literals in JavaScript"
 * since Phase 0, and by the time anyone counted there were seventeen of them
 * across eight files — including six copies of the same two generic queries and
 * one that interpolated a graph name without `iri()`. A rule stated in prose
 * and checked by nobody is a rule that decays at exactly the rate code is
 * written.
 *
 * The reasons are the ones the house style gives: a query is a document with
 * its own syntax that an editor can check and a person can read, a `${...}`
 * inside a template literal cannot be told apart from a SPARQL placeholder by
 * eye, and a query assembled in JavaScript quotes its own values — which is
 * where an injection lives.
 */

const SRC = path.resolve('src')

/** Files that legitimately contain SPARQL, and why. */
const ALLOWED = Object.freeze({
  // It *is* the query constructor: INSERT DATA, DELETE WHERE, DROP and CLEAR
  // are built here so nothing else has to build them.
  'src/store/SPARQLHelper.js': 'constructs the update queries every caller uses'
})

const KEYWORD = /\b(SELECT|CONSTRUCT|ASK|DESCRIBE|INSERT|DELETE)\b/
const CLAUSE = /\b(WHERE|GRAPH|DATA)\b/

function jsFiles (dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...jsFiles(full))
    else if (name.endsWith('.js')) out.push(full)
  }
  return out
}

/**
 * Template literals in a source file, with the line each begins on.
 *
 * Interpolations are tracked so that a `}` inside `${...}` does not end the
 * literal early — which matters here, because the interpolations are exactly
 * what makes an inlined query hard to read.
 */
function templateLiterals (source) {
  const found = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '`') continue
    let j = i + 1
    let depth = 0
    while (j < source.length) {
      if (source[j] === '\\') { j += 2; continue }
      if (source[j] === '$' && source[j + 1] === '{') { depth++; j += 2; continue }
      if (depth > 0 && source[j] === '}') { depth--; j++; continue }
      if (depth === 0 && source[j] === '`') break
      j++
    }
    found.push({ text: source.slice(i + 1, j), line: source.slice(0, i).split('\n').length })
    i = j
  }
  return found
}

describe('SPARQL lives in files', () => {
  const offenders = []
  for (const file of jsFiles(SRC).sort()) {
    const relative = path.relative(process.cwd(), file)
    if (ALLOWED[relative]) continue
    for (const { text, line } of templateLiterals(readFileSync(file, 'utf8'))) {
      if (KEYWORD.test(text) && CLAUSE.test(text)) {
        offenders.push(`${relative}:${line}  ${text.trim().split('\n')[0].slice(0, 60)}`)
      }
    }
  }

  it('has no query assembled as a template literal in src/', () => {
    expect(offenders, [
      'Move each of these into sparql/queries/<category>/<name>.sparql and load',
      'it with QueryService.get(). Values passed in must be formatted terms from',
      'SPARQLHelper — iri(), literal(), typedLiteral(), integer().',
      ''
    ].join('\n')).toEqual([])
  })

  it('names a reason for each file it exempts', () => {
    // An exemption without a reason is how a list of two becomes a list of ten.
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, file).toBeGreaterThan(20)
    }
  })

  it('would notice if the detector stopped detecting', () => {
    // A guard that scrapes source and finds nothing is indistinguishable from
    // a guard that has gone blind — tests/api/linked-routes.test.js went blind
    // for exactly this reason, reading a file the links had moved out of.
    const sample = 'const q = `SELECT ?s WHERE { GRAPH <g> { ?s ?p ?o } }`'
    const [literal] = templateLiterals(sample)
    expect(KEYWORD.test(literal.text) && CLAUSE.test(literal.text)).toBe(true)
  })

  it('does not mistake an interpolation for the end of a literal', () => {
    const sample = 'const q = `SELECT ?s WHERE { GRAPH ${iri(g)} { ?s ?p ?o } }`'
    const [literal] = templateLiterals(sample)
    expect(literal.text).toContain('?s ?p ?o')
  })
})

describe('every query on disk is loadable and used', () => {
  const queries = new QueryService()

  it('finds a caller in src/ or bin/ for each one', () => {
    const sources = [...jsFiles(SRC), ...jsFiles(path.resolve('bin'))]
      .map(file => readFileSync(file, 'utf8'))
      .join('\n')
    // An orphaned query is the same defect as an orphaned template: it looks
    // maintained, and nothing notices when it stops matching the graph model.
    const orphans = queries.list().filter(name => !sources.includes(`'${name}'`))
    expect(orphans).toEqual([])
  })
})
