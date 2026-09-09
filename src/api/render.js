import { TRUST } from '../auth/Accounts.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
// One-way: the HTML pages embed the JSON-LD, the serialisations know nothing
// about HTML.
import { linkable, pluginJsonLd } from './serialise.js'

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
.result.has-shot { display:flex; gap:.9rem; align-items:flex-start; }
.result-body { min-width:0; flex:1; }
/* A sized box whether or not the image arrives: a third-party URL that 404s
   must not collapse the row or shift the text under it. */
.shot { background:var(--line); border-radius:4px; object-fit:cover; display:block; }
.shot-thumb { width:72px; height:72px; flex:0 0 72px; }
.shot-full { width:100%; max-width:320px; height:auto; aspect-ratio:1; margin:.6rem 0; }
.shot-figure { margin:.6rem 0; max-width:320px; }
.shot-figure figcaption { font-size:.75rem; color:var(--muted); margin-top:.3rem; }
.pager { display:flex; gap:1rem; align-items:baseline; justify-content:space-between;
         margin:1.2rem 0 .4rem; font-size:.85rem; }
.pager a { color:var(--accent); text-decoration:none; }
.pager a:hover { text-decoration:underline; }
.pager .disabled { color:var(--line); }
.pager .page { color:var(--muted); }
.scope { font-style:italic; }
.tags strong { color:var(--muted); font-weight:600; margin-right:.3rem; }
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
.correct { display:flex; flex-wrap:wrap; gap:.5rem; align-items:flex-end; margin:.6rem 0; }
.correct label { display:flex; flex-direction:column; gap:.2rem; font-size:.8rem; color:var(--muted); }
.correct input[type=text] { padding:.4rem .5rem; font-size:.9rem; border:1px solid var(--line);
                            border-radius:6px; background:var(--bg); color:var(--fg); min-width:16rem; }
.correct button { background:var(--accent); color:#fff; border-color:transparent; cursor:pointer; }
.correct button.secondary { background:none; color:var(--muted); border:1px solid var(--line); }
.err { color:#b3261e; font-size:.88rem; }
.ok { color:var(--accent); font-size:.88rem; font-weight:600; }
@media (prefers-color-scheme: dark) { .err { color:#f2b8b5; } }
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
  // The moderation queue is linked here or it is not reachable at all. A route
  // with no link is the same defect as a link with no route, and this project
  // has already shipped one of those.
  const moderating = account.trustLevel === TRUST.MODERATOR
    ? '<a href="/moderation">Moderation</a>'
    : ''
  return `<p class="account">
    ${escape(account.login)}
    ${moderating}
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

/**
 * The image a source published of a plugin, or nothing.
 *
 * These are third-party URLs — almost all of them the Open Audio Stack
 * registry's — so the page hotlinks rather than re-hosting, and says so on the
 * profile page. Three things follow from that and none of them is optional:
 *
 * - **https only.** An http image on an https page is mixed content and the
 *   browser blocks it silently. A URL that cannot be one is not rendered.
 * - **`referrerpolicy="no-referrer"`**, so viewing a plugin page does not tell
 *   a third party which plugin the reader was looking at.
 * - **`loading="lazy"` with explicit dimensions**, because a page of 25 results
 *   is otherwise 25 requests to somebody else's server before the text renders.
 *
 * `alt` is the plugin name rather than "image of X": a screen reader announces
 * the role already, and the name is the useful part.
 */
export function pluginImage (doc, { size = 'thumb' } = {}) {
  if (!doc?.image) return ''
  let url
  try {
    url = new URL(doc.image)
  } catch {
    return ''
  }
  if (url.protocol !== 'https:') return ''
  const box = size === 'full' ? 320 : 72
  return `<img class="shot shot-${escape(size)}" src="${escape(doc.image)}" alt="${escape(doc.name ?? '')}"` +
    ` width="${box}" height="${box}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
}

/**
 * The profile-page image, with the attribution attached to it.
 *
 * Attached, not merely nearby: the note first lived in the provenance block,
 * which renders only when there is provenance to show — so a plugin with an
 * image and no recorded source displayed a hotlinked third-party image with
 * nothing saying whose it was. Here the caption cannot render without the
 * image or the image without the caption.
 */
function pluginFigure (doc) {
  const shot = pluginImage(doc, { size: 'full' })
  if (!shot) return ''
  let host = ''
  try {
    host = new URL(doc.image).host
  } catch {
    return ''
  }
  return `<figure class="shot-figure">
  ${shot}
  <figcaption>Image served by the source, ${escape(host)} — not copied here, and its author's.</figcaption>
</figure>`
}

function resultItem (r) {
  const tags = [...(r.formats ?? []), ...(r.categories ?? [])]
  const slug = r.iri?.split('/').pop() ?? ''
  const shot = pluginImage(r)
  return `<div class="result${shot ? ' has-shot' : ''}">
  ${shot}
  <div class="result-body">
  ${r.score !== undefined ? `<span class="score">${r.score.toFixed(3)}</span>` : ''}
  <h2><a href="/plugin/${escape(slug)}">${escape(r.name)}</a>${r.vendor ? ` <span class="vendor">— ${escape(r.vendor)}</span>` : ''}</h2>
  ${r.description ? `<p class="desc">${escape(r.description.split('\n')[0].slice(0, 220))}</p>` : ''}
  <p class="tags">${availabilityBadges(r)}${tags.map(t => `<span class="tag">${escape(t)}</span>`).join('')}</p>
  </div>
</div>`
}

/**
 * Previous/next links for a listing.
 *
 * Built by editing the current query string rather than by assembling one, so
 * a facet the reader chose survives paging. Rendered as links, not buttons:
 * page two of the catalogue is a place, it should be linkable and it should
 * work with the back button.
 */
export function pager ({ total, offset, limit, params = {} }) {
  if (total <= limit) return ''
  const at = position => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== '')
    )
    if (position > 0) query.set('from', String(position))
    else query.delete('from')
    const string = query.toString()
    return `/${string ? `?${string}` : ''}`
  }
  const page = Math.floor(offset / limit) + 1
  const pages = Math.ceil(total / limit)
  const previous = offset > 0
    ? `<a href="${escape(at(Math.max(0, offset - limit)))}" rel="prev">← newer</a>`
    : '<span class="disabled">← newer</span>'
  const next = offset + limit < total
    ? `<a href="${escape(at(offset + limit))}" rel="next">older →</a>`
    : '<span class="disabled">older →</span>'
  return `<nav class="pager">${previous}<span class="page">page ${page} of ${pages}</span>${next}</nav>`
}

export function renderSearchPage ({
  query, facets, results, total, corpus, elapsedMs, facetValues, viewer = {},
  browsing = null
}) {
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
    : `<p class="meta">${corpus} plugins indexed. Search by what a plugin does, not just its name.${browsing ? ' Most recently added first:' : ''}</p>`}
${results.length
    ? results.map(resultItem).join('\n')
    : (query ? '<p class="empty">Nothing matched.</p>' : '')}
${browsing ? pager({ total, offset: browsing.offset, limit: browsing.limit, params: { q: query, ...facets } }) : ''}
`
  return layout(query ? `${query} — Plugin Universe` : 'Plugin Universe', body, {
    description: 'An open, machine-readable database of DAW plugins with semantic search.',
    ...viewer
  })
}

export function renderPluginPage (doc, viewer = {}, contribution = null) {
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
${pluginFigure(doc)}
${doc.description ? `<p class="desc">${escape(doc.description)}</p>` : ''}
<table>
${doc.homepage ? `<tr><th>Homepage</th><td><a href="${escape(doc.homepage)}" rel="nofollow noopener">${escape(doc.homepage)}</a></td></tr>` : ''}
${rows.map(([k, v]) => `<tr><th>${escape(k)}</th><td>${escape(v)}</td></tr>`).join('\n')}
<tr><th>IRI</th><td><code>${escape(doc.iri)}</code></td></tr>
</table>
${renderProvenance(doc)}
${contribution ? renderCorrectionForm(doc, contribution) : ''}
<p class="meta">Also available as
  <a href="${escape(doc.iri.replace(NAMESPACES.pu, '/'))}.ttl">Turtle</a>,
  <a href="${escape(doc.iri.replace(NAMESPACES.pu, '/'))}.jsonld">JSON-LD</a>.
</p>
<script type="application/ld+json">${JSON.stringify(pluginJsonLd(doc), null, 2)}</script>
`
  return layout(`${doc.name} — Plugin Universe`, body, { description: doc.description ?? '', ...viewer })
}

/**
 * The moderation queue.
 *
 * Deliberately plain: a moderator wants to see what was proposed, by whom, and
 * why, and then decide. Each decision is its own form with its own token, so a
 * stale page cannot accept something the moderator has not looked at.
 */
export function renderModerationPage (pending, { csrfToken, message, viewer = {} }) {
  const rows = pending.map(item => `
  <div class="result">
    <h2>${escape(item.predicate.replace(/^.*[#/]/, ''))} &rarr; ${escape(String(item.value).slice(0, 120))}</h2>
    <p class="desc">on <a href="${escape(item.subject.replace(NAMESPACES.pu, '/'))}">${escape(item.subject.split('/').pop())}</a>
       by ${escape(item.by.split('/').pop())}</p>
    ${item.rationale ? `<p class="desc">&ldquo;${escape(item.rationale)}&rdquo;</p>` : ''}
    <form method="post" action="/moderation" class="correct">
      <input type="hidden" name="csrf" value="${escape(csrfToken)}">
      <input type="hidden" name="correction" value="${escape(item.correction)}">
      <button type="submit" name="decision" value="accept">Accept</button>
      <button type="submit" name="decision" value="reject" class="secondary">Reject</button>
    </form>
  </div>`).join('\n')

  return layout('Moderation — Plugin Universe', `
<p class="meta"><a href="/">← search</a></p>
<h2 style="font-size:1.3rem;margin:.5rem 0 .2rem">Moderation queue</h2>
${message ? `<p class="ok">${escape(message)}</p>` : ''}
<p class="meta">${pending.length} correction${pending.length === 1 ? '' : 's'} awaiting review.
  Accepting writes the fact to the contributor's public-domain graph and counts towards their trust.</p>
${pending.length ? rows : '<p class="empty">Nothing waiting.</p>'}
`, { description: 'Corrections awaiting review.', ...viewer })
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
/** A list of sibling category links, or nothing. */
function categoryLinks (label, slugs) {
  if (!slugs || slugs.length === 0) return ''
  return `<p class="tags"><strong>${escape(label)}</strong> ` +
    slugs.map(slug => `<a class="tag" href="/category/${escape(slug)}">${escape(slug)}</a>`).join(' ') +
    '</p>'
}

/**
 * One category: what it means, what else it is called, and where it sits.
 *
 * The scheme carried a label and a parent link and nothing else for as long as
 * it was a JavaScript object literal. Now that it is an ontology there is
 * something to show, and showing it is also how it gets checked — a definition
 * nobody reads is a definition nobody notices is wrong.
 */
export function renderCategoryPage (slug, results, total, viewer = {}, concept = null) {
  const body = `
<p class="meta"><a href="/">← search</a></p>
<h2 style="font-size:1.3rem;margin:.5rem 0 .2rem">${escape(concept?.prefLabel ?? slug)}</h2>
${concept?.definition ? `<p class="desc">${escape(concept.definition)}</p>` : ''}
${concept?.scopeNote ? `<p class="meta scope">${escape(concept.scopeNote)}</p>` : ''}
${concept?.altLabels?.length
    ? `<p class="tags"><strong>Also called</strong> ${concept.altLabels.map(l => `<span class="tag">${escape(l)}</span>`).join(' ')}</p>`
    : ''}
${categoryLinks('Part of', concept?.broader ? [concept.broader] : null)}
${categoryLinks('Includes', concept?.narrower)}
${categoryLinks('Related', concept?.related)}
${concept?.closeMatches?.length
    ? `<p class="tags"><strong>Elsewhere</strong> ${concept.closeMatches.map(m => `<code>${escape(m.replace('http://lv2plug.in/ns/lv2core#', 'lv2:'))}</code>`).join(' ')}</p>`
    : ''}
<p class="meta">${total} plugin${total === 1 ? '' : 's'} in this category.
  Also as <a href="${escape(`/category/${slug}`)}.ttl">Turtle</a>.</p>
${results.map(resultItem).join('\n')}
`
  return layout(`${concept?.prefLabel ?? slug} — Plugin Universe`, body, {
    description: concept?.definition ??
      `Plugins categorised as ${slug} in the Plugin Universe catalogue.`,
    ...viewer
  })
}

/**
 * The suggest-a-correction form.
 *
 * Only for a signed-in viewer: an anonymous form would need its own spam
 * defence and there would be nobody to attribute the contribution to. Someone
 * signed out gets an invitation instead, carrying a return path so they come
 * back to the plugin they were reading.
 *
 * The field list comes from CORRECTABLE, so the form and the validator cannot
 * disagree about what may be changed.
 */
export function renderCorrectionForm (doc, { account, csrfToken, correctable, error, submitted }) {
  const slug = doc.iri.split('/').pop()
  if (!account) {
    return `<div class="prov">
  <h3>Something wrong?</h3>
  <p><a href="/auth/login?return_to=${escape(`/plugin/${slug}`)}">Sign in</a> to suggest a correction.
  Facts you contribute go into the public domain; see the <a href="/terms">contributor terms</a>.</p>
</div>`
  }

  const options = Object.entries(correctable)
    .map(([predicate, field]) => `<option value="${escape(predicate)}">${escape(field.label)}</option>`)
    .join('')

  return `<div class="prov">
  <h3>Suggest a correction</h3>
  ${error ? `<p class="err">${escape(error)}</p>` : ''}
  ${submitted ? `<p class="ok">${escape(submitted)}</p>` : ''}
  <form method="post" action="/plugin/${escape(slug)}/correct" class="correct">
    <input type="hidden" name="csrf" value="${escape(csrfToken)}">
    <label>Field <select name="predicate">${options}</select></label>
    <label>Should be <input type="text" name="value" required maxlength="2000"></label>
    <label>Why <input type="text" name="rationale" maxlength="1000" placeholder="optional"></label>
    <button type="submit">Suggest</button>
  </form>
  <p class="tags">Contributed facts are CC0. See the <a href="/terms">contributor terms</a>.</p>
</div>`
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

export { escape }
