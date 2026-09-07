import { normalisePlugin } from './Normaliser.js'

/**
 * The harvester interface.
 *
 * Sources differ enormously in shape — a git checkout of Turtle files, a JSON
 * REST registry, a GitHub API sweep — so this is deliberately thin. A harvester
 * knows one source's quirks and emits raw plugin records; the normaliser and
 * the serialiser do the unifying work.
 *
 * Every harvester declares its graph kind, its id and its licence up front. The
 * licence is not optional and there is no default: it is what decides whether
 * the harvested data can appear in the public CC0 dump, and a wrong guess is a
 * licensing error rather than a runtime one.
 */

export class HarvestError extends Error {
  constructor (message, { source = null, cause = null } = {}) {
    super(message)
    this.name = 'HarvestError'
    this.source = source
    if (cause) this.cause = cause
  }
}

export class Harvester {
  /**
   * @param {object} spec
   * @param {string} spec.id - stable source id, e.g. 'downspout'
   * @param {string} spec.kind - a GRAPH_KINDS key
   * @param {string} spec.licence - a LICENCES key. Required.
   * @param {string} spec.derivedFrom - where the data came from
   */
  constructor ({ id, kind, licence, derivedFrom }) {
    for (const [key, value] of Object.entries({ id, kind, licence, derivedFrom })) {
      if (!value) throw new HarvestError(`A harvester must declare ${key}`)
    }
    this.id = id
    this.kind = kind
    this.licence = licence
    this.derivedFrom = derivedFrom
  }

  /**
   * Produce raw, source-shaped plugin records.
   *
   * Either an array of records, or `{records, rejected}` when the source can
   * present an individual entry that is unreadable while the rest are fine — a
   * remote registry can change shape under one package without the other 558
   * becoming suspect. Returning the rejects rather than throwing keeps the
   * failure visible without letting one bad row block an ingest.
   *
   * @returns {Promise<object[]|{records: object[], rejected: Array<{name: string, reason: string}>}>}
   */
  async collect () {
    throw new HarvestError(`${this.constructor.name} does not implement collect()`)
  }

  /**
   * Collect and normalise. Records that cannot be normalised are reported
   * rather than silently dropped — a plugin missing from the catalogue with no
   * explanation is the hardest kind of bug to notice.
   *
   * @returns {Promise<{plugins: object[], rejected: Array<{name: string, reason: string}>}>}
   */
  async harvest () {
    const collected = await this.collect()
    const raw = Array.isArray(collected) ? collected : collected.records
    const rejected = Array.isArray(collected) ? [] : [...collected.rejected]
    if (!Array.isArray(raw)) {
      throw new HarvestError(
        `${this.constructor.name}.collect() must return an array or {records, rejected}`
      )
    }
    const plugins = []
    for (const record of raw) {
      try {
        plugins.push(normalisePlugin(record))
      } catch (error) {
        rejected.push({
          name: record.name ?? record.registryId ?? record.sourceIri ?? '(unidentified)',
          reason: error.message
        })
      }
    }
    return { plugins, rejected }
  }
}

export default Harvester
