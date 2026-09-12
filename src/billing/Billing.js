import Stripe from 'stripe'
import logger from 'loglevel'
import { BILLING_CONFIG } from '../../config/preferences.js'

/**
 * Money, and the one boundary it is allowed to cross.
 *
 * Everything here is arranged around a single architectural commitment from
 * `docs/architecture.md` §7: **card details never touch this server.** The
 * consequence is that every payment flow is a redirect to a Stripe-hosted page
 * and a webhook coming back. This process learns that money moved; it never
 * learns how.
 *
 * That also settles a question the site's design would otherwise force. This
 * catalogue is server-rendered with no client-side framework, deliberately, and
 * Stripe's embedded Elements would require one. Hosted Checkout needs none —
 * the "integration" on the page is a form that POSTs and a 303 somewhere else.
 *
 * **Absent rather than broken.** A read-only deployment of this catalogue is a
 * legitimate thing to run and must not require a Stripe account, so
 * `fromEnvironment()` returns null when the keys are unset and says so once.
 * Where a key *is* set but unusable, that is an error: CLAUDE.md's first rule is
 * that a value not successfully retrieved from config is a defect to fix, not a
 * thing to default around.
 */

export class BillingError extends Error {
  constructor (message) {
    super(message)
    this.name = 'BillingError'
  }
}

/**
 * Which mode a key is for, from its prefix alone.
 *
 * Worth knowing and worth surfacing: the difference between `sk_test_` and
 * `sk_live_` is the difference between a rehearsal and somebody's money, and
 * the two are one character apart in a `.env` file. `/health` reports it.
 */
export function keyMode (key) {
  if (typeof key !== 'string' || !key) return null
  if (/^(sk|rk|pk)_test_/.test(key)) return 'test'
  if (/^(sk|rk|pk)_live_/.test(key)) return 'live'
  return 'unrecognised'
}

export class Billing {
  constructor ({ stripe, publicKey, webhookSecret = null, origin, mode }) {
    if (!stripe) throw new BillingError('Billing needs a Stripe client')
    if (!origin) throw new BillingError('Billing needs the site origin, to build return URLs')
    this.stripe = stripe
    this.publicKey = publicKey
    this.webhookSecret = webhookSecret
    this.origin = String(origin).replace(/\/$/, '')
    this.mode = mode
  }

  /**
   * Build from the environment, or null when billing is not configured.
   *
   * @returns {{billing: Billing|null, reason: string|null}} `reason` is set when
   *   billing is *partly* configured — a half-set-up payment system should say
   *   so on `/health` rather than look like a deliberate read-only deployment.
   *   The same shape `AuthRoutes.fromEnvironment` uses, for the same reason.
   */
  static fromEnvironment ({ origin } = {}) {
    const secretKey = process.env.STRIPE_SECRET_KEY
    const publicKey = process.env.STRIPE_PUBLIC_KEY
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? null

    if (!secretKey && !publicKey) {
      logger.info('[billing] STRIPE_SECRET_KEY not set; payments are disabled')
      return { billing: null, reason: null }
    }
    if (!secretKey || !publicKey) {
      return {
        billing: null,
        reason: 'STRIPE_SECRET_KEY and STRIPE_PUBLIC_KEY must both be set, or neither. ' +
          `Currently ${secretKey ? 'only the secret' : 'only the publishable'} key is present.`
      }
    }

    // Which kind of key, before which mode. `keyMode` answers "test or live"
    // and accepts any of the three prefixes, so it cannot on its own tell a
    // publishable key pasted into the secret slot from a real secret — both are
    // `_test_`. The two variables want different prefixes and so get different
    // checks.
    if (!/^(sk|rk)_/.test(secretKey)) {
      throw new BillingError(
        'STRIPE_SECRET_KEY does not look like a secret key (expected sk_ or rk_). ' +
        'A publishable key here passes every check at startup and fails on the first API call — ' +
        'which is inside a webhook, in production.')
    }
    if (!/^pk_/.test(publicKey)) {
      throw new BillingError(
        'STRIPE_PUBLIC_KEY does not look like a publishable key (expected pk_). ' +
        'A secret key here would be rendered into a page.')
    }

    const mode = keyMode(secretKey)
    if (mode === 'unrecognised') {
      throw new BillingError(
        'STRIPE_SECRET_KEY is neither a test nor a live key (expected sk_test_, sk_live_ or rk_).')
    }
    if (mode !== keyMode(publicKey)) {
      // The failure this prevents is a live publishable key on the page with a
      // test secret on the server: checkout appears to work and no money moves.
      throw new BillingError(
        `STRIPE_SECRET_KEY is a ${mode} key and STRIPE_PUBLIC_KEY is a ${keyMode(publicKey)} key. ` +
        'Mixing modes produces a checkout that looks right and settles nowhere.')
    }
    if (!origin) throw new BillingError('Billing.fromEnvironment needs the site origin')

    if (!webhookSecret) {
      // Not fatal at startup — you cannot have the secret before you create the
      // endpoint — but the webhook route refuses to act without it, because an
      // unverified webhook is an open instruction to grant anything.
      logger.warn('[billing] STRIPE_WEBHOOK_SECRET is not set; the webhook will refuse every delivery')
    }

    return {
      billing: new Billing({
        stripe: new Stripe(secretKey, {
          apiVersion: BILLING_CONFIG.apiVersion,
          // So a failure in Stripe's logs can be traced to a deployment.
          appInfo: { name: 'plugin-universe', url: 'https://plugin-universe.com' },
          maxNetworkRetries: BILLING_CONFIG.maxNetworkRetries
        }),
        publicKey,
        webhookSecret,
        origin,
        mode
      }),
      reason: null
    }
  }

  /**
   * A Checkout Session for one plugin's promoted listing.
   *
   * `mode: 'payment'` and not a subscription, deliberately. The placement
   * already ends by its own date and the admin page already reports one lapsing
   * within thirty days, so the renewal conversation happens before it stops. An
   * auto-renewing advertisement would fight that design, and it raises
   * consumer-law questions a one-time purchase does not have.
   *
   * **The metadata is the whole binding.** This process will not see the buyer
   * again until Stripe delivers an event, and that event carries nothing about
   * the catalogue except what is put here. Both IRIs go in, and the webhook
   * refuses anything it cannot resolve back to a real account and a real plugin.
   *
   * @param {object} options
   * @param {object} options.account - the signed-in buyer, `{ iri, login }`
   * @param {object} options.plugin - `{ iri, name, slug }`
   * @param {string} options.priceId - a Stripe Price id, resolved by lookup key
   */
  async checkoutForPromotion ({ account, plugin, priceId }) {
    if (!account?.iri) throw new BillingError('Checkout needs the buying account')
    if (!plugin?.iri) throw new BillingError('Checkout needs the plugin')
    if (!priceId) throw new BillingError('Checkout needs a price')

    return this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${this.origin}/plugin/${plugin.slug}?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.origin}/plugin/${plugin.slug}`,
      expires_at: Math.floor(Date.now() / 1000) + BILLING_CONFIG.checkoutExpiryMinutes * 60,
      // The app holds no email address — accounts are GitHub logins and this
      // project minimises personal data deliberately. Stripe collects one at
      // checkout and keeps it; what comes back here is a customer id, which is
      // a reference rather than a person's details.
      customer_creation: 'always',
      // A buyer who needs a document gets one without anybody being asked. What
      // Stripe issues is a receipt or a Stripe invoice — in Italy it is *not*
      // an SdI invoice, which is a separate obligation. See docs/danja-todo.md.
      invoice_creation: { enabled: true },
      // Billing address from the start, so switching tax collection on later is
      // configuration rather than a migration.
      billing_address_collection: 'required',
      // Read back by the webhook. Nothing else survives the round trip.
      metadata: {
        kind: 'promotion',
        pluginIri: plugin.iri,
        accountIri: account.iri
      },
      client_reference_id: account.iri
    })
  }

  /**
   * A Checkout Session for a subscription tier.
   *
   * `mode: 'subscription'`, and the difference from a placement is not just the
   * mode. A placement is bought outright and ends 365 days later whatever
   * happens; a tier is *rented*, and its expiry has to track the subscription
   * or a cancellation leaves somebody paid-up for months. So the customer is
   * created here and remembered, because every later event — renewed, lapsed,
   * card declined — names the customer and nothing else this system knows.
   */
  async checkoutForTier ({ account, priceId, returnPath = '/account' }) {
    if (!account?.iri) throw new BillingError('Checkout needs the subscribing account')
    if (!priceId) throw new BillingError('Checkout needs a price')

    return this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${this.origin}${returnPath}?subscribed={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.origin}${returnPath}`,
      billing_address_collection: 'required',
      metadata: { kind: 'tier', accountIri: account.iri },
      // Carried onto the subscription itself, not just the session. A renewal
      // a year from now delivers a subscription event, which never sees the
      // session — so metadata left only on the session would be unreachable at
      // exactly the moment it is needed.
      subscription_data: { metadata: { accountIri: account.iri } },
      client_reference_id: account.iri
    })
  }

  /**
   * A Customer Portal session: Stripe's own page for managing a subscription.
   *
   * Cancelling, updating a card, and reading past invoices, none of which this
   * site has to build or hold data for. A sole operator must not be the
   * cancellation desk, and a subscription somebody cannot cancel without
   * emailing a person is the kind of thing consumer protection regulators have
   * opinions about.
   */
  async portalSession ({ stripeCustomer, returnPath = '/account' }) {
    if (!stripeCustomer) {
      throw new BillingError('No Stripe customer on this account; there is nothing to manage yet.')
    }
    return this.stripe.billingPortal.sessions.create({
      customer: stripeCustomer,
      return_url: `${this.origin}${returnPath}`
    })
  }

  /** One subscription, for reading its period end. */
  async subscription (id) {
    return this.stripe.subscriptions.retrieve(id)
  }

  /**
   * Find a price by its lookup key rather than by a hardcoded id.
   *
   * A price id is created in the dashboard and would have to be pasted into
   * configuration; a lookup key is a name this code chooses, and Stripe resolves
   * it. That means the amount can be changed — which in Stripe means creating a
   * *new* price, since prices are immutable — by moving the key, with no deploy.
   */
  async priceByLookupKey (lookupKey) {
    const { data } = await this.stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
    if (!data.length) {
      throw new BillingError(
        `No active Stripe price with lookup key "${lookupKey}". ` +
        'Create a product and price in the Stripe dashboard and set its lookup key to exactly that.')
    }
    return data[0]
  }

  /**
   * Verify a webhook delivery and return the event.
   *
   * **The security boundary of the whole feature.** Everything a webhook says
   * is an instruction to give something away — a year of placement, a paid
   * tier — and the endpoint is a public URL. Without the signature check it is
   * an open grant to anyone who finds it.
   *
   * @param {string|Buffer} rawBody - exactly the bytes received. Not a parsed
   *   object re-serialised: the signature is over the payload as sent, and
   *   `JSON.parse` followed by `JSON.stringify` will not reproduce it.
   */
  verifyWebhook (rawBody, signature) {
    if (!this.webhookSecret) {
      throw new BillingError(
        'No STRIPE_WEBHOOK_SECRET, so this delivery cannot be verified and will not be acted on. ' +
        'Create the endpoint in the Stripe dashboard (or run `stripe listen`) and set the signing secret.')
    }
    if (!signature) throw new BillingError('Delivery carried no Stripe-Signature header.')
    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret)
    } catch (error) {
      throw new BillingError(`Signature did not verify: ${error.message}`)
    }
  }

  /** What `/health` says about payments, with nothing secret in it. */
  status () {
    return {
      mode: this.mode,
      webhook: this.webhookSecret ? 'configured' : 'MISSING — deliveries will be refused'
    }
  }
}

export default Billing
