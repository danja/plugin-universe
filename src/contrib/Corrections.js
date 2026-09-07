import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, insertDataQuery } from '../store/SPARQLHelper.js'
import GraphRegistry from '../store/GraphRegistry.js'
import URIMinter from '../rdf/URIMinter.js'
import { TRUST } from '../auth/Accounts.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'

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
  [`${pu}licenceId`]: { label: 'Licence', kind: 'text' }
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

  const reason = String(rationale ?? '').trim()
  if (reason.length > CONTRIBUTION_CONFIG.maxRationaleLength) {
    throw new CorrectionError(`Please keep the reason under ${CONTRIBUTION_CONFIG.maxRationaleLength} characters.`)
  }

  return { subject, predicate, value: trimmed, rationale: reason || null, kind: field.kind }
}

/** The object term a corrected value becomes, by kind. */
export function valueTerm (kind, value) {
  if (kind === 'url') return iri(value)
  if (kind === 'category') return iri(`${pu}category/${value}`)
  if (kind === 'format') return iri(`${trn}${value}`)
  return literal(value)
}

export class Corrections {
  constructor (client, { registry = new GraphRegistry(client), minter = new URIMinter() } = {}) {
    if (!client) throw new CorrectionError('Corrections needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
    // Proposals live in the system graph with the accounts, because a pending
    // correction is about a person as much as about a plugin. Only an accepted
    // one reaches the contributor's public graph.
    this.queueGraph = GraphRegistry.graphIri('system', 'corrections')
  }

  async ensureGraph () {
    if (await this.registry.isRegistered('system', 'corrections')) return this.queueGraph
    return this.registry.register({
      kind: 'system',
      id: 'corrections',
      // Proposals carry a contributor's identity and their words about why, so
      // the queue is personal data until a correction is accepted and its
      // factual part moves to a CC0 graph.
      licence: 'personal-data',
      derivedFrom: `${pu}corrections`,
      comment: 'Proposed corrections awaiting review, and the record of those decided.'
    })
  }

  /**
   * The two graphs a contributor writes through.
   *
   * Facts under CC0 and prose under CC BY-SA, separately, so which licence
   * applies is decided by which graph a write goes to rather than by anyone
   * remembering. `GraphRegistry.graphIri` forbids a slash in an id, hence the
   * suffix rather than a path.
   */
  async ensureContributorGraphs (account) {
    const base = account.iri.split('/').pop()
    const graphs = {}
    for (const [kind, licence, what] of [
      ['facts', 'CC0-1.0', 'Factual contributions, dedicated to the public domain'],
      ['prose', 'CC-BY-SA-4.0', 'Authored prose, licensed share-alike with attribution']
    ]) {
      const id = `${base}-${kind}`
      graphs[kind] = await this.registry.isRegistered('user', id)
        ? GraphRegistry.graphIri('user', id)
        : await this.registry.register({
          kind: 'user',
          id,
          licence,
          derivedFrom: account.iri,
          comment: `${what} by ${account.login}.`
        })
    }
    return graphs
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
    await this.client.update(`
      DELETE { GRAPH ${iri(this.queueGraph)} { ${iri(correctionIri)} ${iri(pu + 'correctionStatus')} ?s } }
      INSERT { GRAPH ${iri(this.queueGraph)} {
        ${iri(correctionIri)} ${iri(pu + 'correctionStatus')} ${literal(STATUS.ACCEPTED)} ;
                              ${iri(pu + 'reviewedAt')} ${typedLiteral(now)} .
      } }
      WHERE { GRAPH ${iri(this.queueGraph)} { ${iri(correctionIri)} ${iri(pu + 'correctionStatus')} ?s } }`)
    return graphs.facts
  }

  /** Corrections awaiting review, oldest first — a queue, not a list. */
  async pending (limit = 50) {
    return this.client.select(`
      SELECT ?correction ?subject ?predicate ?value ?rationale ?by ?at WHERE {
        GRAPH ${iri(this.queueGraph)} {
          ?correction ${iri(pu + 'correctionStatus')} ${literal(STATUS.PENDING)} ;
                      ${iri(pu + 'correctionSubject')} ?subject ;
                      ${iri(pu + 'correctionPredicate')} ?predicate ;
                      ${iri(pu + 'proposedValue')} ?value ;
                      ${iri(prov + 'wasAttributedTo')} ?by ;
                      ${iri(prov + 'generatedAtTime')} ?at .
          OPTIONAL { ?correction ${iri(pu + 'rationale')} ?rationale }
        }
      } ORDER BY ?at LIMIT ${Number(limit)}`)
  }

  /** How many of this account's corrections have been accepted. */
  async acceptedCount (accountIri) {
    const rows = await this.client.select(`
      SELECT (COUNT(*) AS ?n) WHERE {
        GRAPH ${iri(this.queueGraph)} {
          ?c ${iri(prov + 'wasAttributedTo')} ${iri(accountIri)} ;
             ${iri(pu + 'correctionStatus')} ${literal(STATUS.ACCEPTED)} .
        }
      }`)
    return Number(rows[0]?.n ?? 0)
  }
}

export default Corrections
