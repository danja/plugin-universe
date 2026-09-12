import { TRUST } from '../auth/Accounts.js'
import { CONTRIBUTION_CONFIG, RETRIEVAL_CONFIG, IMAGE_CONFIG, PROMOTION_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
// One-way: the HTML pages embed the JSON-LD, the serialisations know nothing
// about HTML.
import { linkable, pluginJsonLd } from './serialise.js'
import templates, { escape } from './Templates.js'
import { UNVERSIONED, NOASSERTION, LICENCE_IDS } from '../harvest/Licensing.js'
import { vendorSlug } from '../search/SearchService.js'

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
    // The moderation queue and the submission form are linked here or they are
    // not reachable at all. A route with no link is the same defect as a link
    // with no route, and this project has already shipped one of those.
    moderation: templates.when(account.trustLevel === TRUST.MODERATOR, 'account-moderation', {})
  })
}

export function layout (title, body, {
  description = '', account = null, signInEnabled = false,
  // A page laid out in columns carries the site links in one of them, so it
  // asks for the footer to be left off. One template renders them either way —
  // two copies of a list of links is two lists to keep correct, and this one
  // includes the terms.
  footer = true
} = {}) {
  return templates.render('layout', {
    title,
    description: templates.when(Boolean(description), 'meta-description', { description }),
    style: templates.asset('site.css'),
    account: accountBar(account, signInEnabled),
    body,
    footer: templates.when(footer, 'footer', { links: templates.render('site-links', {}) })
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
  // First in the row, always. The ASA asks for disclosure that is immediate and
  // prominent, and a label that follows a licence and two format tags is
  // neither. `title` carries the fuller statement for anyone who hovers; the
  // page itself carries it under the plugin.
  if (r.promoted) {
    badges.push(templates.render('ad-label', {
      label: PROMOTION_CONFIG.label,
      explanation: 'Paid placement. This result is boosted in ranking because it is paid for.'
    }))
  }
  if (PRICING_LABEL[r.pricing]) {
    badges.push(templates.render('badge', { kind: 'price', label: PRICING_LABEL[r.pricing] }))
  }
  if (AVAILABILITY_LABEL[r.sourceAvailability]) {
    badges.push(templates.render('badge', { kind: 'src', label: AVAILABILITY_LABEL[r.sourceAvailability] }))
  }
  if (r.licenceId) badges.push(templates.render('plain-badge', { label: r.licenceId }))
  return badges.join('')
}

/**
 * A licence identifier as a reader should see it.
 *
 * `GPL` sitting in a list beside `GPL-3.0` and `GPL-2.0` looks like a
 * truncation. It is not: 59 plugins state the GNU GPL through a DOAP licence
 * URL that names the family and no version, and the catalogue records that
 * rather than picking one. The parenthesis is the only place a reader is told
 * so, and it costs a facet nothing because the value is unchanged.
 *
 * `NOASSERTION` is SPDX's token for a licence that exists and was not
 * identified, which is not a phrase anybody should have to look up.
 */
function licenceLabel (licenceId) {
  if (!licenceId) return null
  if (licenceId === NOASSERTION) return 'stated, but not identified'
  if (UNVERSIONED.has(licenceId)) return `${licenceId} (version not stated)`
  return licenceId
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
  // Two templates rather than one with a conditional, because the difference
  // is whether dimensions are declared at all. A thumbnail sits in a fixed
  // square box, so width and height are true and stop the row reflowing. The
  // full image has whatever shape it has — plugin screenshots are wide — and
  // declaring it square told the browser to reserve a square and then scale a
  // wide picture into it, which is what made them look cropped.
  if (size === 'full') {
    return templates.render('plugin-image-full', { src: doc.image, alt: doc.name ?? '' })
  }
  return templates.render('plugin-image', {
    size,
    src: doc.image,
    alt: doc.name ?? '',
    box: 72
  })
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
  // An image the catalogue stores is copied here, and saying it is not was
  // false the moment uploads started working. `imageIsLocal` is settled by
  // SearchService, which is the only part that knows this site's own origin.
  if (doc.imageIsLocal) return templates.render('plugin-figure-local', { image })
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
  // Formats and categories both look like links and were not. A format goes to
  // the filtered search, a category to its own page — which exists precisely so
  // that a category IRI resolves to something.
  const tags = [
    ...(r.formats ?? []).map(value => ({ value, href: `/?format=${encodeURIComponent(value)}` })),
    ...(r.categories ?? []).map(value => ({ value, href: `/category/${encodeURIComponent(value)}` }))
  ]
  return templates.render('result', {
    shotClass: image ? ' has-shot' : '',
    image,
    score: templates.when(r.score !== undefined, 'result-score', { score: r.score?.toFixed(3) }),
    slug: r.iri?.split('/').pop() ?? '',
    name: r.name,
    // The vendor's name is a link now that there is a page behind it. It was
    // the one identifier on a result row that named something real and went
    // nowhere.
    vendor: templates.when(Boolean(r.vendor), 'result-vendor',
      { vendor: r.vendor, slug: r.vendorSlug ?? vendorSlug(r.vendor ?? '') }),
    description: templates.when(Boolean(r.description), 'description',
      { description: String(r.description ?? '').split('\n')[0].slice(0, 220) }),
    badges: availabilityBadges(r),
    tags: templates.each('tag-link', tags, tag => tag)
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
export function pager ({ total, offset, limit, params = {}, base = '/' }) {
  if (total <= limit) return ''
  const at = position => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== '')
    )
    if (position > 0) query.set('from', String(position))
    else query.delete('from')
    const string = query.toString()
    return `${base}${string ? `?${string}` : ''}`
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

/**
 * Three pages, one template, because they are three things.
 *
 * `/` was doing all of this at once — landing page, search results and the
 * paged browse list — told apart by a `searched` boolean and a `browsing`
 * object. Meanwhile /search and /plugins were the JSON representations of the
 * second and third. One thing had two URLs and two URLs had one thing.
 *
 * Now each has its own address and its own representations, which is the model
 * the rest of the site already uses for a plugin IRI. The template lays out;
 * these three decide what goes in it.
 */

/** The facet dropdowns, with the current selection marked. */
function facetControls (facetValues, facets) {
  const facetSelect = name => templates.render('search-facet', {
    name,
    options: templates.each('search-facet-option', facetValues?.[name] ?? [], value => ({
      value: value.value,
      count: value.count,
      selected: value.value === facets[name] ? ' selected' : ''
    }))
  })
  return ['format', 'category', 'pricing', 'source'].map(facetSelect).join('\n  ')
}

/**
 * Navigation by format and category, beside the results on a wide screen and
 * behind a toggle on a narrow one.
 *
 * Both lists come from the facet counts the page already has, so this cannot
 * offer a category nothing is in — the counts and the links are the same query.
 * Formats are shown whole; there are seven. Categories are not: there are
 * twenty-eight, and a column of twenty-eight is a wall rather than a way in, so
 * this takes the largest few and links the rest through the browse list.
 */
function sidebar (facetValues, total) {
  const link = (href, label, count) => ({ href, label, count })
  const formats = templates.each('sidebar-link',
    (facetValues?.format ?? []).map(value =>
      link(`/plugins?format=${encodeURIComponent(value.value)}`, value.value, value.count)),
    row => row)
  const categories = templates.each('sidebar-link',
    (facetValues?.category ?? []).slice(0, RETRIEVAL_CONFIG.sidebarCategories).map(value =>
      link(`/category/${encodeURIComponent(value.value)}`, value.value, value.count)),
    row => row)
  return templates.render('sidebar', { formats, categories, total })
}

/** The shared shell: the form, a summary line, results, and the optional slots. */
function searchShell ({
  query, facets, facetValues, summary, results, services, more, pager: pagerHtml, total
}) {
  return templates.render('search', {
    query: query ?? '',
    facets: facetControls(facetValues, facets),
    summary: templates.render('meta-line', { text: summary }),
    services,
    side: sidebar(facetValues, total),
    // The same list the footer renders on every other page. Here it is the
    // left column instead, so the page has one and not both.
    links: templates.render('site-links', {}),
    results: results.length
      ? results.map(resultItem).join('\n')
      : templates.when(Boolean(query), 'empty', { text: 'Nothing matched.' }),
    more,
    pager: pagerHtml
  })
}

/**
 * The landing page: what this is, how to search it, and a glimpse of what is in
 * it — with the complete list one click away rather than paged from here.
 *
 * What the glimpse should be is still an open question; that it is a glimpse
 * rather than page one of seventy-six is what this page needed in order for the
 * question to be answerable at all.
 */
export function renderLandingPage ({ corpus, results, facetValues, viewer = {} }) {
  const body = searchShell({
    query: null,
    facets: {},
    facetValues,
    // No claim about ordering. Every plugin in the catalogue carries the same
    // dcterms:created — one dated ingest — so "most recently added", which this
    // said for a while, was alphabetical wearing a label.
    summary: `${corpus} plugins indexed. Search by what a plugin does, not just its name.`,
    results,
    total: corpus,
    // Only here: somebody who has typed a query is looking for a plugin, not
    // for an endpoint.
    services: templates.render('services-note', {}),
    more: templates.when(results.length > 0, 'browse-all', {}),
    pager: ''
  })
  return layout('Plugin Universe', body, {
    description: 'An open, machine-readable database of DAW plugins with semantic search.',
    ...viewer,
    footer: false
  })
}

/** Search results. Ranked and capped: relevance past the first screen is noise. */
export function renderSearchPage ({
  query, facets, results, total, corpus, elapsedMs, facetValues, viewer = {}
}) {
  const body = searchShell({
    query,
    facets,
    facetValues,
    summary: `${total} of ${corpus} plugins${elapsedMs !== undefined ? `, ${elapsedMs} ms` : ''}`,
    results,
    services: '',
    more: '',
    pager: '',
    total: corpus
  })
  return layout(query ? `${query} — Plugin Universe` : 'Search — Plugin Universe', body, {
    description: 'An open, machine-readable database of DAW plugins with semantic search.',
    ...viewer,
    footer: false
  })
}

/** The whole catalogue, a page at a time. */
export function renderBrowsePage ({
  results, total, offset, limit, facets, facetValues, corpus, viewer = {}
}) {
  const body = searchShell({
    query: null,
    facets,
    facetValues,
    // No ordering claim here either. `recent` is still what is asked for, and
    // it will mean something once a second ingest spreads the first-seen dates
    // — but today every plugin carries the same one, so saying "most recently
    // added first" over an alphabetical list is a claim the data cannot support.
    summary: Object.values(facets).some(Boolean)
      ? `${total} of ${corpus} plugins`
      : `All ${total} plugins`,
    results,
    services: '',
    more: '',
    pager: pager({ total, offset, limit, params: facets, base: '/plugins' }),
    total: corpus
  })
  return layout('All plugins — Plugin Universe', body, {
    description: 'Every plugin in the Plugin Universe catalogue.',
    ...viewer,
    footer: false
  })
}

/**
 * One plugin, with the same two columns the search pages carry.
 *
 * The navigation is a sixth argument rather than a fifth positional one
 * because five was already too many; it is the only thing here that is about
 * the site rather than about the plugin.
 */
/**
 * The upload form, for somebody allowed to use it.
 *
 * Only shown to a trusted contributor or a moderator. An uploaded picture is
 * public the moment it is served and cannot be un-seen, so unlike a correction
 * or a submission there is no useful "queued" state — the choice is to trust
 * the uploader or not, and trust is something this site already measures.
 */
export function imageForm (slug, { csrfToken, error = null, done = null } = {}) {
  return templates.render('image-form', {
    slug,
    csrf: csrfToken ?? '',
    maxKb: String(Math.round(IMAGE_CONFIG.maxBytes / 1024)),
    error: templates.when(Boolean(error), 'error', { text: error }),
    done: templates.when(Boolean(done), 'notice', { text: done })
  })
}

/**
 * JSON, safe to embed in a `<script>` element.
 *
 * `JSON.stringify` escapes what JSON needs and nothing HTML needs, and `<` is
 * not special in JSON. So a value containing `</script>` — in a plugin's name,
 * its description, a tag, a category — closed the JSON-LD block at the foot of
 * every plugin page, and everything after it was parsed as markup. Harvested
 * strings reach those fields, and so does anything typed into `/submit`.
 *
 * Escaping `<` to `\u003c` is the standard fix and costs nothing: it is the
 * same string to any JSON parser, and it cannot close a tag, open a comment, or
 * start a nested `<script`.
 */
function scriptSafeJson (value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c')
}

/**
 * SPDX's own page for a licence, where the identifier is really an SPDX one.
 *
 * Null for the unversioned tokens and for NOASSERTION: they are this
 * catalogue's honest record of what a source said and are deliberately *not*
 * SPDX identifiers, so there is nothing at spdx.org to point at. A link that
 * 404s is worse than a plain word.
 */
function spdxUrl (licenceId) {
  if (!licenceId || UNVERSIONED.has(licenceId) || licenceId === NOASSERTION) return null
  if (!LICENCE_IDS.has(licenceId)) return null
  return `https://spdx.org/licenses/${encodeURIComponent(licenceId)}.html`
}

/**
 * A list of values, each linked, for a table row.
 *
 * The plugin page stated formats, roles and categories as plain text while a
 * result row linked the same values — so the page *about* one plugin was the
 * one place you could not get anywhere from. For a catalogue whose argument is
 * that identifiers should resolve, its own profile page being a dead end is the
 * wrong demonstration.
 */
function linkedValues (values, href) {
  return (values ?? [])
    .map(value => `<a href="${escape(href(value))}">${escape(value)}</a>`)
    .join(', ')
}

export function renderPluginPage (
  doc, viewer = {}, contribution = null, measured = null, wiki = '',
  { facetValues = {}, corpus = 0 } = {}
) {
  // Rows are `[label, value, linked]`. A linked row's value is a fragment this
  // code built and escaped; every other row is escaped by the template, which
  // is the right way round — escaping is the default and the exception is
  // marked.
  const licence = licenceLabel(doc.licenceId)
  const spdx = spdxUrl(doc.licenceId)
  const rows = [
    // Left as text here: the heading above is already a link to the same page,
    // and two links to one place in one screen is noise rather than emphasis.
    ['Vendor', doc.vendor],
    ['Formats', linkedValues(doc.formats, v => `/?format=${encodeURIComponent(v)}`), true],
    ['Roles', linkedValues(doc.roles, v => `/?role=${encodeURIComponent(v)}`), true],
    ['Categories', linkedValues(doc.categories, v => `/category/${encodeURIComponent(v)}`), true],
    ['Tags', (doc.tags ?? []).join(', ')],
    ['Price', PRICING_LABEL[doc.pricing]],
    ['Source', AVAILABILITY_LABEL[doc.sourceAvailability]],
    // The identifier resolves to SPDX's description of it, where it is an SPDX
    // identifier at all.
    ...(spdx
      ? [['Licence', `<a href="${escape(spdx)}">${escape(licence)}</a>`, true]]
      : [['Licence', licence]]),
    // The author's own identifier for this plugin, preserved with owl:sameAs
    // rather than replaced. 86 plugins have one and none of them showed it.
    ['Also known as', linkedValues(doc.sameAs, v => v), true],
    ['Parameters', (doc.parameters ?? []).length ? `${doc.parameters.length}: ${doc.parameters.slice(0, 12).join(', ')}${doc.parameters.length > 12 ? '\u2026' : ''}` : null],
    ['Caution', doc.cautions]
  ].filter(([, value]) => value)
  const path = doc.iri.replace(NAMESPACES.pu, '/')

  const body = templates.render('plugin', {
    side: sidebar(facetValues, corpus),
    links: templates.render('site-links', {}),
    name: doc.name,
    vendor: templates.when(Boolean(doc.vendor), 'plugin-vendor',
      { vendor: doc.vendor, slug: doc.vendorSlug ?? vendorSlug(doc.vendor ?? '') }),
    // Disclosed on the plugin's own page, not only in a result row. Somebody
    // arriving from a link has seen no label at all, and "this placement is
    // paid for" is a fact about the listing wherever it is read.
    promoted: templates.when(Boolean(doc.promoted), 'promoted-note', {
      label: PROMOTION_CONFIG.label
    }),
    figure: pluginFigure(doc),
    description: templates.when(Boolean(doc.description), 'description', { description: doc.description }),
    homepage: templates.when(Boolean(doc.homepage), 'plugin-homepage', { href: doc.homepage }),
    rows: rows.map(([label, value, linked]) =>
      templates.render(linked ? 'table-row-links' : 'table-row', { label, value })).join('\n'),
    iri: doc.iri,
    iriHref: doc.iri,
    wiki,
    measurements: renderMeasurements(measured),
    provenance: renderProvenance(doc),
    correctionForm: contribution ? renderCorrectionForm(doc, contribution) : '',
    // Only for somebody who may actually use it. A form shown to a reader who
    // will be refused is a promise the page cannot keep.
    imageForm: contribution?.mayUploadImage
      ? imageForm(path.replace('/plugin/', ''), {
        csrfToken: contribution.csrfToken,
        error: contribution.imageError,
        done: contribution.imageDone
      })
      : '',
    ttl: `${path}.ttl`,
    jsonld: `${path}.jsonld`,
    jsonLd: scriptSafeJson(pluginJsonLd(doc))
  })
  return layout(`${doc.name} — Plugin Universe`, body, {
    description: doc.description ?? '', ...viewer, footer: false
  })
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
/**
 * The form for proposing a plugin the catalogue does not have.
 *
 * Built from `SUBMITTABLE` rather than written out, so the form, the validator
 * and the triples it becomes cannot drift apart — the help text beside each
 * input is the same string the error message quotes when the field is missing.
 *
 * Whatever was typed comes back on an error. A form that empties itself when it
 * refuses is a form people fill in once.
 */
export function renderSubmitPage (submittable, {
  csrfToken, error = null, submitted = null, values = {}, viewer = {},
  facetValues = {}, corpus = 0, mayRead = false, draft = null, pageUrl = ''
}) {
  /** One field: a row of checkboxes where it takes several values, a box where it does not. */
  const field = ([name, spec]) => {
    if (spec.multiple) {
      // A required group with nothing to tick is a form nobody can complete,
      // and it looks like it should work — so it is an error here rather than
      // an empty row on the page.
      if (!spec.choices?.length) {
        throw new Error(`${name} takes several values but declares no choices to offer.`)
      }
      const chosen = new Set([values[name] ?? []].flat())
      return templates.render('submit-checkboxes', {
        label: spec.label,
        help: spec.help,
        boxes: templates.each('submit-checkbox', spec.choices, value => ({
          name,
          value,
          checked: chosen.has(value) ? ' checked' : ''
        }))
      })
    }
    return templates.render('submit-field', {
      name,
      label: spec.label,
      help: spec.help,
      // A URL field gets the keyboard and the validation a browser already has.
      type: spec.kind === 'url' ? 'url' : 'text',
      value: values[name] ?? '',
      maxLength: String(CONTRIBUTION_CONFIG.maxValueLength),
      required: spec.required ? '' : ' (optional)',
      requiredAttr: spec.required ? ' required' : ''
    })
  }

  const body = templates.render('submit', {
    heading: templates.render('page-heading', { title: 'Submit a plugin' }),
    csrf: csrfToken ?? '',
    error: templates.when(Boolean(error), 'error', { text: error }),
    done: templates.when(Boolean(submitted), 'submit-done', {
      text: submitted?.text ?? '',
      href: submitted?.href ?? '/',
      linkText: submitted?.linkText ?? ''
    }),
    fields: Object.entries(submittable).map(field).join('\n  '),
    // Moderators only. `docs/resources.md` §4 rule 8: an open form is an open
    // proxy, and "a person asked for it" stops being true the moment anyone
    // can ask. The route checks it too — this only decides whether to draw it.
    fetch: templates.when(Boolean(mayRead), 'submit-fetch', {
      csrf: csrfToken ?? '',
      value: pageUrl,
      maxLength: String(CONTRIBUTION_CONFIG.maxValueLength)
    }),
    // Where each drafted field came from, shown rather than summarised: a page
    // that named itself in JSON-LD and one that had a <title> and nothing else
    // do not deserve the same trust, and only the moderator can weigh that.
    draft: templates.when(Boolean(draft), 'submit-draft', {
      url: draft?.url ?? '',
      sources: draft && Object.keys(draft.sources ?? {}).length
        ? `<ul class="draft-sources">${templates.each('submit-draft-source',
            Object.entries(draft.sources), ([key, from]) => ({
              label: submittable[key]?.label ?? key, from
            }))}</ul>`
        : '',
      notes: draft?.notes?.length
        ? `<ul class="draft-notes">${templates.each('submit-draft-note',
            draft.notes, text => ({ text }))}</ul>`
        : ''
    }),
    // The same two columns the search pages carry. Somebody who has just
    // submitted a plugin, or been told theirs is already here, wants a way
    // back into the catalogue rather than a dead end.
    side: sidebar(facetValues, corpus),
    links: templates.render('site-links', {})
  })
  return layout('Submit a plugin — Plugin Universe', body, {
    description: 'Propose a plugin for the Plugin Universe catalogue.',
    ...viewer,
    footer: false
  })
}

/**
 * A person's own account: what they are on, and how to change it.
 *
 * Three states and one of them is easy to forget — **lapsed**. Somebody whose
 * subscription ended needs to be told so plainly, because the alternative is a
 * page that looks like the free plan and leaves them wondering what happened to
 * the placements they were paying for.
 *
 * Prices are passed in rather than written here. They live in Stripe, and a
 * figure typed into a template is a second place for a price to be wrong — the
 * failure this whole integration is arranged to avoid.
 */
export function renderAccountPage ({
  account, csrfToken, plan, prices, corpus = 0, notice = null,
  viewer = {}, facetValues = {}
}) {
  const day = value => String(value ?? '').slice(0, 10)
  const proLabel = prices.pro?.label ?? 'Pro'

  const planBlock = () => {
    if (plan.state === 'paid') {
      return templates.render('account-plan-paid', {
        proLabel,
        remaining: plan.daysRemaining === 1 ? '1 day left' : `${plan.daysRemaining} days left`,
        renews: plan.cancelling ? 'ends' : 'renews',
        until: day(plan.endsAt),
        csrf: csrfToken
      })
    }
    if (plan.state === 'lapsed') {
      return templates.render('account-plan-lapsed', { proLabel, until: day(plan.endsAt), csrf: csrfToken })
    }
    return templates.render('account-plan-free', {
      singlePrice: prices.single?.text ?? '—',
      proPrice: prices.pro?.text ?? '—',
      proLabel,
      csrf: csrfToken
    })
  }

  const body = templates.render('account', {
    heading: templates.render('page-heading', { title: 'Your account' }),
    login: account.login,
    standing: account.trustLevel === TRUST.MODERATOR
      ? 'You are a moderator.'
      : account.trustLevel === TRUST.TRUSTED
        ? 'Your contributions go live without review.'
        : 'Your contributions are reviewed before they go live.',
    notice: templates.when(Boolean(notice), 'notice', { text: notice }),
    plan: planBlock(),
    corpus: String(corpus),
    side: sidebar(facetValues, corpus),
    links: templates.render('site-links', {})
  })
  return layout('Your account — Plugin Universe', body, {
    description: 'Your plan and your standing in the Plugin Universe catalogue.',
    ...viewer,
    footer: false
  })
}

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

/**
 * The administration page: the moderation queue, and the buttons.
 *
 * One page rather than two because they are one job — somebody who has just
 * accepted a submission is exactly the person who then wants to reindex, and
 * making them navigate between the queue and a separate console would be an
 * invented boundary.
 */
export function renderAdminPage (pending, {
  csrfToken, message, viewer = {}, submissions = [], actions = {},
  facetValues = {}, corpus = 0, promotions = null
}) {
  const total = pending.length + submissions.length
  const body = templates.render('admin', {
    heading: templates.render('page-heading', { title: 'Administration' }),
    login: viewer.account?.login ?? '',
    message: templates.when(Boolean(message), 'notice', { text: message }),
    side: sidebar(facetValues, corpus),
    links: templates.render('site-links', {}),
    actions: templates.each('admin-action', Object.entries(actions), ([name, action]) => ({
      name,
      label: action.label,
      describes: action.describes,
      csrf: csrfToken
    })),
    count: total === 0
      ? 'Nothing'
      : [
          pending.length ? `${pending.length} correction${pending.length === 1 ? '' : 's'}` : null,
          submissions.length ? `${submissions.length} proposed plugin${submissions.length === 1 ? '' : 's'}` : null
        ].filter(Boolean).join(' and '),
    items: moderationItems(pending, csrfToken),
    submissions: submissionItems(submissions, csrfToken),
    // Absent entirely when promotions are not configured, rather than an empty
    // panel: a control for something the instance cannot do is a puzzle.
    promotions: promotions ? promotionPanel(promotions, csrfToken) : ''
  })
  return layout('Administration — Plugin Universe', body, {
    description: 'Moderation queue and catalogue operations.',
    ...viewer,
    footer: false
  })
}

/**
 * What a moderator needs to run paid placements.
 *
 * Three things, and the second is the one that is easy not to think of:
 *
 *  - promote and end, by slug
 *  - **what is about to lapse**, so the conversation about renewing happens
 *    before the placement stops rather than after somebody notices it has
 *  - what is running now, with how long each has left
 *
 * The list of live placements is the ad repository in its working form; the
 * public account of it is /about/promotion.
 */
function promotionPanel ({ live = [], expiring = [] }, csrfToken) {
  const row = entry => ({
    href: String(entry.plugin).replace(NAMESPACES.pu, '/'),
    name: entry.name ?? String(entry.plugin).split('/').pop(),
    until: String(entry.endsAt).slice(0, 10),
    by: String(entry.by ?? '').split('/').pop(),
    remaining: entry.daysRemaining <= 0
      ? 'lapsed'
      : `${entry.daysRemaining} day${entry.daysRemaining === 1 ? '' : 's'} left`,
    // The soon-to-lapse ones are marked, because a list where every row looks
    // the same is a list nobody scans.
    warnClass: entry.daysRemaining <= PROMOTION_CONFIG.expiringWithinDays ? ' promotion-warn' : ''
  })

  return templates.render('promotion-panel', {
    csrf: csrfToken,
    summary: live.length === 0
      ? 'Nothing is promoted.'
      : `${live.length} live placement${live.length === 1 ? '' : 's'}.`,
    expiring: templates.when(expiring.length > 0, 'promotion-list', {
      title: `Lapsing within ${PROMOTION_CONFIG.expiringWithinDays} days`,
      rows: templates.each('promotion-row', expiring, row)
    }),
    live: templates.when(live.length > 0, 'promotion-list', {
      title: 'Running now',
      rows: templates.each('promotion-row', live, row)
    })
  })
}

/** Corrections, as review cards. */
function moderationItems (pending, csrfToken) {
  if (pending.length === 0) return templates.render('empty', { text: 'Nothing waiting.' })
  return templates.each('moderation-item', pending, item => ({
    field: item.predicate.replace(/^.*[#/]/, ''),
    value: String(item.value).slice(0, 120),
    href: item.subject.replace(NAMESPACES.pu, '/'),
    slug: item.subject.split('/').pop(),
    by: item.by.split('/').pop(),
    rationale: templates.when(Boolean(item.rationale), 'quoted', { text: item.rationale }),
    csrf: csrfToken,
    correction: item.correction
  }))
}

/** Proposed plugins, as review cards. */
function submissionItems (submissions, csrfToken) {
  return templates.each('moderation-submission', submissions, item => ({
    name: item.fields.name ?? '(unnamed)',
    // A proposed plugin has no page to link to yet, so the summary has to
    // carry enough for a decision without one.
    summary: [item.fields.vendor, [item.fields.format].flat().filter(Boolean).join(', '),
      item.fields.category, item.fields.description].filter(Boolean).join(' · ').slice(0, 200),
    by: item.by.split('/').pop(),
    homepage: item.fields.homepage ?? '',
    submission: item.submission,
    csrf: csrfToken
  }))
}

/**
 * A prose page — about, terms, the crawler notice.
 *
 * The Markdown is rendered elsewhere; this puts it in the site's chrome so a
 * visitor reads it as part of the site. Constrained to a narrower measure than
 * the search results, because these are paragraphs rather than a table.
 */
/**
 * The vocabulary index, for a person.
 *
 * `/ns` is linked from the footer of every page and returned a JSON list of
 * filenames — an answer to a question nobody following that link was asking.
 */
export function renderVocabularies (vocabularies, viewer = {}) {
  const body = templates.render('vocabularies', {
    heading: templates.render('page-heading', { title: 'Vocabularies' }),
    rows: templates.each('vocabulary-row', Object.entries(vocabularies), ([name, vocabulary]) => ({
      name,
      url: `/ns/${name}.ttl`,
      description: vocabulary.description
    }))
  })
  return layout('Vocabularies — Plugin Universe', body, {
    description: 'The ontologies the Plugin Universe catalogue publishes its data in.',
    ...viewer
  })
}

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
  return templates.render('measurements', {
    verdict: templates.when(Boolean(measured.verdict), 'badge',
      { kind: verdictBadge(measured.verdict), label: measured.verdict }),
    rows: templates.each('measurement-row',
      measured.readings.filter(reading => reading.metric !== 'ValidationResult'),
      reading => ({
        title: templates.when(Boolean(reading.about), 'attribute-title', { text: reading.about }),
        label: reading.label,
        value: readingValue(reading),
        note: templates.when(Boolean(reading.note), 'measurement-note', { text: reading.note })
      })),
    tool: measured.tool,
    platform: measured.platform,
    at: String(measured.at).slice(0, 10)
  })
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

/**
 * Verdict to badge class. Anything other than a pass reads as a warning.
 *
 * Two tools write two vocabularies here and both are passes. lilv's scanner
 * reports the sandbox's own outcome, where a clean run is `ok`; pluginval
 * reports its own conclusion about the plugin, where a clean run is `passed`.
 * They are deliberately not flattened into one word — "the scan completed" and
 * "the plugin is well-behaved" are different claims, and the second is the one
 * worth making — so this is the one place that has to know both.
 */
const PASSING_VERDICTS = new Set(['ok', 'passed'])

function verdictBadge (verdict) {
  return PASSING_VERDICTS.has(verdict) ? 'src' : 'warn'
}

/** A list of sibling category links, or nothing. */
function categoryLinks (label, slugs) {
  if (!slugs || slugs.length === 0) return ''
  return templates.render('labelled-tags', {
    label,
    items: templates.each('category-link', slugs, slug => ({ slug }))
  })
}

/**
 * One category: what it means, what else it is called, and where it sits.
 *
 * The scheme carried a label and a parent link and nothing else for as long as
 * it was a JavaScript object literal. Now that it is an ontology there is
 * something to show, and showing it is also how it gets checked — a definition
 * nobody reads is a definition nobody notices is wrong.
 */
/**
 * One vendor, and everything of theirs the catalogue holds.
 *
 * Deliberately modest about what it is. The page is assembled from harvested
 * facts — nobody has written a word of it, and the vendor has not seen it — so
 * it says so rather than reading like a profile they wrote. That note is also
 * what a vendor profile would replace, if one is ever sold.
 */
export function renderVendorPage (
  vendor, viewer = {}, { facetValues = {}, corpus = 0 } = {}
) {
  const body = templates.render('vendor', {
    side: sidebar(facetValues, corpus),
    links: templates.render('site-links', {}),
    heading: templates.render('page-heading', { title: vendor.name }),
    // Shown only when the catalogue really did meet more than one spelling, so
    // it reads as information rather than as boilerplate.
    alsoKnownAs: templates.when(vendor.spellings.length > 1, 'labelled-tags', {
      label: 'Also written',
      items: templates.each('tag', vendor.spellings.slice(1), value => ({ value }))
    }),
    claim: templates.render('vendor-claim', { name: vendor.name }),
    count: `${vendor.count} plugin${vendor.count === 1 ? '' : 's'}`,
    slug: vendor.slug,
    results: vendor.results.map(resultItem).join('\n')
  })
  return layout(`${vendor.name} — Plugin Universe`, body, {
    description: `Plugins by ${vendor.name} in the Plugin Universe catalogue.`,
    ...viewer,
    footer: false
  })
}

/** Every vendor, as a way in. */
export function renderVendorsPage (vendors, viewer = {}, { facetValues = {}, corpus = 0 } = {}) {
  const body = templates.render('vendors', {
    side: sidebar(facetValues, corpus),
    links: templates.render('site-links', {}),
    heading: templates.render('page-heading', { title: 'Vendors' }),
    count: `${vendors.length} vendor${vendors.length === 1 ? '' : 's'}`,
    rows: templates.each('vendor-row', vendors, vendor => ({
      slug: vendor.slug,
      name: vendor.name,
      count: `${vendor.count} plugin${vendor.count === 1 ? '' : 's'}`
    }))
  })
  return layout('Vendors — Plugin Universe', body, {
    description: 'Every vendor with plugins in the Plugin Universe catalogue.',
    ...viewer,
    footer: false
  })
}

export function renderCategoryPage (
  slug, results, total, viewer = {}, concept = null,
  { facetValues = {}, corpus = 0 } = {}
) {
  const body = templates.render('category', {
    // A category page is most often reached *from* this panel. Losing it on
    // arrival would strand somebody one click into browsing.
    side: sidebar(facetValues, corpus),
    links: templates.render('site-links', {}),
    heading: templates.render('page-heading', { title: concept?.prefLabel ?? slug }),
    definition: templates.when(Boolean(concept?.definition), 'description', { description: concept?.definition }),
    scopeNote: templates.when(Boolean(concept?.scopeNote), 'scope-note', { text: concept?.scopeNote }),
    altLabels: templates.when(Boolean(concept?.altLabels?.length), 'labelled-tags', {
      label: 'Also called',
      items: templates.each('tag', concept?.altLabels ?? [], value => ({ value }))
    }),
    broader: categoryLinks('Part of', concept?.broader ? [concept.broader] : null),
    narrower: categoryLinks('Includes', concept?.narrower),
    related: categoryLinks('Related', concept?.related),
    closeMatches: templates.when(Boolean(concept?.closeMatches?.length), 'labelled-tags', {
      label: 'Elsewhere',
      items: templates.each('code', concept?.closeMatches ?? [],
        match => ({ text: match.replace(`${NAMESPACES.lv2}`, 'lv2:') }))
    }),
    count: `${total} plugin${total === 1 ? '' : 's'}`,
    slug,
    results: results.map(resultItem).join('\n')
  })

  return layout(`${concept?.prefLabel ?? slug} — Plugin Universe`, body, {
    description: concept?.definition ?? `Plugins categorised as ${slug} in the Plugin Universe catalogue.`,
    ...viewer,
    footer: false
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
  if (!account) return templates.render('correct-signed-out', { slug })

  return templates.render('correct-form', {
    slug,
    error: templates.when(Boolean(error), 'error', { text: error }),
    submitted: templates.when(Boolean(submitted), 'notice', { text: submitted }),
    csrf: csrfToken,
    // Not every correctable property is one a person types. A picture is
    // contributed by the upload form above, which is the only thing that can
    // produce a value the validator accepts — offering "Picture" here would be
    // a menu entry whose every answer is refused.
    options: templates.each('select-option',
      Object.entries(correctable).filter(([, field]) => field.viaForm !== false),
      ([predicate, field]) => ({ value: predicate, label: field.label })),
    maxValue: CONTRIBUTION_CONFIG.maxValueLength,
    maxRationale: CONTRIBUTION_CONFIG.maxRationaleLength
  })
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
    links.push(templates.render('code', { text: source.derivedFrom }))
  } else if (source?.derivedFrom) {
    links.push(templates.render('external-link', { href: source.derivedFrom, label: source.derivedFrom }))
  }
  if (doc.seeAlso) {
    links.push(templates.render('external-link', { href: doc.seeAlso, label: 'source record' }))
  }
  if (!source && links.length === 0) return ''

  return templates.render('provenance', {
    origin: source
      ? templates.render('provenance-source', {
        source: source.source,
        licence: templates.when(Boolean(source.licence), 'provenance-licence', { licence: source.licence })
      })
      : 'Source unrecorded.',
    links: links.join(' &middot; '),
    graph: source?.graph ?? 'unknown'
  })
}

export { escape }
