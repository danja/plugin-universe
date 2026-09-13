import { RETRIEVAL_CONFIG, PROMOTION_CONFIG } from '../../config/preferences.js'

/**
 * How a result set is scored and ordered.
 *
 * Fusion of the two retrieval signals, the promotion re-rank, and the two sort
 * orders. All pure: they take rows and return rows, so the retrieval
 * regression suite measures the policy directly, on the same code the service
 * runs, without standing up a store.
 */

/**
 * Combine the two scoring signals into one.
 *
 * Kept as a free function so the retrieval regression suite can measure the
 * fusion policy directly, on the same code the service runs, without standing
 * up a store.
 */
export function fuse (lexical, vector) {
  return lexical * RETRIEVAL_CONFIG.lexicalWeight + vector * RETRIEVAL_CONFIG.vectorWeight
}

/**
 * Paid placement, applied to an already-ranked list.
 *
 * A re-rank after retrieval, never a filter and never an insertion —
 * `docs/architecture.md` §7: *a promoted result may be boosted but never
 * inserted where it does not match the query*. Everything here exists to keep
 * that sentence true, and each guard is separately load-bearing:
 *
 *  1. **It only boosts what retrieval already returned.** The list in is the
 *     list out, reordered. Nothing is added, so nothing can appear in a search
 *     it did not match.
 *  2. **A multiplier, not an addition.** Anything times 1.25 is still nothing,
 *     so the boost cannot manufacture relevance out of a zero score.
 *  3. **A floor.** Scoring above zero is a low bar — one weak token in a
 *     description clears it. `floor` is the "moderate match" bar the boost
 *     needs to be worth applying at all, and below it a promoted plugin ranks
 *     exactly as it would unpromoted.
 *  4. **A rank cap**, `maxPromotedRank`, which is currently 1 — a placement may
 *     reach first place. It is the weakest of the four and always was: what
 *     keeps a search trustworthy is that a paid result cannot appear where it
 *     does not belong, not which position it takes among results that do.
 *  5. **A count cap.** At most `maxPromotedPerPage` placements in one page, and
 *     at most `maxPromotedPerVendor` of them from any one vendor. The second
 *     exists because a Pro subscription allows promoting every plugin a vendor
 *     owns, and the largest vendors here have thirty to fifty — without it one
 *     subscription would hold both slots on every search it matched.
 *
 * Reaching first place is *permitted*, not bought outright: the boost is a
 * multiplier, so a substantially better match still wins. A placement scoring
 * 0.6 against a 1.4 match goes to 0.75 and stays second.
 *
 * Every result the boost touched is flagged `promoted`, which is what the label
 * on the page and the field in the JSON are rendered from. A boost that were
 * ever applied without that flag would be an undisclosed ad.
 *
 * @param {object[]} ranked - results sorted best-first, each with `score`
 * @param {Map<string, object>} promoted - live placements by plugin IRI
 * @returns {object[]} the same results, reordered, some flagged
 */
export function applyPromotion (ranked, promoted, config = PROMOTION_CONFIG) {
  if (!promoted || promoted.size === 0) return ranked

  let placed = 0
  // How many slots each vendor has taken. Keyed by the same folded vendor key
  // the vendor pages group on, so two spellings of one name are one vendor.
  const byVendor = new Map()
  const boosted = ranked.map((result, earnedRank) => {
    const placement = promoted.get(result.iri)
    // `earnedRank` is where retrieval put it, before any money. Kept on every
    // result because guard 4 needs to tell a place that was bought from a place
    // that was won.
    if (!placement) return { ...result, earnedRank }
    // Guard 3: below the floor a placement buys nothing at all.
    if (result.score < config.floor) return { ...result, earnedRank }
    // Guard 5, in two parts: how much of the page is paid for, and how much of
    // that any one payer may hold.
    if (placed >= config.maxPromotedPerPage) return { ...result, earnedRank }
    // A result with no vendor is nobody's, so it is capped by the page limit
    // alone rather than sharing an "unknown vendor" allowance with others.
    const vendor = result.vendorSlug ?? null
    if (vendor !== null && (byVendor.get(vendor) ?? 0) >= config.maxPromotedPerVendor) {
      return { ...result, earnedRank }
    }
    if (vendor !== null) byVendor.set(vendor, (byVendor.get(vendor) ?? 0) + 1)
    placed += 1
    return {
      ...result,
      earnedRank,
      score: result.score * config.boostFactor,
      promoted: true,
      promotedUntil: placement.endsAt ?? null,
      signals: { ...result.signals, unpromotedScore: result.score }
    }
  })

  boosted.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

  // Guard 4, applied last because it is about position rather than score.
  //
  // At the current setting of 1 this loop does not run: no position is reserved
  // and a placement may reach first. The code stays because the cap is a
  // published number that may be raised, and because the rule it encodes is the
  // subtle one — the reserved places are protected from being *bought*, not
  // barred to promoted plugins. A plugin that was already the best answer keeps
  // first place whatever the cap: demoting it for having paid would make
  // promotion harmful to the thing being promoted, which is a strange thing to
  // have sold. So a result is moved down only out of a place better than the
  // one it earned, and whoever earned it comes up.
  const cap = Math.max(1, config.maxPromotedRank)
  for (let i = 0; i < Math.min(cap - 1, boosted.length); i++) {
    const here = boosted[i]
    if (!here.promoted || here.earnedRank <= i) continue
    const swapWith = boosted.findIndex((result, j) => j > i && !result.promoted)
    if (swapWith === -1) break
    const [displaced] = boosted.splice(swapWith, 1)
    boosted.splice(i, 0, displaced)
  }
  return boosted
}

/** Alphabetical, the default order for a browse. */
export function byName (a, b) {
  return a.name.localeCompare(b.name)
}

/**
 * Most recently added first, ties broken by name.
 *
 * A plugin with no `dcterms:created` sorts **last**. An absent date means the
 * plugin was harvested before the catalogue recorded dates, which is the
 * opposite of new; treating it as `now` — or as the epoch and reversing —
 * would put the entire pre-existing corpus at the top of a list titled
 * "recently added". Dates are xsd:dateTime strings, which sort correctly as
 * strings, so no parsing is needed to compare two of them.
 */
export function byRecency (a, b) {
  if (a.created && b.created) return b.created.localeCompare(a.created) || byName(a, b)
  if (a.created) return -1
  if (b.created) return 1
  return byName(a, b)
}

/**
 * Which depiction to show, of however many a plugin has.
 *
 * A plugin can carry a harvested image and an uploaded one. The uploaded one
 * wins: somebody went to the trouble because the harvested one was missing,
 * wrong or gone, and it is served from this origin — so it cannot 404 on a
 * third party's reorganisation, and a reader's browser fetches nothing from
 * anywhere else to see it.
 */
