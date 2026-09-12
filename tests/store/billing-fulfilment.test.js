import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/Config.js'
import SPARQLClient from '../../src/store/SPARQLClient.js'
import GraphRegistry from '../../src/store/GraphRegistry.js'
import Promotions, { PromotionError } from '../../src/catalogue/Promotions.js'

/**
 * Giving somebody what they paid for, exactly once.
 *
 * A webhook is delivered *at least* once — Stripe retries on any non-2xx, and
 * duplicate deliveries happen without any failure at all. So the question that
 * decides whether this feature is correct is not "does it grant a placement"
 * but "what happens the second and third time the same event arrives".
 *
 * Against the live store, because the idempotency lives in a SPARQL query and a
 * mocked store would be testing the mock.
 */

const GRAPH_ID = 'promotions-fulfilment-test'
const PLUGIN = 'http://purl.org/stuff/plugin-universe/plugin/test-paid-1'
const BUYER = { iri: 'http://purl.org/stuff/plugin-universe/person/test-buyer' }
const SESSION = 'cs_test_fulfilmenttest1'

let client
let promotions

beforeAll(async () => {
  client = new SPARQLClient(Config.load().get('storage.endpoint'))
  promotions = new Promotions(client, { graphId: GRAPH_ID })
  await promotions.ensureGraph()
})

afterAll(async () => {
  await client.update(`DROP SILENT GRAPH <graph:system/${GRAPH_ID}>`)
  await new GraphRegistry(client).drop('system', GRAPH_ID).catch(() => {})
})

describe('a paid placement is granted once, however many times it is delivered', () => {
  it('grants on the first delivery', async () => {
    const result = await promotions.grantPaid({
      account: BUYER, pluginIri: PLUGIN, paymentReference: SESSION
    })
    expect(result.created).toBe(true)
    expect(result.endsAt).toBeTruthy()
  })

  it('recognises its own work when the same payment arrives again', async () => {
    // The check the webhook makes before doing anything. Without it, a
    // duplicate delivery for a plugin whose placement had since been revoked
    // would silently grant a second year.
    const already = await promotions.forPayment(SESSION)
    expect(already).toBeTruthy()
    expect(already.promotion).toContain('/promotion/')
  })

  it('does not create a second placement on a repeat grant', async () => {
    const again = await promotions.grantPaid({
      account: BUYER, pluginIri: PLUGIN, paymentReference: SESSION
    })
    expect(again.created).toBe(false)
    const live = [...(await promotions.active()).values()].filter(r => r.plugin === PLUGIN)
    expect(live).toHaveLength(1)
  })

  it('records who paid, as well as who it is attributed to', async () => {
    // A paid placement has no moderator. Attribution goes to the buyer because
    // the shape requires every placement to be traceable to somebody.
    const rows = await client.select(`
      PREFIX pu: <http://purl.org/stuff/plugin-universe/>
      PREFIX prov: <http://www.w3.org/ns/prov#>
      SELECT ?by ?paidBy ?ref WHERE {
        GRAPH <graph:system/${GRAPH_ID}> {
          ?p pu:promotes <${PLUGIN}> ; prov:wasAttributedTo ?by ;
             pu:paidBy ?paidBy ; pu:paymentReference ?ref .
        }
      }`)
    expect(rows).toHaveLength(1)
    expect(rows[0].by).toBe(BUYER.iri)
    expect(rows[0].paidBy).toBe(BUYER.iri)
    expect(rows[0].ref).toBe(SESSION)
  })

  it('does not know about a payment that bought nothing here', async () => {
    expect(await promotions.forPayment('cs_test_neverseen')).toBeNull()
  })
})

describe('what a paid grant refuses', () => {
  it('refuses a reference that is not a Stripe session id', async () => {
    // The only evidence money changed hands. Anything else here means
    // something other than a verified payment reached this method.
    for (const bad of ['paid honest', 'pi_123', '', null, 'cs_', 'sub_123']) {
      await expect(promotions.grantPaid({
        account: BUYER, pluginIri: PLUGIN, paymentReference: bad
      }), String(bad)).rejects.toThrow(PromotionError)
    }
  })

  it('refuses a grant with no buying account', async () => {
    await expect(promotions.grantPaid({
      account: null, pluginIri: PLUGIN, paymentReference: 'cs_test_x'
    })).rejects.toThrow(/buying account/)
  })

  it('does not require a moderator, because a payment is the authorisation', async () => {
    // The whole point of the second door: there is no moderator in the room
    // when Stripe delivers the event. What makes it safe is that only a
    // verified webhook can reach it.
    const other = 'http://purl.org/stuff/plugin-universe/plugin/test-paid-2'
    const result = await promotions.grantPaid({
      account: BUYER, pluginIri: other, paymentReference: 'cs_test_secondplugin'
    })
    expect(result.created).toBe(true)
  })
})
