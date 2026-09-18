import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { vocabularyTerms, termDocument, vocabularyTermRoute } from '../../src/api/meta-routes.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

/**
 * A `pu:` term IRI resolves to the document that defines it.
 *
 * The PURL sends the whole namespace to this site, so
 * `http://purl.org/stuff/plugin-universe/supportedPlatform` arrives as
 * `/supportedPlatform` — and until now every one of those answered 404 with a
 * JSON body. The namespace root resolved and the documents under `/ns`
 * resolved; the terms the published data is actually written in did not, which
 * is the one case that matters, because a predicate is what a consumer follows
 * when it wants to know what a triple means.
 *
 * It was found from the other side. `~/github/jigdaw` made `trn:` dereference
 * and measured this namespace on the way past.
 *
 * The rule this file holds: **a `pu:` term the code writes must be a term the
 * vocabulary defines**, or it is an IRI in published data that leads nowhere.
 */

const pu = NAMESPACES.pu

describe('the terms the vocabulary defines', () => {
  it('finds them, and would say so rather than quietly finding none', async () => {
    const terms = await vocabularyTerms()
    expect(terms.size).toBeGreaterThan(50)
    expect(terms.has('supportedPlatform')).toBe(true)
    expect(terms.has('licenceId')).toBe(true)
  })

  it('refuses a vocabulary file with no terms in it', async () => {
    // The failure that would otherwise be silent: vocabs/ missing from an
    // image, an empty set, and every term answering 404 exactly as before.
    // trn-profile.ttl describes `trn:` terms and no `pu:` ones, which is what a
    // file that cannot answer for this namespace looks like.
    await expect(vocabularyTerms('vocabs/trn-profile.ttl')).rejects.toThrow(/no pu: terms/)
  })

  it('leaves instance IRIs alone', async () => {
    // `pu:category/reverb` and `pu:plugin/<slug>` are not vocabulary terms and
    // never needed this: their paths are routes the catalogue already serves.
    const terms = await vocabularyTerms()
    expect([...terms].some(term => term.includes('/'))).toBe(false)
  })
})

describe('what a term IRI answers', () => {
  const call = async (path, accept = 'text/turtle') => {
    const written = {}
    const response = {
      writeHead (status, headers) { written.status = status; written.headers = headers },
      end () { written.ended = true }
    }
    const handled = await vocabularyTermRoute({
      path, response, request: { headers: { accept } }
    })
    return { handled, ...written }
  }

  it('303s a term to the vocabulary document', async () => {
    const { handled, status, headers } = await call('/supportedPlatform')
    expect(handled).toBe(true)
    // 303 and not 302: the term is a property, not a document, and the thing at
    // the other end is a description of it rather than the term itself.
    expect(status).toBe(303)
    expect(headers.Location).toBe('/ns/plugin-universe.ttl')
    // An RDF client in a browser follows this hop cross-origin.
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
  })

  it('sends a person to the index instead, which is readable', async () => {
    const { headers } = await call('/supportedPlatform', 'text/html')
    expect(headers.Location).toBe('/ns')
    expect(termDocument('text/html')).toBe('/ns')
  })

  it('declines everything that is not a term, so it can shadow no route', async () => {
    // It runs after every other route module, so these reach it only as 404s
    // already — but a handler that answered them would be a route that had
    // quietly moved.
    for (const path of ['/plugins', '/search', '/health', '/plugin/wet-reverb-693085a0',
      '/category/reverb', '/nonsense', '/', '/ns/plugin-universe.ttl']) {
      expect((await call(path)).handled, `${path} was answered as a term`).toBe(false)
    }
  })
})

/**
 * The binding. Everything above is about the route; this is about the data.
 *
 * `PluginSerialiser` is where a `pu:` predicate is written onto a plugin, and
 * the vocabulary is where it is described. Nothing connected the two, so a term
 * could be — and this is the shape of the failure this project keeps
 * repeating — written into 650 plugins and defined nowhere, which reads as a
 * 404 to anybody following it out of the published Turtle.
 */
describe('every pu: term the serialiser writes', () => {
  const written = new Set()
  for (const file of [
    'src/harvest/PluginSerialiser.js',
    'src/harvest/Platforms.js',
    'src/harvest/Licensing.js'
  ]) {
    const source = fs.readFileSync(file, 'utf8')
    // `pu + 'name'`, which is how every one of them is spelled, and
    // `${pu}Name` inside a template literal.
    for (const match of source.matchAll(/pu \+ '([A-Za-z][A-Za-z0-9_-]*)'/g)) written.add(match[1])
    for (const match of source.matchAll(/\$\{pu\}([A-Za-z][A-Za-z0-9_-]*)/g)) written.add(match[1])
  }

  it('finds the predicates it is meant to be checking', () => {
    // Scraping source goes blind rather than red when the spelling changes.
    expect(written.size).toBeGreaterThan(15)
    expect(written).toContain('supportedPlatform')
    expect(written).toContain('licenceId')
  })

  it('is defined in vocabs/plugin-universe.ttl, so it dereferences', async () => {
    const terms = await vocabularyTerms()
    const undefined_ = [...written].filter(term => !terms.has(term))
    expect(undefined_,
      `written into the catalogue and described by no vocabulary, so ${pu}<term> ` +
      'answers 404 to anyone following it out of the published data').toEqual([])
  })
})
