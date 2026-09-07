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
header { border-bottom:1px solid var(--line); padding-bottom:1rem; margin-bottom:1.5rem; position:relative; }
.account { position:absolute; top:0; right:0; margin:0; font-size:.82rem; color:var(--muted);
           display:flex; gap:.5rem; align-items:center; }
.account a { color:var(--accent); }
.account form { margin:0; }
.account button { padding:.15rem .5rem; font-size:.78rem; background:none; color:var(--muted);
                  border:1px solid var(--line); cursor:pointer; }
.account button:hover { color:var(--fg); }
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
.badge { display:inline-block; border-radius:99px; padding:.05rem .5rem; margin-right:.3rem; font-weight:600;
         border:1px solid var(--accent); color:var(--accent); }
.badge-price { background:var(--accent); color:var(--bg); border-color:transparent; }
.badge-src { border-style:dashed; }
.score { float:right; font-variant-numeric:tabular-nums; font-size:.78rem; color:var(--muted); }
table { border-collapse:collapse; width:100%; margin:1rem 0; font-size:.88rem; }
th, td { text-align:left; padding:.35rem .6rem .35rem 0; border-bottom:1px solid var(--line); }
th { color:var(--muted); font-weight:500; }
.empty { color:var(--muted); padding:2rem 0; }
footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--muted); font-size:.82rem; }
footer a { color:var(--accent); }
.prov { margin:1.5rem 0; padding:.75rem 1rem; border:1px solid var(--line); border-radius:6px; background:color-mix(in srgb, var(--fg) 3%, transparent); }
.prov h3 { font-size:.9rem; margin:0 0 .35rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
.prov p { margin:.25rem 0; font-size:.9rem; }
.prov a { color:var(--accent); }
code { font-size:.85em; background:color-mix(in srgb, var(--fg) 8%, transparent); padding:.1em .35em; border-radius:3px; }
.prose { max-width:42rem; }
.prose h1 { font-size:1.5rem; margin:0 0 .3rem; letter-spacing:-0.01em; }
.prose h2 { font-size:1.15rem; margin:2rem 0 .4rem; padding-top:.6rem; border-top:1px solid var(--line); }
.prose h3 { font-size:1rem; margin:1.4rem 0 .3rem; color:var(--muted); text-transform:uppercase;
            letter-spacing:.04em; font-size:.82rem; }
.prose p, .prose li { line-height:1.65; }
.prose ul, .prose ol { padding-left:1.2rem; }
.prose li { margin:.3rem 0; }
.prose a { color:var(--accent); }
.prose strong { font-weight:650; }
.prose hr { border:0; border-top:1px solid var(--line); margin:2rem 0; }
.prose blockquote { margin:1rem 0; padding:.6rem 1rem; border-left:3px solid var(--accent);
                    background:color-mix(in srgb, var(--fg) 3%, transparent); color:var(--muted); }
.prose blockquote p { margin:.2rem 0; }
.prose table { font-size:.86rem; }
.prose th { white-space:nowrap; }
.prose pre { background:color-mix(in srgb, var(--fg) 6%, transparent); padding:.7rem .9rem;
             border-radius:6px; overflow-x:auto; font-size:.82rem; line-height:1.5; }
.prose pre code { background:none; padding:0; }
.prose h1 + p, .prose h2 + p { margin-top:.4rem; }
`

/**
 * The sign-in corner of the header.
 *
 * `account` is null when nobody is signed in, and undefined when the instance
 * has no sign-in configured at all — a read-only deployment shows nothing
 * rather than a link that 404s.
 */
function accountBar (account, signInEnabled) {
  if (!signInEnabled) return ''
  if (!account) {
    return '<p class="account"><a href="/auth/login">Sign in with GitHub</a></p>'
  }
  return `<p class="account">
    ${escape(account.login)}
    <form method="post" action="/auth/logout"><button type="submit">Sign out</button></form>
  </p>`
}

function layout (title, body, { description = '', account = null, signInEnabled = false } = {}) {
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
  ${accountBar(account, signInEnabled)}
  <h1><a href="/">Plugin Universe</a></h1>
  <p class="tagline">An open database of DAW plugins. Public domain (CC0).</p>
</header>
${body}
<footer>
  Catalogue data released under
  <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>;
  attribution requested, not required.
  <br>
  <a href="/about">About</a> &middot;
  <a href="/terms">Contributor terms</a> &middot;
  <a href="/about/crawler">Crawler</a> &middot;
  <a href="/ns">Vocabularies</a> &middot;
  <a href="/search?q=reverb">JSON API</a>
</footer>
</div>
</body>
</html>`
}

/** Human labels for the availability individuals. */
const AVAILABILITY_LABEL = { OpenSource: 'open source', SourceAvailable: 'source available', Proprietary: 'proprietary' }
const PRICING_LABEL = { Free: 'free', Donationware: 'donationware', Freemium: 'freemium', Paid: 'paid' }

/**
 * The two answers a person scanning results actually wants, shown as badges
 * rather than left to be inferred from a licence identifier. An unknown value
 * shows nothing: saying nothing is honest, and "unknown" in every row is noise.
 */
function availabilityBadges (r) {
  const badges = []
  if (PRICING_LABEL[r.pricing]) badges.push(`<span class="badge badge-price">${escape(PRICING_LABEL[r.pricing])}</span>`)
  if (AVAILABILITY_LABEL[r.sourceAvailability]) {
    badges.push(`<span class="badge badge-src">${escape(AVAILABILITY_LABEL[r.sourceAvailability])}</span>`)
  }
  if (r.licenceId) badges.push(`<span class="badge">${escape(r.licenceId)}</span>`)
  return badges.join('')
}

function resultItem (r) {
  const tags = [...(r.formats ?? []), ...(r.categories ?? [])]
  const slug = r.iri?.split('/').pop() ?? ''
  return `<div class="result">
  ${r.score !== undefined ? `<span class="score">${r.score.toFixed(3)}</span>` : ''}
  <h2><a href="/plugin/${escape(slug)}">${escape(r.name)}</a>${r.vendor ? ` <span class="vendor">— ${escape(r.vendor)}</span>` : ''}</h2>
  ${r.description ? `<p class="desc">${escape(r.description.split('\n')[0].slice(0, 220))}</p>` : ''}
  <p class="tags">${availabilityBadges(r)}${tags.map(t => `<span class="tag">${escape(t)}</span>`).join('')}</p>
</div>`
}

export function renderSearchPage ({ query, facets, results, total, corpus, elapsedMs, facetValues, viewer = {} }) {
  const options = (name, values, selected) => `<select name="${name}">
    <option value="">${name}: any</option>
    ${(values ?? []).map(v => `<option value="${escape(v.value)}"${v.value === selected ? ' selected' : ''}>${escape(v.value)} (${v.count})</option>`).join('')}
  </select>`

  const body = `
<form method="get" action="/">
  <input type="search" name="q" value="${escape(query ?? '')}" placeholder="warm analogue bus compressor" autofocus>
  ${options('format', facetValues?.format, facets.format)}
  ${options('category', facetValues?.category, facets.category)}
  ${options('pricing', facetValues?.pricing, facets.pricing)}
  ${options('source', facetValues?.source, facets.source)}
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
    description: 'An open, machine-readable database of DAW plugins with semantic search.',
    ...viewer
  })
}

/**
 * schema.org JSON-LD for a plugin page. This is what makes the catalogue
 * legible to search engines without them parsing the RDF.
 */
export function pluginJsonLd (doc) {
  const keywords = [...(doc.formats ?? []), ...(doc.categories ?? []), ...(doc.tags ?? [])].join(', ')
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
  if (doc.homepage) ld.url = doc.homepage
  if (doc.seeAlso) ld.sameAs = doc.seeAlso
  if (linkable(doc.provenance?.derivedFrom)) ld.isBasedOn = doc.provenance.derivedFrom
  if (keywords) ld.keywords = keywords
  return ld
}

export function renderPluginPage (doc, viewer = {}) {
  const rows = [
    ['Vendor', doc.vendor],
    ['Formats', (doc.formats ?? []).join(', ')],
    ['Roles', (doc.roles ?? []).join(', ')],
    ['Categories', (doc.categories ?? []).join(', ')],
    ['Tags', (doc.tags ?? []).join(', ')],
    ['Price', PRICING_LABEL[doc.pricing]],
    ['Source', AVAILABILITY_LABEL[doc.sourceAvailability]],
    ['Licence', doc.licenceId],
    ['Parameters', (doc.parameters ?? []).length ? `${doc.parameters.length}: ${doc.parameters.slice(0, 12).join(', ')}${doc.parameters.length > 12 ? '…' : ''}` : null],
    ['Caution', doc.cautions]
  ].filter(([, v]) => v)

  const body = `
<p class="meta"><a href="/">← search</a></p>
<h2 style="font-size:1.3rem;margin:.5rem 0 .2rem">${escape(doc.name)}</h2>
${doc.vendor ? `<p class="tagline">${escape(doc.vendor)}</p>` : ''}
${doc.description ? `<p class="desc">${escape(doc.description)}</p>` : ''}
<table>
${doc.homepage ? `<tr><th>Homepage</th><td><a href="${escape(doc.homepage)}" rel="nofollow noopener">${escape(doc.homepage)}</a></td></tr>` : ''}
${rows.map(([k, v]) => `<tr><th>${escape(k)}</th><td>${escape(v)}</td></tr>`).join('\n')}
<tr><th>IRI</th><td><code>${escape(doc.iri)}</code></td></tr>
</table>
${renderProvenance(doc)}
<p class="meta">Also available as
  <a href="${escape(doc.iri.replace(NAMESPACES.pu, '/'))}.ttl">Turtle</a>,
  <a href="${escape(doc.iri.replace(NAMESPACES.pu, '/'))}.jsonld">JSON-LD</a>.
</p>
<script type="application/ld+json">${JSON.stringify(pluginJsonLd(doc), null, 2)}</script>
`
  return layout(`${doc.name} — Plugin Universe`, body, { description: doc.description ?? '', ...viewer })
}

/**
 * A prose page — about, terms, the crawler notice.
 *
 * The Markdown is rendered elsewhere; this puts it in the site's chrome so a
 * visitor reads it as part of the site. Constrained to a narrower measure than
 * the search results, because these are paragraphs rather than a table.
 */
export function renderDocPage ({ title, description, html }, viewer = {}) {
  return layout(`${escape(title)} — Plugin Universe`, `
<p class="meta"><a href="/">← search</a></p>
<article class="prose">
${html}
</article>`, { description, ...viewer })
}

/**
 * A category page: the browsable facet, and the thing a pu:category IRI
 * dereferences to.
 *
 * Categories are minted as IRIs and asserted on every plugin, so they have to
 * resolve to something. A list of what is in the category is both the useful
 * answer for a person and the honest one for a machine.
 */
export function renderCategoryPage (slug, results, total, viewer = {}) {
  const body = `
<p class="meta"><a href="/">← search</a></p>
<h2 style="font-size:1.3rem;margin:.5rem 0 .2rem">${escape(slug)}</h2>
<p class="meta">${total} plugin${total === 1 ? '' : 's'} in this category.
  Also as <a href="${escape(`/category/${slug}`)}.ttl">Turtle</a>.</p>
${results.map(resultItem).join('\n')}
`
  return layout(`${slug} — Plugin Universe`, body, {
    description: `Plugins categorised as ${slug} in the Plugin Universe catalogue.`,
    ...viewer
  })
}

/** Turtle for one category concept and its members. */
export function categoryTurtle (slug, results) {
  const concept = `${NAMESPACES.pu}category/${slug}`
  const lines = [
    `@prefix pu: <${NAMESPACES.pu}> .`,
    `@prefix skos: <${NAMESPACES.skos}> .`,
    '',
    `${iri(concept)}`,
    '    a skos:Concept ;',
    `    skos:inScheme ${iri(`${NAMESPACES.pu}categories`)} ;`,
    `    skos:prefLabel ${literal(slug)} .`,
    ''
  ]
  for (const result of results) {
    lines.push(`${iri(result.iri)} pu:category ${iri(concept)} .`)
  }
  return lines.join('\n')
}

/**
 * Where this profile's facts came from.
 *
 * Shown on every plugin page rather than buried in the graph. The named-graph
 * design exists so that every statement can be traced to a source and a licence
 * (docs/architecture.md §3); a page that does not surface that is asking to be
 * trusted rather than checked. It is also how the sources get credited, which
 * the operating principle requires whether or not their licence compels it.
 */
/** Only an http(s) URL is rendered as a link; anything else is shown as text. */
function linkable (value) {
  if (!value) return false
  try {
    return /^https?:$/.test(new URL(value).protocol)
  } catch {
    return false
  }
}

export function renderProvenance (doc) {
  const source = doc.provenance
  const links = []
  if (source?.derivedFrom && !linkable(source.derivedFrom)) {
    // A source recorded as something other than a URL — a local checkout, say.
    // Shown, because it is the provenance, but never as a link.
    links.push(`<code>${escape(source.derivedFrom)}</code>`)
  } else if (source?.derivedFrom) {
    links.push(`<a href="${escape(source.derivedFrom)}" rel="nofollow noopener">${escape(source.derivedFrom)}</a>`)
  }
  if (doc.seeAlso) {
    links.push(`<a href="${escape(doc.seeAlso)}" rel="nofollow noopener">source record</a>`)
  }
  if (!source && links.length === 0) return ''

  return `<div class="prov">
  <h3>Provenance</h3>
  <p>
    ${source ? `Harvested from <strong>${escape(source.source)}</strong>` : 'Source unrecorded'}${source?.licence ? `, whose metadata is <strong>${escape(source.licence)}</strong>` : ''}.
    ${links.length ? links.join(' &middot; ') : ''}
  </p>
  <p class="tags">Graph <code>${escape(source?.graph ?? 'unknown')}</code>. Catalogue data is CC0; the plugin's own licence is its author's.</p>
</div>`
}

/** Turtle for one plugin, for content-negotiated dereferencing. */
export function pluginTurtle (doc) {
  const lines = [
    `@prefix trn: <${NAMESPACES.trn}> .`,
    `@prefix pu: <${NAMESPACES.pu}> .`,
    `@prefix rdfs: <${NAMESPACES.rdfs}> .`,
    `@prefix dcterms: <${NAMESPACES.dcterms}> .`,
    `@prefix foaf: <${NAMESPACES.foaf}> .`,
    `@prefix prov: <${NAMESPACES.prov}> .`,
    '',
    `${iri(doc.iri)}`,
    `    a trn:PluginProfile ;`,
    `    rdfs:label ${literal(doc.name)} ;`
  ]
  if (doc.vendor) lines.push(`    trn:vendor ${literal(doc.vendor)} ;`)
  if (doc.description) lines.push(`    rdfs:comment ${literal(doc.description)} ;`)
  if (doc.homepage) lines.push(`    foaf:homepage ${iri(doc.homepage)} ;`)
  if (doc.seeAlso) lines.push(`    rdfs:seeAlso ${iri(doc.seeAlso)} ;`)
  if (linkable(doc.provenance?.derivedFrom)) {
    lines.push(`    prov:wasDerivedFrom ${iri(doc.provenance.derivedFrom)} ;`)
  }
  for (const format of doc.formats ?? []) lines.push(`    trn:format trn:${format} ;`)
  // Category IRIs are written out in full: a Turtle prefixed name may not
  // contain a slash, so pu:category/midi does not parse.
  for (const category of doc.categories ?? []) {
    lines.push(`    pu:category ${iri(`${NAMESPACES.pu}category/${category}`)} ;`)
  }
  for (const tag of doc.tags ?? []) lines.push(`    pu:tag ${literal(tag)} ;`)
  lines.push('    dcterms:license <https://creativecommons.org/publicdomain/zero/1.0/> .')
  return lines.join('\n')
}

export { escape }
