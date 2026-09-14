import logger from 'loglevel'
import { RETRIEVAL_CONFIG } from '../../config/preferences.js'
import { send, sendText, redirect, LICENCE, HTML } from './respond.js'
import {
  renderLandingPage, renderSearchPage, renderBrowsePage, renderPluginPage,
  renderCategoryPage, renderVendorPage, renderVendorsPage
} from './render.js'
import { pluginJsonLd, pluginTurtle, categoryTurtle } from './serialise.js'
import { FACET_NAMES, facetsFrom, negotiate, prefersPage, pageOffset } from './requests.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { CORRECTABLE } from '../contrib/Corrections.js'
import { TRUST, TIER } from '../auth/Accounts.js'
import { vendorKey } from '../search/SearchService.js'
import { renderWikiBlock } from '../wiki/render.js'
import { billingPrices } from '../billing/routes.js'

/**
 * The catalogue itself: everything that answers a question about plugins.
 *
 * The landing page, search, the browse list, the facet counts, vendors,
 * categories and a plugin's own IRI. These are what the site is *for*, and
 * they were the last thing left in `server.js` once signing in, moderating,
 * contributing and the health check had each gone to their own module.
 *
 * Three of them answer in two languages. JSON is the default on `/search` and
 * `/plugins` because that is what those paths have always been; HTML is the
 * default on `/plugin/<slug>` and `/category/<slug>` because those are IRIs
 * somebody pastes into a browser. `prefersPage` and `negotiate` are two
 * functions rather than one for exactly that reason.
 */

const PATHS = new Set(['/', '/search', '/facets', '/plugins', '/vendors'])
const VENDOR_PATH = /^\/vendor\/([a-z0-9-]+?)(\.json)?$/
const CATEGORY_PATH = /^\/category\/([a-z0-9-]+?)(\.ttl|\.json)?$/
const PLUGIN_PATH = /^\/plugin\/([A-Za-z0-9-]+?)(\.ttl|\.jsonld|\.json)?$/

/**
 * What a `promoted` result is, said in the response rather than only on a page.
 *
 * The DSA asks that the main parameters used to rank an advertisement be
 * disclosed. For a JSON consumer that means here: a link is the disclosure, and
 * the numbers behind it are on the page it points at.
 */
export const PROMOTION_DISCLOSURE = Object.freeze({
  note: 'Results marked "promoted" are paid placements, boosted in ranking and labelled as such.',
  // The bound that is actually load-bearing, and the one that will not change:
  // a placement may reach first place, but only among results the query already
  // returned. Deliberately says nothing about position — that is a published
  // number which may be tuned, and a sentence here repeating it is a second
  // copy to keep true. It was wrong within an hour of being written.
  bounded: 'A placement is applied after retrieval and only to a result that already matched: it re-ranks, and never adds a plugin to a search it does not match.',
  url: 'https://plugin-universe.com/about/promotion'
})

export async function catalogueRoutes (context) {
  const { path } = context

  if (path === '/') return landing(context)
  if (path === '/search') return searchRoute(context)
  if (path === '/facets') return facets(context)
  if (path === '/plugins') return browse(context)
  if (path === '/vendors') return vendors(context)

  const vendor = path.match(VENDOR_PATH)
  if (vendor) return vendorPage(context, vendor[1], vendor[2])

  const category = path.match(CATEGORY_PATH)
  if (category) return categoryPage(context, category[1], category[2])

  const plugin = path.match(PLUGIN_PATH)
  if (plugin) return pluginPage(context, plugin[1], plugin[2])

  return false
}

async function landing ({ response, params, viewer, search }) {
  // `/` used to be the landing page, the search results and the paged browse
  // list at once, told apart by which parameters arrived. Each now has its own
  // address, so the old shapes are sent to their new homes rather than answered
  // here — otherwise every bookmark, every shared link and every crawler's
  // index breaks on deploy.
  if (params.get('q') || FACET_NAMES.some(name => params.get(name))) {
    redirect(response, `/search?${params.toString()}`)
    return true
  }
  if (params.get('from')) {
    redirect(response, `/plugins?${params.toString()}`)
    return true
  }

  // Only plugins with a picture. A grid of grey rectangles is a worse first
  // impression than a shorter list, and about three quarters of the catalogue
  // has an image, so this narrows the pool rather than emptying it. The
  // complete list, pictures or not, is /plugins.
  const outcome = await search.browse({
    limit: RETRIEVAL_CONFIG.browsePageSize, offset: 0, hasImage: true
  })
  sendText(response, 200, renderLandingPage({
    corpus: search.documents.size,
    results: outcome.results,
    facetValues: await search.facets(),
    viewer
  }), HTML)
  return true
}

async function searchRoute ({ request, response, params, viewer, search, started }) {
  const q = params.get('q')
  const facetFilter = facetsFrom(params)
  const asked = Boolean(q) || Object.values(facetFilter).some(Boolean)
  const wantsHtml = prefersPage(request.headers.accept)

  // A browser submits every <select> in the form, including the ones left on
  // "any", so the search box produces
  // `?q=reverb&format=&category=&pricing=&source=`. That is the URL a person
  // copies and shares, and four empty parameters make it a different string
  // from the same search reached any other way — which is the duplication this
  // whole split exists to remove. Strip them once and settle on the short form.
  // No loop: nothing empty survives the cleaning.
  const tidy = new URLSearchParams(
    [...params.entries()].filter(([, value]) => value !== '')
  )
  if (wantsHtml && tidy.toString() !== params.toString()) {
    redirect(response, tidy.toString() ? `/search?${tidy}` : '/')
    return true
  }

  if (!asked) {
    // Nothing to search for. A person gets the page with the search box on it;
    // a program gets told what it left out.
    if (wantsHtml) redirect(response, '/')
    else {
      send(response, 400, {
        error: `Provide q, or at least one of ${FACET_NAMES.join(', ')}`
      })
    }
    return true
  }

  const limit = wantsHtml
    ? RETRIEVAL_CONFIG.htmlPageSize
    : Math.min(
      Number(params.get('limit')) || RETRIEVAL_CONFIG.defaultPageSize,
      RETRIEVAL_CONFIG.maxPageSize
    )
  const outcome = q
    ? await search.search(q, { facets: facetFilter, limit })
    : await search.browse({ facets: facetFilter, limit, order: 'recent' })

  if (wantsHtml) {
    sendText(response, 200, renderSearchPage({
      query: q,
      facets: facetFilter,
      results: outcome.results,
      total: outcome.total,
      corpus: search.documents.size,
      elapsedMs: Date.now() - started,
      facetValues: await search.facets(),
      viewer
    }), HTML)
    return true
  }

  send(response, 200, {
    query: q ?? null,
    facets: Object.fromEntries(Object.entries(facetFilter).filter(([, v]) => v)),
    total: outcome.total,
    count: outcome.results.length,
    elapsedMs: Date.now() - started,
    results: outcome.results,
    signals: outcome.signals ?? null,
    // Only when there is one to disclose, and then in the envelope as well as
    // on the result. A consumer that re-publishes these results needs to know a
    // placement was paid for without having to know that `promoted` is a field
    // it should have looked for.
    ...(outcome.results.some(result => result.promoted) ? { promotion: PROMOTION_DISCLOSURE } : {}),
    licence: LICENCE
  })
  return true
}

async function facets ({ response, search }) {
  send(response, 200, { facets: await search.facets(), licence: LICENCE })
  return true
}

async function browse ({ request, response, params, viewer, search }) {
  const wantsHtml = prefersPage(request.headers.accept)
  const facetFilter = facetsFrom(params)
  // The page a person reads is a fixed size; the JSON is the caller's to
  // choose, up to the cap. Ordering differs for the same reason the two exist:
  // a person browsing wants what is new, a program paging through the whole
  // catalogue wants a stable order.
  const outcome = await search.browse({
    limit: wantsHtml
      ? RETRIEVAL_CONFIG.browsePageSize
      : Math.min(Number(params.get('limit')) || 50, RETRIEVAL_CONFIG.maxPageSize),
    offset: pageOffset(params),
    facets: facetFilter,
    order: wantsHtml
      ? (params.get('order') === 'name' ? 'name' : 'recent')
      : (params.get('order') === 'recent' ? 'recent' : 'name')
  })

  if (wantsHtml) {
    sendText(response, 200, renderBrowsePage({
      results: outcome.results,
      total: outcome.total,
      offset: outcome.offset,
      limit: RETRIEVAL_CONFIG.browsePageSize,
      facets: facetFilter,
      facetValues: await search.facets(),
      corpus: search.documents.size,
      viewer
    }), HTML)
    return true
  }

  send(response, 200, {
    total: outcome.total,
    offset: outcome.offset,
    order: outcome.order,
    count: outcome.results.length,
    results: outcome.results,
    licence: LICENCE
  })
  return true
}

async function vendors ({ response, viewer, search, navigationFor }) {
  sendText(response, 200, renderVendorsPage(search.vendorList(), viewer, {
    ...await navigationFor()
  }), HTML)
  return true
}

/**
 * `/vendor/<slug>` — everything the catalogue holds by one maker.
 *
 * The slug is a fold of the vendor's name, not a minted identity: `trn:vendor`
 * is free text and there is nothing else to key on. That is fine for a listing
 * and is *not* enough to hang a claimable, editable profile on — see the note
 * in TODO.md before selling one.
 */
async function vendorPage ({ response, viewer, search, navigationFor }, slug, suffix) {
  const record = search.vendor(slug)
  if (!record) {
    send(response, 404, { error: 'No such vendor', vendor: slug })
    return true
  }
  if (suffix === '.json') {
    send(response, 200, {
      vendor: record.name,
      slug: record.slug,
      // The minted identity, where one has been derived. A consumer joining
      // this against their own data wants the IRI rather than our slug: the
      // slug moves if the preferred spelling does, and the IRI does not.
      iri: record.iri ?? null,
      // Every spelling the catalogue met, because a consumer reconciling this
      // against their own data needs the variants rather than our pick of them.
      names: record.spellings,
      // The subset of those the identity layer actually asserts, as distinct
      // from the ones re-derived from the corpus. A merge of two vendors is
      // recorded here and nowhere else, so a consumer that wants the
      // catalogue's judgement rather than its observations reads this.
      altLabels: record.altLabels ?? [],
      total: record.count,
      results: record.results,
      licence: LICENCE
    })
    return true
  }
  sendText(response, 200, renderVendorPage(record, viewer, {
    ...await navigationFor()
  }), HTML)
  return true
}

/**
 * `/category/<slug>` — a SKOS concept from the category scheme, and the
 * browsable facet page for it. One IRI, negotiated like a plugin.
 */
async function categoryPage ({ request, response, viewer, search }, slug, suffix) {
  const facetValues = await search.facets()
  const known = (facetValues.category ?? []).find(value => value.value === slug)
  if (!known) {
    send(response, 404, { error: 'No such category', category: slug })
    return true
  }

  const outcome = await search.browse({ facets: { category: slug }, limit: 200 })
  const concept = search.concept(slug)
  if (negotiate(suffix, request.headers.accept) === 'turtle') {
    sendText(response, 200,
      categoryTurtle(slug, outcome.results, concept), 'text/turtle; charset=utf-8')
    return true
  }
  if (suffix === '.json') {
    send(response, 200, {
      category: slug,
      iri: `${NAMESPACES.pu}category/${slug}`,
      concept,
      total: outcome.total,
      results: outcome.results,
      licence: LICENCE
    })
    return true
  }
  sendText(response, 200,
    renderCategoryPage(slug, outcome.results, outcome.total, viewer, concept,
      { facetValues, corpus: search.documents.size }), HTML)
  return true
}

/**
 * `/plugin/<slug>-<hash>` resolves the catalogue IRI it denotes.
 *
 * Four representations of one resource. The HTML is also the only place two
 * other routes are reachable from — the upload form at `/plugin/<slug>/image`
 * and the checkout at `/plugin/<slug>/promote` — and both of those shipped
 * once with nothing linking to them, which is the failure in CLAUDE.md's table.
 */
async function pluginPage ({
  request, response, viewer, auth, search, corrections, images, billing,
  wiki, navigationFor
}, slug, suffix) {
  const iri = `${NAMESPACES.pu}plugin/${slug}`
  const doc = search.documents.get(iri)
  if (!doc) {
    send(response, 404, { error: 'No such plugin', iri })
    return true
  }

  switch (negotiate(suffix, request.headers.accept)) {
    case 'turtle':
      sendText(response, 200, pluginTurtle(doc), 'text/turtle; charset=utf-8')
      return true
    case 'jsonld':
      sendText(response, 200, JSON.stringify(pluginJsonLd(doc), null, 2), 'application/ld+json')
      return true
    case 'json':
      send(response, 200, { ...doc, measured: search.measured(iri), licence: LICENCE })
      return true
  }

  // What, if anything, this reader may be offered for this plugin. Read once
  // per page, and only for the page: Stripe unreachable withholds the offer
  // rather than rendering a button with no amount on it.
  let promoteOffer = { price: null, proLabel: null }
  if (billing && viewer.account && !doc.promoted) {
    try {
      const prices = await billingPrices(billing)
      promoteOffer = { price: prices.single?.text ?? null, proLabel: prices.pro?.label ?? null }
    } catch (error) {
      logger.warn(`[billing] no price for the plugin page: ${error.message}`)
    }
  }

  sendText(response, 200, renderPluginPage(doc, viewer,
    corrections
      ? {
          account: viewer.account,
          csrfToken: viewer.account ? auth.session.csrfToken(viewer.account.iri) : null,
          correctable: CORRECTABLE,
          // The only place the upload form appears. Without this the route at
          // /plugin/<slug>/image worked and nothing on the site reached it — a
          // route with no link, which is the failure in CLAUDE.md's table and
          // which this shipped as.
          mayUploadImage: Boolean(images) && (
            viewer.account?.trustLevel === TRUST.TRUSTED ||
            viewer.account?.trustLevel === TRUST.MODERATOR),
          // Likewise the only place /plugin/<slug>/promote is reachable from.
          // It shipped without one.
          billing: Boolean(billing),
          promotePrice: promoteOffer.price,
          proLabel: promoteOffer.proLabel,
          // The same three conditions the route enforces. This decides what a
          // page *offers*; the route decides what it grants, and both check
          // independently. They compare the vendor **identity**, because a
          // folded name changes when two vendors are merged and the claim would
          // stop matching — see the note on the route.
          promoteIncluded: Boolean(
            viewer.account?.tier === TIER.PRO &&
            viewer.account?.claimsVendor &&
            doc.vendorIri && doc.vendorIri === viewer.account.claimsVendor)
        }
      : null,
    search.measured(iri),
    wiki ? renderWikiBlock(await wiki.current(iri), slug) : '',
    await navigationFor()), HTML)
  return true
}

export default catalogueRoutes
