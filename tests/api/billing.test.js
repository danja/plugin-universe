import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { Billing, BillingError, keyMode } from '../../src/billing/Billing.js'
import { BILLING_CONFIG, lookupKeyFor } from '../../config/preferences.js'
import { TIER } from '../../src/auth/Accounts.js'
import { MAX_BODY_BYTES } from '../../src/api/body.js'
import Stripe from 'stripe'

/**
 * Taking money.
 *
 * Two commitments shape all of this and both are in `docs/architecture.md` §7:
 * card details never touch this server, and payment is an external provider's
 * job with only a customer reference and an entitlement stored here. What that
 * leaves behind is a redirect out and a webhook back — so the tests that matter
 * are about configuration being *right or absent*, never half-right, and about
 * the webhook refusing anything it cannot verify.
 */

const KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY', 'STRIPE_WEBHOOK_SECRET']
const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]))
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})
const withEnv = env => {
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, env)
  return Billing.fromEnvironment({ origin: 'https://plugin-universe.com' })
}

describe('telling a test key from a live one', () => {
  it('reads the mode off the prefix', () => {
    expect(keyMode('sk_test_abc')).toBe('test')
    expect(keyMode('sk_live_abc')).toBe('live')
    expect(keyMode('rk_test_abc')).toBe('test')
    expect(keyMode('pk_live_abc')).toBe('live')
  })

  it('does not guess at something that is not a key', () => {
    expect(keyMode('hello')).toBe('unrecognised')
    expect(keyMode('')).toBeNull()
    expect(keyMode(null)).toBeNull()
  })
})

describe('configuration is complete or absent, never half', () => {
  it('is absent, and quiet, when no keys are set', () => {
    // A read-only deployment of this catalogue must not require a Stripe
    // account. Absence is a deployment choice, not a fault.
    const { billing, reason } = withEnv({})
    expect(billing).toBeNull()
    expect(reason).toBeNull()
  })

  it('reports a half-configured setup rather than running on one key', () => {
    // The state that looks like the one above and is not. /health has to be
    // able to tell them apart, or a broken payment system reads as a
    // deliberate read-only site.
    expect(withEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }).reason).toMatch(/both be set/)
    expect(withEnv({ STRIPE_PUBLIC_KEY: 'pk_test_x' }).reason).toMatch(/both be set/)
    expect(withEnv({ STRIPE_SECRET_KEY: 'sk_test_x' }).billing).toBeNull()
  })

  it('refuses two keys from different modes', () => {
    // The failure worth most: a live publishable key on the page with a test
    // secret on the server. Checkout looks right and no money moves.
    expect(() => withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLIC_KEY: 'pk_live_x' }))
      .toThrow(/Mixing modes/)
  })

  it('refuses a publishable key pasted into the secret variable', () => {
    // Both are `pk_test_`, so a test-or-live check cannot tell them apart —
    // which is why the two variables get different checks. Left to the mode
    // check alone this passed startup and failed on the first API call, inside
    // a webhook, in production.
    expect(() => withEnv({ STRIPE_SECRET_KEY: 'pk_test_x', STRIPE_PUBLIC_KEY: 'pk_test_x' }))
      .toThrow(/does not look like a secret key/)
  })

  it('refuses a secret key rendered into a page', () => {
    // The reverse, and the worse direction: STRIPE_PUBLIC_KEY reaches the
    // browser by design.
    expect(() => withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLIC_KEY: 'sk_test_x' }))
      .toThrow(/does not look like a publishable key/)
  })

  it('accepts a matched test pair and says which mode it is in', () => {
    const { billing } = withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLIC_KEY: 'pk_test_x' })
    expect(billing.status().mode).toBe('test')
  })

  it('needs the site origin, because every return URL is built from it', () => {
    for (const k of KEYS) delete process.env[k]
    Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLIC_KEY: 'pk_test_x' })
    expect(() => Billing.fromEnvironment({})).toThrow(/origin/)
  })
})

describe('a webhook is not believed until it is verified', () => {
  const billing = () =>
    withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLIC_KEY: 'pk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }).billing

  it('refuses a delivery with no signature', () => {
    expect(() => billing().verifyWebhook('{}', null)).toThrow(BillingError)
  })

  it('refuses a forged signature', () => {
    expect(() => billing().verifyWebhook('{"type":"checkout.session.completed"}', 't=1,v1=deadbeef'))
      .toThrow(/did not verify/)
  })

  it('refuses everything when no signing secret is configured', () => {
    // Every delivery is an instruction to give something away, and the endpoint
    // is a public URL. Unverifiable must mean refused, not trusted.
    const { billing: b } = withEnv({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLIC_KEY: 'pk_test_x' })
    expect(() => b.verifyWebhook('{}', 't=1,v1=x')).toThrow(/cannot be verified/)
    expect(b.status().webhook).toMatch(/MISSING/)
  })

  it('says so in its status, so a missing secret is visible before it matters', () => {
    expect(billing().status().webhook).toBe('configured')
  })
})

describe('the configuration is documented and cannot leak', () => {
  it('documents every Stripe variable in .env.example', () => {
    // .env.example is the contract for what this app needs. A secret that is
    // read at runtime and documented nowhere is found by a deployment failing.
    const example = readFileSync('.env.example', 'utf8')
    for (const name of KEYS) expect(example, name).toContain(`${name}=`)
  })

  it('ships no value with those names', () => {
    const example = readFileSync('.env.example', 'utf8')
    for (const name of KEYS) {
      expect(example, `${name} has a value in .env.example`).toMatch(new RegExp(`^${name}=\\s*$`, 'm'))
    }
  })

  it('keeps .env out of git and out of the image', () => {
    expect(readFileSync('.gitignore', 'utf8')).toMatch(/^\.env$/m)
    expect(readFileSync('.dockerignore', 'utf8')).toMatch(/^\.env$/m)
  })

  it('never puts a key in what /health publishes', () => {
    const { billing } = withEnv({
      STRIPE_SECRET_KEY: 'sk_test_SECRETVALUE', STRIPE_PUBLIC_KEY: 'pk_test_PUBLICVALUE',
      STRIPE_WEBHOOK_SECRET: 'whsec_SECRETVALUE'
    })
    const published = JSON.stringify(billing.status())
    expect(published).not.toContain('SECRETVALUE')
    expect(published).not.toContain('sk_test')
    expect(published).not.toContain('whsec')
  })
})

describe('the webhook body cap', () => {
  it('is larger than the form-post default, which a webhook exceeds', () => {
    // src/api/body.js caps a body at 16 kB, which is right for a form and too
    // small for an invoice with several line items. Stripe retries a rejected
    // delivery, so a cap set too low is a fulfilment that never happens and a
    // retry storm behind it.
    expect(BILLING_CONFIG.webhookMaxBytes).toBeGreaterThan(MAX_BODY_BYTES)
  })

  it('pins the API version rather than following the library', () => {
    // An unpinned version lets a library upgrade silently change the shape of a
    // webhook payload, and break fulfilment on a day nobody deployed anything.
    expect(BILLING_CONFIG.apiVersion).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  it('states no amount and no currency, because those live in Stripe', () => {
    // Two places for an amount is one place for it to be wrong, and a price in
    // Stripe is immutable — so what this file may hold is a *lookup key*, which
    // is a name this code chooses, and never a figure.
    const source = readFileSync('config/preferences.js', 'utf8')
    const block = source.slice(source.indexOf('export const BILLING_CONFIG'))
    const values = block.slice(0, block.indexOf('\n}'))
      // Both comment syntaxes. Stripping only `//` left the JSDoc blocks in and
      // matched the word "amount" in a sentence explaining why there is none.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
    expect(values).not.toMatch(/\b(gbp|usd|eur)\b/i)
    expect(values).not.toMatch(/amount/i)
    // Structurally, not by regex: a number here is as likely to be a byte cap
    // or a timeout as a price, and an earlier version of this check failed on
    // the API version date. What matters is that nothing *sold* carries a
    // figure — the price is whatever the lookup key resolves to in Stripe.
    for (const [key, sold] of Object.entries(BILLING_CONFIG.sells)) {
      for (const field of Object.keys(sold)) {
        expect(field, `${key}.${field}`).not.toMatch(/price|amount|cost|currency/i)
      }
    }
  })

  it('names everything it sells by lookup key, never by price id', () => {
    // A price id would have to be copied into configuration and re-copied every
    // time the amount changed, because Stripe prices are immutable. A lookup
    // key moves onto the new price in the dashboard, with no deploy.
    for (const key of Object.keys(BILLING_CONFIG.sells)) {
      expect(key, key).toMatch(/^[a-z0-9_]+$/)
      expect(key, key).not.toMatch(/^price_/)
    }
    expect(readFileSync('src/billing/Billing.js', 'utf8')).toContain('lookup_keys')
  })

  it('grants only tiers the account model recognises', () => {
    // Two lists that must agree. A tier sold here that TIER does not know would
    // take somebody's money and give them a status nothing reads.
    const known = Object.values(TIER)
    for (const [key, sold] of Object.entries(BILLING_CONFIG.sells)) {
      if (sold.grants !== 'tier') continue
      expect(known, `${key} grants a tier nothing recognises`).toContain(sold.tier)
    }
  })

  it('can find each thing it sells by what that thing grants', () => {
    // A second paid tier should be a row in the table, not a new branch in the
    // webhook — so the lookup is by entitlement rather than by hardcoded key.
    expect(lookupKeyFor('promotion')).toBe('promoted_listing_year')
    expect(lookupKeyFor('tier')).toBe('pro_tier_year')
    expect(() => lookupKeyFor('nothing_sells_this')).toThrow()
  })
})

/**
 * A signature that really verifies.
 *
 * Stripe's own `generateTestHeaderString` signs a payload with a secret exactly
 * as its servers do, so this exercises the real verification path rather than a
 * stand-in for it — which for the one check standing between a public URL and
 * giving away a year of paid placement is the only kind of test worth having.
 */
describe('a correctly signed delivery is accepted, and only that', () => {
  const SECRET = 'whsec_testsecretfortestingonly'
  const billing = () => withEnv({
    STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLIC_KEY: 'pk_test_x', STRIPE_WEBHOOK_SECRET: SECRET
  }).billing

  const signed = (payload, { secret = SECRET, timestamp } = {}) =>
    Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp })

  const body = JSON.stringify({
    id: 'evt_1', type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_1', payment_status: 'paid', metadata: { kind: 'promotion' } } }
  })

  it('accepts a payload signed with the endpoint secret', () => {
    const event = billing().verifyWebhook(body, signed(body))
    expect(event.type).toBe('checkout.session.completed')
    expect(event.data.object.id).toBe('cs_test_1')
  })

  it('refuses the same payload signed with a different secret', () => {
    expect(() => billing().verifyWebhook(body, signed(body, { secret: 'whsec_someoneelse' })))
      .toThrow(/did not verify/)
  })

  it('refuses a payload altered after signing', () => {
    // The attack the signature exists to stop: a real delivery, edited in
    // flight to name a different plugin or a longer term.
    const signature = signed(body)
    const tampered = body.replace('cs_test_1', 'cs_test_2')
    expect(() => billing().verifyWebhook(tampered, signature)).toThrow(/did not verify/)
  })

  it('refuses a replayed delivery from outside the tolerance window', () => {
    // Otherwise a delivery captured once could be re-sent indefinitely.
    const old = Math.floor(Date.now() / 1000) - 60 * 60
    expect(() => billing().verifyWebhook(body, signed(body, { timestamp: old })))
      .toThrow(/did not verify/)
  })
})

describe('the two routes have opposite threat models, and the code says so', () => {
  const source = readFileSync('src/billing/routes.js', 'utf8')

  it('verifies before doing anything with a webhook payload', () => {
    // Order matters: every line after verification treats the payload as fact.
    const hook = source.slice(source.indexOf("path === '/billing/webhook'"))
    expect(hook.indexOf('verifyWebhook')).toBeLessThan(hook.indexOf('fulfil('))
  })

  it('reads the raw body rather than a parsed one', () => {
    // The signature is over the bytes as sent; a parse/stringify round trip
    // would not reproduce them.
    expect(source).toContain('readBody(request')
    const hook = source.slice(source.indexOf("path === '/billing/webhook'"))
    expect(hook).not.toContain('readForm')
  })

  it('answers a failed signature with 400 and not 500', () => {
    // 500 makes Stripe retry a message that will never verify.
    const hook = source.slice(source.indexOf('refused a webhook delivery'))
    expect(hook.slice(0, 200)).toContain('400')
  })

  it('answers a failed fulfilment with 500, so Stripe retries', () => {
    // The opposite case: the money arrived and the thing bought was not
    // granted. A retry is exactly what should happen, and grantPaid is
    // idempotent so it costs nothing.
    const hook = source.slice(source.indexOf('FULFILMENT FAILED'))
    expect(hook.slice(0, 260)).toContain('500')
  })

  it('acknowledges an event it does not handle rather than failing it', () => {
    // Returning a failure makes Stripe retry for days something this code was
    // never going to act on.
    expect(source).toMatch(/HANDLED\.includes/)
    const ignored = source.slice(source.indexOf('HANDLED.includes'))
    expect(ignored.slice(0, 200)).toContain('200')
  })

  it('requires a CSRF token on the outbound purchase, like every other form', () => {
    const buy = source.slice(source.indexOf('const buying ='), source.indexOf("path === '/billing/webhook'"))
    expect(buy).toContain('verifyCsrf')
    expect(buy).toContain('needsSignIn')
  })
})
