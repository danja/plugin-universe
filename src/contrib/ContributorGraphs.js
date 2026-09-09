import GraphRegistry from '../store/GraphRegistry.js'

/**
 * The two graphs every contributor writes through.
 *
 * Facts under CC0, prose under CC BY-SA, in separate graphs — so which licence
 * applies to a contribution is decided by which graph it went into rather than
 * by anybody remembering at publication time. Dump assembly is then a query
 * over the licence flag, and erasing a person is a DROP of two graphs.
 *
 * Shared by corrections and the wiki because the boundary must be identical for
 * both. It lived inside Corrections until the wiki needed it; a second copy
 * would have been two places to get a licence flag wrong, which is exactly the
 * class of defect the recurring-failure note in CLAUDE.md is about.
 *
 * `GraphRegistry.graphIri` forbids a slash in an id, hence the suffix rather
 * than a path.
 */

export const CONTRIBUTOR_GRAPHS = Object.freeze({
  facts: { licence: 'CC0-1.0', what: 'Factual contributions, dedicated to the public domain' },
  prose: { licence: 'CC-BY-SA-4.0', what: 'Authored prose, licensed share-alike with attribution' }
})

/** The graph id for one kind of contribution by one account. */
export function graphIdFor (account, kind) {
  if (!CONTRIBUTOR_GRAPHS[kind]) {
    throw new Error(`Unknown contribution kind "${kind}". Known: ${Object.keys(CONTRIBUTOR_GRAPHS).join(', ')}`)
  }
  return `${account.iri.split('/').pop()}-${kind}`
}

/**
 * Register both graphs for an account if they are not registered, and return
 * their IRIs either way.
 */
export async function ensureContributorGraphs (registry, account) {
  const graphs = {}
  for (const [kind, spec] of Object.entries(CONTRIBUTOR_GRAPHS)) {
    const id = graphIdFor(account, kind)
    graphs[kind] = await registry.isRegistered('user', id)
      ? GraphRegistry.graphIri('user', id)
      : await registry.register({
        kind: 'user',
        id,
        licence: spec.licence,
        derivedFrom: account.iri,
        comment: `${spec.what} by ${account.login}.`
      })
  }
  return graphs
}

export default ensureContributorGraphs
