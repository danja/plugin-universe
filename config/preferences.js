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

  // A page of the browse list at /plugins, and the glimpse on the landing page.
  // Ten because it is a sample meant to show what the catalogue holds and to
  // be scanned in one screen.
  browsePageSize: 10,

  // Categories listed in the sidebar. There are twenty-eight; a column of
  // twenty-eight is a wall rather than a way in, and the rest are one click
  // away through the browse list. Ordered by count, so these are the ones most
  // of the catalogue is actually in. Twelve is a settled choice, not a
  // placeholder — it reaches down to categories of around forty plugins.
  sidebarCategories: 12,

  // Results on an HTML search page. Fixed rather than caller-chosen, because
  // nobody reading a page asked for a page size, and relevance past the first
  // screen or two is noise. The JSON caller still chooses its own, up to
  // maxPageSize — it may well be paging the whole catalogue.
  htmlPageSize: 25
}


/**
 * How much a promoted listing may be boosted, and the guarantees around it.
 * These numbers are published (docs/architecture.md §7) — changing them is a
 * change to a public commitment, not just a tuning decision.
 */
export const PROMOTION_CONFIG = {
  // Multiplier applied to a promoted result's fused score.
  //
  // A multiplier rather than an addition, and that is the load-bearing choice:
  // anything times 1.25 is still nothing, so the boost cannot by construction
  // put a plugin into a result set it had no business being in. An additive
  // bonus would lift every promoted plugin towards the top of every search,
  // including the ones it does not match.
  boostFactor: 1.25,

  // How well a plugin must already match before money moves it at all.
  //
  // The multiplier alone only guarantees a promoted plugin matched *somehow* —
  // one weak token in a description is enough to score above zero. This is the
  // "moderate match" bar: below it the boost is not applied, so a promoted
  // reverb stays out of a search for "granular synthesiser" rather than
  // creeping up it. A fused score (lexical + 0.7 × vector), on the same scale
  // as the numbers `signals` reports.
  //
  // Measured against the 645-plugin catalogue on 2026-09-12, by the same method
  // as minSimilarity above. For "warm analogue bus compressor" the fused scores
  // run: 0.73, 0.72, 0.71 (three compressors), 0.58-0.55 (four more), then
  // **0.43 for "ZL Warm"** — which is a warmth plugin and not a compressor, and
  // matched the single word "warm" — then 0.28 and below for noise
  // ("War Tuba", "Contrast"). The gap between 0.55 and 0.43 is the gap between
  // "answered the query" and "shares a word with it", and 0.45 sits in it.
  //
  // For comparison, a query the catalogue answers well has no such gap: every
  // result for "plate reverb" scores 0.78 or better, and all of them are
  // reverbs. The floor only bites where the tail is weak, which is exactly
  // where a paid placement riding an incidental word would be noticed.
  floor: 0.45,

  // The best position a placement may be lifted into. 1 is first place.
  //
  // Set to 1 deliberately: a vendor paying for placement expects to be seen
  // first, and a product that quietly caps them at third is selling something
  // other than what the buyer thinks. Honest about what is sold beats a bound
  // that reads well and disappoints.
  //
  // **This is the least of the four guards, and it was always the least.** The
  // ones that matter are `floor` and the fact that promotion runs after
  // retrieval over the results it already found: together they mean a placement
  // cannot appear in a search it does not match, which is the failure that
  // makes people stop trusting a search. Being first among things that *do*
  // match, clearly labelled, is advertising working as advertising.
  //
  // Raising it to 2 or 3 reserves that many positions for unpaid results. It is
  // one number — but /about/promotion states it, so changing it changes a
  // public commitment and the page has to change with it.
  maxPromotedRank: 1,

  // Promoted results shown on one page of results, at most.
  maxPromotedPerPage: 2,

  // The label shown on a promoted result. Not "Sponsored": the ASA advises
  // against it as ambiguous.
  label: 'Ad',

  // How long a placement runs before it lapses.
  //
  // Expiry is read from the record at query time rather than applied by a
  // sweep, so a lapsed placement stops being boosted whether or not anything
  // ran. A sweep that fails quietly would be a paid placement running on for
  // free, indefinitely, which is the failure mode worth designing out.
  termDays: 365,

  // When a moderator starts being warned that a placement is running out, so
  // the conversation about renewing happens before it lapses rather than after.
  expiringWithinDays: 30
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
 * Uploaded images.
 *
 * The first binary this project accepts from outside, and the first data it
 * holds that is not a triple. Every limit here is a containment limit rather
 * than a preference.
 */
export const IMAGE_CONFIG = {
  // Bytes. Generous for a screenshot of a plugin's interface and far too small
  // to be worth using as free file hosting. Enforced while reading, not after:
  // a cap checked once the file is in memory is not a cap.
  maxBytes: 2 * 1024 * 1024,

  // What may be uploaded, by what the bytes actually are rather than by what
  // the request claims. SVG is deliberately absent and must stay absent: it is
  // a script container, and serving one from this origin would be a stored
  // cross-site scripting hole rather than a picture.
  accepted: Object.freeze({
    png: { magic: '89504e470d0a1a0a', type: 'image/png' },
    jpeg: { magic: 'ffd8ff', type: 'image/jpeg' },
    gif: { magic: '474946383961', type: 'image/gif' },
    gif87: { magic: '474946383761', type: 'image/gif' },
    // RIFF....WEBP — the four bytes between are the length, so the check is in
    // two parts and ImageStore does it rather than this table.
    webp: { magic: '52494646', type: 'image/webp' }
  }),

  // Where the files live, relative to the project root. Outside the image, on
  // a volume, or an upload does not survive a redeploy.
  directory: 'data/images'
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
