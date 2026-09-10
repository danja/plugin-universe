import templates from '../api/Templates.js'
import { layout } from '../api/render.js'
import { renderWikiMarkdown } from './markdown.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'

/**
 * The wiki's pages.
 *
 * Separate from `src/api/render.js` for the reason the house rule gives: these
 * change when the wiki changes, and the catalogue pages change when the
 * catalogue does. The HTML itself is in `templates/wiki-*.html`; what is here
 * is the decisions.
 *
 * **Attribution is not decoration.** Prose is CC BY-SA and the licence requires
 * naming the author, so the byline is rendered with the prose and not as an
 * afterthought somewhere else on the page. The licence difference is stated
 * plainly too: a reader looking at one page is looking at CC0 facts and CC
 * BY-SA prose at the same time, and nothing else on the page would tell them.
 */

/**
 * Who to credit.
 *
 * The login where the accounts graph has one. Falling back to the IRI tail
 * would name nobody — it is a content hash — so an author whose account has
 * gone is credited as withdrawn rather than as "1b505ba2".
 */
function authorName (revision) {
  return revision?.authorName || 'a withdrawn account'
}

/** The prose block on a plugin page, or an invitation to write it. */
export function renderWikiBlock (current, slug, { authors = [] } = {}) {
  if (!current) return templates.render('wiki-empty', { slug })
  const names = (authors.length ? authors : [current]).map(authorName)
  return templates.render('wiki', {
    body: renderWikiMarkdown(current.text),
    attribution: `Written by ${names.join(', ')}.`,
    slug
  })
}

export function renderWikiEditor (slug, { csrfToken, text = '', previous = '', error = null, conflict = null }) {
  const body = templates.render('wiki-edit', {
    heading: templates.render('page-heading', { title: `Editing ${slug}` }),
    slug,
    error: templates.when(Boolean(error), 'error', { text: error }),
    conflict: templates.when(Boolean(conflict), 'wiki-conflict', {
      message: conflict?.message ?? '',
      current: conflict?.current?.text ?? ''
    }),
    csrf: csrfToken,
    // The revision the editor started from. Sent back on save so a write
    // built on a stale copy is refused rather than silently overwriting.
    previous: previous ?? '',
    text,
    maxLength: CONTRIBUTION_CONFIG.maxWikiLength,
    maxSummary: CONTRIBUTION_CONFIG.maxRationaleLength
  })
  return layout(`Editing ${slug} — Plugin Universe`, body,
    { description: `Edit the community notes on ${slug}.` })
}

export function renderWikiHistory (slug, revisions, viewer = {}) {
  const body = templates.render('wiki-history', {
    heading: templates.render('page-heading', { title: `History of ${slug}` }),
    slug,
    items: revisions.length
      ? templates.each('wiki-revision', revisions, (revision, index) => ({
        slug,
        revision: revision.revision.split('/').pop(),
        at: String(revision.at).replace('T', ' ').slice(0, 16),
        current: templates.when(revision === revisions[0], 'wiki-current-marker', {}),
        length: revision.length,
        author: authorName(revision),
        summary: templates.when(Boolean(revision.summary), 'tags-line', { text: revision.summary })
      }))
      : templates.render('empty', { text: 'No notes have been written on this plugin.' })
  })
  return layout(`History of ${slug} — Plugin Universe`, body,
    { description: `Revision history of the community notes on ${slug}.`, ...viewer })
}

export function renderWikiRevision (slug, revision, viewer = {}) {
  const body = templates.render('page-heading', { title: `${slug} — an older version` }) +
    templates.render('wiki-old', {
      at: String(revision.at).replace('T', ' ').slice(0, 16),
      author: authorName(revision),
      slug,
      body: renderWikiMarkdown(revision.text)
    })
  return layout(`${slug} — older version — Plugin Universe`, body,
    { description: `An earlier version of the community notes on ${slug}.`, ...viewer })
}
