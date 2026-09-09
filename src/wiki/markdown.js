import { marked, Renderer } from 'marked'

/**
 * Markdown from a stranger, rendered for everyone else.
 *
 * `src/api/pages.js` also renders Markdown with marked, and carries a warning
 * at the top not to reuse it for this. The difference is not the library, it is
 * the author: those documents are in the repository and were written by whoever
 * can commit to it. This one is typed into a form by anybody with a GitHub
 * account, and marked does not sanitise — its own documentation says so.
 *
 * **No sanitiser dependency.** The usual answer is to render, then clean the
 * HTML with a library. This instead stops the dangerous constructs from being
 * emitted at all, which is a smaller and more auditable claim than "our
 * sanitiser catches everything":
 *
 *  - **Raw HTML is dropped.** `renderer.html` receives every html token, block
 *    and inline, and returns nothing. `<script>alert(1)</script>` loses its
 *    tags and leaves the harmless text between them. Nothing in the output is
 *    HTML that marked did not itself construct.
 *  - **Link schemes are filtered.** `[x](javascript:alert(1))` passes through
 *    marked untouched — verified, not assumed — so a link that is not http,
 *    https or site-relative is rendered as plain text instead of a link.
 *  - **Images are not loaded.** An image in a wiki page is a URL every reader's
 *    browser fetches from a third party: a tracking pixel, a hotlink to
 *    something illegal, or fifty megabytes. Rendered as a link, so the
 *    contributor loses nothing and the reader chooses.
 *
 * The property that makes this safe rather than hopeful is that raw HTML never
 * survives parsing. Sanitising *after* rendering means reasoning about
 * attacker-supplied tags; dropping the tokens means there are none.
 *
 * What is stored is always the Markdown source. Rendering happens on the way
 * out, so a change here applies to every revision ever written rather than only
 * to the next one.
 */

/** Schemes a link may use. Anything else is shown as text. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/**
 * Is this somewhere a link may point?
 *
 * Site-relative links are allowed so a wiki page can point at a plugin or a
 * category. A protocol-relative `//host` is not: it is absolute to a browser
 * and looks relative here, which is the same trap `safeReturnTo` exists for.
 */
export function safeHref (href) {
  if (typeof href !== 'string' || href === '') return null
  const trimmed = href.trim()
  if (trimmed.startsWith('//')) return null
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed
  try {
    return SAFE_SCHEMES.has(new URL(trimmed).protocol) ? trimmed : null
  } catch {
    return null
  }
}

function escapeAttribute (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function wikiRenderer () {
  const renderer = new Renderer()

  // Every raw HTML token, block and inline. The text inside is preserved by
  // marked as text and escaped normally; only the tags go.
  renderer.html = () => ''

  // marked assigns `renderer.parser` before it starts parsing, so this resolves
  // at call time. `marked.parseInline` is not the same thing: it takes a source
  // string, not the token array a renderer method is handed.
  const parseInline = tokens => renderer.parser.parseInline(tokens)

  renderer.link = ({ href, title, tokens }) => {
    const text = parseInline(tokens)
    const safe = safeHref(href)
    if (!safe) return text
    // `ugc` and `nofollow` because this is user-generated: a wiki that passes
    // search ranking to whatever anyone links is a spam target within a week.
    // `noopener` because a new tab would otherwise get a handle on this one.
    return `<a href="${escapeAttribute(safe)}" rel="nofollow ugc noopener"` +
      `${title ? ` title="${escapeAttribute(title)}"` : ''}>${text}</a>`
  }

  renderer.image = ({ href, title, text }) => {
    const safe = safeHref(href)
    const label = escapeAttribute(text || title || href || 'image')
    if (!safe) return label
    return `<a href="${escapeAttribute(safe)}" rel="nofollow ugc noopener">${label}</a> ` +
      '<span class="muted">(image link)</span>'
  }

  // Headings without ids: an id chosen by a contributor can collide with one
  // the surrounding page uses, and a fragment link into user prose is not worth
  // that.
  renderer.heading = ({ tokens, depth }) =>
    `<h${Math.min(depth + 2, 6)}>${parseInline(tokens)}</h${Math.min(depth + 2, 6)}>\n`

  return renderer
}

/** Render one contributor's Markdown to HTML that is safe to serve. */
export function renderWikiMarkdown (source) {
  if (!source) return ''
  return marked.parse(String(source), { renderer: wikiRenderer(), gfm: true })
}

export default renderWikiMarkdown
