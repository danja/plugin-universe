import fs from 'fs'
import path from 'path'
import logger from 'loglevel'
import { HARVEST_CONFIG } from '../../config/preferences.js'
import { HarvestError } from './Harvester.js'

/**
 * Fetching from a remote source, politely.
 *
 * The operating principle in docs/architecture.md §8 is that harvesting should
 * cost the source nothing. Three things follow, and they are enforced here
 * rather than left to each harvester to remember:
 *
 *  - The crawler identifies itself honestly, with a contact address.
 *  - A response is cached to disk, so re-running an ingest costs the source
 *    nothing at all. The cache is explicit and its age is checked; it is not a
 *    silent fallback for a failed fetch.
 *  - A 403, a 429 or any other refusal is an answer. It is reported, never
 *    retried around with a different user agent (docs/resources.md §4, rule 3).
 */

/** Responses that mean "no". Retrying these is working around an answer. */
const REFUSALS = Object.freeze(new Set([401, 403, 404, 410, 429, 451]))

export class HttpSource {
  /**
   * @param {object} [options]
   * @param {number} [options.maxCacheAgeMs] - how old a cached body may be
   *   before it is re-fetched. Required to be explicit at the call site when a
   *   cache is used at all.
   */
  constructor ({ maxCacheAgeMs = null } = {}) {
    this.maxCacheAgeMs = maxCacheAgeMs
    this.lastRequestAt = 0
  }

  /** Hold requests to one host apart by the configured interval. */
  async #pace () {
    const wait = HARVEST_CONFIG.requestIntervalMs - (Date.now() - this.lastRequestAt)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    this.lastRequestAt = Date.now()
  }

  /**
   * @param {string} url
   * @param {object} [options]
   * @param {string} [options.accept] - the Accept header. The default asks for
   *   the machine-readable forms a harvester wants; a caller reading a page
   *   somebody linked has to ask for HTML, and does so here rather than by
   *   opening a second way out of this process.
   * @param {number} [options.maxBytes] - refuse a body larger than this. A
   *   harvester's sources are known and bounded; a URL a person pastes is not.
   * @param {'follow'|'manual'} [options.redirect] - `follow` by default, which
   *   is what every configured source needs: the registries redirect, and a
   *   harvester that treated a 301 as a failure would retry it twice and give
   *   up. A caller fetching a URL somebody pasted wants `manual`, because the
   *   address it vetted is not the address a redirect leads to.
   */
  async fetchText (url, {
    accept = 'application/json, text/plain', maxBytes = null, redirect = 'follow'
  } = {}) {
    let lastError = null
    for (let attempt = 1; attempt <= HARVEST_CONFIG.maxRetries; attempt++) {
      await this.#pace()
      let response
      try {
        response = await fetch(url, {
          headers: { 'User-Agent': HARVEST_CONFIG.userAgent, Accept: accept },
          signal: AbortSignal.timeout(HARVEST_CONFIG.requestTimeoutMs),
          redirect
        })
      } catch (error) {
        lastError = error
        logger.warn(`[harvest] ${url} attempt ${attempt} failed: ${error.message}`)
        continue
      }
      if (REFUSALS.has(response.status)) {
        throw new HarvestError(
          `${url} answered HTTP ${response.status}. That is an answer, not an obstacle: ` +
          'do not retry it behind a different identity. If access is wanted, ask the source.',
          { source: url }
        )
      }
      if (!response.ok) {
        lastError = new HarvestError(`${url} returned HTTP ${response.status}`, { source: url })
        continue
      }
      if (maxBytes !== null) {
        const declared = Number(response.headers.get('content-length'))
        if (Number.isFinite(declared) && declared > maxBytes) {
          throw new HarvestError(
            `${url} is ${declared} bytes, over the ${maxBytes} limit.`, { source: url })
        }
        const body = await response.text()
        // Checked again after reading: content-length is a claim, and a
        // chunked response does not make one at all.
        if (Buffer.byteLength(body) > maxBytes) {
          throw new HarvestError(
            `${url} returned more than ${maxBytes} bytes.`, { source: url })
        }
        return body
      }
      return response.text()
    }
    throw new HarvestError(
      `${url} could not be fetched in ${HARVEST_CONFIG.maxRetries} attempts: ${lastError?.message}`,
      { source: url, cause: lastError }
    )
  }

  /** True when a cache file exists and is younger than maxCacheAgeMs. */
  isCacheFresh (cachePath) {
    if (!cachePath || this.maxCacheAgeMs === null) return false
    if (!fs.existsSync(cachePath)) return false
    return Date.now() - fs.statSync(cachePath).mtimeMs < this.maxCacheAgeMs
  }

  /**
   * Fetch JSON, using a disk cache when one is configured and fresh.
   *
   * @param {string} url
   * @param {string|null} cachePath - where to keep the body. Null disables caching.
   */
  async fetchJson (url, cachePath = null) {
    if (this.isCacheFresh(cachePath)) {
      logger.info(`[harvest] using cached ${path.basename(cachePath)}`)
      return JSON.parse(await fs.promises.readFile(cachePath, 'utf8'))
    }
    const body = await this.fetchText(url)
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch (error) {
      throw new HarvestError(`${url} did not return JSON: ${error.message}`, { source: url, cause: error })
    }
    if (cachePath) {
      await fs.promises.mkdir(path.dirname(cachePath), { recursive: true })
      await fs.promises.writeFile(cachePath, body, 'utf8')
    }
    return parsed
  }
}

export default HttpSource
