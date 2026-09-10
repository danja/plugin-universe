# The MCP endpoint

```
https://mcp.plugin-universe.com/
```

An open catalogue of DAW plugins, as tools an agent can call. Streamable HTTP,
stateless, no account, nothing to write.

## Connecting

```json
{
  "mcpServers": {
    "plugin-universe": {
      "type": "http",
      "url": "https://mcp.plugin-universe.com/"
    }
  }
}
```

## The tools

**`search_plugins`** — find plugins by what they *do*. Retrieval is hybrid: a
semantic match over each plugin's description, parameters and category labels,
fused with a lexical match on names and vendors. "Warm analogue bus compressor"
works better than a product name. Facets — format, category, pricing, source —
narrow the result set and never re-rank it.

**`get_plugin`** — the full record for one plugin: description, vendor, formats,
parameters, licence, **where each fact came from and under what terms**, and any
measurements a profiler has taken of the built binary.

**`list_categories`** — the category scheme with definitions, alternative labels
and how the categories nest. Worth calling before filtering a search: the
definitions say where the boundaries are.

**`sparql_query`** — for questions a search cannot answer. Read-only SELECT and
ASK against the published catalogue.

## Two things worth knowing before quoting it

**Provenance travels with the facts.** Every plugin record names the source it
was harvested from and that source's licence. An agent repeating a claim from
here can say where it came from, and should.

**A measurement is not a property of a plugin.** It is a reading from one
binary, on one machine, on one day — so the tool, the platform and the date come
back with every number. "This plugin uses 2% CPU" is a claim the catalogue
cannot support; "a scan on Linux x64 in September reported 5 ports" is one it
can.

## What is not here

No accounts, no contributor records, no pending contributions. `sparql_query`
runs against the *published* copy of the catalogue, into which those graphs were
never loaded — so the one tool that can express an arbitrary query cannot
express one that reaches personal data.

Nothing writes. Corrections and wiki edits are made by a signed-in person on the
site, deliberately: a contribution is attributed to somebody, and an agent is
not somebody.

## Terms

Facts are CC0 — public domain, attribution requested but not required.
Contributor-written prose is CC BY-SA 4.0 and must be attributed. A plugin's own
licence is its author's and is a separate matter from the catalogue's.

Credit, if you would like to give it: Plugin Universe,
https://plugin-universe.com
