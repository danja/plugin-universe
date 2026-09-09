import { describe, it, expect, beforeAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import QueryService from '../../src/store/QueryService.js'
import CategoryScheme from '../../src/rdf/CategoryScheme.js'

/**
 * The category scheme as it reaches search, against the live store.
 *
 * The assertion that matters here is the narrow one about alternative labels.
 * Joining them into the text view looked right and was not: `?cat` came from a
 * sibling OPTIONAL, so for a plugin with **no** category it was unbound, the
 * join was unconstrained, and that plugin collected every alternative label in
 * the scheme — 134 of them — becoming lexically matchable by every synonym in
 * the taxonomy. The query ran, returned the right number of rows, and the
 * first plugin checked looked correct.
 */

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
const queries = new QueryService()

const list = value => (value ? value.split(', ').filter(Boolean) : [])

let rows
let scheme

beforeAll(async () => {
  if (!(await client.isReachable())) {
    throw new Error(
      `SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable. ` +
      'These tests require a live store; start it with "npm run store:up".'
    )
  }
  rows = await client.select(queries.get('plugin/text-view', {}))
  scheme = await CategoryScheme.load('vocabs/categories.ttl')
}, 120000)

describe('alternative labels reach the text view', () => {
  it('has a corpus to check', () => {
    expect(rows.length).toBeGreaterThan(100)
  })

  it('gives a plugin with no category no alternative labels', () => {
    // The bug, stated as the thing that must not happen again.
    const wrong = rows
      .filter(row => list(row.categories).length === 0 && list(row.categoryAltLabels).length > 0)
      .map(row => row.name)
    expect(
      wrong,
      `${wrong.length} uncategorised plugins carry alternative labels: ${wrong.slice(0, 5).join(', ')}. ` +
      'The alt-label join is unconstrained — it is matching every label in the scheme.'
    ).toEqual([])
  })

  it('gives a plugin only the labels of its own categories', () => {
    for (const row of rows.slice(0, 200)) {
      const expected = new Set(
        list(row.categories).flatMap(slug => scheme.get(slug)?.altLabels ?? []))
      for (const label of list(row.categoryAltLabels)) {
        expect(expected.has(label), `${row.name} has "${label}" from ${row.categories}`).toBe(true)
      }
    }
  })

  it('gives a categorised plugin some labels, so the join is doing something', () => {
    const categorised = rows.filter(row => list(row.categories).length > 0)
    expect(categorised.length).toBeGreaterThan(100)
    expect(categorised.every(row => list(row.categoryAltLabels).length > 0)).toBe(true)
  })
})

describe('the scheme in the store', () => {
  it('describes every category the data uses', () => {
    // The other half of the pattern: the vocabulary and the harvested category
    // values have to agree, and nothing else connects them. A new vendor tag
    // mapping to a category nobody defined would otherwise pass unnoticed.
    const used = new Set(rows.flatMap(row => list(row.categories)))
    const undescribed = scheme.undescribed([...used])
    expect(
      undescribed,
      `vocabs/categories.ttl does not describe ${undescribed.join(', ')}, which plugins are using. ` +
      'Add a definition and alternative labels rather than letting a bare label into the scheme.'
    ).toEqual([])
  })

  it('was written to the store with the enrichment, not just labels', () => {
    // If the scheme graph were still being written from the old JS hierarchy,
    // every one of these would be zero and search would look unaffected.
    return client.select(`
      SELECT (COUNT(*) AS ?n) WHERE {
        GRAPH ?g { ?c <http://www.w3.org/2004/02/skos/core#definition> ?d }
      }`).then(([row]) => expect(Number(row.n)).toBeGreaterThanOrEqual(28))
  })
})
