import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { VOCABULARIES } from '../../src/api/server.js'
import { categoryTurtle } from '../../src/api/serialise.js'
import { parseTurtle } from '../../src/harvest/TurtleReader.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * Every pu: IRI this catalogue publishes has to resolve to something, through
 * two redirects it does not control the first of:
 *
 *   http://purl.org/stuff/plugin-universe/…  (purl.org, /stuff/ → /xmlns/)
 *   https://hyperdata.it/xmlns/plugin-universe/…  (deploy/nginx/hyperdata-xmlns.conf)
 *   https://plugin-universe.com/…
 *
 * The last hop is this application. A vocabulary file renamed without updating
 * the served list would break the far end of that chain silently, and the only
 * symptom would be a 404 at an IRI nobody on this side ever visits.
 */

describe('the vocabulary documents', () => {
  it('names files that exist', () => {
    for (const [name, vocabulary] of Object.entries(VOCABULARIES)) {
      expect(fs.existsSync(path.resolve(vocabulary.file)), `${name} → ${vocabulary.file}`).toBe(true)
    }
  })

  it('serves the namespace document that defines the pu: terms', () => {
    expect(VOCABULARIES['plugin-universe'].file).toBe('vocabs/plugin-universe.ttl')
  })

  it('offers only files under vocabs/, by name', () => {
    for (const { file } of Object.values(VOCABULARIES)) {
      expect(file.startsWith('vocabs/')).toBe(true)
      expect(file).not.toContain('..')
    }
  })

  it('says what each one is for', () => {
    // /ns is linked from the footer of every page. A list of filenames is not
    // an answer to somebody who followed a link called "Vocabularies", and a
    // vocabulary added without a description would put one back.
    for (const [name, vocabulary] of Object.entries(VOCABULARIES)) {
      expect(vocabulary.description, `${name} has no description`).toBeTruthy()
      expect(vocabulary.description.length, `${name}'s description is too thin`).toBeGreaterThan(40)
    }
  })

  it('serves Turtle that parses', async () => {
    for (const [name, vocabulary] of Object.entries(VOCABULARIES)) {
      const dataset = await parseTurtle(await fs.promises.readFile(path.resolve(vocabulary.file), 'utf8'))
      expect(dataset.size, `${name} parsed to no triples`).toBeGreaterThan(0)
    }
  })
})

describe('category concepts', () => {
  const results = [
    { iri: `${NAMESPACES.pu}plugin/one-aaaaaaaa`, name: 'One' },
    { iri: `${NAMESPACES.pu}plugin/two-bbbbbbbb`, name: 'Two' }
  ]

  it('describes the concept and what is in it', async () => {
    const turtle = categoryTurtle('compressor', results)
    const dataset = await parseTurtle(turtle)
    expect(dataset.size).toBe(5)
    expect(turtle).toContain(`<${NAMESPACES.pu}category/compressor>`)
    expect(turtle).toContain('skos:Concept')
    expect(turtle).toContain(`skos:inScheme <${NAMESPACES.pu}categories>`)
  })

  it('round-trips through the parser with no members', async () => {
    const dataset = await parseTurtle(categoryTurtle('empty', []))
    expect(dataset.size).toBe(3)
  })
})
