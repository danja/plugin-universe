import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, integer, insertDataQuery } from '../store/SPARQLHelper.js'
import GraphRegistry from '../store/GraphRegistry.js'
import URIMinter from '../rdf/URIMinter.js'
import QueryService from '../store/QueryService.js'
import ensureContributorGraphs from '../contrib/ContributorGraphs.js'
import { CONTRIBUTION_CONFIG } from '../../config/preferences.js'

/**
 * Wiki prose about plugins, as revisions.
 *
 * **Nothing is ever edited or deleted.** A save writes a new revision that
 * supersedes the previous one through `prov:wasRevisionOf`; the current text is
 * the newest revision, and the history is the data rather than a log kept
 * beside it. Reverting is writing an old body again, which is itself a
 * revision — so the record of what happened survives the fixing of it.
 *
 * **Each revision lives in its author's own prose graph**, under CC BY-SA. Not
 * one shared wiki graph: the licence requires attribution, erasure has to be a
 * DROP of one person's graph, and a page written by four people is then four
 * graphs rather than four rows nobody can separate. It means the current text
 * of a page is found by a query across graphs, which is the cost of that.
 *
 * **The stored text is Markdown, never HTML.** Rendering happens on the way out
 * through `src/wiki/markdown.js`, so a change to how prose is sanitised applies
 * to every revision ever written.
 */

const pu = NAMESPACES.pu
const rdf = NAMESPACES.rdf
const prov = NAMESPACES.prov

/**
 * The accounts graph, joined to for the author's login.
 *
 * CC BY-SA requires attribution and an account IRI ends in a content hash, so
 * without the join the byline read "1b505ba2", which names nobody. The join is
 * written out in each query that needs it rather than spliced in from here:
 * a fragment assembled in JavaScript is the thing these files exist to remove,
 * and three copies of five lines of SPARQL is cheaper than a second syntax.
 */
const ACCOUNTS_GRAPH = GraphRegistry.graphIri('system', 'accounts')

export class WikiError extends Error {
  constructor (message) {
    super(message)
    this.name = 'WikiError'
  }
}

/** A conflicting save: somebody else wrote while this edit was open. */
export class WikiConflictError extends WikiError {
  constructor (message, { current }) {
    super(message)
    this.name = 'WikiConflictError'
    this.current = current
  }
}

export class Wiki {
  constructor (client, {
    registry = new GraphRegistry(client), minter = new URIMinter(),
    queries = new QueryService()
  } = {}) {
    if (!client) throw new WikiError('Wiki needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
    this.queries = queries
  }

  /**
   * The current revision of one plugin's page, or null.
   *
   * Across every contributor's prose graph, newest first. `LIMIT 1` after an
   * ORDER BY rather than a stored "current" pointer: a pointer is a second
   * thing to keep true, and it is wrong the moment two graphs are written in
   * either order.
   */
  async current (pluginIri) {
    const rows = await this.client.select(this.queries.get('wiki/current-revision', {
      plugin: iri(pluginIri),
      accountsGraph: iri(ACCOUNTS_GRAPH)
    }))
    return rows[0] ?? null
  }

  /** Every revision of one page, newest first. The page's history. */
  async history (pluginIri, limit = 50) {
    return this.client.select(this.queries.get('wiki/history', {
      plugin: iri(pluginIri),
      accountsGraph: iri(ACCOUNTS_GRAPH),
      limit: integer(limit)
    }))
  }

  /** One revision by IRI, for reading an old version. */
  async revision (revisionIri) {
    const rows = await this.client.select(this.queries.get('wiki/revision', {
      revision: iri(revisionIri),
      accountsGraph: iri(ACCOUNTS_GRAPH)
    }))
    return rows[0] ?? null
  }

  /** How many revisions this account has saved in the last hour. */
  async recentEdits (accountIri, now = new Date()) {
    const since = new Date(now.getTime() - 60 * 60 * 1000)
    const rows = await this.client.select(this.queries.get('wiki/recent-edits', {
      account: iri(accountIri),
      since: typedLiteral(since)
    }))
    return Number(rows[0]?.n ?? 0)
  }

  /**
   * Check a body of prose before it is written. Returns it, or throws.
   *
   * Every message is shown to the contributor, so each says what to do.
   */
  static validate ({ text, summary }) {
    const body = String(text ?? '').replace(/\r\n/g, '\n').trim()
    if (!body) throw new WikiError('There is nothing to save.')
    if (body.length > CONTRIBUTION_CONFIG.maxWikiLength) {
      throw new WikiError(
        `That is ${body.length} characters; the limit is ${CONTRIBUTION_CONFIG.maxWikiLength}.`)
    }
    const note = String(summary ?? '').trim()
    if (note.length > CONTRIBUTION_CONFIG.maxRationaleLength) {
      throw new WikiError(`Please keep the summary under ${CONTRIBUTION_CONFIG.maxRationaleLength} characters.`)
    }
    return { text: body, summary: note || null }
  }

  /**
   * Save a revision.
   *
   * `previous` is the revision the editor started from. If the page has moved
   * on since, the save is refused with the current revision attached rather
   * than silently overwriting somebody's work — the one thing a wiki must not
   * do. A first edit passes null and is refused if a page already exists.
   */
  async save ({ account, pluginIri, text, summary, previous = null }, now = new Date()) {
    if (!account) throw new WikiError('Sign in to edit this page.')
    if (account.suspended) throw new WikiError('This account is suspended.')
    if (!pluginIri || !pluginIri.startsWith(pu)) {
      throw new WikiError('That is not a plugin in this catalogue.')
    }

    const recent = await this.recentEdits(account.iri, now)
    if (recent >= CONTRIBUTION_CONFIG.wikiEditsPerHour) {
      throw new WikiError(
        `That is ${CONTRIBUTION_CONFIG.wikiEditsPerHour} edits in an hour, which is the limit. ` +
        'Please come back shortly.')
    }

    const revision = Wiki.validate({ text, summary })
    const head = await this.current(pluginIri)
    const headIri = head?.revision ?? null
    if ((previous ?? null) !== headIri) {
      throw new WikiConflictError(
        head
          ? 'Somebody else saved this page while you were editing. Your text is below; the current version is beside it.'
          : 'This page did not exist when you started editing, and now it does.',
        { current: head })
    }
    // Text only. A revision whose body is identical records nothing about the
    // page whatever its summary says, and an unbound SPARQL summary comes back
    // as undefined while an empty one is normalised to null — so comparing
    // both silently never matched.
    if (head && head.text === revision.text) {
      throw new WikiError('Nothing changed, so nothing was saved.')
    }

    const graphs = await ensureContributorGraphs(this.registry, account)
    // Minted over the author and the instant as well as the plugin: two people
    // saving the same page in the same millisecond must not mint one IRI and
    // silently become one revision.
    const node = this.minter.mint('revision', `${pluginIri.split('/').pop()}-${now.getTime()}`,
      [pluginIri, account.iri, String(now.getTime())])
    const s = iri(node)

    const triples = [
      `${s} ${iri(rdf + 'type')} ${iri(pu + 'WikiRevision')} .`,
      `${s} ${iri(pu + 'wikiSubject')} ${iri(pluginIri)} .`,
      // The contributor's Markdown, escaped by SPARQLHelper. This is the only
      // place in the project where a stranger's free text becomes a SPARQL
      // literal, and escapeLiteral is what stands between a quote in a sentence
      // and a broken update.
      `${s} ${iri(pu + 'wikiText')} ${literal(revision.text)} .`,
      `${s} ${iri(prov + 'wasAttributedTo')} ${iri(account.iri)} .`,
      `${s} ${iri(prov + 'generatedAtTime')} ${typedLiteral(now)} .`
    ]
    if (revision.summary) triples.push(`${s} ${iri(pu + 'editSummary')} ${literal(revision.summary)} .`)
    if (headIri) triples.push(`${s} ${iri(prov + 'wasRevisionOf')} ${iri(headIri)} .`)

    await this.client.update(insertDataQuery(graphs.prose, triples))
    return { iri: node, graph: graphs.prose, ...revision, at: now.toISOString() }
  }
}

export default Wiki
