import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, integer, insertDataQuery } from '../store/SPARQLHelper.js'
import GraphRegistry from '../store/GraphRegistry.js'
import URIMinter from '../rdf/URIMinter.js'
import QueryService from '../store/QueryService.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'

/**
 * People, in `<graph:system>`.
 *
 * That graph is registered under the `personal-data` licence, which is flagged
 * not redistributable — so accounts are excluded from every public dump by the
 * same query that excludes any other non-redistributable source. GDPR and
 * licensing end up using one mechanism rather than two, and erasure is a DROP.
 *
 * What is stored is exactly what the contributor terms say is stored: a GitHub
 * login and numeric id, a display name where one is public, a link to an avatar,
 * a trust level and a suspension flag. No email address, because the sign-in
 * cannot read one. No token, because it is discarded after identification.
 *
 * Trust is what makes moderation bounded: a new contributor's edits are queued,
 * and past a threshold they go live. The threshold is a number in
 * `config/preferences.js`, expected to be changed with evidence.
 */

const pu = NAMESPACES.pu
const rdf = NAMESPACES.rdf
const rdfs = NAMESPACES.rdfs
const foaf = NAMESPACES.foaf
const prov = NAMESPACES.prov

/** Trust levels, lowest first. A level is earned, never asserted by the user. */
export const TRUST = Object.freeze({
  NEW: 'new',
  TRUSTED: 'trusted',
  MODERATOR: 'moderator'
})

/** Tiers, from docs/architecture.md §7. */
export const TIER = Object.freeze({
  REGISTERED: 'registered',
  PRO: 'pro',
  ADMIN: 'admin'
})

export class AccountError extends Error {
  constructor (message) {
    super(message)
    this.name = 'AccountError'
  }
}

export class Accounts {
  constructor (client, {
    registry = new GraphRegistry(client), minter = new URIMinter(), graphId = 'accounts',
    queries = new QueryService()
  } = {}) {
    if (!client) throw new AccountError('Accounts needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
    this.queries = queries
    // The id is a parameter so a test can address its own graph. Personal data
    // is the one thing a test suite must not write into the live graph, and
    // "remember to clean up afterwards" is not a mechanism.
    this.graphId = graphId
    this.graph = GraphRegistry.graphIri('system', graphId)
  }

  /**
   * Register the accounts graph, once, with its licence flag.
   *
   * Called at startup rather than at first sign-in: a graph holding personal
   * data that is not flagged as such is the one failure mode this design exists
   * to prevent, and it should not depend on somebody having signed in first.
   */
  async ensureGraph () {
    if (await this.registry.isRegistered('system', this.graphId)) return this.graph
    return this.registry.register({
      kind: 'system',
      id: this.graphId,
      licence: 'personal-data',
      derivedFrom: `${pu}accounts`,
      comment: 'Registered accounts. Personal data: excluded from every public dump by its licence flag.'
    })
  }

  /** A stable IRI for a GitHub identity. */
  accountIri (githubId) {
    if (!githubId) throw new AccountError('An account needs a GitHub id')
    // Minted from the GitHub numeric id, which never changes — a login can be
    // renamed, and an account whose IRI moved when its owner renamed themselves
    // would orphan every contribution attributed to it.
    return this.minter.mint('person', `github-${githubId}`, [`github:${githubId}`])
  }

  /**
   * Create the account if it is new, refresh the public fields if not, and
   * return it either way.
   *
   * @param {object} identity - from GitHubOAuth.identify
   */
  async upsert (identity, now = new Date()) {
    const accountIri = this.accountIri(identity.githubId)
    const existing = await this.find(accountIri)

    const s = iri(accountIri)
    const triples = [
      `${s} ${iri(rdf + 'type')} ${iri(foaf + 'Person')} .`,
      `${s} ${iri(pu + 'githubId')} ${literal(identity.githubId)} .`,
      `${s} ${iri(foaf + 'accountName')} ${literal(identity.login)} .`,
      `${s} ${iri(rdfs + 'label')} ${literal(identity.name ?? identity.login)} .`,
      `${s} ${iri(pu + 'lastSeen')} ${typedLiteral(now)} .`
    ]
    if (identity.avatarUrl) triples.push(`${s} ${iri(foaf + 'depiction')} ${iri(identity.avatarUrl)} .`)

    if (existing) {
      // Refresh only what GitHub is authoritative for. Trust, tier and
      // suspension are this project's judgements and must survive a sign-in —
      // re-asserting them from the identity would let anyone reset their own
      // suspension by logging in again.
      await this.client.update(this.queries.get('account/refresh-identity', {
        graph: iri(this.graph),
        account: s
      }))
      await this.client.update(insertDataQuery(this.graph, triples))
      return { ...existing, ...identity, iri: accountIri }
    }

    triples.push(
      `${s} ${iri(pu + 'trustLevel')} ${literal(TRUST.NEW)} .`,
      `${s} ${iri(pu + 'tier')} ${literal(TIER.REGISTERED)} .`,
      `${s} ${iri(pu + 'suspended')} ${typedLiteral(false)} .`,
      `${s} ${iri(prov + 'generatedAtTime')} ${typedLiteral(now)} .`
    )
    await this.client.update(insertDataQuery(this.graph, triples))
    return {
      iri: accountIri,
      ...identity,
      trustLevel: TRUST.NEW,
      tier: TIER.REGISTERED,
      suspended: false
    }
  }

  /** One account, or null. */
  async find (accountIri) {
    const rows = await this.client.select(this.queries.get('account/find', {
      graph: iri(this.graph),
      account: iri(accountIri)
    }))
    const row = rows[0]
    if (!row) return null
    return {
      iri: accountIri,
      githubId: row.githubId,
      login: row.login,
      name: row.label ?? row.login,
      avatarUrl: row.avatar ?? null,
      trustLevel: row.trust ?? TRUST.NEW,
      tier: row.tier ?? TIER.REGISTERED,
      // SPARQL returns literals as strings; "false" is truthy.
      suspended: row.suspended === 'true'
    }
  }

  /**
   * Set a trust level, tier or suspension.
   *
   * Deliberately not something an account can do to itself: all three are
   * judgements this project makes about a person, and the only routes to them
   * are a moderator's decision or `bin/grant.js` run on the server.
   */
  async setTrust (accountIri, trustLevel) {
    if (!Object.values(TRUST).includes(trustLevel)) {
      throw new AccountError(`Unknown trust level "${trustLevel}". Known: ${Object.values(TRUST).join(', ')}`)
    }
    return this.#replace(accountIri, pu + 'trustLevel', literal(trustLevel))
  }

  async setTier (accountIri, tier) {
    if (!Object.values(TIER).includes(tier)) {
      throw new AccountError(`Unknown tier "${tier}". Known: ${Object.values(TIER).join(', ')}`)
    }
    return this.#replace(accountIri, pu + 'tier', literal(tier))
  }

  async setSuspended (accountIri, suspended) {
    return this.#replace(accountIri, pu + 'suspended', typedLiteral(Boolean(suspended)))
  }

  async #replace (accountIri, predicate, term) {
    await this.client.update(this.queries.get('account/replace-field', {
      graph: iri(this.graph),
      account: iri(accountIri),
      predicate: iri(predicate),
      value: term
    }))
    return true
  }

  /**
   * Promote a contributor who has earned it.
   *
   * The threshold is the whole moderation design: below it every contribution
   * is reviewed, above it they go live and the reviewer's work shrinks. This
   * has to be *called* for any of that to happen — until it was, nobody could
   * ever be promoted and the queue only grew.
   *
   * @returns {Promise<boolean>} whether the account was promoted just now
   */
  async promoteIfEarned (account, acceptedCount) {
    if (account.trustLevel !== TRUST.NEW) return false
    if (acceptedCount < CONTRIBUTION_CONFIG.acceptedBeforeTrusted) return false
    await this.setTrust(account.iri, TRUST.TRUSTED)
    return true
  }

  /** Everyone, for the moderation view. Small by construction for now. */
  async list (limit = 200) {
    const rows = await this.client.select(this.queries.get('account/list', {
      graph: iri(this.graph),
      limit: integer(limit)
    }))
    return Promise.all(rows.map(row => this.find(row.account)))
  }

  /**
   * Erase an account and everything attributed to it.
   *
   * The contributor terms promise this, and they also state its limit: a CC0
   * grant already made is irrevocable and anything already in a published dump
   * is beyond recall. What this does is remove the account and the attribution
   * from this catalogue, which is what can honestly be offered.
   */
  async erase (accountIri) {
    const account = await this.find(accountIri)
    if (!account) return false
    await this.client.update(this.queries.get('account/erase', {
      graph: iri(this.graph),
      account: iri(accountIri)
    }))
    for (const suffix of ['facts', 'prose']) {
      const id = `${accountIri.split('/').pop()}-${suffix}`
      await this.registry.drop('user', id).catch(() => {})
    }
    return true
  }
}

export default Accounts
