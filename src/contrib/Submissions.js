import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, insertDataQuery } from '../store/SPARQLHelper.js'
import GraphRegistry from '../store/GraphRegistry.js'
import URIMinter from '../rdf/URIMinter.js'
import { TRUST } from '../auth/Accounts.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'
import ensureContributorGraphs from './ContributorGraphs.js'
import QueryService from '../store/QueryService.js'
import { STATUS } from './Corrections.js'

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

const pu = NAMESPACES.pu
const rdf = NAMESPACES.rdf
const rdfs = NAMESPACES.rdfs
const trn = NAMESPACES.trn
const foaf = NAMESPACES.foaf
const prov = NAMESPACES.prov

export class SubmissionError extends Error {
  constructor (message, { existing = null } = {}) {
    super(message)
    this.name = 'SubmissionError'
    // The plugin this submission turned out to duplicate, so the caller can
    // link to it rather than only saying no.
    this.existing = existing
  }
}

/**
 * What a person may state about a plugin they are proposing.
 *
 * Shorter than what a harvester writes, on purpose. Everything here is either
 * needed to identify the plugin, needed to display it, or a facet without which
 * it would be invisible to every filter on the site. Measurements, releases,
 * checksums and parameters are not on this list: those are things the catalogue
 * finds out, not things it is told.
 */
export const SUBMITTABLE = Object.freeze({
  name: {
    predicate: `${rdfs}label`, label: 'Name', kind: 'text', required: true,
    help: 'The name as its author writes it.'
  },
  homepage: {
    predicate: `${foaf}homepage`, label: 'Homepage', kind: 'url', required: true,
    help: 'The project page. This is what identifies the plugin, so it has to be the real one.'
  },
  vendor: {
    predicate: `${trn}vendor`, label: 'Vendor', kind: 'text', required: true,
    help: 'Who makes it — a person or a company.'
  },
  description: {
    predicate: `${rdfs}comment`, label: 'Description', kind: 'text', required: false,
    help: 'What it does, in a sentence or two.'
  },
  format: {
    predicate: `${trn}format`, label: 'Format', kind: 'format', required: true,
    help: 'VST3, LV2, CLAP, AudioUnit, VST2, AAX or Standalone.'
  },
  category: {
    predicate: `${pu}category`, label: 'Category', kind: 'category', required: false,
    help: 'One of the catalogue\'s categories, such as reverb or synth.'
  },
  licenceId: {
    predicate: `${pu}licenceId`, label: 'Licence', kind: 'text', required: false,
    help: 'An SPDX identifier such as GPL-3.0 or MIT, if you know it.'
  }
})

/** The object term a submitted value becomes, by kind. */
export function valueTerm (kind, value) {
  if (kind === 'url') return iri(value)
  if (kind === 'category') return iri(`${pu}category/${value}`)
  if (kind === 'format') return iri(`${trn}${value}`)
  return literal(value)
}

/**
 * Check a submission before anything is minted or written.
 *
 * Every message is shown to the person who typed it, so each says what to do
 * rather than what went wrong.
 */
export function validate (fields = {}) {
  const clean = {}
  for (const [key, spec] of Object.entries(SUBMITTABLE)) {
    const raw = String(fields[key] ?? '').trim()
    if (!raw) {
      if (spec.required) throw new SubmissionError(`${spec.label} is needed. ${spec.help}`)
      continue
    }
    if (raw.length > CONTRIBUTION_CONFIG.maxValueLength) {
      throw new SubmissionError(`${spec.label} is longer than ${CONTRIBUTION_CONFIG.maxValueLength} characters.`)
    }
    if (spec.kind === 'url') {
      let url
      try {
        url = new URL(raw)
      } catch {
        throw new SubmissionError(`${spec.label} must be a full URL, starting http:// or https://.`)
      }
      if (!/^https?:$/.test(url.protocol)) {
        throw new SubmissionError(`${spec.label} must be an http or https URL.`)
      }
    }
    if (spec.kind === 'category' && !/^[a-z0-9-]+$/.test(raw)) {
      throw new SubmissionError('A category is lowercase letters, digits and hyphens, like "reverb".')
    }
    if (spec.kind === 'format' && !/^[A-Za-z0-9]+$/.test(raw)) {
      throw new SubmissionError('A format is a name like VST3, LV2 or CLAP.')
    }
    clean[key] = raw
  }
  return clean
}

export class Submissions {
  constructor (client, {
    registry = new GraphRegistry(client),
    minter = new URIMinter(),
    validator = null,
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
    for (const [key, spec] of Object.entries(SUBMITTABLE)) {
      if (!fields[key]) continue
      triples.push(`${s} ${iri(spec.predicate)} ${valueTerm(spec.kind, fields[key])} .`)
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

    const clean = validate(fields)
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
    for (const [key, spec] of Object.entries(SUBMITTABLE)) {
      if (!clean[key]) continue
      const field = `_:f${key}`
      record.push(
        `${q} ${iri(pu + 'proposedField')} ${field} .`,
        `${field} ${iri(pu + 'fieldPredicate')} ${literal(spec.predicate)} .`,
        `${field} ${iri(pu + 'fieldValue')} ${literal(clean[key])} .`)
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
      const key = Object.keys(SUBMITTABLE).find(name => SUBMITTABLE[name].predicate === row.predicate)
      if (key) byIri.get(row.submission).fields[key] = row.value
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
      const key = Object.keys(SUBMITTABLE).find(name => SUBMITTABLE[name].predicate === row.predicate)
      if (key) fields[key] = row.value
    }
    const clean = validate(fields)
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
    await this.client.update(
      `DELETE { GRAPH ${iri(this.queueGraph)} { ${iri(submissionIri)} ${iri(pu + 'submissionStatus')} ?old } }
       INSERT { GRAPH ${iri(this.queueGraph)} {
         ${iri(submissionIri)} ${iri(pu + 'submissionStatus')} ${literal(status)} ;
                               ${iri(pu + 'reviewedBy')} ${iri(moderator.iri)} ;
                               ${iri(pu + 'reviewedAt')} ${typedLiteral(now)} .
       } }
       WHERE { GRAPH ${iri(this.queueGraph)} { ${iri(submissionIri)} ${iri(pu + 'submissionStatus')} ?old } }`)
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
