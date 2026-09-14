import { PROMOTION_CONFIG } from '../../config/preferences.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
// One-way: the HTML pages embed the JSON-LD, the serialisations know nothing
// about HTML.
import { linkable, pluginJsonLd } from './serialise.js'
import templates, { escape } from './Templates.js'
import { vendorSlug } from '../search/SearchService.js'
import {
  layout, sidebar, pluginImage, licenceLabel, spdxUrl, linkedValues, scriptSafeJson,
  AVAILABILITY_LABEL, PRICING_LABEL
} from './page-shell.js'
import { imageForm, renderCorrectionForm } from './render-forms.js'

/**
 * One plugin, in full.
 *
 * The longest page on the site and the one with the most to say: the facts,
 * the picture, what the profiler measured, where every statement came from,
 * the wiki, and the two forms a contributor may be offered.
 *
 * It must be crawlable and carry schema.org JSON-LD (docs/architecture.md §4),
 * and a plugin IRI must dereference to Turtle, JSON-LD or HTML according to
 * the request (§2.1) — the other two representations are `serialise.js`.
 */

/**
 * Whether this reader can promote this plugin, and on what terms.
 *
 * Four outcomes, and the first two are the ones that keep the page honest: a
 * placement that is already running says so rather than offering to sell a
 * second, and a reader who cannot buy is shown nothing rather than a button
 * that will refuse them.
 */
function promoteBlock (doc, contribution, slug) {
  if (!contribution?.billing) return ''
  if (doc.promoted) {
    return templates.render('promote-live', { until: String(doc.promotedUntil ?? '').slice(0, 10) })
  }
  if (!contribution.account) return ''
  if (contribution.promoteIncluded) {
    return templates.render('promote-included', {
      slug,
      csrf: contribution.csrfToken,
      proLabel: contribution.proLabel ?? 'Pro'
    })
  }
  // Without a price there is nothing honest to put on the button, so the offer
  // is withheld rather than made vaguely. Stripe being unreachable should not
  // produce a "buy" with no amount on it.
  if (!contribution.promotePrice) return ''
  return templates.render('promote-buy', {
    slug, csrf: contribution.csrfToken, price: contribution.promotePrice
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

export function renderPluginPage (
  doc, viewer = {}, contribution = null, measured = null, wiki = '',
  { facetValues = {}, corpus = 0, labels = new Map() } = {}
) {
  // Rows are `[label, value, linked]`. A linked row's value is a fragment this
  // code built and escaped; every other row is escaped by the template, which
  // is the right way round — escaping is the default and the exception is
  // marked.
  //
  // `named` is how a `trn:` term is written for a reader: "Control MIDI" rather
  // than "ControlMidi", from `rdfs:label` by way of the same field table the
  // submission form is built from. A term the vocabulary does not describe
  // shows its local name — the same policy as an unlabelled measurement metric,
  // and for the same reason: the fact is the point, and a missing label is a
  // gap in `vocabs/` to report rather than a value to hide.
  const named = value => labels.get(value) ?? value
  const licence = licenceLabel(doc.licenceId)
  const spdx = spdxUrl(doc.licenceId)
  const rows = [
    // Left as text here: the heading above is already a link to the same page,
    // and two links to one place in one screen is noise rather than emphasis.
    ['Vendor', doc.vendor],
    ['Formats', linkedValues(doc.formats, v => `/?format=${encodeURIComponent(v)}`), true],
    ['Roles', linkedValues(doc.roles, v => `/?role=${encodeURIComponent(v)}`, named), true],
    // Each links to the plugins on the *other* side of the join: what a plugin
    // accepts links to everything that produces it, so "what goes before this?"
    // is one click rather than a question the catalogue holds the answer to and
    // never offers. This is the one thing here a list of plugin names cannot do.
    //
    // The link's text is the label and its target is the local name, which is
    // the whole reason `linkedValues` takes the two separately: "Control MIDI"
    // reads properly and `?produces=ControlMidi` still resolves.
    ['Accepts', linkedValues(doc.accepts, v => `/?produces=${encodeURIComponent(v)}`, named), true],
    ['Produces', linkedValues(doc.produces, v => `/?accepts=${encodeURIComponent(v)}`, named), true],
    // Text, not a link. Nothing produces a host transport, so there is no
    // opposite side to link to, and there is no `requires=` facet — 57 plugins
    // carry one and a list of them is not a question anybody asks. A link that
    // resolves to an empty result is worse than no link.
    ['Requires', (doc.requires ?? []).map(named).join(', ')],
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
    // Buying or claiming a placement. The route existed before this did, which
    // made it unreachable from the site — the failure CLAUDE.md lists more
    // often than any other, and one the linked-routes guard cannot catch,
    // because it looks for links pointing at missing routes and not for routes
    // nothing points at.
    promoteForm: promoteBlock(doc, contribution, path.replace('/plugin/', '')),
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
    // A different document from the `.ttl` above, not a fourth representation
    // of the same one: that is everything the catalogue holds — provenance,
    // ports, measurements — and this is the short authored shape an author
    // publishes, the same file `/submit` hands back.
    profileTtl: `${path}/profile.ttl`,
    // The <script> element is part of the value, not part of the template, for
    // the reason `layout` now keeps its <style> tags on this side: a
    // placeholder inside a script or style element sits in a language an editor
    // knows how to reformat, and one duly exploded `{{{style}}}` into eight
    // lines of pretty-printed CSS and stopped the deployment starting. An
    // `application/ld+json` body is exactly as reformattable.
    //
    // The escaping is unchanged and is still the load-bearing part:
    // `scriptSafeJson` escapes `<` to `\u003c`, because JSON.stringify does not
    // and any harvested value containing `</script>` would otherwise close this
    // block and have the rest parsed as markup.
    jsonLd: `<script type="application/ld+json">${scriptSafeJson(pluginJsonLd(doc))}</script>`
  })
  return layout(`${doc.name} — Plugin Universe`, body, {
    // The page somebody posts a link to, and the picture that should appear
    // with it. A hotlinked screenshot is somebody else's server and may refuse
    // a scraper, so only an image this site stores is offered.
    canonical: doc.iri.replace(NAMESPACES.pu, '/'),
    image: doc.imageIsLocal ? doc.image : null,
    imageAlt: doc.imageIsLocal ? `${doc.name}` : undefined,
    description: doc.description ?? '', ...viewer, footer: false
  })
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
