import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, integer, insertDataQuery } from '../store/SPARQLHelper.js'
import GraphRegistry from '../store/GraphRegistry.js'
import QueryService from '../store/QueryService.js'
import URIMinter from '../rdf/URIMinter.js'
import { TRUST } from '../auth/Accounts.js'
import { PROMOTION_CONFIG } from '../../config/preferences.js'

/**
 * Paid placement: the records, not the ranking.
 *
 * A promotion is a resource with its own IRI — `docs/architecture.md` §7 is
 * explicit that this is what makes a public ad repository a query rather than a
 * feature somebody has to build later.
 *
 * **One predicate decides everything.** A placement is live when
 * `pu:startedAt <= now < pu:endsAt`, and that is the whole rule. Expiry and
 * revocation are the same fact — the placement stops at a moment — so ending
 * one early writes a new `pu:endsAt` rather than setting a second flag that
 * could fall out of step with the dates. There is no swept "active" column to
 * go stale, and the comparison happens at query time, so a term that ran out
 * stops applying whether or not any job ran. For something that is paid for,
 * that is the right direction to fail in.
 *
 * **Nothing is ever deleted.** A record of a placement that has been taken down
 * is exactly what an ad repository is asked for, and the audit of who placed it
 * outlives the placement.
 *
 * The ranking effect lives in `SearchService`, where the scores are. This file
 * knows who is promoted and until when; it has no opinion about search.
 */

const pu = NAMESPACES.pu
const rdf = NAMESPACES.rdf
const prov = NAMESPACES.prov

export class PromotionError extends Error {
  constructor (message) {
    super(message)
    this.name = 'PromotionError'
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/** When a placement started now would lapse. */
export function termEnd (from, days = PROMOTION_CONFIG.termDays) {
  return new Date(from.getTime() + days * DAY_MS)
}

/**
 * Is this placement live at a given moment?
 *
 * Exported and pure, because it is asserted in three places — the ranking path,
 * the admin list and the plugin page — and three copies of a date comparison is
 * three chances to get an inclusive bound wrong.
 *
 * The start is inclusive and the end is not: a placement that ends at noon is
 * not running at noon. That also makes "revoke" mean "stop now" exactly, with
 * no final instant in which the placement is both revoked and live.
 */
export function isLive ({ startedAt, endsAt }, now = new Date()) {
  const at = now.getTime()
  return new Date(startedAt).getTime() <= at && new Date(endsAt).getTime() > at
}

/** Days until a placement lapses; negative once it has. */
export function daysRemaining ({ endsAt }, now = new Date()) {
  return Math.ceil((new Date(endsAt).getTime() - now.getTime()) / DAY_MS)
}

export class Promotions {
  constructor (client, {
    registry = new GraphRegistry(client), minter = new URIMinter(),
    queries = new QueryService(), graphId = 'promotions'
  } = {}) {
    if (!client) throw new PromotionError('Promotions needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
    this.queries = queries
    this.graphId = graphId
    this.graph = GraphRegistry.graphIri('system', graphId)
  }

  async ensureGraph () {
    if (await this.registry.isRegistered('system', this.graphId)) return this.graph
    return this.registry.register({
      kind: 'system',
      id: this.graphId,
      // Personal data, because every record names the moderator who placed it,
      // and later the account that paid. The disclosure the law asks for is the
      // label on the result and the ad repository at /about/promotion, neither
      // of which needs a moderator's identity in a public dump.
      licence: 'personal-data',
      derivedFrom: `${pu}promotions`,
      comment: 'Paid placements: what was promoted, by whom, from when, until when.'
    })
  }

  /** A moderator, or an error naming what is required. */
  #requireModerator (moderator) {
    if (!moderator || moderator.trustLevel !== TRUST.MODERATOR) {
      throw new PromotionError('Only a moderator can change a promotion.')
    }
  }

  /**
   * Promote a plugin for the standard term.
   *
   * Promoting something already promoted is not an error and not an extension:
   * it reports the placement that is already running. Extending by pressing a
   * button twice is the kind of thing nobody means to do.
   */
  async promote ({ moderator, pluginIri, paidBy = null }, now = new Date()) {
    this.#requireModerator(moderator)
    if (!pluginIri) throw new PromotionError('Which plugin?')

    const existing = await this.forPlugin(pluginIri, now)
    if (existing) {
      return { promotion: existing.promotion, created: false, endsAt: existing.endsAt }
    }

    await this.ensureGraph()
    const endsAt = termEnd(now)
    const node = this.minter.mint('promotion', `${pluginIri.split('/').pop()}-${now.getTime()}`,
      [pluginIri, moderator.iri, String(now.getTime())])
    const s = iri(node)

    const triples = [
      `${s} ${iri(rdf + 'type')} ${iri(pu + 'Promotion')} .`,
      `${s} ${iri(pu + 'promotes')} ${iri(pluginIri)} .`,
      `${s} ${iri(pu + 'startedAt')} ${typedLiteral(now)} .`,
      `${s} ${iri(pu + 'endsAt')} ${typedLiteral(endsAt)} .`,
      `${s} ${iri(prov + 'wasAttributedTo')} ${iri(moderator.iri)} .`
    ]
    if (paidBy) triples.push(`${s} ${iri(pu + 'paidBy')} ${iri(paidBy)} .`)

    await this.client.update(insertDataQuery(this.graph, triples))
    return { promotion: node, created: true, endsAt: endsAt.toISOString() }
  }

  /**
   * Grant a placement that has been paid for.
   *
   * **Only ever called from a verified Stripe webhook.** `promote()` requires a
   * moderator because a moderator is who authorises a free placement; a paid
   * one is authorised by the payment, and there is no moderator in the room
   * when Stripe delivers the event. So this is a second door, and what makes it
   * safe is that the only thing holding the key is
   * `Billing.verifyWebhook()` — an unsigned or wrongly-signed delivery never
   * reaches here.
   *
   * Attribution goes to the buyer's account rather than to nobody: they caused
   * it, and `prov:wasAttributedTo` is required by the shape precisely so that
   * every placement can be traced to somebody.
   *
   * **Idempotent twice over**, because a webhook is delivered at least once and
   * sometimes more. A plugin already promoted returns the existing placement
   * untouched — pressing a button twice must not buy two years — and the
   * payment reference is recorded, so a replay of the *same* payment is
   * distinguishable from a genuine second purchase.
   *
   * @param {object} options
   * @param {object} options.account - the buyer's account, `{ iri }`
   * @param {string} options.pluginIri
   * @param {string} options.paymentReference - the Stripe Checkout Session id
   */
  async grantPaid ({ account, pluginIri, paymentReference }, now = new Date()) {
    if (!account?.iri) throw new PromotionError('A paid placement needs the buying account.')
    if (!pluginIri) throw new PromotionError('Which plugin?')
    if (!/^cs_[A-Za-z0-9_]+$/.test(String(paymentReference ?? ''))) {
      // Not cosmetic. This value is the only evidence that money changed hands,
      // and the shape refuses anything that is not a session id — so catching
      // it here gives a better error than a SHACL violation three steps later.
      throw new PromotionError(
        `"${paymentReference}" is not a Stripe Checkout Session id. A placement is only granted against a payment.`)
    }

    const existing = await this.forPlugin(pluginIri, now)
    if (existing) {
      return { promotion: existing.promotion, created: false, endsAt: existing.endsAt }
    }

    await this.ensureGraph()
    const endsAt = termEnd(now)
    const node = this.minter.mint('promotion', `${pluginIri.split('/').pop()}-${now.getTime()}`,
      [pluginIri, account.iri, paymentReference])
    const s = iri(node)

    await this.client.update(insertDataQuery(this.graph, [
      `${s} ${iri(rdf + 'type')} ${iri(pu + 'Promotion')} .`,
      `${s} ${iri(pu + 'promotes')} ${iri(pluginIri)} .`,
      `${s} ${iri(pu + 'startedAt')} ${typedLiteral(now)} .`,
      `${s} ${iri(pu + 'endsAt')} ${typedLiteral(endsAt)} .`,
      `${s} ${iri(prov + 'wasAttributedTo')} ${iri(account.iri)} .`,
      `${s} ${iri(pu + 'paidBy')} ${iri(account.iri)} .`,
      `${s} ${iri(pu + 'paymentReference')} ${literal(paymentReference)} .`
    ]))
    return { promotion: node, created: true, endsAt: endsAt.toISOString() }
  }

  /** The placement bought by one payment, if that payment has been fulfilled. */
  async forPayment (paymentReference) {
    const rows = await this.client.select(this.queries.get('promotion/for-payment', {
      graph: iri(this.graph),
      reference: literal(paymentReference)
    }))
    return rows[0] ?? null
  }

  /**
   * End a plugin's live placement now.
   *
   * Ending something that is not running is a no-op rather than an error: the
   * moderator wanted it not promoted, and it is not promoted.
   */
  async unpromote ({ moderator, pluginIri }, now = new Date()) {
    this.#requireModerator(moderator)
    const existing = await this.forPlugin(pluginIri, now)
    if (!existing) return { ended: false }

    await this.client.update(this.queries.get('promotion/end', {
      graph: iri(this.graph),
      promotion: iri(existing.promotion),
      at: typedLiteral(now),
      moderator: iri(moderator.iri)
    }))
    return { ended: true, promotion: existing.promotion }
  }

  /** The live placement on one plugin, or null. */
  async forPlugin (pluginIri, now = new Date()) {
    const rows = await this.client.select(this.queries.get('promotion/for-plugin', {
      graph: iri(this.graph),
      plugin: iri(pluginIri),
      at: typedLiteral(now)
    }))
    return rows[0] ?? null
  }

  /**
   * Every live placement, as a map from plugin IRI to its record.
   *
   * A map because the ranking path asks "is this one promoted" once per
   * candidate document, and that must not be a query.
   */
  async active (now = new Date()) {
    const rows = await this.client.select(this.queries.get('promotion/active', {
      graph: iri(this.graph),
      at: typedLiteral(now)
    }))
    return new Map(rows.map(row => [row.plugin, row]))
  }

  /**
   * Every placement ever made, newest first. The ad repository.
   */
  async all (limit = 500) {
    return this.client.select(this.queries.get('promotion/all', {
      graph: iri(this.graph),
      limit: integer(limit)
    }))
  }

  /**
   * Live placements lapsing within the warning window, soonest first.
   *
   * The tool that stops a renewal conversation happening after the fact. It is
   * a filter over `active()` rather than its own query — the expiry rule is one
   * comparison and it should have one implementation.
   */
  async expiringSoon (now = new Date(), withinDays = PROMOTION_CONFIG.expiringWithinDays) {
    const rows = [...(await this.active(now)).values()]
    return rows
      .map(row => ({ ...row, daysRemaining: daysRemaining(row, now) }))
      .filter(row => row.daysRemaining <= withinDays)
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
  }
}

export default Promotions
