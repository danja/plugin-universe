import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import logger from 'loglevel'
import { HARVEST_CONFIG } from '../../config/preferences.js'
import { HarvestError } from './Harvester.js'

/**
 * The GitHub REST API, used the way GitHub asks it to be used.
 *
 * GitHub's acceptable use policy is explicit that "scraping does not refer to
 * the collection of information through our API" — so the API is the only route
 * this project takes, and never the HTML (docs/resources.md §4).
 *
 * Three things this class exists to get right:
 *
 * **Conditional requests.** Every response's ETag is cached. A repeat request
 * sends If-None-Match, and a 304 does not count against the rate limit at all.
 * For a catalogue that re-harvests the same repositories nightly this is the
 * difference between a sweep that costs 5,000 requests and one that costs
 * almost none.
 *
 * **Rate limits are answers.** Waiting for the reset time GitHub publishes is
 * the sanctioned behaviour and is what this does. Retrying immediately, or
 * behind a second identity, is working around an access-control measure and is
 * not done here under any circumstances.
 *
 * **The token is never logged.** It goes in one header and appears in no error
 * message, no cache file and no debug line.
 */

const API_ROOT = 'https://api.github.com'

/** How long to wait for a rate-limit window to reset before giving up. */
const MAX_RATE_LIMIT_WAIT_MS = 15 * 60 * 1000

export class GitHubError extends HarvestError {
  constructor (message, { status = null, source = null } = {}) {
    super(message, { source })
    this.name = 'GitHubError'
    this.status = status
  }
}

export class GitHubClient {
  /**
   * @param {object} [options]
   * @param {string|null} [options.token] - a fine-grained, public-read-only
   *   token. Optional: without one the API allows 60 requests an hour, which is
   *   enough to try things and not enough to harvest.
   * @param {string|null} [options.cacheDir] - where ETags and bodies are kept.
   */
  constructor ({ token = null, cacheDir = null } = {}) {
    this.token = token
    this.cacheDir = cacheDir
    this.lastRequestAt = 0
    /** Populated from response headers, so a caller can pace a long sweep. */
    this.rateLimit = { limit: null, remaining: null, resetAt: null, used: 0 }
  }

  /** Reads GITHUB_TOKEN from the environment, which Config.load() populates. */
  static fromEnvironment ({ cacheDir = null } = {}) {
    const token = process.env.GITHUB_TOKEN
    if (!token) {
      logger.warn(
        '[github] no GITHUB_TOKEN set: the API allows 60 requests an hour unauthenticated. ' +
        'See .env.example for the scopes to grant (none).'
      )
    }
    return new GitHubClient({ token: token ?? null, cacheDir })
  }

  get authenticated () {
    return Boolean(this.token)
  }

  #headers (etag) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': HARVEST_CONFIG.userAgent
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    if (etag) headers['If-None-Match'] = etag
    return headers
  }

  #cachePath (url) {
    if (!this.cacheDir) return null
    const digest = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)
    return path.join(this.cacheDir, `${digest}.json`)
  }

  #readCache (url) {
    const file = this.#cachePath(url)
    if (!file || !fs.existsSync(file)) return null
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      // A corrupt cache entry is not worth failing over; it is re-fetched.
      return null
    }
  }

  async #writeCache (url, entry) {
    const file = this.#cachePath(url)
    if (!file) return
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(file, JSON.stringify(entry), 'utf8')
  }

  #recordRateLimit (response) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    const limit = response.headers.get('x-ratelimit-limit')
    const reset = response.headers.get('x-ratelimit-reset')
    if (remaining !== null) this.rateLimit.remaining = Number(remaining)
    if (limit !== null) this.rateLimit.limit = Number(limit)
    if (reset !== null) this.rateLimit.resetAt = new Date(Number(reset) * 1000)
  }

  async #pace () {
    const wait = HARVEST_CONFIG.requestIntervalMs - (Date.now() - this.lastRequestAt)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    this.lastRequestAt = Date.now()
  }

  /**
   * Handle a rate-limit response by waiting for the window GitHub published.
   *
   * @returns {Promise<boolean>} true when the caller should retry
   */
  async #waitForRateLimit (response) {
    const retryAfter = response.headers.get('retry-after')
    // A secondary rate limit. GitHub says how long to wait; that is the answer.
    if (retryAfter !== null) {
      const waitMs = Number(retryAfter) * 1000
      if (waitMs > MAX_RATE_LIMIT_WAIT_MS) return false
      logger.warn(`[github] secondary rate limit, waiting ${Number(retryAfter)}s as instructed`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return true
    }
    // A primary rate limit, with a published reset time.
    if (response.headers.get('x-ratelimit-remaining') === '0') {
      const resetAt = Number(response.headers.get('x-ratelimit-reset')) * 1000
      const waitMs = resetAt - Date.now() + 1000
      if (waitMs > MAX_RATE_LIMIT_WAIT_MS || waitMs < 0) return false
      logger.warn(`[github] rate limit reached, waiting ${Math.round(waitMs / 1000)}s until reset`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return true
    }
    return false
  }

  /**
   * GET one API path.
   *
   * @param {string} pathOrUrl - "/repos/owner/name" or a full API URL
   * @param {object} [options]
   * @param {boolean} [options.allowMissing] - return null on 404 rather than
   *   throwing. A repository with no DOAP file is a fact, not a failure.
   * @returns {Promise<{body: object|null, status: number, notModified: boolean, headers: Headers}>}
   */
  async request (pathOrUrl, { allowMissing = false, accept = null } = {}) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API_ROOT}${pathOrUrl}`
    const cached = this.#readCache(url)

    for (let attempt = 1; attempt <= HARVEST_CONFIG.maxRetries; attempt++) {
      await this.#pace()

      let response
      try {
        const headers = this.#headers(cached?.etag)
        if (accept) headers.Accept = accept
        response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(HARVEST_CONFIG.requestTimeoutMs)
        })
      } catch (error) {
        logger.warn(`[github] ${url} attempt ${attempt}: ${error.message}`)
        continue
      }

      this.#recordRateLimit(response)
      this.rateLimit.used += 1

      // Nothing changed since the cached copy. This costs no rate-limit quota.
      if (response.status === 304 && cached) {
        return { body: cached.body, status: 304, notModified: true, headers: response.headers }
      }

      if (response.status === 404) {
        if (allowMissing) return { body: null, status: 404, notModified: false, headers: response.headers }
        throw new GitHubError(`Not found: ${url}`, { status: 404, source: url })
      }

      if (response.status === 403 || response.status === 429) {
        if (await this.#waitForRateLimit(response)) continue
        throw new GitHubError(
          `${url} answered HTTP ${response.status} and the limit does not reset soon enough to wait. ` +
          'That is an answer: stop the sweep and resume later rather than working around it.',
          { status: response.status, source: url }
        )
      }

      if (!response.ok) {
        logger.warn(`[github] ${url} returned HTTP ${response.status}`)
        continue
      }

      const body = await response.json()
      const etag = response.headers.get('etag')
      if (etag) await this.#writeCache(url, { etag, body })
      return { body, status: response.status, notModified: false, headers: response.headers }
    }

    throw new GitHubError(`${url} could not be fetched in ${HARVEST_CONFIG.maxRetries} attempts`, { source: url })
  }

  /** The body alone, for the common case. */
  async get (pathOrUrl, options = {}) {
    const { body } = await this.request(pathOrUrl, options)
    return body
  }

  /**
   * Follow RFC 5988 `Link: rel="next"` pagination.
   * @param {number} maxPages - a bound, because an unbounded sweep of someone
   *   else's API is not a polite thing to write.
   */
  async paginate (pathOrUrl, { maxPages = 10, allowMissing = false } = {}) {
    const items = []
    let url = pathOrUrl
    for (let page = 0; page < maxPages && url; page++) {
      const { body, headers } = await this.request(url, { allowMissing })
      if (!body) break
      items.push(...(Array.isArray(body) ? body : [body]))
      const link = headers.get('link')
      const next = link?.match(/<([^>]+)>;\s*rel="next"/)
      url = next ? next[1] : null
    }
    return items
  }

  /**
   * A file's decoded text content, or null if it is not there.
   *
   * The contents endpoint base64-encodes anything under 1MB and refuses larger
   * files, which is fine: a bundle's Turtle is kilobytes.
   */
  async fileText (owner, repo, filePath, ref = null) {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
    const body = await this.get(
      `/repos/${owner}/${repo}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}${query}`,
      { allowMissing: true }
    )
    if (!body || body.encoding !== 'base64' || typeof body.content !== 'string') return null
    return Buffer.from(body.content, 'base64').toString('utf8')
  }

  /**
   * Every file path in a repository, in one request.
   *
   * The recursive trees endpoint is dramatically cheaper than walking the
   * contents endpoint directory by directory, which is what makes finding LV2
   * bundles in an unfamiliar repository affordable at all. `truncated` is
   * reported rather than hidden: a partial listing that looks complete would
   * silently lose plugins.
   */
  async tree (owner, repo, ref = 'HEAD') {
    const body = await this.get(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      { allowMissing: true }
    )
    if (!body) return { paths: [], truncated: false }
    return {
      paths: (body.tree ?? []).filter(node => node.type === 'blob').map(node => node.path),
      truncated: body.truncated === true
    }
  }
}

export default GitHubClient
