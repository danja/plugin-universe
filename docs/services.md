# Services

Everything here is one catalogue, offered five ways. Pick whichever suits what
you are: a person, a program, an agent, or a database.

The facts are **CC0** — public domain. Attribution to Plugin Universe is
requested and not required. Contributor-written prose is **CC BY-SA 4.0** and
must be attributed. A plugin's own licence is its author's and is a separate
matter from the catalogue's.

---

## For a person

[plugin-universe.com](/) — search by what a plugin *does*, not just its name.
Retrieval is semantic, so "warm analogue bus compressor" works better than a
product name.

## For a program: the JSON API

No key, no account, CORS open.

```
GET /search?q=warm+analogue+bus+compressor&limit=10
GET /search?category=reverb&pricing=Free&source=OpenSource
GET /plugins?limit=50&order=recent
GET /facets
GET /plugin/<slug>.json
GET /category/<slug>.json
GET /health
```

Facets are `format`, `category`, `role`, `vendor`, `source`, `pricing`,
`licence` and `measured`. They filter and never re-rank.

## For a database: content negotiation

Every plugin IRI dereferences. Ask for what you want:

```sh
curl -H "Accept: text/turtle"        https://plugin-universe.com/plugin/<slug>
curl -H "Accept: application/ld+json" https://plugin-universe.com/plugin/<slug>
```

Or by suffix — `.ttl`, `.jsonld`, `.json`. Category IRIs resolve the same way.

IRIs are minted under `http://purl.org/stuff/plugin-universe/` and redirect
here, so they survive this site moving. The vocabularies they use are at
[`/ns`](/ns).

### SPARQL

```
https://sparql.plugin-universe.com/public/query
```

Read-only. The default graph is the union of every named graph, so a query with
no `GRAPH` clause sees everything. [Details, limits and what is deliberately
absent](/about/sparql).

## For a package manager

```
https://plugin-universe.com/registry/plugins/index.json
```

An [Open Audio Stack](https://github.com/open-audio-stack) compatible registry:
every plugin the catalogue has a release for, with versions, download URLs and
SHA-256 checksums. OwlPlug and StudioRack can read it as-is.

## For an agent: MCP

```
https://mcp.plugin-universe.com/mcp
```

Streamable HTTP, stateless, no account. Four tools: `search_plugins`,
`get_plugin`, `list_categories` and `sparql_query`. [What each does](/about/mcp).

### Claude Code

```sh
claude mcp add --transport http plugin-universe https://mcp.plugin-universe.com/mcp
```

`--scope user` makes it available in every project; the default is this project
only. To share it with a repository, use `--scope project` and it is written to
`.mcp.json`:

```json
{
  "mcpServers": {
    "plugin-universe": {
      "type": "http",
      "url": "https://mcp.plugin-universe.com/mcp"
    }
  }
}
```

Check it with `claude mcp list`.

### Codex

```sh
codex mcp add plugin-universe --url https://mcp.plugin-universe.com/mcp
```

Or in `~/.codex/config.toml`:

```toml
[mcp_servers.plugin-universe]
url = "https://mcp.plugin-universe.com/mcp"
```

No `bearer_token_env_var` and no `auth`: the endpoint is open and read-only, so
there is nothing to authenticate.

### Anything else

Any MCP client that speaks Streamable HTTP. The endpoint answers at
`https://mcp.plugin-universe.com/` as well, for clients that expect the server
at the root.

---

## Two things worth knowing before you quote it

**Provenance travels with the facts.** Every plugin record names the source it
came from and that source's licence. If you repeat a claim from here, you can
say where it came from — and should.

**A measurement is not a property of a plugin.** It is a reading from one
binary, on one machine, on one day, so the tool, the platform and the date come
back with every number. "This plugin uses 2% CPU" is a claim this catalogue
cannot support. "A scan on Linux x64 in September reported five ports" is one it
can.

## Bulk

There is no published dump yet — the machinery exists and the decision about
where to serve it from has not been made. Until then, the registry JSON above is
the whole of the release data in one request, and SPARQL will answer most of the
rest. If you want everything and neither suits, ask.

Please do not paginate the SPARQL endpoint to scrape the catalogue: it costs
this server far more than it costs you, and there is a better answer available
for the asking.

## Limits, and contact

The API and the SPARQL endpoint are rate-limited, and SPARQL queries time out at
thirty seconds. This runs on one small machine.

If something here is broken, insufficient, or you need access in a shape that is
not offered, the crawler contact page has a working address:
[/about/crawler](/about/crawler).
