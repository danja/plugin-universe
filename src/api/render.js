import { NAMESPACES } from '../rdf/NamespaceManager.js'
import templates from './Templates.js'
import { layout, sidebar, searchShell, resultItem, pager } from './page-shell.js'

/**
 * The listings, and the prose pages.
 *
 * Everything that shows *many* plugins — the landing page, a search, the
 * browse list, a vendor, a category — plus the two pages that show none: the
 * vocabulary index and a document from `docs/`.
 *
 * This file is also the front door. It re-exports the whole rendering surface
 * so that `import { renderPluginPage } from "./render.js"` keeps working for
 * the routes and the fifty-odd tests that already do it: the split is an
 * arrangement of this code, not a change to how anything calls it.
 */

export * from './page-shell.js'
export * from './render-forms.js'
export * from './render-plugin.js'

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

export function renderDocPage ({ title, description, html, lang = 'en' }, viewer = {}) {
  return layout(`${title} — Plugin Universe`, templates.render('doc-page', { html }),
    { description, lang, ...viewer })
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
    // The minted identity, where it has been derived. Shown for the same reason
    // a plugin page shows its own IRI: this is the name the catalogue will
    // answer to for ever, and a vendor about to claim a profile should be able
    // to see what they are claiming. Absent until `bin/mint-vendors.js` has
    // run, and the page is complete without it.
    identity: templates.when(Boolean(vendor.iri), 'vendor-identity', {
      iri: vendor.iri ?? '',
      href: (vendor.iri ?? '').replace(NAMESPACES.pu, '/')
    }),
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
