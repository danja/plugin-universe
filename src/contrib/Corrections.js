import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, integer, insertDataQuery } from '../store/SPARQLHelper.js'
import GraphRegistry from '../store/GraphRegistry.js'
import URIMinter from '../rdf/URIMinter.js'
import { TRUST } from '../auth/Accounts.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'
import ensureContributorGraphs from './ContributorGraphs.js'
import { toKnownSpdx } from '../harvest/Licensing.js'
import QueryService from '../store/QueryService.js'

/**
 * Corrections: a person proposing that one fact about one plugin is wrong.
 *
 * The first write of catalogue data by someone other than a harvester, and it
 * is deliberately the narrowest possible one.
 *
 * **A correction is typed, not free text.** Subject, predicate, value. That is
 * what lets it be validated against the SHACL shapes before it is written and
 * applied mechanically once accepted — and it is what stops a contribution form
 * being a way to write arbitrary triples into the store.
 *
 * **The predicate is whitelisted.** Not every property is correctable by a
 * stranger: a category is, a licence flag on a graph is not. The list below is
 * the whole of what a contribution can touch, and it is short on purpose.
 *
 * **Accepting a correction does not overwrite anything.** The harvested
 * statement stays in its own graph; the correction lands in the contributor's
 * graph, and which one a reader sees is decided by source precedence. Nothing
 * is destroyed, so a rollback is a DROP rather than a repair.
 */

const pu = NAMESPACES.pu
const rdf = NAMESPACES.rdf
const rdfs = NAMESPACES.rdfs
const trn = NAMESPACES.trn
const prov = NAMESPACES.prov

export const STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected'
})

/**
 * The kinds of value a contributed field can hold.
 *
 * One list, exported, because three places have to agree about it: the checks
 * below, `SUBMITTABLE` in `Submissions.js`, and `render.js`, which picks the
 * HTML input type. A kind added to a field and not to this list is a value
 * that reaches the graph unchecked.
 *
 * - `text` — a string, length-limited and nothing more
 * - `url` — http or https, parsed
 * - `category` — a slug from the concept scheme
 * - `format` — a plugin format name
 * - `licence` — normalised through `toKnownSpdx`, and refused if unrecognised
 */
export const FIELD_KINDS = Object.freeze(['text', 'url', 'category', 'format', 'licence'])

/**
 * What a correction may touch.
 *
 * Each entry says what kind of value is expected, so the check happens once
 * here rather than in the form, the handler and the serialiser separately.
 */
export const CORRECTABLE = Object.freeze({
  [`${rdfs}label`]: { label: 'Name', kind: 'text' },
  [`${rdfs}comment`]: { label: 'Description', kind: 'text' },
  [`${trn}vendor`]: { label: 'Vendor', kind: 'text' },
  [`${NAMESPACES.foaf}homepage`]: { label: 'Homepage', kind: 'url' },
  [`${pu}category`]: { label: 'Category', kind: 'category' },
  [`${trn}format`]: { label: 'Format', kind: 'format' },
  // `licence`, not `text`: a correction goes through the same normalisation a
  // harvest does, so correcting GPLv3 to "gpl3" cannot split the facet.
  [`${pu}licenceId`]: { label: 'Licence', kind: 'licence' }
})

export class CorrectionError extends Error {
  constructor (message) {
    super(message)
    this.name = 'CorrectionError'
  }
}

/**
 * Check a submission before anything is written.
 *
 * Returns the normalised correction or throws. Every message here is shown to
 * the contributor, so each says what to do rather than what went wrong.
 */
export function validate ({ subject, predicate, value, rationale }) {
  if (!subject || !subject.startsWith(pu)) {
    throw new CorrectionError('That is not a plugin in this catalogue.')
  }
  const field = CORRECTABLE[predicate]
  if (!field) {
    throw new CorrectionError(
      `${predicate} cannot be corrected. Correctable: ` +
      Object.values(CORRECTABLE).map(f => f.label).join(', ') + '.'
    )
  }
  const trimmed = String(value ?? '').trim()
  if (!trimmed) throw new CorrectionError(`A proposed ${field.label.toLowerCase()} is needed.`)
  if (trimmed.length > CONTRIBUTION_CONFIG.maxValueLength) {
    throw new CorrectionError(`That is longer than ${CONTRIBUTION_CONFIG.maxValueLength} characters.`)
  }

  if (field.kind === 'url') {
    try {
      const url = new URL(trimmed)
      if (!/^https?:$/.test(url.protocol)) throw new Error('scheme')
    } catch {
      throw new CorrectionError('A homepage must be an http or https URL.')
    }
  }
  if (field.kind === 'category' && !/^[a-z0-9-]+$/.test(trimmed)) {
    throw new CorrectionError('A category is lowercase letters, digits and hyphens.')
  }
  if (field.kind === 'format' && !/^[A-Za-z0-9]+$/.test(trimmed)) {
    throw new CorrectionError('A format is a name like VST3, LV2 or CLAP.')
  }

  // A licence is normalised as well as checked, so a correction cannot be the
  // thing that puts a second spelling of GPL-3.0 into the catalogue.
  let proposed = trimmed
  if (field.kind === 'licence') {
    proposed = toKnownSpdx(trimmed)
    if (!proposed) {
      throw new CorrectionError(
        `"${trimmed}" is not a licence identifier the catalogue recognises. Use the SPDX form, such as GPL-3.0, MIT or Apache-2.0.`)
    }
  }

  const reason = String(rationale ?? '').trim()
  if (reason.length > CONTRIBUTION_CONFIG.maxRationaleLength) {
    throw new CorrectionError(`Please keep the reason under ${CONTRIBUTION_CONFIG.maxRationaleLength} characters.`)
  }

  return { subject, predicate, value: proposed, rationale: reason || null, kind: field.kind }
}

/** The object term a corrected value becomes, by kind. */
export function valueTerm (kind, value) {
  if (kind === 'url') return iri(value)
  if (kind === 'category') return iri(`${pu}category/${value}`)
  if (kind === 'format') return iri(`${trn}${value}`)
  return literal(value)
}

export class Corrections {
  constructor (client, {
    registry = new GraphRegistry(client), minter = new URIMinter(), graphId = 'corrections',
    queries = new QueryService()
  } = {}) {
    if (!client) throw new CorrectionError('Corrections needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
    this.queries = queries
    // Proposals live in the system graph with the accounts, because a pending
    // correction is about a person as much as about a plugin. Only an accepted
    // one reaches the contributor's public graph. The id is a parameter for the
    // same reason it is on Accounts: the queue holds a contributor's own words.
    this.graphId = graphId
    this.queueGraph = GraphRegistry.graphIri('system', graphId)
  }

  async ensureGraph () {
    if (await this.registry.isRegistered('system', this.graphId)) return this.queueGraph
    return this.registry.register({
      kind: 'system',
      id: this.graphId,
      // Proposals carry a contributor's identity and their words about why, so
      // the queue is personal data until a correction is accepted and its
      // factual part moves to a CC0 graph.
      licence: 'personal-data',
      derivedFrom: `${pu}corrections`,
      comment: 'Proposed corrections awaiting review, and the record of those decided.'
    })
  }

  /** The contributor's CC0 and CC BY-SA graphs, registered if new. */
  async ensureContributorGraphs (account) {
    return ensureContributorGraphs(this.registry, account)
  }

  /**
   * Submit a correction.
   *
   * A trusted contributor's correction is accepted on arrival; a new
   * contributor's waits for review. That threshold is the whole moderation
   * design — it is what makes the work bounded and shrinking rather than
   * constant.
   */
  async submit ({ account, subject, predicate, value, rationale, currentValue = null }, now = new Date()) {
    if (!account) throw new CorrectionError('Sign in to suggest a correction.')
    if (account.suspended) throw new CorrectionError('This account is suspended.')

    // Generous for a person, useless for a script. Counted from the store
    // rather than kept in memory, so it survives a restart and cannot be reset
    // by making the app forget.
    const recent = await this.recentCount(account.iri, now)
    if (recent >= CONTRIBUTION_CONFIG.perAccountPerHour) {
      throw new CorrectionError(
        `That is ${CONTRIBUTION_CONFIG.perAccountPerHour} suggestions in an hour, which is the limit. ` +
        'Please come back shortly.'
      )
    }

    const correction = validate({ subject, predicate, value, rationale })
    const trusted = account.trustLevel === TRUST.TRUSTED || account.trustLevel === TRUST.MODERATOR
    const status = trusted ? STATUS.ACCEPTED : STATUS.PENDING

    await this.ensureGraph()
    const node = this.minter.mint('correction', `${subject.split('/').pop()}-${now.getTime()}`,
      [account.iri, subject, predicate, String(now.getTime())])
    const s = iri(node)

    const triples = [
      `${s} ${iri(rdf + 'type')} ${iri(pu + 'Correction')} .`,
      `${s} ${iri(pu + 'correctionSubject')} ${iri(subject)} .`,
      `${s} ${iri(pu + 'correctionPredicate')} ${literal(predicate)} .`,
      `${s} ${iri(pu + 'proposedValue')} ${literal(correction.value)} .`,
      `${s} ${iri(pu + 'correctionStatus')} ${literal(status)} .`,
      `${s} ${iri(prov + 'wasAttributedTo')} ${iri(account.iri)} .`,
      `${s} ${iri(prov + 'generatedAtTime')} ${typedLiteral(now)} .`
    ]
    if (correction.rationale) triples.push(`${s} ${iri(pu + 'rationale')} ${literal(correction.rationale)} .`)
    if (currentValue) triples.push(`${s} ${iri(pu + 'currentValue')} ${literal(String(currentValue))} .`)

    await this.client.update(insertDataQuery(this.queueGraph, triples))

    if (status === STATUS.ACCEPTED) await this.apply(node, correction, account, now)
    return { iri: node, status, ...correction }
  }

  /**
   * Write an accepted correction into the contributor's CC0 graph.
   *
   * It does not touch the harvested statement. Both remain, in their own
   * graphs, and precedence decides which a reader sees — so accepting a
   * correction is additive and reverting it is a delete of one graph's worth.
   */
  async apply (correctionIri, correction, account, now = new Date()) {
    const graphs = await this.ensureContributorGraphs(account)
    const triples = [
      `${iri(correction.subject)} ${iri(correction.predicate)} ` +
      `${valueTerm(correction.kind, correction.value)} .`
    ]
    await this.client.update(insertDataQuery(graphs.facts, triples))
    await this.client.update(this.queries.get('contrib/correction-accept-on-arrival', {
      queueGraph: iri(this.queueGraph),
      correction: iri(correctionIri),
      status: literal(STATUS.ACCEPTED),
      at: typedLiteral(now)
    }))
    return graphs.facts
  }

  /** How many corrections this account has made in the last hour. */
  async recentCount (accountIri, now = new Date()) {
    const since = new Date(now.getTime() - 60 * 60 * 1000)
    const rows = await this.client.select(this.queries.get('contrib/correction-recent', {
      queueGraph: iri(this.queueGraph),
      account: iri(accountIri),
      since: typedLiteral(since)
    }))
    return Number(rows[0]?.n ?? 0)
  }

  /**
   * Accept or reject a pending correction.
   *
   * Accepting writes the fact into the contributor's CC0 graph and may promote
   * them: past the threshold their later corrections go live on arrival, which
   * is what makes the reviewer's work shrink rather than accumulate.
   *
   * Rejecting writes nothing to any public graph. The proposal stays in the
   * queue marked rejected, so the record of what was asked for and declined
   * survives — a queue that forgets its rejections invites the same suggestion
   * every week.
   */
  async review ({ correctionIri, moderator, accept, accounts }, now = new Date()) {
    if (!moderator || moderator.trustLevel !== TRUST.MODERATOR) {
      throw new CorrectionError('Only a moderator can review corrections.')
    }
    const rows = await this.client.select(this.queries.get('contrib/correction-pending-one', {
      queueGraph: iri(this.queueGraph),
      correction: iri(correctionIri),
      status: literal(STATUS.PENDING)
    }))
    const row = rows[0]
    if (!row) throw new CorrectionError('That correction is not pending; it may already have been decided.')

    if (!accept) {
      await this.#setStatus(correctionIri, STATUS.REJECTED, moderator, now)
      return { status: STATUS.REJECTED, promoted: false }
    }

    const contributor = await accounts.find(row.by)
    if (!contributor) throw new CorrectionError('The contributor no longer has an account.')

    // Re-validated on the way out as well as on the way in. The whitelist may
    // have changed since it was proposed, and an accepted correction writes
    // directly into a public graph.
    const validated = validate({
      subject: row.subject, predicate: row.predicate, value: row.value
    })
    await this.apply(correctionIri, validated, contributor, now)
    await this.#setStatus(correctionIri, STATUS.ACCEPTED, moderator, now)

    const promoted = await accounts.promoteIfEarned(
      contributor, await this.acceptedCount(contributor.iri))
    return { status: STATUS.ACCEPTED, promoted, contributor: contributor.login }
  }

  async #setStatus (correctionIri, status, moderator, now) {
    await this.client.update(this.queries.get('contrib/correction-set-status', {
      queueGraph: iri(this.queueGraph),
      correction: iri(correctionIri),
      status: literal(status),
      moderator: iri(moderator.iri),
      at: typedLiteral(now)
    }))
  }

  /** Corrections awaiting review, oldest first — a queue, not a list. */
  async pending (limit = 50) {
    return this.client.select(this.queries.get('contrib/corrections-pending', {
      queueGraph: iri(this.queueGraph),
      status: literal(STATUS.PENDING),
      limit: integer(limit)
    }))
  }

  /**
   * Everything one account has proposed, newest first.
   *
   * Their own contributions only. A pending correction is in the personal-data
   * graph and carries a person's own words about why they think something is
   * wrong; that is theirs to see, not a public record. What becomes public when
   * a correction is accepted is the fact, in their CC0 graph, attributed to
   * them — and that is already visible on the plugin page.
   */
  async byAccount (accountIri, limit = 100) {
    return this.client.select(this.queries.get('contrib/corrections-by-account', {
      queueGraph: iri(this.queueGraph),
      account: iri(accountIri),
      limit: integer(limit)
    }))
  }

  /** How many of this account's corrections have been accepted. */
  async acceptedCount (accountIri) {
    const rows = await this.client.select(this.queries.get('contrib/correction-accepted-count', {
      queueGraph: iri(this.queueGraph),
      account: iri(accountIri),
      status: literal(STATUS.ACCEPTED)
    }))
    return Number(rows[0]?.n ?? 0)
  }
}

export default Corrections
