import { RETRIEVAL_CONFIG } from '../../config/preferences.js'

/**
 * The sitemap: every address a crawler should walk.
 *
 * `/`, `/plugins` and its pages, the category pages and the plugin pages —
 * the list HUMANS.md decided, with `/search` staying out (robots.txt already
 * says so, and every distinct query string is a URL that exists only because
 * it was asked for). Built from the documents already in memory rather than
 * queried per request: the corpus is a few hundred IRIs and this answers on
 * every crawler's first visit.
 *
 * Pure, like the serialisations: the route gathers, this writes. XML is built
 * by concatenation with escaping rather than in a template — templates/ holds
 * the site's HTML pages, and an XML document there would be a second language
 * for the markup guards to trip over.
 */

/** XML text escaping: a URL with a query string carries `&`. */
function xml (value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * @param {object} args
 * @param {string} args.origin - this site's own origin, without a trailing slash
 * @param {{slug: string, created?: string|null}[]} args.plugins
 * @param {string[]} args.categories - category slugs
 * @param {number} args.pageSize - the browse list's page size
 * @returns {string} the sitemap XML
 */
export function buildSitemap ({
  origin, plugins = [], categories = [], pageSize = RETRIEVAL_CONFIG.browsePageSize
}) {
  const base = String(origin ?? '').replace(/\/$/, '')
  if (!base) throw new Error('A sitemap needs the site origin: relative URLs are not sitemap URLs.')
  const urls = [{ loc: `${base}/` }]
  urls.push({ loc: `${base}/plugins` })
  // Page two onwards. Page one is /plugins itself; a ?from= past the end
  // clamps to the last page rather than 404ing, so listing exactly the pages
  // that hold plugins is a count, not a guess.
  for (let from = pageSize; from < plugins.length; from += pageSize) {
    urls.push({ loc: `${base}/plugins?from=${from}` })
  }
  for (const slug of categories) urls.push({ loc: `${base}/category/${slug}` })
  for (const plugin of plugins) {
    // First seen, not released — the one date the catalogue is authoritative
    // for. Absent means harvested before dates were recorded, which is the
    // opposite of new, so no lastmod rather than a wrong one.
    const lastmod = typeof plugin.created === 'string' ? plugin.created.slice(0, 10) : null
    urls.push({
      loc: `${base}/plugin/${plugin.slug}`,
      ...(lastmod ? { lastmod } : {})
    })
  }
  const entries = urls.map(({ loc, lastmod }) =>
    `  <url><loc>${xml(loc)}</loc>${lastmod ? `<lastmod>${xml(lastmod)}</lastmod>` : ''}</url>`
  )
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${entries.join('\n')}\n` +
    '</urlset>\n'
}

export default buildSitemap
