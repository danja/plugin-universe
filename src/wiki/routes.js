import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { readForm } from '../api/body.js'
import { send, sendText, HTML } from '../api/respond.js'
import { WikiError, WikiConflictError } from './Wiki.js'
import { renderWikiEditor, renderWikiHistory, renderWikiRevision } from './render.js'

/**
 * The wiki's routes, beside the rest of the wiki.
 *
 * `/plugin/<slug>/wiki` reads, `.../wiki/edit` edits, a POST to `.../wiki`
 * saves, `.../wiki/history` lists every version. The prose itself also appears
 * on the plugin page, which is where readers already are — this is the
 * machinery around it.
 *
 * Lives here rather than in `server.js` because it changes when the wiki
 * changes, and `server.js` changes when the catalogue's read API does. Returns
 * true when it has answered the request, false when the path is not its
 * business.
 */
export const WIKI_PATH = /^\/plugin\/([A-Za-z0-9-]+)\/wiki(\/edit|\/history)?$/

export async function wikiRoutes ({ request, response, path, params, viewer, auth, wiki, search }) {
  const matched = path.match(WIKI_PATH)
  if (!matched) return false

  if (!wiki || !auth) {
    send(response, 404, { error: 'The wiki is not enabled' })
    return true
  }
  const slug = matched[1]
  const pluginIri = `${NAMESPACES.pu}plugin/${slug}`
  if (!search.documents.has(pluginIri)) {
    send(response, 404, { error: 'No such plugin' })
    return true
  }
  const section = matched[2] ?? ''

  if (section === '/history') {
    sendText(response, 200, renderWikiHistory(slug, await wiki.history(pluginIri), viewer), HTML)
    return true
  }

  if (section === '/edit') {
    if (!viewer.account) {
      send(response, 401, { error: 'Sign in to edit this page' })
      return true
    }
    const current = await wiki.current(pluginIri)
    sendText(response, 200, renderWikiEditor(slug, {
      csrfToken: auth.session.csrfToken(viewer.account.iri),
      text: current?.text ?? '',
      // The revision the editor starts from, returned on save so that a write
      // built on a stale copy is refused rather than overwriting silently.
      previous: current?.revision ?? ''
    }), HTML)
    return true
  }

  if (request.method === 'POST') {
    if (!viewer.account) {
      send(response, 401, { error: 'Sign in to edit this page' })
      return true
    }
    let form
    try {
      form = await readForm(request)
    } catch (error) {
      send(response, error.status ?? 400, { error: error.message })
      return true
    }
    if (!auth.session.verifyCsrf(form.get('csrf'), viewer.account.iri)) {
      send(response, 403, { error: 'That page has expired. Reload and try again.' })
      return true
    }
    const editor = extra => sendText(response, extra.status ?? 200, renderWikiEditor(slug, {
      csrfToken: auth.session.csrfToken(viewer.account.iri),
      text: form.get('text') ?? '',
      previous: form.get('previous') ?? '',
      ...extra
    }), HTML)

    try {
      await wiki.save({
        account: viewer.account,
        pluginIri,
        text: form.get('text'),
        summary: form.get('summary'),
        previous: form.get('previous') || null
      })
    } catch (error) {
      if (error instanceof WikiConflictError) {
        // The editor keeps their own text and is shown what landed meanwhile.
        // Nothing is overwritten and nothing is lost.
        editor({
          status: 409,
          previous: error.current?.revision ?? '',
          conflict: { message: error.message, current: error.current }
        })
        return true
      }
      if (error instanceof WikiError) {
        editor({ status: 400, error: error.message })
        return true
      }
      throw error
    }
    response.writeHead(303, { Location: `/plugin/${slug}` })
    response.end()
    return true
  }

  // A named older revision, or a redirect to the plugin page, where the current
  // prose already is.
  const wanted = params.get('revision')
  if (wanted) {
    const revision = await wiki.revision(`${NAMESPACES.pu}revision/${wanted}`)
    if (!revision) {
      send(response, 404, { error: 'No such revision' })
      return true
    }
    sendText(response, 200, renderWikiRevision(slug, revision, viewer), HTML)
    return true
  }
  response.writeHead(302, { Location: `/plugin/${slug}` })
  response.end()
  return true
}

export default wikiRoutes
