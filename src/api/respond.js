/**
 * Writing a response.
 *
 * Extracted so that route handlers can live beside the feature they serve
 * rather than all inside `server.js` — the wiki's routes are in `src/wiki/`
 * with the rest of the wiki, and they need these.
 *
 * Every response is CC0 catalogue data, so CORS is open: a catalogue nobody can
 * call from a browser is not much of an open dataset.
 */

/**
 * `Vary: Accept` on everything, not on the routes that happen to negotiate.
 *
 * This site chooses a representation from the Accept header on plugin IRIs,
 * category pages, /search and /plugins. Without Vary, any shared cache is
 * entitled to hand the Turtle it stored for a crawler to the next person who
 * opens the same URL in a browser. Nothing was setting it anywhere.
 *
 * It is unconditional for the same reason the stylesheet now sets a default
 * link colour: a rule that has to be remembered per route is a rule that will
 * be missed by the next route. The cost on a response that does not negotiate
 * is a little less cache sharing; the cost of omitting it where one does is
 * serving the wrong document.
 */
export const VARY = 'Accept'

export const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=60',
  Vary: VARY
}

/**
 * Licence and attribution, on every response.
 *
 * The dataset is CC0 and attribution is requested rather than required, so
 * saying so in the payload costs nothing and means a consumer never has to go
 * looking for the terms.
 */
export const LICENCE = {
  licence: 'CC0-1.0',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attribution: 'Plugin Universe — https://plugin-universe.com (requested, not required)'
}

export function sendText (response, status, body, contentType) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
    Vary: VARY
  })
  response.end(body)
}

/**
 * Send somebody to the URL that now holds what they asked for.
 *
 * 302 rather than 301, deliberately. These redirects carry the old shapes —
 * `/?q=…` and `/?from=…` — to `/search` and `/plugins`, and a 301 is cached by
 * browsers indefinitely and effectively cannot be withdrawn. Nothing here needs
 * the ranking value of a permanent redirect: these are parameter URLs that no
 * sitemap will list. Promote them once the shape has settled.
 */
export function redirect (response, location, status = 302) {
  response.writeHead(status, { Location: location, Vary: VARY, 'Content-Length': 0 })
  response.end()
}

export function send (response, status, body) {
  const payload = JSON.stringify(body, null, 2)
  response.writeHead(status, { ...JSON_HEADERS, 'Content-Length': Buffer.byteLength(payload) })
  response.end(payload)
}

export const HTML = 'text/html; charset=utf-8'

/**
 * Ask someone to sign in, in whichever way suits them.
 *
 * A person following a link gets the sign-in page and comes back to where they
 * were; a machine calling the API gets 401 and a sentence. Returning raw JSON
 * to a reader who clicked "Edit" — which is what this did — is neither.
 *
 * The return path is a path on this site by construction, and `safeReturnTo`
 * in the auth routes checks it again before it is used.
 */
export function needsSignIn (request, response, { returnTo, message }) {
  const wantsHtml = String(request.headers.accept ?? '').includes('text/html')
  if (!wantsHtml) {
    send(response, 401, { error: message })
    return
  }
  response.writeHead(302, { Location: `/auth/login?return_to=${encodeURIComponent(returnTo)}` })
  response.end()
}
