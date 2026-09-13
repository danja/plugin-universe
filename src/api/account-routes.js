import logger from 'loglevel'
import { send, sendText, needsSignIn, HTML } from './respond.js'
import { renderAccountPage } from './render.js'
import { billingPrices } from '../billing/routes.js'
import { TIER } from '../auth/Accounts.js'

/**
 * Who you are, and what you are on.
 *
 * Four routes that answer a question about the *viewer* rather than about the
 * catalogue: the three OAuth steps, and the page that says which plan an
 * account holds. They came out of `server.js` when it reached 1268 lines, along
 * the seam `src/wiki/routes.js` and `src/billing/routes.js` already marked — a
 * feature owns its routes and the handler mounts them.
 *
 * The contract is theirs too: `(context) => boolean`, true meaning the request
 * was answered here. A module that returns false has written nothing to the
 * response and the next one is tried.
 *
 * Named `account-routes` and not `auth/routes` because **`src/auth/routes.js`
 * is already the OAuth machinery** — the `AuthRoutes` class that mints state,
 * exchanges the code and turns a cookie into an account. This file is the HTTP
 * layer that calls it.
 */

/** The paths this module answers. Checked before anything else is done. */
const PATHS = new Set(['/auth/login', '/auth/callback', '/auth/logout', '/account'])

export async function accountRoutes ({
  request, response, url, path, params, viewer, auth, search, billing
}) {
  if (!PATHS.has(path)) return false

  if (!auth) {
    send(response, 404, {
      error: path === '/account'
        ? 'Accounts are not enabled'
        : 'Sign-in is not configured on this instance'
    })
    return true
  }

  if (path === '/account') {
    await accountPage({ response, request, params, viewer, auth, search, billing })
    return true
  }

  // A GET logout is triggerable by any page with an <img> tag.
  if (path === '/auth/logout' && request.method !== 'POST') {
    send(response, 405, { error: 'Sign out with POST' })
    return true
  }
  const outcome = path === '/auth/login'
    ? auth.login(request, url)
    : path === '/auth/callback'
      ? await auth.callback(request, url)
      : auth.logout(request)
  response.writeHead(outcome.status, {
    ...(outcome.headers ?? {}),
    ...(outcome.body ? { 'Content-Type': 'text/plain; charset=utf-8' } : {})
  })
  response.end(outcome.body ?? '')
  return true
}

/** The account page: which plan, until when, and the way out of it. */
async function accountPage ({ response, request, params, viewer, auth, search, billing }) {
  if (!viewer.account) {
    return needsSignIn(request, response, {
      returnTo: '/account', message: 'Sign in to see your account'
    })
  }
  const account = viewer.account
  // The plan, as three states. Lapsed is the one worth naming: without it
  // somebody whose subscription ended sees the free plan and is left wondering
  // what happened to the placements they were paying for.
  const remaining = account.tierEndsAt
    ? Math.ceil((new Date(account.tierEndsAt).getTime() - Date.now()) / 86400000)
    : null
  const plan = account.paidTier && account.paidTier !== TIER.REGISTERED
    ? (account.tier === TIER.REGISTERED
        ? { state: 'lapsed', endsAt: account.tierEndsAt }
        : { state: 'paid', endsAt: account.tierEndsAt, daysRemaining: remaining, cancelling: false })
    : { state: 'free' }

  // Prices come from Stripe rather than from anything written here. Unreachable
  // is not fatal: the page still tells somebody what they are on, which is most
  // of why they opened it.
  let prices = {}
  if (billing) {
    try {
      prices = await billingPrices(billing)
    } catch (error) {
      logger.warn(`[billing] could not read prices for /account: ${error.message}`)
    }
  }

  return sendText(response, 200, renderAccountPage({
    account,
    csrfToken: auth.session.csrfToken(account.iri),
    plan,
    prices,
    corpus: search.documents.size,
    notice: params.get('subscribed') ? 'Thank you — your subscription is active.' : null,
    viewer,
    facetValues: await search.facets()
  }), HTML)
}

export default accountRoutes
