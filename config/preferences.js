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
  // Below this the match is noise rather than a weak result.
  minSimilarity: 0.35,

  // Candidates pulled from the ANN index before fusion and filtering.
  candidateLimit: 200,

  // Results returned to a caller that does not ask for a specific page size.
  defaultPageSize: 20,
  maxPageSize: 100
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
  memoryLimitMb: 2048,
  sampleRate: 48000,
  blockSize: 512,
  // Repeats per measurement; the published figure is the median.
  repeats: 3
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
