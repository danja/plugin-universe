import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { parseTurtleFile } from '../../src/harvest/TurtleReader.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * The plugin formats, in the three places that have to agree — and upstream.
 *
 * `trn:` is owned by `~/github/transmission`, and as of 2026-09-18 it serves
 * `http://purl.org/stuff/transmissions/` for real: the format individuals were
 * moved up into `vocabs/formats.ttl` there, which is what this project's own
 * `trn-extensions.ttl` header had always said should happen. This repository
 * keeps its copy because its SHACL shapes validate against it here, so the two
 * are now a pair that can drift.
 *
 * Transmission's `tests/vocab/site.test.js` watches one direction: a term
 * declared here and missing upstream. **This watches the other**, which is the
 * one that costs this project — a format blessed upstream and unknown here is
 * a format the shapes refuse, so a profile written against the published
 * vocabulary fails ingest and the report says only that the IRI is not in the
 * `sh:in` list. Neither test is the other's copy.
 *
 * The local three — the vocabulary, the shapes, and the submission form — are
 * the coupling this project has paid for repeatedly. `PLUGIN_FORMATS` against
 * the shapes is already bound in `tests/contrib/Submissions.test.js`; the leg
 * that was missing is the vocabulary against either of them, which is how a
 * format could be accepted by the shapes and defined nowhere — an IRI in
 * published data that describes nothing.
 */

const trn = NAMESPACES.trn
const LOCAL = 'vocabs/trn-extensions.ttl'
const UPSTREAM = path.join(process.env.HOME ?? '', 'github/transmission/vocabs/formats.ttl')

/** The local names typed `trn:PluginFormat` in a Turtle file. */
async function formatsIn (file) {
  const dataset = await parseTurtleFile(file)
  const found = new Set()
  for (const quad of dataset) {
    if (quad.predicate.value !== `${NAMESPACES.rdf}type`) continue
    if (quad.object.value !== `${trn}PluginFormat`) continue
    found.add(quad.subject.value.replace(trn, ''))
  }
  return found
}

/** The names enumerated by the `sh:in` list on `trn:format`. */
function formatsInShapes () {
  const shapes = fs.readFileSync('vocabs/shapes.ttl', 'utf8')
  const clause = shapes.slice(shapes.indexOf('sh:path trn:format'))
  return new Set(
    [...clause.slice(0, clause.indexOf(')')).matchAll(/trn:([A-Za-z0-9]+)/g)]
      .map(match => match[1])
      .filter(name => name !== 'format'))
}

describe('the formats this repository declares', () => {
  it('finds some, in both files', async () => {
    // Either half going blind makes every assertion below vacuous.
    expect((await formatsIn(LOCAL)).size).toBeGreaterThan(5)
    expect(formatsInShapes().size).toBeGreaterThan(5)
  })

  it('are exactly the ones the shapes accept', async () => {
    // Both directions. A format in the vocabulary that the shapes refuse is a
    // term nothing may use; one the shapes accept and the vocabulary does not
    // define is an IRI in published data that describes nothing — the same
    // fault as a term that will not dereference, one layer up.
    const declared = [...await formatsIn(LOCAL)].sort()
    const accepted = [...formatsInShapes()].sort()
    expect(declared).toEqual(accepted)
  })
})

describe('the copy upstream in transmission', () => {
  // Skipped rather than failed when the sibling checkout is absent: a server or
  // a fresh clone has one repository, and this must not fail there. The empty
  // case is asserted so that "skipped" is a recorded state rather than silence.
  const present = fs.existsSync(UPSTREAM)

  it('is where trn: is served from, when it is here to check', async () => {
    if (!present) {
      expect(present, `no checkout at ${UPSTREAM}; this check did not run`).toBe(false)
      return
    }
    expect((await formatsIn(UPSTREAM)).size).toBeGreaterThan(5)
  })

  it.skipIf(!present)('declares nothing this repository has not caught up with', async () => {
    const ours = await formatsIn(LOCAL)
    const theirs = await formatsIn(UPSTREAM)
    const behind = [...theirs].filter(name => !ours.has(name)).sort()
    expect(behind,
      `${UPSTREAM} declares these and ${LOCAL} does not, so vocabs/shapes.ttl ` +
      'will refuse a profile written against the published vocabulary').toEqual([])
  })
})
