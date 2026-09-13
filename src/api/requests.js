/**
 * Reading a request: what was asked for, and in what form.
 *
 * Five pure functions over a URL and an Accept header, and nothing else — no
 * store, no renderer, no response. They live apart from `server.js` because
 * every route module needs them and `server.js` imports every route module:
 * leaving them there would have made a cycle out of what is really a leaf.
 *
 * `server.js` re-exports all five, so `import { negotiate } from
 * "./server.js"` keeps working for the callers and tests that already do it.
 */

/**
 * The facets a caller may filter by, in one place.
 *
 * This list was written out three times — in `/`, in `/search` and in
 * `/plugins` — and `/plugins` had silently fallen behind: it accepted none of
 * them, so `?category=reverb` on the browse list was ignored rather than
 * refused. It is also the list `/services` documents and the one the search
 * form's dropdowns are built from, so it is exactly the shape of thing this
 * project keeps getting wrong by copying.
 */
export const FACET_NAMES = Object.freeze([
  'format', 'category', 'role', 'vendor', 'source', 'pricing', 'licence', 'measured',
  // `accepts` and `produces` are the two that make a chain answerable: given a
  // plugin that produces MIDI, `/?accepts=Midi` is the list of things that can
  // follow it. Like `role`, they are addressable by URL and linked from a
  // plugin page without being a dropdown on the form — `facetControls` renders
  // four of these deliberately, and a form with eight selects is a wall.
  'accepts', 'produces'
])

/** The facet filter a request is asking for; null for each one it is not. */
export function facetsFrom (params) {
  return Object.fromEntries(FACET_NAMES.map(name => [name, params.get(name) || null]))
}

export function negotiate (suffix, acceptHeader = '') {
  if (suffix === '.ttl') return 'turtle'
  if (suffix === '.jsonld') return 'jsonld'
  if (suffix === '.json') return 'json'
  const accept = acceptHeader.toLowerCase()
  if (accept.includes('text/turtle')) return 'turtle'
  if (accept.includes('application/ld+json')) return 'jsonld'
  if (accept.includes('application/json')) return 'json'
  if (accept.includes('text/html')) return 'html'
  return 'html'
}

/**
 * Whether this caller asked for a page, on a route whose default is JSON.
 *
 * The inverse default from negotiate(), and deliberately a separate function
 * rather than a flag on it. `/plugin/<slug>` is a page that gained machine
 * representations, so no Accept header at all means HTML — somebody pasted an
 * IRI into a browser. `/search` and `/plugins` are the opposite: documented
 * JSON endpoints that have gained a page. curl sends a wildcard Accept and
 * `fetch()` with no headers sends none at all; both have been receiving JSON
 * since the API was written down in docs/services.md, and both must keep
 * receiving it. Only an explicit text/html changes the answer.
 */
export function prefersPage (acceptHeader = '') {
  return String(acceptHeader).toLowerCase().includes('text/html')
}

/**
 * The `from` parameter of a listing, as a non-negative integer.
 *
 * Anything else is page one. A paging parameter is the easiest thing on a page
 * for a stranger to put a negative number, a float or a word into, and none of
 * those should reach `Array.slice` to be interpreted for us.
 */
export function pageOffset (params) {
  const raw = Number(params.get('from'))
  if (!Number.isFinite(raw) || raw < 0) return 0
  return Math.min(Math.floor(raw), 100000)
}
