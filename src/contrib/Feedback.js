import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, integer, insertDataQuery } from '../store/SPARQLHelper.js'
import GraphRegistry from '../store/GraphRegistry.js'
import URIMinter from '../rdf/URIMinter.js'
import QueryService from '../store/QueryService.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'

/**
 * A message to the moderators, from somebody signed in.
 *
 * Stored the way a correction is — an RDF record in a named graph, attributed
 * with `prov:`, queued for a moderator — and licensed the way an account is,
 * which is the one place it deliberately parts company with every other thing a
 * person can write on this site.
 *
 * **Feedback is correspondence, not a contribution.** A correction, a
 * submission and a wiki revision are offers of material for the catalogue, and
 * each lands in a graph carrying a publication licence: CC0 for facts, CC BY-SA
 * for prose. Somebody writing to say the search is confusing has agreed to
 * neither. So this goes in a `personal-data` system graph beside the accounts,
 * which means the public dump excludes it by the same query that already
 * excludes anything non-redistributable, and erasing an account erases their
 * messages along with it. Putting it in the contributor's prose graph would
 * have published private mail under a share-alike licence on the next dump, and
 * nothing would have complained.
 *
 * **There is nothing to accept or reject.** A correction proposes a change that
 * can be applied; a message does not. The only state it has is whether a
 * moderator has dealt with it.
 *
 * **No subject line, no reply address.** The account says who wrote it and the
 * moderators answer out of band. A record that holds the least it can is the
 * one that is cheapest to be trusted with.
 */

const pu = NAMESPACES.pu
const rdf = NAMESPACES.rdf
const prov = NAMESPACES.prov

export const FEEDBACK_STATUS = Object.freeze({ NEW: 'new', READ: 'read' })

export class FeedbackError extends Error {
  constructor (message) {
    super(message)
    this.name = 'FeedbackError'
  }
}

/**
 * Check a message before it is written.
 *
 * Free text, which is the point — it is a message. What is checked is that
 * there is something in it and that one paste cannot fill the store.
 */
export function validate ({ message }) {
  const trimmed = String(message ?? '').trim()
  if (!trimmed) throw new FeedbackError('Write a message first.')
  if (trimmed.length > CONTRIBUTION_CONFIG.maxFeedbackLength) {
    throw new FeedbackError(
      `That is longer than ${CONTRIBUTION_CONFIG.maxFeedbackLength} characters. ` +
      'Please shorten it, or use the contact address for anything longer.'
    )
  }
  return { message: trimmed }
}

export class Feedback {
  constructor (client, {
    registry = new GraphRegistry(client), minter = new URIMinter(),
    graphId = 'feedback', queries = new QueryService()
  } = {}) {
    if (!client) throw new FeedbackError('Feedback needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
    this.queries = queries
    // Its own graph rather than the corrections queue: both are personal data,
    // but erasing somebody's messages and erasing their pending corrections are
    // different requests, and a graph is the unit either one is answered in.
    this.graphId = graphId
    this.graph = GraphRegistry.graphIri('system', graphId)
  }

  async ensureGraph () {
    if (await this.registry.isRegistered('system', this.graphId)) return this.graph
    return this.registry.register({
      kind: 'system',
      id: this.graphId,
      // The flag that keeps it out of every dump. See the note at the top of
      // this file: this is the whole of the difference between a message and a
      // contribution, and it is enforced here rather than remembered later.
      licence: 'personal-data',
      derivedFrom: `${pu}feedback`,
      comment: 'Messages sent to the moderators through /feedback. Correspondence, never published.'
    })
  }

  /**
   * Send one.
   *
   * No trust threshold, unlike a correction: there is no "accept on arrival"
   * for a message, because nothing is applied. Anyone signed in and not
   * suspended may write, and every message waits to be read.
   */
  async submit ({ account, message }, now = new Date()) {
    if (!account) throw new FeedbackError('Sign in to send a message.')
    if (account.suspended) throw new FeedbackError('This account is suspended.')

    const recent = await this.recentCount(account.iri, now)
    if (recent >= CONTRIBUTION_CONFIG.feedbackPerHour) {
      throw new FeedbackError(
        `That is ${CONTRIBUTION_CONFIG.feedbackPerHour} messages in an hour, which is the limit. ` +
        'Please come back shortly.'
      )
    }

    const checked = validate({ message })
    await this.ensureGraph()

    const node = this.minter.mint('feedback', `${account.iri.split('/').pop()}-${now.getTime()}`,
      [account.iri, String(now.getTime())])
    const s = iri(node)
    await this.client.update(insertDataQuery(this.graph, [
      `${s} ${iri(rdf + 'type')} ${iri(pu + 'Feedback')} .`,
      `${s} ${iri(pu + 'message')} ${literal(checked.message)} .`,
      `${s} ${iri(pu + 'feedbackStatus')} ${literal(FEEDBACK_STATUS.NEW)} .`,
      `${s} ${iri(prov + 'wasAttributedTo')} ${iri(account.iri)} .`,
      `${s} ${iri(prov + 'generatedAtTime')} ${typedLiteral(now)} .`
    ]))
    return { iri: node, status: FEEDBACK_STATUS.NEW, ...checked }
  }

  /** Messages nobody has dealt with, oldest first. */
  async pending (limit = 50) {
    if (!await this.registry.isRegistered('system', this.graphId)) return []
    const rows = await this.client.select(this.queries.get('contrib/feedback-pending', {
      queueGraph: iri(this.graph),
      status: literal(FEEDBACK_STATUS.NEW),
      limit: integer(limit)
    }))
    return rows.map(row => ({
      iri: row.feedback,
      message: row.message,
      by: row.by,
      at: row.at
    }))
  }

  /** Mark one dealt with. */
  async markRead ({ feedbackIri, moderator }, now = new Date()) {
    if (!feedbackIri) throw new FeedbackError('Which message?')
    if (!moderator) throw new FeedbackError('Only a moderator can mark a message read.')
    await this.client.update(this.queries.get('contrib/feedback-mark-read', {
      queueGraph: iri(this.graph),
      feedback: iri(feedbackIri),
      status: literal(FEEDBACK_STATUS.READ),
      moderator: iri(moderator.iri),
      at: typedLiteral(now)
    }))
    return { iri: feedbackIri, status: FEEDBACK_STATUS.READ }
  }

  /** How many messages this account has sent in the last hour. */
  async recentCount (accountIri, now = new Date()) {
    if (!await this.registry.isRegistered('system', this.graphId)) return 0
    const since = new Date(now.getTime() - 3600000)
    const rows = await this.client.select(this.queries.get('contrib/feedback-recent', {
      queueGraph: iri(this.graph),
      account: iri(accountIri),
      since: typedLiteral(since)
    }))
    return Number(rows[0]?.n ?? 0)
  }
}

export default Feedback
