# The public SPARQL endpoint

```
https://sparql.plugin-universe.com/public/query
```

Read-only, open, and CC0. Ask it anything the catalogue can answer.

```sparql
SELECT ?name ?vendor WHERE {
  ?plugin a <http://purl.org/stuff/transmissions/PluginProfile> ;
          <http://www.w3.org/2000/01/rdf-schema#label> ?name .
  OPTIONAL { ?plugin <http://purl.org/stuff/transmissions/vendor> ?vendor }
} LIMIT 20
```

## The default graph is the union of everything here

A query with no `GRAPH` clause sees every named graph at once, so
`SELECT * WHERE { ?s ?p ?o }` does what you would expect. This is worth stating
because the alternative — an empty default graph — is a common configuration and
makes a newcomer's first query return nothing, which reads as a broken endpoint
rather than as a setting.

Provenance is kept, so a query that cares which source a statement came from can
name its graph:

```sparql
SELECT ?g (COUNT(*) AS ?triples) WHERE { GRAPH ?g { ?s ?p ?o } } GROUP BY ?g
```

## What is here, and what is not

This is a **published copy**, rebuilt from the catalogue rather than being the
catalogue. It holds the graphs whose licence permits redistribution, in three
parts: facts under CC0, material from permissively-licensed sources with their
notices, and contributor-written prose under CC BY-SA.

Accounts and pending contributions are **not here at all**. They are not
filtered out on the way to you; they were never loaded into this dataset. That
is deliberate — a filter is something somebody has to maintain, and absence is
not.

Because it is a copy, it lags the live catalogue by up to a day.

## Limits, and the better path for bulk

Queries time out at thirty seconds and the endpoint is rate-limited. Both exist
because an unbounded query costs this server far more than it costs whoever sent
it, and this runs on one small machine.

**If you want the whole dataset, take the dump instead of paginating through
this.** It is faster for you and cheaper for us, and it is the same data:

- the dumps, one file per graph, with a manifest and a VoID description
- an [Open Audio Stack compatible registry](/registry/plugins/index.json), if
  you are a package manager

## Terms

Facts are CC0 — public domain, attribution requested but not required.
Contributor prose is CC BY-SA 4.0 and must be attributed. The parts are
separate datasets so the boundary is a property of the data rather than
something you have to work out.

Credit, if you would like to give it: Plugin Universe,
https://plugin-universe.com
