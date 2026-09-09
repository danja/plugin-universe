import { describe, it, expect } from 'vitest'
import QueryService, { QueryError } from '../../src/store/QueryService.js'

describe('QueryService', () => {
  const queries = new QueryService()

  it('finds every query on disk', () => {
    const names = queries.list()
    expect(names).toContain('graph/register')
    expect(names).toContain('graph/cc0-dump-graphs')
    expect(names.length).toBeGreaterThan(0)
  })

  it('prepends prefixes from the namespace registry, not a separate file', () => {
    const sparql = queries.get('graph/cc0-dump-graphs', { metadataGraph: '<urn:g>' })
    expect(sparql).toContain('PREFIX pu: <http://purl.org/stuff/plugin-universe/>')
    expect(sparql).toContain('PREFIX dcterms:')
  })

  it('fills placeholders', () => {
    const sparql = queries.get('graph/is-registered', {
      metadataGraph: '<urn:meta>',
      graph: '<urn:graph>'
    })
    expect(sparql).toContain('GRAPH <urn:meta> { <urn:graph> ?p ?o }')
    expect(sparql).not.toContain('${')
  })

  it('refuses to run a query with an unfilled placeholder', () => {
    expect(() => queries.get('graph/is-registered', { metadataGraph: '<urn:meta>' }))
      .toThrow(QueryError)
  })

  it('refuses parameters the query does not use, which means something drifted', () => {
    expect(() => queries.get('graph/is-registered', {
      metadataGraph: '<urn:meta>',
      graph: '<urn:graph>',
      surplus: 'x'
    })).toThrow(QueryError)
  })

  it('rejects a query name that is not category/name', () => {
    expect(() => queries.template('register')).toThrow(QueryError)
    expect(() => queries.template('../../etc/passwd')).toThrow(QueryError)
  })

  it('reports a missing query by name rather than returning nothing', () => {
    expect(() => queries.template('graph/nonexistent')).toThrow(QueryError)
  })

  it('names a GRAPH in every query, so none depends on the default-graph union', () => {
    // `tdb2:unionDefaultGraph true` in config/fuseki/assembler-tdb2.ttl makes a
    // query without a GRAPH clause see every named graph at once. A store that
    // was not created from that assembler — any Fuseki dataset made by hand,
    // including the one this repo's development endpoint runs against — sees
    // nothing instead. Same query, same data, no error, empty result.
    //
    // Naming the graph makes the setting irrelevant to correctness, which is
    // the only version of this that is safe to rely on. It is also required by
    // the named-graph-per-source design: a query that does not say which graph
    // it means has already lost the provenance the design exists to keep.
    const silent = queries.list().filter(name => !/\bGRAPH\b/i.test(queries.template(name)))
    expect(
      silent,
      `${silent.join(', ')} has no GRAPH clause. It will return everything on a store with ` +
      'unionDefaultGraph and nothing on a store without it, with no error either way.'
    ).toEqual([])
  })

  it('every query on disk declares only placeholders and known prefixes', () => {
    for (const name of queries.list()) {
      const template = queries.template(name)
      const prefixesUsed = [...template.matchAll(/\b([a-z][a-z0-9]*):[A-Za-z]/g)].map(m => m[1])
      for (const prefix of new Set(prefixesUsed)) {
        // Anything used as prefix:term in a query must be registered, or the
        // query will fail at the endpoint rather than here.
        expect(() => queries.namespaces.expand(`${prefix}:x`)).not.toThrow()
      }
    }
  })
})
