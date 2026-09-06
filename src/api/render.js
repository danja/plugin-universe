import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal } from '../store/SPARQLHelper.js'

/**
 * HTML and RDF rendering for the public pages.
 *
 * Plugin pages must be crawlable and carry schema.org JSON-LD
 * (docs/architecture.md §4), and a plugin IRI must dereference to Turtle,
 * JSON-LD or HTML according to the request (§2.1).
 *
 * Server-rendered, no client framework: a catalogue page is text and links.
 */

function escape (text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const STYLE = `
:root { color-scheme: light dark; --fg:#1a1a1a; --bg:#fdfdfc; --muted:#666; --line:#e0dedb; --accent:#2b5f75; }
@media (prefers-color-scheme: dark) {
  :root { --fg:#e8e6e3; --bg:#16181a; --muted:#9a9a9a; --line:#2e3236; --accent:#7fb8cd; }
}
* { box-sizing: border-box; }
body { margin:0; font:15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
       color:var(--fg); background:var(--bg); }
.wrap { max-width: 52rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
header { border-bottom:1px solid var(--line); padding-bottom:1rem; margin-bottom:1.5rem; }
h1 { font-size:1.35rem; margin:0 0 .2rem; letter-spacing:-0.01em; }
h1 a { color:inherit; text-decoration:none; }
.tagline { color:var(--muted); font-size:.9rem; margin:0; }
form { display:flex; gap:.5rem; margin:1.5rem 0 1rem; flex-wrap:wrap; }
input[type=search] { flex:1 1 20rem; padding:.6rem .75rem; font-size:1rem; border:1px solid var(--line);
                     border-radius:6px; background:var(--bg); color:var(--fg); }
select, button { padding:.6rem .7rem; font-size:.9rem; border:1px solid var(--line); border-radius:6px;
                 background:var(--bg); color:var(--fg); }
button { background:var(--accent); color:#fff; border-color:transparent; cursor:pointer; }
.meta { color:var(--muted); font-size:.85rem; margin:.5rem 0 1.5rem; }
.result { padding:.9rem 0; border-bottom:1px solid var(--line); }
.result h2 { font-size:1.02rem; margin:0 0 .2rem; font-weight:600; }
.result h2 a { color:var(--accent); text-decoration:none; }
.result h2 a:hover { text-decoration:underline; }
.vendor { color:var(--muted); font-weight:400; }
.desc { margin:.25rem 0; }
.tags { font-size:.8rem; color:var(--muted); }
.tag { display:inline-block; border:1px solid var(--line); border-radius:99px; padding:.05rem .5rem; margin-right:.3rem; }
.score { float:right; font-variant-numeric:tabular-nums; font-size:.78rem; color:var(--muted); }
table { border-collapse:collapse; width:100%; margin:1rem 0; font-size:.88rem; }
th, td { text-align:left; padding:.35rem .6rem .35rem 0; border-bottom:1px solid var(--line); }
th { color:var(--muted); font-weight:500; }
.empty { color:var(--muted); padding:2rem 0; }
footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--muted); font-size:.82rem; }
footer a { color:var(--accent); }
code { font-size:.85em; background:color-mix(in srgb, var(--fg) 8%, transparent); padding:.1em .35em; border-radius:3px; }
`

function layout (title, body, { description = '' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
${description ? `<meta name="description" content="${escape(description)}">` : ''}
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
  <h1><a href="/">Plugin Universe</a></h1>
  <p class="tagline">An open database of DAW plugins. Public domain (CC0).</p>
</header>
${body}
<footer>
  Catalogue data released under
  <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>;
  attribution requested, not required.
  Machine-readable: <a href="/search?q=reverb">JSON API</a>.
</footer>
</div>
</body>
</html>`
}

function resultItem (r) {
  const tags = [...(r.formats ?? []), ...(r.categories ?? [])]
  const slug = r.iri?.split('/').pop() ?? ''
  return `<div class="result">
  ${r.score !== undefined ? `<span class="score">${r.score.toFixed(3)}</span>` : ''}
  <h2><a href="/plugin/${escape(slug)}">${escape(r.name)}</a>${r.vendor ? ` <span class="vendor">— ${escape(r.vendor)}</span>` : ''}</h2>
  ${r.description ? `<p class="desc">${escape(r.description.split('\n')[0].slice(0, 220))}</p>` : ''}
  <p class="tags">${tags.map(t => `<span class="tag">${escape(t)}</span>`).join('')}</p>
</div>`
}

export function renderSearchPage ({ query, facets, results, total, corpus, elapsedMs, facetValues }) {
  const options = (name, values, selected) => `<select name="${name}">
    <option value="">${name}: any</option>
    ${(values ?? []).map(v => `<option value="${escape(v.value)}"${v.value === selected ? ' selected' : ''}>${escape(v.value)} (${v.count})</option>`).join('')}
  </select>`

  const body = `
<form method="get" action="/">
  <input type="search" name="q" value="${escape(query ?? '')}" placeholder="warm analogue bus compressor" autofocus>
  ${options('format', facetValues?.format, facets.format)}
  ${options('category', facetValues?.category, facets.category)}
  <button type="submit">Search</button>
</form>
${query || Object.values(facets).some(Boolean)
    ? `<p class="meta">${total} of ${corpus} plugins${elapsedMs !== undefined ? `, ${elapsedMs} ms` : ''}</p>`
    : `<p class="meta">${corpus} plugins indexed. Search by what a plugin does, not just its name.</p>`}
${results.length
    ? results.map(resultItem).join('\n')
    : (query ? '<p class="empty">Nothing matched.</p>' : '')}
`
  return layout(query ? `${query} — Plugin Universe` : 'Plugin Universe', body, {
    description: 'An open, machine-readable database of DAW plugins with semantic search.'
  })
}

/**
 * schema.org JSON-LD for a plugin page. This is what makes the catalogue
 * legible to search engines without them parsing the RDF.
 */
export function pluginJsonLd (doc) {
  const keywords = [...(doc.formats ?? []), ...(doc.categories ?? [])].join(', ')
  const subCategory = doc.categories?.join(', ')

  // Keys are added only when there is something to say. An `author: undefined`
  // survives in the object even though JSON.stringify drops it, and a consumer
  // reading the object directly would see a property that is not there.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': doc.iri,
    name: doc.name,
    applicationCategory: 'MultimediaApplication',
    license: 'https://creativecommons.org/publicdomain/zero/1.0/'
  }
  if (doc.description) ld.description = doc.description
  if (subCategory) ld.applicationSubCategory = subCategory
  if (doc.vendor) ld.author = { '@type': 'Organization', name: doc.vendor }
  if (keywords) ld.keywords = keywords
  return ld
}

export function renderPluginPage (doc) {
  const rows = [
    ['Vendor', doc.vendor],
    ['Formats', (doc.formats ?? []).join(', ')],
    ['Roles', (doc.roles ?? []).join(', ')],
    ['Categories', (doc.categories ?? []).join(', ')],
    ['Parameters', (doc.parameters ?? []).length ? `${doc.parameters.length}: ${doc.parameters.slice(0, 12).join(', ')}${doc.parameters.length > 12 ? '…' : ''}` : null],
    ['Caution', doc.cautions]
  ].filter(([, v]) => v)

  const body = `
<p class="meta"><a href="/">← search</a></p>
<h2 style="font-size:1.3rem;margin:.5rem 0 .2rem">${escape(doc.name)}</h2>
${doc.vendor ? `<p class="tagline">${escape(doc.vendor)}</p>` : ''}
${doc.description ? `<p class="desc">${escape(doc.description)}</p>` : ''}
<table>
${rows.map(([k, v]) => `<tr><th>${escape(k)}</th><td>${escape(v)}</td></tr>`).join('\n')}
<tr><th>IRI</th><td><code>${escape(doc.iri)}</code></td></tr>
</table>
<p class="meta">Also available as
  <a href="${escape(doc.iri.replace(NAMESPACES.pu, '/'))}.ttl">Turtle</a>,
  <a href="${escape(doc.iri.replace(NAMESPACES.pu, '/'))}.jsonld">JSON-LD</a>.
</p>
<script type="application/ld+json">${JSON.stringify(pluginJsonLd(doc), null, 2)}</script>
`
  return layout(`${doc.name} — Plugin Universe`, body, { description: doc.description ?? '' })
}

/** Turtle for one plugin, for content-negotiated dereferencing. */
export function pluginTurtle (doc) {
  const lines = [
    `@prefix trn: <${NAMESPACES.trn}> .`,
    `@prefix pu: <${NAMESPACES.pu}> .`,
    `@prefix rdfs: <${NAMESPACES.rdfs}> .`,
    `@prefix dcterms: <${NAMESPACES.dcterms}> .`,
    '',
    `${iri(doc.iri)}`,
    `    a trn:PluginProfile ;`,
    `    rdfs:label ${literal(doc.name)} ;`
  ]
  if (doc.vendor) lines.push(`    trn:vendor ${literal(doc.vendor)} ;`)
  if (doc.description) lines.push(`    rdfs:comment ${literal(doc.description)} ;`)
  for (const format of doc.formats ?? []) lines.push(`    trn:format trn:${format} ;`)
  // Category IRIs are written out in full: a Turtle prefixed name may not
  // contain a slash, so pu:category/midi does not parse.
  for (const category of doc.categories ?? []) {
    lines.push(`    pu:category ${iri(`${NAMESPACES.pu}category/${category}`)} ;`)
  }
  lines.push('    dcterms:license <https://creativecommons.org/publicdomain/zero/1.0/> .')
  return lines.join('\n')
}

export { escape }
