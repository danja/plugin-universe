import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, insertDataQuery } from '../store/SPARQLHelper.js'
import GraphRegistry from '../store/GraphRegistry.js'
import URIMinter from '../rdf/URIMinter.js'
import { TRUST } from '../auth/Accounts.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'
import ensureContributorGraphs from './ContributorGraphs.js'
import QueryService from '../store/QueryService.js'
import { STATUS } from './Corrections.js'
import {
  SUBMITTABLE, SubmissionError, validate, valueTerm
} from './submittable.js'

// The field table, its vocabulary composition and its checking moved to
// `./submittable.js` when this file passed 750 lines with two reasons to
// change. Re-exported here, so none of the dozen importers move: a split
// that edits its callers is a rewrite wearing a refactor's clothes.
export {
  SUBMITTABLE, SubmissionError, validate, valueTerm,
  PLUGIN_FORMATS, withProfileVocabulary, loadSubmittable, profileLabels
} from './submittable.js'

const pu = NAMESPACES.pu
const rdf = NAMESPACES.rdf
const trn = NAMESPACES.trn
const prov = NAMESPACES.prov

/**
 * Submissions: a person proposing a plugin the catalogue does not have.
 *
 * Corrections were the narrowest possible first write by a stranger — one fact
 * about one plugin. This is the next one out, and it is deliberately shaped the
 * same way rather than as a general "write some RDF" form.
 *
 * **The homepage is the identity, and that is why it is required.** A harvester
 * identifies a plugin by its bundle name and class id, or by its own canonical
 * IRI; a person has neither. What a person does have is the address of the
 * project, and it is stable in the way a name is not — two plugins called
 * "Reverb" are common, two at the same URL are the same plugin. Minting from it
 * means a duplicate submission collides with the original instead of quietly
 * becoming a second record of one thing, which is the failure `IngestPipeline`
 * refuses for harvesters and which a form would otherwise reintroduce.
 *
 * **A submission is reviewed whole.** A correction can be accepted on its own
 * because the plugin already exists; a plugin needs a name to exist at all, so
 * half of one is a record nothing can display. The proposed fields therefore
 * live on the submission until it is accepted, and only then are they written
 * into the contributor's CC0 graph.
 *
 * **Nothing unreviewed reaches a public graph.** Until a moderator accepts —
 * or the contributor is trusted, which is the same promotion corrections use —
 * the proposal is a record in the queue and the catalogue does not have it.
 */

export class Submissions {
  constructor (client, {
    registry = new GraphRegistry(client),
    minter = new URIMinter(),
    validator = null,
    // The field table with profile choices filled in. Defaults to the bare one,
    // which cannot check a profile term and says so.
    submittable = SUBMITTABLE,
    queries = new QueryService(),
    queueGraph = GraphRegistry.graphIri('system', 'submissions')
  } = {}) {
    if (!client) throw new SubmissionError('Submissions needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
    // The SHACL shapes, when the caller supplies them. A submission is checked
    // against the same shapes a harvest is, because a plugin a person typed is
    // not a different kind of plugin.
    this.validator = validator
    this.queries = queries
    this.submittable = submittable
    this.queueGraph = queueGraph
  }

  async ensureGraph () {
    if (await this.registry.isRegistered('system', 'submissions')) return this.queueGraph
    return this.registry.register({
      kind: 'system',
      id: 'submissions',
      // The same flag the corrections queue carries, and for the same reason: a
      // proposal names the person who made it, so the queue is personal data
      // until it is accepted and its factual part moves to a CC0 graph.
      licence: 'personal-data',
      derivedFrom: `${pu}submissions`,
      comment: 'Proposed plugins, pending review. Not catalogue data until accepted.'
    })
  }

  /** The IRI this submission will mint, so a duplicate can be found before writing. */
  pluginIriFor (fields) {
    return this.minter.mintPlugin({
      name: fields.name,
      vendor: fields.vendor,
      // The homepage stands in for a canonical source IRI. It is the only
      // stable identifier a person can supply, and hashing it is what makes
      // two submissions of one plugin collide rather than duplicate.
      sourceIri: fields.homepage
    })
  }

  /** Whether the catalogue already holds a plugin at this IRI. */
  async exists (pluginIri) {
    const rows = await this.client.select(
      this.queries.get('contrib/plugin-exists', { plugin: iri(pluginIri) }))
    return rows.length > 0
  }

  /** The triples an accepted submission becomes. */
  triplesFor (pluginIri, fields, now) {
    const s = iri(pluginIri)
    const triples = [
      `${s} ${iri(rdf + 'type')} ${iri(trn + 'PluginProfile')} .`,
      // First seen now, because this is when the catalogue first saw it. A
      // re-harvest preserves this; nothing else writes it again.
      `${s} ${iri(NAMESPACES.dcterms + 'created')} ${typedLiteral(now)} .`
    ]
    for (const [key, spec] of Object.entries(this.submittable)) {
      if (!fields[key]) continue
      for (const value of [fields[key]].flat()) {
        triples.push(`${s} ${iri(spec.predicate)} ${valueTerm(spec.kind, value)} .`)
      }
    }
    return triples
  }

  /**
   * Propose a plugin.
   *
   * Order matters here: validate, mint, check for a duplicate, check the
   * shapes, and only then write. Each of those can refuse, and refusing before
   * anything is written is what makes a failed submission leave no trace.
   */
  async submit ({ account, fields }, now = new Date()) {
    if (!account) throw new SubmissionError('Sign in to submit a plugin.')
    if (account.suspended) throw new SubmissionError('This account is suspended.')

    const recent = await this.recentCount(account.iri, now)
    if (recent >= CONTRIBUTION_CONFIG.perAccountPerHour) {
      throw new SubmissionError(
        `That is ${CONTRIBUTION_CONFIG.perAccountPerHour} contributions in an hour, which is the limit. ` +
        'Please come back shortly.')
    }

    const clean = validate(fields, this.submittable)
    const pluginIri = this.pluginIriFor(clean)

    if (await this.exists(pluginIri)) {
      throw new SubmissionError(
        'The catalogue already has this plugin — the name, vendor and homepage match one it holds.',
        { existing: pluginIri })
    }
    const queued = await this.pendingFor(pluginIri)
    if (queued) {
      throw new SubmissionError(
        'Somebody has already proposed this plugin and it is waiting to be reviewed.',
        { existing: pluginIri })
    }

    const triples = this.triplesFor(pluginIri, clean, now)
    if (this.validator) {
      const report = await this.validator.validateTriples(triples)
      if (!report.conforms) {
        throw new SubmissionError(
          `That does not make a valid plugin record: ${report.results[0].message}`)
      }
    }

    await this.ensureGraph()
    const trusted = account.trustLevel === TRUST.TRUSTED || account.trustLevel === TRUST.MODERATOR
    const status = trusted ? STATUS.ACCEPTED : STATUS.PENDING
    const node = this.minter.mint('correction', `submission-${now.getTime()}`,
      [account.iri, pluginIri, String(now.getTime())])
    const q = iri(node)

    const record = [
      `${q} ${iri(rdf + 'type')} ${iri(pu + 'Submission')} .`,
      `${q} ${iri(pu + 'proposedPlugin')} ${iri(pluginIri)} .`,
      `${q} ${iri(pu + 'submissionStatus')} ${literal(status)} .`,
      `${q} ${iri(prov + 'wasAttributedTo')} ${iri(account.iri)} .`,
      `${q} ${iri(prov + 'generatedAtTime')} ${typedLiteral(now)} .`
    ]
    for (const [key, spec] of Object.entries(this.submittable)) {
      if (!clean[key]) continue
      // One node per value, not per field: a plugin built for VST3 and LV2 is
      // two proposed formats, and a single node would have kept whichever was
      // written last.
      for (const [index, value] of [clean[key]].flat().entries()) {
        const field = `_:f${key}${index}`
        record.push(
          `${q} ${iri(pu + 'proposedField')} ${field} .`,
          `${field} ${iri(pu + 'fieldPredicate')} ${literal(spec.predicate)} .`,
          `${field} ${iri(pu + 'fieldValue')} ${literal(value)} .`)
      }
    }
    // One request: the blank nodes above are scoped to it, and splitting them
    // across two would leave half a submission with no fields.
    await this.client.update(insertDataQuery(this.queueGraph, record))

    if (status === STATUS.ACCEPTED) await this.apply(node, pluginIri, clean, account, now)
    return { iri: node, plugin: pluginIri, status, fields: clean }
  }

  /**
   * Write an accepted submission into the contributor's CC0 graph.
   *
   * The plugin becomes catalogue data at this moment and not before. It lands
   * in the contributor's own graph, so withdrawing it later is a DROP of one
   * graph rather than a repair of the catalogue.
   */
  async apply (submissionIri, pluginIri, fields, account, now = new Date()) {
    const graphs = await ensureContributorGraphs(this.registry, account)
    await this.client.update(
      insertDataQuery(graphs.facts, this.triplesFor(pluginIri, fields, now)))
    return graphs.facts
  }

  /** Submissions by this account in the last hour, counted from the store. */
  async recentCount (accountIri, now = new Date()) {
    const since = new Date(now.getTime() - 3600000)
    const rows = await this.client.select(this.queries.get('contrib/submission-recent', {
      queueGraph: iri(this.queueGraph),
      account: iri(accountIri),
      since: typedLiteral(since)
    }))
    return rows.length
  }

  /**
   * Proposed plugins awaiting review, oldest first, grouped one per submission.
   *
   * SPARQL returns a row per proposed field; a submission is reviewed whole, so
   * the rows are folded back into one record here rather than shown as several
   * things a moderator could decide separately.
   */
  async pending (limit = 50) {
    const rows = await this.client.select(this.queries.get('contrib/submissions-pending', {
      queueGraph: iri(this.queueGraph),
      status: literal(STATUS.PENDING)
    }))
    const byIri = new Map()
    for (const row of rows) {
      if (!byIri.has(row.submission)) {
        byIri.set(row.submission, {
          submission: row.submission, plugin: row.plugin, by: row.by, at: row.at, fields: {}
        })
      }
      const key = Object.keys(this.submittable).find(name => this.submittable[name].predicate === row.predicate)
      if (!key) continue
      const record = byIri.get(row.submission).fields
      if (SUBMITTABLE[key].multiple) (record[key] ??= []).push(row.value)
      else record[key] = row.value
    }
    return [...byIri.values()].slice(0, limit)
  }

  /**
   * Accept or reject a proposed plugin.
   *
   * Accepting re-validates rather than trusting what was stored: the whitelist
   * may have changed since it was proposed, and this writes into a public
   * graph. A rejection writes nothing anywhere — the proposal was never in the
   * catalogue to begin with, which is the advantage of holding the fields on
   * the submission rather than writing them provisionally.
   */
  async review ({ submissionIri, moderator, accept, accounts }, now = new Date()) {
    if (!moderator || moderator.trustLevel !== TRUST.MODERATOR) {
      throw new SubmissionError('Only a moderator can review submissions.')
    }
    const rows = await this.client.select(this.queries.get('contrib/submission-fields', {
      queueGraph: iri(this.queueGraph),
      submission: iri(submissionIri),
      status: literal(STATUS.PENDING)
    }))
    if (rows.length === 0) {
      throw new SubmissionError('That submission is not pending; it may already have been decided.')
    }

    if (!accept) {
      await this.#setStatus(submissionIri, STATUS.REJECTED, moderator, now)
      return { status: STATUS.REJECTED, promoted: false }
    }

    const contributor = await accounts.find(rows[0].by)
    if (!contributor) throw new SubmissionError('The contributor no longer has an account.')

    const fields = {}
    for (const row of rows) {
      const key = Object.keys(this.submittable).find(name => this.submittable[name].predicate === row.predicate)
      if (!key) continue
      if (SUBMITTABLE[key].multiple) (fields[key] ??= []).push(row.value)
      else fields[key] = row.value
    }
    const clean = validate(fields, this.submittable)
    const pluginIri = rows[0].plugin

    // Checked again here as well as at submission: time has passed, and the
    // catalogue may have harvested the same plugin in between.
    if (await this.exists(pluginIri)) {
      await this.#setStatus(submissionIri, STATUS.REJECTED, moderator, now)
      throw new SubmissionError(
        'The catalogue has acquired this plugin since it was proposed, so the submission has been closed.',
        { existing: pluginIri })
    }

    await this.apply(submissionIri, pluginIri, clean, contributor, now)
    await this.#setStatus(submissionIri, STATUS.ACCEPTED, moderator, now)

    const promoted = await accounts.promoteIfEarned(
      contributor, await this.acceptedCount(contributor.iri))
    return { status: STATUS.ACCEPTED, promoted, contributor: contributor.login, plugin: pluginIri }
  }

  async #setStatus (submissionIri, status, moderator, now) {
    await this.client.update(this.queries.get('contrib/submission-set-status', {
      queueGraph: iri(this.queueGraph),
      submission: iri(submissionIri),
      status: literal(status),
      moderator: iri(moderator.iri),
      at: typedLiteral(now)
    }))
  }

  /** How many of this account's submissions have been accepted. */
  async acceptedCount (accountIri) {
    const rows = await this.client.select(this.queries.get('contrib/submission-accepted-count', {
      queueGraph: iri(this.queueGraph),
      account: iri(accountIri),
      status: literal(STATUS.ACCEPTED)
    }))
    return rows.length
  }

  /** The pending submission for a plugin IRI, if there is one. */
  async pendingFor (pluginIri) {
    const rows = await this.client.select(this.queries.get('contrib/submission-pending-for', {
      queueGraph: iri(this.queueGraph),
      plugin: iri(pluginIri),
      status: literal(STATUS.PENDING)
    }))
    return rows[0]?.submission ?? null
  }
}

export default Submissions
