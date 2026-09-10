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

export const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=60'
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
    'Content-Length': Buffer.byteLength(body)
  })
  response.end(body)
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
