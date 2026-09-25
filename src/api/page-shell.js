import { TRUST } from '../auth/Accounts.js'
import { RETRIEVAL_CONFIG, PROMOTION_CONFIG } from '../../config/preferences.js'
import templates, { escape } from './Templates.js'
import { UNVERSIONED, NOASSERTION, LICENCE_IDS } from '../harvest/Licensing.js'
import { vendorSlug } from '../search/SearchService.js'
import fs from 'fs'
import Config from '../Config.js'

/**
 * Where this instance lives, for the absolute URLs social metadata requires.
 *
 * Open Graph will not take a relative `og:image` or `og:url` — a scraper has no
 * base to resolve one against — so the renderer needs an origin, and nothing
 * else in it did. Read from config once at load rather than threaded through
 * the seventeen callers of `layout()`: it is one value, it is the same for
 * every page, and it does not change while the process runs.
 *
 * `Config.load()` throws when the value is absent, which is the behaviour this
 * project asks for — a missing configuration value is an error to fix, not a
 * default to invent.
 */
const CONFIG = Config.load()
const ORIGIN = CONFIG.get('site.origin').replace(/\/$/, '')

/**
 * The site card's own dimensions, read from the file rather than written here.
 *
 * Facebook renders an image on the *first* scrape only if it already knows how
 * big it is; without `og:image:width` and `og:image:height` it has to fetch and
 * measure the file, and the share that triggered the scrape shows no picture.
 * Everybody who has posted a link and seen a bare title has met this.
 *
 * Measured from the PNG's own header so that replacing `og-image.png` — which
 * is a placeholder and will be replaced — cannot leave the numbers behind. Two
 * places holding one fact is this project's most expensive habit, and a
 * hardcoded 1200×630 would be exactly that.
 */
/**
 * Facebook's `fb:app_id`, if this deployment has one.
 *
 * The Sharing Debugger reports it as a *required* property and it is not: a
 * link preview renders perfectly well without it, and every card this site
 * serves does. What it is for is attributing domain insights to a Meta app, so
 * having one means registering an app with Meta — a decision about who this
 * project deals with, not a technical gap.
 *
 * So it is optional, off by default, and one value away from being on. Empty
 * means absent, which is how this project reads every empty environment value.
 */
const FB_APP_ID = process.env.FACEBOOK_APP_ID ||
  (CONFIG.has('site.facebookAppId') ? CONFIG.get('site.facebookAppId') : '') || null

const CARD = (() => {
  const bytes = fs.readFileSync('og-image.png')
  // PNG: 8-byte signature, a 4-byte length, "IHDR", then width and height as
  // big-endian 32-bit integers.
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('og-image.png is not a PNG: no IHDR where one must be')
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
})()

/**
 * The furniture every page is built out of.
 *
 * The shell — header, account bar, footer — and the pieces that appear on more
 * than one page: a result row, the facet dropdowns, the sidebar, the pager,
 * and the small functions that decide how a licence, an image or a linked
 * value is written.
 *
 * It has no page of its own. Everything here is called by one of the four
 * renderers that do — `render.js` for the listings, `render-plugin.js` for a
 * plugin, `render-forms.js` for the things a person fills in — and nothing
 * here imports any of them, which is what keeps the four free of cycles.
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
  // The document's language, for anything that reads it aloud. English unless
  // a page says otherwise — `/leggere-prima` is the first that does.
  lang = 'en',
  // The page's own path, for `og:url` and `rel=canonical`. Null on a page whose
  // address is not canonical — a search result is a query, and pointing every
  // variant of one at itself tells a crawler nothing useful.
  canonical = null,
  // A page-specific image for the card, absolute. Null falls back to the site
  // card, so every link posted anywhere has *something* to show.
  image = null,
  imageAlt = 'Plugin Universe — an open, machine-readable database of DAW plugins',
  type = 'website',
  // A page laid out in columns carries the site links in one of them, so it
  // asks for the footer to be left off. One template renders them either way —
  // two copies of a list of links is two lists to keep correct, and this one
  // includes the terms.
  footer = true
} = {}) {
  return templates.render('layout', {
    title,
    lang,
    social: templates.render('social-meta', {
      type,
      // The bare page title, not the one with the site name appended: a card
      // that reads "Shifty — Plugin Universe" under a heading that already says
      // Plugin Universe says it twice.
      title: title.replace(/\s+—\s+Plugin Universe$/, ''),
      description,
      image: image ?? `${ORIGIN}/og-image.png`,
      imageAlt,
      // Dimensions only for the card, whose size this knows. A plugin's own
      // uploaded picture is whatever somebody uploaded, and guessing would be
      // worse than letting the scraper measure it.
      imageSize: image
        ? ''
        : templates.render('og-image-size', {
          width: String(CARD.width),
          height: String(CARD.height)
        }),
      appId: templates.when(Boolean(FB_APP_ID), 'fb-app-id', { id: FB_APP_ID ?? '' }),
      canonical: templates.when(Boolean(canonical), 'canonical-link', {
        url: `${ORIGIN}${canonical ?? ''}`
      })
    }),
    description: templates.when(Boolean(description), 'meta-description', { description }),
    // The <style> element is part of the value, not part of the template.
    //
    // `templates/layout.html` used to read `<style>{{{style}}}</style>`, which
    // put the placeholder inside a CSS context — and an editor's "format
    // document" duly parsed those braces as CSS and pretty-printed them across
    // eight lines. The placeholder stopped existing, `layout` was handed a
    // value it no longer used, and the deployment refused to start. Keeping the
    // tags on this side means there is no CSS for a formatter to find.
    style: `<style>${templates.asset('site.css')}</style>`,
    account: accountBar(account, signInEnabled),
    body,
    footer: templates.when(footer, 'footer', { links: templates.render('site-links', {}) })
  })
}

/** Human labels for the availability individuals. */
export const AVAILABILITY_LABEL = { OpenSource: 'open source', SourceAvailable: 'source available', Proprietary: 'proprietary' }

export const PRICING_LABEL = { Free: 'free', Donationware: 'donationware', Freemium: 'freemium', Paid: 'paid' }

/**
 * The two answers a person scanning results actually wants, shown as badges
 * rather than left to be inferred from a licence identifier. An unknown value
 * shows nothing: saying nothing is honest, and "unknown" in every row is noise.
 */
export function availabilityBadges (r) {
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
export function licenceLabel (licenceId) {
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

export function resultItem (r) {
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
export function pager ({ total, offset, limit, params = {}, base = '/', ranked = false }) {
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

  // A ranked list is not in date order, and "older" over search results would
  // say something about them that is not true.
  const [back, on] = ranked ? ['\u2190 previous', 'next \u2192'] : ['\u2190 newer', 'older \u2192']
  return templates.render('pager', {
    previous: step(offset > 0, Math.max(0, offset - limit), 'prev', back),
    next: step(offset + limit < total, offset + limit, 'next', on),
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

/**
 * How a facet value is written in a dropdown, where it differs from the token.
 *
 * Only the one entry, and an exception table rather than a full map so that its
 * silence about `Windows` means "the token is already right" — the same shape as
 * `UNIT_SYMBOL` in `render-plugin.js` and `SCHEMA_PLATFORM` in `serialise.js`.
 * The *value* in the option stays the token, because that is what goes into the
 * URL; only the text changes.
 */
const FACET_VALUE_LABEL = { MacOS: 'macOS' }

/**
 * The facet dropdowns, with the current selection marked.
 *
 * Four of the eleven facets, deliberately: a form with eleven selects is a wall.
 * `platform` replaced `source` here on 2026-09-15 — "will it run on my machine"
 * disqualifies a plugin before anything else about it matters, and source
 * availability is still a badge on every result row, a link on every plugin page
 * and `?source=` in a URL. The one thing it costs is worth stating: a plugin
 * with no platform recorded is in no platform's results, so this dropdown hides
 * part of the catalogue when it is set. It defaults to "any" like the others,
 * and nothing makes it sticky.
 */
export function facetControls (facetValues, facets) {
  const facetSelect = name => templates.render('search-facet', {
    name,
    options: templates.each('search-facet-option', facetValues?.[name] ?? [], value => ({
      value: value.value,
      label: FACET_VALUE_LABEL[value.value] ?? value.value,
      count: value.count,
      selected: value.value === facets[name] ? ' selected' : ''
    }))
  })
  return ['format', 'category', 'pricing', 'platform'].map(facetSelect).join('\n  ')
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
 *
 * **The links carry the current selection.** Each one used to be a fresh URL
 * naming one facet, so choosing Audio Unit and then Reverb threw the format
 * away — and "reverbs I can load in Logic" was reachable only by the search
 * form, which had no second page. Given a `selection` (the query and facets of
 * the listing it sits beside), a link adds its value to what is chosen, and the
 * value already chosen becomes the link that removes it. Without one, on a
 * plugin page or a form, there is nothing to carry and the links start afresh.
 *
 * The counts are the selection's, from `SearchService.facets(chosen)`: each
 * facet counted under the other chosen filters, so the categories beside an
 * Audio Unit listing say how many of each are Audio Unit.
 */
export function sidebar (facetValues, total, selection = null) {
  const hrefFor = (name, value) => {
    if (!selection) {
      return name === 'category'
        ? `/category/${encodeURIComponent(value)}`
        : `/plugins?${name}=${encodeURIComponent(value)}`
    }
    const params = { ...selection.facets, [name]: selection.facets[name] === value ? null : value }
    const query = new URLSearchParams(
      Object.entries({ q: selection.query, ...params })
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
    )
    const keys = [...query.keys()]
    // One category and nothing else is the category's own page, which says what
    // the category means as well as listing it.
    if (keys.length === 1 && keys[0] === 'category') return `/category/${encodeURIComponent(query.get('category'))}`
    if (keys.length === 0) return '/plugins'
    return `${selection.query ? '/search' : '/plugins'}?${query}`
  }
  const links = (name, values) => values.map(value => {
    const chosen = selection?.facets[name] === value.value
    return templates.render(chosen ? 'sidebar-link-current' : 'sidebar-link', {
      href: hrefFor(name, value.value), label: value.value, count: value.count
    })
  }).join('\n')
  const categoryValues = facetValues?.category ?? []
  const shown = categoryValues.slice(0, RETRIEVAL_CONFIG.sidebarCategories)
  // A chosen category outside the largest few still has to be shown, or there
  // is no link to remove it with.
  const chosenCategory = categoryValues.find(value => value.value === selection?.facets.category)
  if (chosenCategory && !shown.includes(chosenCategory)) shown.push(chosenCategory)
  return templates.render('sidebar', {
    formats: links('format', facetValues?.format ?? []),
    categories: links('category', shown),
    total
  })
}

/** The shared shell: the form, a summary line, results, and the optional slots. */
export function searchShell ({
  query, facets, facetValues, summary, results, more, pager: pagerHtml, total
}) {
  return templates.render('search', {
    query: query ?? '',
    facets: facetControls(facetValues, facets),
    summary: templates.render('meta-line', { text: summary }),
    side: sidebar(facetValues, total, { query, facets }),
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
export function scriptSafeJson (value) {
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
export function spdxUrl (licenceId) {
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
export function linkedValues (values, href, text = value => value) {
  return (values ?? [])
    .map(value => `<a href="${escape(href(value))}">${escape(text(value))}</a>`)
    .join(', ')
}
