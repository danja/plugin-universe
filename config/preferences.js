/**
 * Tunable constants for Plugin Universe.
 *
 * Everything here is a value someone may reasonably want to change without
 * reading the code. Nothing here has a fallback elsewhere: if a module needs a
 * number, it comes from this file or from config/config.json, never from an
 * expression like `options.x || 5`.
 */

/**
 * Retrieval signal fusion. Weights are relative, not required to sum to 1.
 * See docs/architecture.md §5.
 */
export const RETRIEVAL_CONFIG = {
  // Exact/lexical match on name, vendor or bundle name. Weighted highest
  // because a user typing a plugin's name wants that plugin, not something
  // semantically adjacent to it.
  lexicalWeight: 1.0,

  // Vector similarity over the composed text view. The signal that answers
  // descriptive queries ("warm analogue bus compressor").
  vectorWeight: 0.7,

  // Minimum cosine similarity for a vector hit to be considered at all.
  //
  // This number is calibrated to the embedding model, not chosen on intuition,
  // and must be re-measured if the model changes. nomic-embed-text:v1.5 does
  // not use the full cosine range: measured against the 86-plugin catalogue,
  // pure nonsense ("zzzzqqqxyzzy") scores 0.53-0.54, a real query for something
  // the catalogue does not contain scores 0.51-0.54, a genuine topical match
  // scores 0.60-0.64, and an exact name match scores 0.67. An 0.35 floor
  // therefore excluded nothing at all and let every query return a full page of
  // noise. 0.58 sits in the gap between "nothing relevant" and "relevant".
  minSimilarity: 0.58,

  // Candidates pulled from the ANN index before fusion and filtering.
  candidateLimit: 200,

  // Results returned to a caller that does not ask for a specific page size.
  defaultPageSize: 20,
  maxPageSize: 100,

  // The front-page listing, shown when nobody has searched for anything yet.
  // Ten because it is a sample meant to show what the catalogue holds and to
  // be scanned in one screen, not a way to read 645 plugins ten at a time.
  browsePageSize: 10
}

/**
 * How much a promoted listing may be boosted, and the guarantees around it.
 * These numbers are published (docs/architecture.md §7) — changing them is a
 * change to a public commitment, not just a tuning decision.
 */
export const PROMOTION_CONFIG = {
  // Multiplier applied to a promoted result's fused score.
  boostFactor: 1.25,

  // A promoted result is never inserted above this rank, and never inserted at
  // all if it did not already match the query.
  maxPromotedRank: 3,

  // Promoted results shown on one page of results, at most.
  maxPromotedPerPage: 2,

  // The label shown on a promoted result. Not "Sponsored": the ASA advises
  // against it as ambiguous.
  label: 'Ad'
}

/**
 * Source precedence when two graphs assert conflicting facts about the same
 * subject. Higher wins. See docs/architecture.md §3.
 */
export const SOURCE_PRECEDENCE = {
  measurement: 60,
  discovery: 50,
  vendor: 40,
  registry: 30,
  curated: 20,
  user: 10
}

/**
 * Harvest politeness. See the operating principle in docs/architecture.md §8:
 * harvest at a rate that costs the source nothing.
 */
export const HARVEST_CONFIG = {
  // Minimum gap between requests to a single host.
  requestIntervalMs: 1000,

  // Concurrent requests to a single host.
  hostConcurrency: 1,

  // Sent on every outbound harvest request so a source can identify and
  // contact us. The contact address must be real.
  userAgent: 'plugin-universe-harvester/0.1 (+https://plugin-universe.com/about/crawler)',

  requestTimeoutMs: 30000,
  maxRetries: 3
}

/**
 * Profiler resource caps. The profiler runs untrusted third-party native code;
 * these are containment limits, not performance tuning.
 */
export const PROFILER_CONFIG = {
  wallClockLimitMs: 120000,
  cpuLimitCores: 1,
  // Enough for a plugin to instantiate and be scanned, and far too little to
  // be a comfortable place to do anything else.
  memoryLimitMb: 1024,
  // A fork bomb hits this rather than the host's process table.
  pidsLimit: 256,
  // Unprivileged, and never root even inside the container. Matches the
  // profiler image's own user.
  uid: 1001,
  sampleRate: 48000,
  blockSize: 512,
  // Repeats per measurement; the published figure is the median.
  repeats: 3,

  // pluginval's strictness level. 5 is its own recommended minimum for host
  // compatibility and the level whose verdict developers quote; above it the
  // tests get long and fuzz-heavy, which is a different question from "does
  // this load in a host". Raising it changes what a verdict means, so a run at
  // a different level is not comparable with one at this one — which is why
  // the level is recorded with the measurement rather than assumed.
  pluginvalStrictness: 5,

  // pluginval's own inactivity timeout. Deliberately well under
  // wallClockLimitMs: when a plugin hangs, pluginval saying so is a better
  // measurement than the sandbox killing the container, because only the
  // former knows which test it hung in.
  pluginvalTimeoutMs: 30000
}

/**
 * Contributions and moderation.
 *
 * The trust threshold is what makes moderation bounded rather than unbounded:
 * a new contributor's corrections are queued, and past this many accepted ones
 * they go live on arrival. It is a number to be changed with evidence — too
 * high and contributors give up before earning it, too low and the queue stops
 * being a filter.
 */
export const CONTRIBUTION_CONFIG = {
  acceptedBeforeTrusted: 5,

  // A rationale long enough to be a reason and short enough to read.
  maxRationaleLength: 1000,
  maxValueLength: 2000,

  // Corrections one account may submit in an hour. Generous for a person,
  // useless for a script.
  perAccountPerHour: 30,

  // Wiki prose. Long enough for a thorough page about a plugin — a few
  // thousand words — and short enough that one paste cannot fill the store.
  maxWikiLength: 40000,

  // Wiki saves one account may make in an hour. Lower than the correction
  // limit because each one writes a full revision that is kept forever.
  wikiEditsPerHour: 20
}

/**
 * Embedding pipeline.
 */
export const EMBEDDING_CONFIG = {
  requestTimeoutMs: 60000,
  maxRetries: 3,
  retryBackoffMs: 500,
  // Plugins embedded per batch when rebuilding the index.
  batchSize: 32
}
