import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import Accounts, { TIER, TRUST, AccountError, effectiveTier } from '../../src/auth/Accounts.js'
import Promotions, { PromotionError } from '../../src/catalogue/Promotions.js'
import { vendorKey } from '../../src/search/SearchService.js'
import { vendorRecords } from '../../src/catalogue/VendorIdentity.js'

// Acme's minted identity, derived rather than written out: the claim stores
// what `bin/mint-vendors.js` would mint, so hard-coding the hash here would let
// the test and the minter drift apart silently.
const ACME_IRI = vendorRecords([{ iri: 'urn:seed', vendor: 'Acme Audio' }])[0].iri

/**
 * "Promote as many of your plugins as you like" — and what **your** means.
 *
 * The word the catalogue could not evaluate. `trn:vendor` is a bare string with
 * no link to any account, so the entitlement needed something to stand on: a
 * moderator's confirmation that an account speaks for a vendor. Against the
 * live store, because the claim, the tier and its expiry are all triples and
 * the rules that read them are queries.
 */

const GRAPH_ID = 'accounts-claim-test'
const PROMO_GRAPH_ID = 'promotions-claim-test'

let client
let accounts
let promotions
let subject
let moderator

beforeAll(async () => {
  client = new SPARQLClient(Config.load().get('storage.endpoint'))
  accounts = new Accounts(client, { graphId: GRAPH_ID })
  promotions = new Promotions(client, { graphId: PROMO_GRAPH_ID })
  await accounts.ensureGraph()
  await promotions.ensureGraph()

  subject = await accounts.upsert({ githubId: '90001', login: 'claimant', name: 'A Vendor' })
  await accounts.upsert({ githubId: '90002', login: 'themod', name: 'Mod' })
  const modIri = accounts.accountIri('90002')
  await accounts.setTrust(modIri, TRUST.MODERATOR)
  moderator = await accounts.find(modIri)
})

afterAll(async () => {
  for (const id of [GRAPH_ID, PROMO_GRAPH_ID]) {
    await client.update(`DROP SILENT GRAPH <graph:system/${id}>`)
    await new GraphRegistry(client).drop('system', id).catch(() => {})
  }
})

describe('a vendor claim is a moderator\'s decision', () => {
  it('is absent until somebody confirms it', async () => {
    expect((await accounts.find(subject.iri)).claimsVendor).toBeNull()
  })

  it('cannot be made by the account holder', async () => {
    // The whole reason it exists. Self-asserted, it would be a way to promote
    // anybody's plugins — and a promoted result looks identical however it was
    // authorised, so the abuse would be invisible rather than merely possible.
    const self = await accounts.find(subject.iri)
    await expect(accounts.claimVendor(subject.iri, 'someoneelse', self))
      .rejects.toThrow(AccountError)
  })

  it('cannot be made by a merely trusted contributor either', async () => {
    await expect(accounts.claimVendor(subject.iri, 'acme', { iri: 'x', trustLevel: TRUST.TRUSTED }))
      .rejects.toThrow(/Only a moderator/)
  })

  it('is recorded when a moderator confirms it', async () => {
    await accounts.claimVendor(subject.iri, ACME_IRI, moderator)
    expect((await accounts.find(subject.iri)).claimsVendor).toBe(ACME_IRI)
  })

  it('refuses a folded name, which is what it used to store', async () => {
    // The change this test exists for. A claim held `"acmeaudio"` until
    // 2026-09-14, and the fold is derived from the spelling — so merging two
    // vendors changed which key a plugin folded to and the claim quietly
    // stopped matching the plugins the merge had just gathered. Accepting a key
    // here would let that back in through the one door a moderator uses.
    for (const bad of ['acmeaudio', 'Acme Audio', 'acme-audio', '', null]) {
      await expect(accounts.claimVendor(subject.iri, bad, moderator), String(bad))
        .rejects.toThrow(AccountError)
    }
  })

  it('refuses an IRI that is not a vendor', async () => {
    for (const bad of [
      'http://purl.org/stuff/plugin-universe/plugin/acme-1234abcd',
      'https://example.com/vendor/acme'
    ]) {
      await expect(accounts.claimVendor(subject.iri, bad, moderator), bad)
        .rejects.toThrow(AccountError)
    }
  })

  it('can be withdrawn, and only by a moderator', async () => {
    await expect(accounts.releaseVendor(subject.iri, { trustLevel: TRUST.TRUSTED }))
      .rejects.toThrow(/Only a moderator/)
    await accounts.releaseVendor(subject.iri, moderator)
    expect((await accounts.find(subject.iri)).claimsVendor).toBeNull()
    // Re-confirmed for the entitlement tests below.
    await accounts.claimVendor(subject.iri, ACME_IRI, moderator)
  })
})

describe('a paid tier is an entitlement with an expiry, in the store', () => {
  const future = new Date(Date.now() + 30 * 86400000)

  it('is registered until something grants otherwise', async () => {
    expect((await accounts.find(subject.iri)).tier).toBe(TIER.REGISTERED)
  })

  it('reads as pro once granted with a future expiry', async () => {
    await accounts.grantTier(subject.iri, {
      tier: TIER.PRO, endsAt: future, stripeCustomer: 'cus_claimtest'
    })
    const account = await accounts.find(subject.iri)
    expect(account.tier).toBe(TIER.PRO)
    expect(account.stripeCustomer).toBe('cus_claimtest')
  })

  it('finds the account back from its Stripe customer id', async () => {
    // The only route from "somebody's subscription renewed" to whose it is.
    const found = await accounts.findByStripeCustomer('cus_claimtest')
    expect(found?.iri).toBe(subject.iri)
  })

  it('refuses to grant a tier with no expiry, which would never lapse', async () => {
    await expect(accounts.grantTier(subject.iri, { tier: TIER.PRO, endsAt: null }))
      .rejects.toThrow(/never lapses/)
  })

  it('reads as registered again once the expiry has passed', async () => {
    // No webhook involved. This is the design: silence expires it.
    await accounts.grantTier(subject.iri, { tier: TIER.PRO, endsAt: new Date(Date.now() - 1000) })
    expect((await accounts.find(subject.iri)).tier).toBe(TIER.REGISTERED)
    // ...while still recording what they had, for the account page.
    expect((await accounts.find(subject.iri)).paidTier).toBe(TIER.PRO)
    await accounts.grantTier(subject.iri, { tier: TIER.PRO, endsAt: future })
  })
})

describe('an included placement lasts exactly as long as the subscription', () => {
  const PLUGIN = 'http://purl.org/stuff/plugin-universe/plugin/test-claimed-1'

  it('ends on the tier\'s date rather than a year out', async () => {
    const account = await accounts.find(subject.iri)
    const result = await promotions.grantIncluded({
      account, pluginIri: PLUGIN, endsAt: account.tierEndsAt
    })
    expect(result.created).toBe(true)
    // The same instant, not approximately: they are the same date by
    // construction, which is why cancellation needs no handling of its own.
    expect(new Date(result.endsAt).getTime())
      .toBe(new Date(account.tierEndsAt).getTime())
  })

  it('records the account without a payment reference', async () => {
    const rows = await client.select(`
      PREFIX pu: <http://purl.org/stuff/plugin-universe/>
      SELECT ?paidBy ?ref WHERE {
        GRAPH <graph:system/${PROMO_GRAPH_ID}> {
          ?p pu:promotes <${PLUGIN}> ; pu:paidBy ?paidBy .
          OPTIONAL { ?p pu:paymentReference ?ref }
        }
      }`)
    expect(rows[0].paidBy).toBe(subject.iri)
    expect(rows[0].ref).toBeUndefined()
  })

  it('refuses one against a lapsed subscription', async () => {
    await expect(promotions.grantIncluded({
      account: { iri: subject.iri }, pluginIri: 'http://purl.org/stuff/plugin-universe/plugin/x-9',
      endsAt: new Date(Date.now() - 1000)
    })).rejects.toThrow(/already lapsed/)
  })

  it('refuses one with no end date at all', async () => {
    await expect(promotions.grantIncluded({
      account: { iri: subject.iri }, pluginIri: 'http://purl.org/stuff/plugin-universe/plugin/x-9', endsAt: null
    })).rejects.toThrow(PromotionError)
  })
})

describe('the three conditions the route checks', () => {
  it('all hold for the claimant and their own vendor', async () => {
    const account = await accounts.find(subject.iri)
    expect(account.tier).toBe(TIER.PRO)
    expect(account.claimsVendor).toBe(ACME_IRI)
    // The route compares a plugin's `foaf:maker` with this, so the value has to
    // be what the identity layer mints — not a name the plugin happens to carry.
    expect(vendorRecords([{ iri: 'urn:p', vendor: 'Acme Audio' }])[0].iri).toBe(ACME_IRI)
  })

  it('survives a merge, which folding on the name did not', async () => {
    // A vendor merged into Acme keeps Acme's IRI, and `bin/mint-vendors.js`
    // repoints every merged plugin's `foaf:maker` at it — so the claim still
    // matches. Folding on the name, the merged-in plugins kept their own
    // spelling, folded to their own key, and matched nothing.
    const [merged] = vendorRecords(
      [{ iri: 'urn:a', vendor: 'Acme Audio' }, { iri: 'urn:b', vendor: 'Acme Ltd' }],
      undefined, [{ into: 'acmeaudio', keys: ['acmeltd'] }])
    const account = await accounts.find(subject.iri)
    expect(merged.iri).toBe(account.claimsVendor)
    expect(merged.count).toBe(2)
    expect(vendorKey('Acme Ltd')).not.toBe(account.claimsVendor)
  })

  it('fail for somebody else\'s vendor', async () => {
    const account = await accounts.find(subject.iri)
    expect(vendorRecords([{ iri: 'urn:p', vendor: 'Some Other Maker' }])[0].iri)
      .not.toBe(account.claimsVendor)
  })

  it('fail once the tier lapses, even with the claim intact', async () => {
    await accounts.grantTier(subject.iri, { tier: TIER.PRO, endsAt: new Date(Date.now() - 1000) })
    const account = await accounts.find(subject.iri)
    expect(account.claimsVendor).toBe(ACME_IRI)
    expect(effectiveTier(account.paidTier, account.tierEndsAt)).toBe(TIER.REGISTERED)
  })
})
