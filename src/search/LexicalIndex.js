/**
 * The lexical signal.
 *
 * Exists because vector similarity alone measured recall@1 of 80% on the
 * fixture corpus, and every failure was a query whose wording did not overlap
 * the plugin's description.
 *
 * Terms are weighted by inverse document frequency. Without it, a query like
 * "make a sound wobble in time with the track" scores every plugin that happens
 * to mention "time" or "sound", which is most of a catalogue of audio software
 * — the first hybrid measurement lifted recall@1 to 87% but pushed recall@3
 * down from 93%, because common words were spreading weak credit everywhere.
 * IDF is what makes a rare, discriminating word count for more than a word the
 * whole corpus shares.
 */

/** Fold case and strip punctuation so "Pro-Q 4" and "pro q 4" match. */
export function tokenise (text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 1)
}

/**
 * Field weights. A name match dominates because someone typing a plugin's name
 * wants that plugin, not something semantically adjacent to it.
 */
const FIELD_WEIGHTS = Object.freeze({
  name: 3,
  vendor: 2,
  body: 1,
  prefix: 1.5
})

export class LexicalIndex {
  constructor () {
    this.documentFrequency = new Map()
    this.corpusSize = 0
  }

  /** All searchable tokens of a document, by field. */
  static fields (doc) {
    return {
      name: new Set(tokenise(doc.name)),
      vendor: new Set(tokenise(doc.vendor)),
      body: new Set([
        ...tokenise(doc.description),
        ...(doc.roles ?? []).flatMap(tokenise),
        ...(doc.categories ?? []).flatMap(tokenise),
        // A category's alternative labels, so "reverberation" reaches a reverb.
        // In the body rather than the name field: a synonym of a category is
        // weaker evidence than the plugin's own name and must not outrank it.
        ...(doc.categoryAltLabels ?? []).flatMap(tokenise),
        ...(doc.tags ?? []).flatMap(tokenise),
        ...(doc.parameters ?? []).flatMap(tokenise)
      ])
    }
  }

  /**
   * Compute document frequencies. Call once with the whole corpus; the score is
   * meaningless relative to a different corpus.
   */
  build (documents) {
    this.documentFrequency = new Map()
    this.corpusSize = 0
    for (const doc of documents) {
      this.corpusSize += 1
      const { name, vendor, body } = LexicalIndex.fields(doc)
      for (const token of new Set([...name, ...vendor, ...body])) {
        this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1)
      }
    }
    return this.corpusSize
  }

  /**
   * Inverse document frequency, normalised to 0..1.
   *
   * A token in every document scores near 0; a token in one document scores
   * near 1. An unseen token scores 1 — it cannot be common if it is absent.
   */
  idf (token) {
    if (this.corpusSize === 0) return 1
    const df = this.documentFrequency.get(token) ?? 0
    if (df === 0) return 1
    return Math.log(1 + this.corpusSize / df) / Math.log(1 + this.corpusSize)
  }

  /**
   * Lexical score in 0..1.
   *
   * An exact name match returns 1 and nothing else can reach it, so a plugin
   * searched for by name is always first.
   */
  score (queryTokens, doc) {
    if (queryTokens.length === 0) return 0
    if (String(doc.name ?? '').toLowerCase() === queryTokens.join(' ')) return 1

    const { name, vendor, body } = LexicalIndex.fields(doc)

    let score = 0
    let possible = 0
    for (const token of queryTokens) {
      const weight = this.idf(token)
      possible += FIELD_WEIGHTS.name * weight

      if (name.has(token)) score += FIELD_WEIGHTS.name * weight
      else if (vendor.has(token)) score += FIELD_WEIGHTS.vendor * weight
      else if (body.has(token)) score += FIELD_WEIGHTS.body * weight
      else if ([...name].some(n => n.startsWith(token) || token.startsWith(n))) {
        score += FIELD_WEIGHTS.prefix * weight
      }
    }
    if (possible === 0) return 0
    // Capped below 1 so only an exact name match reaches the top.
    return Math.min(score / possible, 0.99)
  }
}

export default LexicalIndex
