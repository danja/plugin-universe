import logger from 'loglevel'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { send, sendText, needsSignIn } from '../api/respond.js'
import { readBody, readForm, BodyError } from '../api/body.js'
import { BILLING_CONFIG, lookupKeyFor } from '../../config/preferences.js'
import { BillingError } from './Billing.js'
import { PromotionError } from '../catalogue/Promotions.js'

/**
 * The two routes money needs, and nothing else.
 *
 * One goes out — a form POST that answers with a redirect to a Stripe-hosted
 * page. One comes back — a webhook that grants what was bought. Between them
 * this process knows nothing: no card, no amount entered here, no payment page
 * of its own.
 *
 * **They have opposite threat models and it shows in the code.** The outbound
 * route trusts a signed-in session and a CSRF token, like every other form on
 * the site. The inbound one trusts nothing at all: it is a public URL that
 * hands out a year of paid placement, so a delivery is refused unless its
 * signature verifies against the endpoint secret. Everything after that check
 * treats the payload as fact; everything before it treats it as a stranger's
 * POST, because that is what it is.
 */

/** Stripe's own header. Case-insensitive on the wire; Node lower-cases it. */
const SIGNATURE_HEADER = 'stripe-signature'

/**
 * Events this endpoint acts on.
 *
 * A short list on purpose. Stripe will deliver whatever the endpoint is
 * subscribed to, and an unrecognised event must be a `200` and a shrug rather
 * than an error — returning a failure makes Stripe retry something this code
 * was never going to handle, for days.
 */
const HANDLED = Object.freeze(['checkout.session.completed'])

/**
 * @returns {Promise<boolean>} whether this request was a billing route
 */
export default async function billingRoutes (request, response, {
  path, billing, promotions, accounts, search, auth, viewer
}) {
  if (!path.startsWith('/billing/') && !path.endsWith('/promote')) return false
  if (!billing || !promotions) {
    send(response, 404, { error: 'Payments are not enabled on this instance' })
    return true
  }

  // ── Outbound: buy a placement ────────────────────────────────────────────
  const buying = path.match(/^\/plugin\/([A-Za-z0-9-]+)\/promote$/)
  if (buying) {
    if (request.method !== 'POST') {
      send(response, 405, { error: 'POST to buy a placement' })
      return true
    }
    const pluginIri = `${NAMESPACES.pu}plugin/${buying[1]}`
    const doc = search.documents.get(pluginIri)
    if (!doc) {
      send(response, 404, { error: 'No such plugin' })
      return true
    }
    if (!viewer.account) {
      needsSignIn(request, response, {
        returnTo: `/plugin/${buying[1]}`,
        message: 'Sign in to promote a plugin'
      })
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
      send(response, 403, { error: 'That form has expired. Reload the page and try again.' })
      return true
    }

    // Already promoted: say so rather than taking money for a placement that
    // is already running. The webhook would refuse to create a second one, so
    // without this the buyer would pay for nothing.
    const live = await promotions.forPlugin(pluginIri)
    if (live) {
      send(response, 409, {
        error: `${doc.name} is already promoted until ${String(live.endsAt).slice(0, 10)}.`
      })
      return true
    }

    try {
      const price = await billing.priceByLookupKey(lookupKeyFor('promotion'))
      const session = await billing.checkoutForPromotion({
        account: viewer.account,
        plugin: { iri: pluginIri, name: doc.name, slug: buying[1] },
        priceId: price.id
      })
      // 303, so the browser turns a POST into a GET on the way to Stripe.
      response.writeHead(303, { Location: session.url, 'Content-Length': 0 })
      response.end()
    } catch (error) {
      if (!(error instanceof BillingError)) throw error
      logger.warn(`[billing] checkout refused: ${error.message}`)
      send(response, 400, { error: error.message })
    }
    return true
  }

  // ── Inbound: Stripe tells us what happened ───────────────────────────────
  if (path === '/billing/webhook') {
    if (request.method !== 'POST') {
      send(response, 405, { error: 'POST only' })
      return true
    }

    let raw
    try {
      // The raw bytes, unparsed. The signature is over the payload exactly as
      // sent, so a JSON.parse/stringify round trip would not reproduce it.
      // A larger cap than a form post: src/api/body.js defaults to 16 kB and a
      // webhook exceeds that, and a delivery this endpoint rejects is retried.
      raw = await readBody(request, { limit: BILLING_CONFIG.webhookMaxBytes })
    } catch (error) {
      if (!(error instanceof BodyError)) throw error
      send(response, error.status ?? 400, { error: error.message })
      return true
    }

    let event
    try {
      event = billing.verifyWebhook(raw, request.headers[SIGNATURE_HEADER])
    } catch (error) {
      // 400, never 500: a failed signature is a rejected message rather than a
      // fault here, and Stripe should not retry it.
      logger.warn(`[billing] refused a webhook delivery: ${error.message}`)
      send(response, 400, { error: 'Signature verification failed' })
      return true
    }

    if (!HANDLED.includes(event.type)) {
      // Acknowledged and ignored. Anything else makes Stripe retry for days.
      sendText(response, 200, 'ignored', 'text/plain; charset=utf-8')
      return true
    }

    try {
      const outcome = await fulfil(event, { promotions, accounts, search })
      sendText(response, 200, outcome, 'text/plain; charset=utf-8')
    } catch (error) {
      // 500 on purpose, so Stripe retries. The payment succeeded and the thing
      // bought was not granted; a retry is exactly what should happen, and
      // grantPaid is idempotent so retrying costs nothing.
      logger.error(`[billing] FULFILMENT FAILED for ${event.id}: ${error.message}`)
      send(response, 500, { error: 'Fulfilment failed; please retry this delivery' })
    }
    return true
  }

  return false
}

/**
 * Give the buyer what they paid for.
 *
 * Everything here has already been proved to come from Stripe. What has *not*
 * been proved is that the metadata still refers to anything real — a plugin can
 * be removed and an account erased between checkout and delivery — so both are
 * resolved against the catalogue rather than trusted.
 */
async function fulfil (event, { promotions, accounts, search }) {
  const session = event.data.object
  const { kind, pluginIri, accountIri } = session.metadata ?? {}

  if (kind !== 'promotion') return `ignored: unknown kind ${kind}`
  if (session.payment_status !== 'paid') {
    // A completed session is not always a paid one — a delayed method can
    // complete as `unpaid` and settle later. Granting here would give a year
    // away on a payment that may never arrive.
    return `ignored: payment_status ${session.payment_status}`
  }

  // Already fulfilled? A webhook is delivered at least once and sometimes more.
  const already = await promotions.forPayment(session.id)
  if (already) return `already fulfilled: ${already.promotion}`

  if (!search.documents.get(pluginIri)) {
    throw new Error(`paid session ${session.id} names a plugin the catalogue does not have: ${pluginIri}`)
  }
  const account = await accounts.find(accountIri)
  if (!account) {
    throw new Error(`paid session ${session.id} names an account that no longer exists: ${accountIri}`)
  }

  try {
    const result = await promotions.grantPaid({
      account, pluginIri, paymentReference: session.id
    })
    // The ranking reads a map held in memory, so a placement somebody has just
    // paid for must take effect now rather than at the next restart.
    await search.loadPromotions()
    return result.created
      ? `promoted ${pluginIri} until ${result.endsAt}`
      : `already promoted: ${result.promotion}`
  } catch (error) {
    if (error instanceof PromotionError) throw new Error(`could not grant: ${error.message}`)
    throw error
  }
}
