import logger from 'loglevel'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { send, sendText, needsSignIn } from '../api/respond.js'
import { readBody, readForm, BodyError } from '../api/body.js'
import { BILLING_CONFIG, lookupKeyFor } from '../../config/preferences.js'
import { BillingError } from './Billing.js'
import { PromotionError } from '../catalogue/Promotions.js'
import { TIER } from '../auth/Accounts.js'
import { vendorKey } from '../search/SearchService.js'

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

/**
 * What each thing costs, as text, read from Stripe.
 *
 * The account page shows prices and this is the only place they come from —
 * never a figure in a template. Stripe is the one authority on what something
 * costs, and a second copy is a second thing to keep true.
 */
export async function billingPrices (billing) {
  const shown = {}
  const money = price => new Intl.NumberFormat('en-IE', {
    style: 'currency', currency: price.currency.toUpperCase(), minimumFractionDigits: 0
  }).format(price.unit_amount / 100)

  for (const [key, sold] of Object.entries(BILLING_CONFIG.sells)) {
    const price = await billing.priceByLookupKey(key)
    shown[sold.grants === 'tier' ? 'pro' : 'single'] = { text: money(price), label: sold.label }
  }
  return shown
}

/** A placement granted without a trip to Stripe. */
function respondPromoted (response, doc, result) {
  send(response, 200, {
    promoted: doc.name,
    until: result.endsAt,
    included: true,
    note: result.created
      ? 'Included in your Pro subscription. It lapses when the subscription does.'
      : 'Already promoted.'
  })
  return true
}

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
const HANDLED = Object.freeze([
  // Something was bought: a placement, or a subscription starting.
  'checkout.session.completed',
  // A subscription renewed and was paid for. This is what extends an
  // entitlement — and the reason an entitlement has to be extended at all
  // rather than granted once, so that silence expires it.
  'invoice.paid',
  // Ended: cancelled, or given up on after failed payments. Not the only way a
  // tier lapses — it also lapses simply by its expiry passing — which is what
  // makes a missed delivery here survivable rather than permanent.
  'customer.subscription.deleted'
])

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

    // A Pro subscriber promotes their own plugins without paying per plugin.
    // Three conditions, and all three are load-bearing:
    //
    //  - the tier is Pro *and currently effective*, so a lapsed subscription
    //    grants nothing (`account.tier` is already the effective one);
    //  - a moderator has confirmed which vendor this account speaks for;
    //  - and this plugin is that vendor's.
    //
    // Without the third, €99 would buy the right to promote anybody's work,
    // which is both the obvious abuse and the one hardest to notice — a
    // promoted result looks the same however it was authorised.
    const entitled = viewer.account.tier === TIER.PRO &&
      viewer.account.claimsVendor &&
      doc.vendor && vendorKey(doc.vendor) === viewer.account.claimsVendor

    if (entitled) {
      try {
        const result = await promotions.grantIncluded({
          account: viewer.account,
          pluginIri,
          // A Pro placement lapses with the subscription rather than running a
          // fixed year. Cancel after two months and it stops at the period end,
          // not ten months later — the same rule that governs the tier itself.
          endsAt: viewer.account.tierEndsAt
        })
        await search.loadPromotions()
        return respondPromoted(response, doc, result)
      } catch (error) {
        if (!(error instanceof PromotionError)) throw error
        send(response, 400, { error: error.message })
        return true
      }
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

  // ── Outbound: subscribe, and manage a subscription ───────────────────────
  if (path === '/billing/subscribe' || path === '/billing/portal') {
    if (request.method !== 'POST') {
      send(response, 405, { error: 'POST only' })
      return true
    }
    if (!viewer.account) {
      needsSignIn(request, response, { returnTo: '/account', message: 'Sign in to manage a subscription' })
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

    try {
      let url
      if (path === '/billing/portal') {
        // Cancelling, changing a card, reading past invoices — Stripe's page,
        // not one built here, and not an email to a person.
        url = (await billing.portalSession({ stripeCustomer: viewer.account.stripeCustomer })).url
      } else {
        const price = await billing.priceByLookupKey(lookupKeyFor('tier'))
        url = (await billing.checkoutForTier({ account: viewer.account, priceId: price.id })).url
      }
      response.writeHead(303, { Location: url, 'Content-Length': 0 })
      response.end()
    } catch (error) {
      if (!(error instanceof BillingError)) throw error
      logger.warn(`[billing] ${path} refused: ${error.message}`)
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
      const outcome = await fulfil(event, { promotions, accounts, search, billing })
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
async function fulfil (event, { promotions, accounts, search, billing }) {
  if (event.type === 'invoice.paid') return renewTier(event, { accounts, billing })
  if (event.type === 'customer.subscription.deleted') return endTier(event, { accounts })

  const session = event.data.object
  const { kind, pluginIri, accountIri } = session.metadata ?? {}

  if (kind === 'tier') return startTier(session, { accounts, billing })
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

/**
 * A subscription has just started.
 *
 * The tier is written with an expiry taken from the subscription's own period
 * end rather than from a guess here: Stripe decides when the period ends, and
 * a date computed locally would drift from it by however long the two clocks
 * and the payment took to agree.
 */
async function startTier (session, { accounts, billing }) {
  if (session.payment_status !== 'paid') return `ignored: payment_status ${session.payment_status}`
  const accountIri = session.metadata?.accountIri
  const account = await accounts.find(accountIri)
  if (!account) throw new Error(`paid session ${session.id} names an account that no longer exists: ${accountIri}`)

  const sold = BILLING_CONFIG.sells[await lookupKeyOf(session, billing)]
  if (!sold || sold.grants !== 'tier') {
    throw new Error(`session ${session.id} bought a tier this build does not sell`)
  }

  const subscription = await billing.subscription(session.subscription)
  await accounts.grantTier(accountIri, {
    tier: sold.tier,
    endsAt: periodEnd(subscription),
    stripeCustomer: session.customer
  })
  return `granted ${sold.tier} to ${account.login} until ${periodEnd(subscription).toISOString()}`
}

/**
 * A subscription renewed and was paid for: push the expiry out.
 *
 * Extending rather than re-granting is the whole design. An entitlement that
 * must be actively extended lapses if this stops arriving; one granted
 * permanently and cancelled by a message lasts for ever if that message is
 * lost. The first fails in the direction somebody complains about the same
 * day, which is the one to choose.
 */
async function renewTier (event, { accounts, billing }) {
  const invoice = event.data.object
  if (!invoice.subscription) return 'ignored: invoice with no subscription'

  const account = await accounts.findByStripeCustomer(invoice.customer)
  if (!account) {
    // Not an error worth retrying: an erased account is a legitimate state and
    // Stripe would redeliver this for days.
    logger.warn(`[billing] invoice.paid for unknown customer ${invoice.customer}`)
    return `ignored: no account for customer ${invoice.customer}`
  }
  const subscription = await billing.subscription(invoice.subscription)
  await accounts.grantTier(account.iri, {
    tier: account.paidTier ?? 'pro',
    endsAt: periodEnd(subscription),
    stripeCustomer: invoice.customer
  })
  return `extended ${account.login} until ${periodEnd(subscription).toISOString()}`
}

/**
 * A subscription ended.
 *
 * Belt and braces rather than the mechanism: the entitlement would lapse at its
 * expiry anyway. What this adds is *promptness* — somebody who cancels mid-term
 * keeps what they paid for until the period ends, and somebody whose payments
 * failed stops now rather than at a date already passed.
 */
async function endTier (event, { accounts }) {
  const subscription = event.data.object
  const account = await accounts.findByStripeCustomer(subscription.customer)
  if (!account) return `ignored: no account for customer ${subscription.customer}`

  // Ends when the paid-for period ends, not at this instant. Cancelling on day
  // two of a year does not take back the other 363 days.
  const at = periodEnd(subscription)
  await accounts.grantTier(account.iri, { tier: account.paidTier ?? 'pro', endsAt: at })
  return `${account.login} lapses at ${at.toISOString()}`
}

/** A subscription's current period end, as a Date. */
function periodEnd (subscription) {
  const seconds = subscription.current_period_end ??
    subscription.items?.data?.[0]?.current_period_end
  if (!seconds) throw new Error(`subscription ${subscription.id} has no period end`)
  return new Date(seconds * 1000)
}

/** Which of the things we sell a completed session bought. */
async function lookupKeyOf (session, billing) {
  const { data } = await billing.stripe.checkout.sessions.listLineItems(session.id, { limit: 1 })
  const priceId = data[0]?.price?.id
  if (!priceId) throw new Error(`session ${session.id} has no line item`)
  const price = await billing.stripe.prices.retrieve(priceId)
  return price.lookup_key
}
