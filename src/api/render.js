import { TRUST } from '../auth/Accounts.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
// One-way: the HTML pages embed the JSON-LD, the serialisations know nothing
// about HTML.
import { linkable, pluginJsonLd } from './serialise.js'
import templates, { escape } from './Templates.js'

/**
 * HTML and RDF rendering for the public pages.
 *
 * Plugin pages must be crawlable and carry schema.org JSON-LD
 * (docs/architecture.md §4), and a plugin IRI must dereference to Turtle,
 * JSON-LD or HTML according to the request (§2.1).
 *
 * Server-rendered, no client framework: a catalogue page is text and links.
 */


/**
 * The sign-in corner of the header.
 *
 * `account` is null when nobody is signed in, and undefined when the instance
 * has no sign-in configured at all — a read-only deployment shows nothing
 * rather than a link that 404s.
 */
function accountBar (account, signInEnabled) {
  if (!signInEnabled) return ''
  if (!account) return templates.render('account-signed-out', {})
  return templates.render('account-signed-in', {
    login: account.login,
    // The moderation queue is linked here or it is not reachable at all. A
    // route with no link is the same defect as a link with no route, and this
    // project has already shipped one of those.
    moderation: templates.when(account.trustLevel === TRUST.MODERATOR, 'account-moderation', {})
  })
}

function layout (title, body, { description = '', account = null, signInEnabled = false } = {}) {
  return templates.render('layout', {
    title,
    description: templates.when(Boolean(description), 'meta-description', { description }),
    style: templates.asset('site.css'),
    account: accountBar(account, signInEnabled),
    body
  })
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
  const image = pluginImage(doc, { size: 'full' })
  if (!image) return ''
  let host = ''
  try {
    host = new URL(doc.image).host
  } catch {
    return ''
  }
  return templates.render('plugin-figure', { image, host })
}

function resultItem (r) {
  const image = pluginImage(r)
  const tags = [...(r.formats ?? []), ...(r.categories ?? [])]
  return templates.render('result', {
    shotClass: image ? ' has-shot' : '',
    image,
    score: templates.when(r.score !== undefined, 'result-score', { score: r.score?.toFixed(3) }),
    slug: r.iri?.split('/').pop() ?? '',
    name: r.name,
    vendor: templates.when(Boolean(r.vendor), 'result-vendor', { vendor: r.vendor }),
    description: templates.when(Boolean(r.description), 'description',
      { description: String(r.description ?? '').split('\n')[0].slice(0, 220) }),
    badges: availabilityBadges(r),
    tags: templates.each('tag', tags, value => ({ value }))
  })
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
  const step = (condition, position, rel, label) => condition
    ? templates.render('pager-link', { href: at(position), rel, label })
    : templates.render('pager-disabled', { label })

  return templates.render('pager', {
    previous: step(offset > 0, Math.max(0, offset - limit), 'prev', '\u2190 newer'),
    next: step(offset + limit < total, offset + limit, 'next', 'older \u2192'),
    page: Math.floor(offset / limit) + 1,
    pages: Math.ceil(total / limit)
  })
}

export function renderSearchPage ({
  query, facets, results, total, corpus, elapsedMs, facetValues, viewer = {},
  browsing = null
}) {
  const facetSelect = name => templates.render('search-facet', {
    name,
    options: templates.each('search-facet-option', facetValues?.[name] ?? [], value => ({
      value: value.value,
      count: value.count,
      selected: value.value === facets[name] ? ' selected' : ''
    }))
  })

  const searched = Boolean(query) || Object.values(facets).some(Boolean)
  const body = templates.render('search', {
    query: query ?? '',
    facets: ['format', 'category', 'pricing', 'source'].map(facetSelect).join('\n  '),
    summary: templates.render('meta-line', {
      text: searched
        ? `${total} of ${corpus} plugins${elapsedMs !== undefined ? `, ${elapsedMs} ms` : ''}`
        : `${corpus} plugins indexed. Search by what a plugin does, not just its name.` +
          `${browsing ? ' Most recently added first:' : ''}`
    }),
    results: results.length
      ? results.map(resultItem).join('\n')
      : templates.when(Boolean(query), 'empty', { text: 'Nothing matched.' }),
    pager: browsing
      ? pager({ total, offset: browsing.offset, limit: browsing.limit, params: { q: query, ...facets } })
      : ''
  })

  return layout(query ? `${query} — Plugin Universe` : 'Plugin Universe', body, {
    description: 'An open, machine-readable database of DAW plugins with semantic search.',
    ...viewer
  })
}

export function renderPluginPage (doc, viewer = {}, contribution = null, measured = null) {
  const rows = [
    ['Vendor', doc.vendor],
    ['Formats', (doc.formats ?? []).join(', ')],
    ['Roles', (doc.roles ?? []).join(', ')],
    ['Categories', (doc.categories ?? []).join(', ')],
    ['Tags', (doc.tags ?? []).join(', ')],
    ['Price', PRICING_LABEL[doc.pricing]],
    ['Source', AVAILABILITY_LABEL[doc.sourceAvailability]],
    ['Licence', doc.licenceId],
    ['Parameters', (doc.parameters ?? []).length ? `${doc.parameters.length}: ${doc.parameters.slice(0, 12).join(', ')}${doc.parameters.length > 12 ? '\u2026' : ''}` : null],
    ['Caution', doc.cautions]
  ].filter(([, value]) => value)
  const path = doc.iri.replace(NAMESPACES.pu, '/')

  const body = templates.render('plugin', {
    name: doc.name,
    vendor: templates.when(Boolean(doc.vendor), 'tagline', { text: doc.vendor }),
    figure: pluginFigure(doc),
    description: templates.when(Boolean(doc.description), 'description', { description: doc.description }),
    homepage: templates.when(Boolean(doc.homepage), 'plugin-homepage', { href: doc.homepage }),
    rows: templates.each('table-row', rows, ([label, value]) => ({ label, value })),
    iri: doc.iri,
    measurements: renderMeasurements(measured),
    provenance: renderProvenance(doc),
    correctionForm: contribution ? renderCorrectionForm(doc, contribution) : '',
    ttl: `${path}.ttl`,
    jsonld: `${path}.jsonld`,
    jsonLd: JSON.stringify(pluginJsonLd(doc), null, 2)
  })
  return layout(`${doc.name} — Plugin Universe`, body, { description: doc.description ?? '', ...viewer })
}

/**
 * The moderation queue.
 *
 * Deliberately plain: a moderator wants to see what was proposed, by whom, and
 * why, and then decide. Each decision is its own form with its own token, so a
 * stale page cannot accept something the moderator has not looked at.
 */
/**
 * What one person has proposed, and what became of it.
 *
 * Their own contributions only, and only to them. A pending correction sits in
 * the personal-data graph with the contributor's own words about why they think
 * something is wrong — theirs to see, not a public record. The part that
 * becomes public on acceptance is the fact itself, attributed to them on the
 * plugin page.
 *
 * Without this page a contributor suggests something and it vanishes: no
 * acknowledgement, no queue position, no way to know a moderator declined it.
 * That is the state the correction form shipped in.
 */
export function renderContributionsPage (rows, { viewer = {}, correctable = {}, trustLevel = null }) {
  const BADGE = { accepted: 'src', rejected: 'warn', pending: 'price' }
  const accepted = rows.filter(row => row.status === 'accepted').length

  const body = templates.render('contributions', {
    heading: templates.render('page-heading', { title: 'Your contributions' }),
    standing: rows.length === 0
      ? ''
      : templates.render('meta-line', {
        text: trustLevel === 'new'
          ? `${accepted} of your suggestions have been accepted. ` +
            `After ${CONTRIBUTION_CONFIG.acceptedBeforeTrusted}, later ones go live as soon as you make them.`
          : 'Your corrections are applied as soon as you make them.'
      }),
    items: rows.length === 0
      ? templates.render('empty', { text: 'Nothing yet. Every plugin page has a \u201Csuggest a correction\u201D form.' })
      : templates.each('contribution', rows, row => ({
        slug: row.subject.split('/').pop(),
        badge: templates.render('badge', { kind: BADGE[row.status] ?? 'price', label: row.status }),
        field: correctable[row.predicate]?.label ?? row.predicate.replace(/^.*[/#]/, ''),
        value: row.value,
        rationale: templates.when(Boolean(row.rationale), 'tags-line', { text: row.rationale }),
        at: String(row.at).slice(0, 10),
        decided: row.reviewedAt ? `, decided ${String(row.reviewedAt).slice(0, 10)}` : ''
      }))
  })

  return layout('Your contributions — Plugin Universe', body, {
    description: 'Corrections you have suggested to the Plugin Universe catalogue.',
    ...viewer
  })
}

export function renderModerationPage (pending, { csrfToken, message, viewer = {} }) {
  const body = templates.render('moderation', {
    heading: templates.render('page-heading', { title: 'Moderation queue' }),
    message: templates.when(Boolean(message), 'notice', { text: message }),
    count: `${pending.length} correction${pending.length === 1 ? '' : 's'}`,
    items: pending.length
      ? templates.each('moderation-item', pending, item => ({
        field: item.predicate.replace(/^.*[#/]/, ''),
        value: String(item.value).slice(0, 120),
        href: item.subject.replace(NAMESPACES.pu, '/'),
        slug: item.subject.split('/').pop(),
        by: item.by.split('/').pop(),
        rationale: templates.when(Boolean(item.rationale), 'quoted', { text: item.rationale }),
        csrf: csrfToken,
        correction: item.correction
      }))
      : templates.render('empty', { text: 'Nothing waiting.' })
  })
  return layout('Moderation — Plugin Universe', body, { description: 'Corrections awaiting review.', ...viewer })
}

/**
 * A prose page — about, terms, the crawler notice.
 *
 * The Markdown is rendered elsewhere; this puts it in the site's chrome so a
 * visitor reads it as part of the site. Constrained to a narrower measure than
 * the search results, because these are paragraphs rather than a table.
 */
export function renderDocPage ({ title, description, html }, viewer = {}) {
  return layout(`${title} — Plugin Universe`, templates.render('doc-page', { html }),
    { description, ...viewer })
}

/**
 * A category page: the browsable facet, and the thing a pu:category IRI
 * dereferences to.
 *
 * Categories are minted as IRIs and asserted on every plugin, so they have to
 * resolve to something. A list of what is in the category is both the useful
 * answer for a person and the honest one for a machine.
 */
/**
 * What the profiler measured, if anything has.
 *
 * The profiler has been writing these into the store since Phase 2 and nothing
 * displayed them — the third instance in MISTAKES.md of data collected, never
 * shown, and therefore never checked. Every one of the previous three was
 * wrong in some way that became obvious the moment a person could see it.
 *
 * The tool, the machine and the date are shown beside the readings rather than
 * tucked away, because a measurement without them is not a measurement: "20
 * ports" is a fact about a binary on a particular host on a particular day, and
 * the next run may disagree.
 */
export function renderMeasurements (measured) {
  if (!measured || measured.readings.length === 0) return ''
  const verdict = measured.verdict
    ? `<span class="badge badge-${verdictBadge(measured.verdict)}">${escape(measured.verdict)}</span>`
    : ''
  const rows = measured.readings
    .filter(reading => reading.metric !== 'ValidationResult')
    .map(reading => `<tr><th${reading.about ? ` title="${escape(reading.about)}"` : ''}>${escape(reading.label)}</th>` +
      `<td>${escape(readingValue(reading))}${reading.note ? ` <span class="muted">— ${escape(reading.note)}</span>` : ''}</td></tr>`)
    .join('\n')

  return `<div class="prov measured">
  <h3>Measured ${verdict}</h3>
  <table>
${rows}
  </table>
  <p class="tags">By <code>${escape(measured.tool)}</code> on ${escape(measured.platform)},
    ${escape(String(measured.at).slice(0, 10))}. One run on one machine — a reading here describes
    that binary on that host, not the plugin in the abstract.</p>
</div>`
}

/**
 * Units whose LV2 local name is not how a person writes them.
 *
 * The authority for a unit is its IRI in the LV2 units vocabulary, which this
 * catalogue does not hold a copy of — so the local name is used, and it is the
 * conventional symbol for every unit here except this one. Kept as an
 * exception list rather than a table of every unit, so it stays small and its
 * absence of an entry means "the local name is right".
 */
const UNIT_SYMBOL = Object.freeze({ pc: '%' })

/**
 * One reading, as a person reads it.
 *
 * A bare number with no unit is how "364" came to sit on a page meaning
 * milliseconds, and a raw `false` is how a boolean metric came to read as a
 * measurement that had failed.
 */
function readingValue (reading) {
  if (reading.value === 'true') return 'yes'
  if (reading.value === 'false') return 'no'
  if (!reading.unit) return reading.value
  const name = reading.unit.replace(/^.*[/#]/, '')
  return `${reading.value} ${UNIT_SYMBOL[name] ?? name}`
}

/** Verdict to badge class. Anything other than a pass reads as a warning. */
function verdictBadge (verdict) {
  return verdict === 'ok' ? 'src' : 'warn'
}

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
