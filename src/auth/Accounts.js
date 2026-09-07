import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, insertDataQuery } from '../store/SPARQLHelper.js'
import GraphRegistry from '../store/GraphRegistry.js'
import URIMinter from '../rdf/URIMinter.js'

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
  constructor (client, { registry = new GraphRegistry(client), minter = new URIMinter() } = {}) {
    if (!client) throw new AccountError('Accounts needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
    this.graph = GraphRegistry.graphIri('system', 'accounts')
  }

  /**
   * Register the accounts graph, once, with its licence flag.
   *
   * Called at startup rather than at first sign-in: a graph holding personal
   * data that is not flagged as such is the one failure mode this design exists
   * to prevent, and it should not depend on somebody having signed in first.
   */
  async ensureGraph () {
    if (await this.registry.isRegistered('system', 'accounts')) return this.graph
    return this.registry.register({
      kind: 'system',
      id: 'accounts',
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
      await this.client.update(`
        DELETE { GRAPH ${iri(this.graph)} {
          ${s} ${iri(foaf + 'accountName')} ?login .
          ${s} ${iri(rdfs + 'label')} ?label .
          ${s} ${iri(foaf + 'depiction')} ?avatar .
          ${s} ${iri(pu + 'lastSeen')} ?seen .
        } }
        WHERE { GRAPH ${iri(this.graph)} {
          OPTIONAL { ${s} ${iri(foaf + 'accountName')} ?login }
          OPTIONAL { ${s} ${iri(rdfs + 'label')} ?label }
          OPTIONAL { ${s} ${iri(foaf + 'depiction')} ?avatar }
          OPTIONAL { ${s} ${iri(pu + 'lastSeen')} ?seen }
        } }`)
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
    const rows = await this.client.select(`
      SELECT ?login ?label ?trust ?tier ?suspended ?avatar ?githubId WHERE {
        GRAPH ${iri(this.graph)} {
          ${iri(accountIri)} ${iri(foaf + 'accountName')} ?login ;
                             ${iri(pu + 'githubId')} ?githubId .
          OPTIONAL { ${iri(accountIri)} ${iri(rdfs + 'label')} ?label }
          OPTIONAL { ${iri(accountIri)} ${iri(pu + 'trustLevel')} ?trust }
          OPTIONAL { ${iri(accountIri)} ${iri(pu + 'tier')} ?tier }
          OPTIONAL { ${iri(accountIri)} ${iri(pu + 'suspended')} ?suspended }
          OPTIONAL { ${iri(accountIri)} ${iri(foaf + 'depiction')} ?avatar }
        }
      } LIMIT 1`)
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
    await this.client.update(`
      DELETE WHERE { GRAPH ${iri(this.graph)} { ${iri(accountIri)} ?p ?o } }`)
    for (const suffix of ['facts', 'prose']) {
      const id = `${accountIri.split('/').pop()}-${suffix}`
      await this.registry.drop('user', id).catch(() => {})
    }
    return true
  }
}

export default Accounts
