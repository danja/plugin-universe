import logger from 'loglevel'
import { graphIdFor } from './GitHubHarvester.js'
import { LICENCES } from '../store/GraphRegistry.js'

/**
 * Finding candidate repositories, as a step of its own.
 *
 * Discovery and harvesting are deliberately separated. Discovery produces a
 * list that a person can read and edit; harvesting consumes it. The reason is
 * the standing rule in docs/resources.md §4 — a source is added by recording a
 * decision about its terms, not by a crawler deciding for itself — and the
 * practical effect is that "which repositories" stays a curation question with
 * a written answer, rather than whatever a search query happened to return on
 * the day.
 *
 * The default topics are the ones the LV2 world actually uses. They are a
 * starting point for review, not an authority.
 */

export const DEFAULT_TOPICS = Object.freeze([
  'lv2',
  'lv2-plugin',
  'lv2-plugins',
  'audio-plugin',
  'audio-plugins'
])

/**
 * Whether a discovered repository is harvested.
 *
 * **An unrecognised or absent licence is skipped.** That is settled policy, not
 * a default awaiting review (docs/resources.md §4, rule 7). The graph registry
 * flags `unknown` as not redistributable, so harvesting one would add data the
 * public dump could never use, taken from a source that has granted nothing.
 * Silence is not permission.
 *
 * Skipped rows stay in the candidate file, marked, rather than being dropped:
 * the list is a record of what was seen and what was decided about it, and the
 * policy can be revisited per repository by setting `include` by hand — after
 * asking the maintainer, which is rule 6.
 *
 * Archived repositories are excluded for a weaker reason: not wrong, just
 * unlikely to be worth a rate-limit window on a first sweep. That one is taste,
 * and flipping it in the file is expected.
 */
export function shouldInclude (candidate) {
  if (candidate.licence === 'unknown') return false
  if (!LICENCES[candidate.licence]?.redistributable) return false
  if (candidate.archived) return false
  return true
}

export class GitHubDiscovery {
  constructor (client) {
    if (!client) throw new Error('GitHubDiscovery needs a GitHubClient')
    this.client = client
  }

  /**
   * Search repositories by topic.
   *
   * The search API is rate-limited far more tightly than the rest — roughly 30
   * requests a minute — so this asks for the largest page GitHub allows and
   * bounds the number of pages rather than sweeping until exhaustion.
   */
  async searchByTopic (topic, { maxPages = 2, perPage = 100 } = {}) {
    const query = encodeURIComponent(`topic:${topic}`)
    const items = await this.client.paginate(
      `/search/repositories?q=${query}&sort=stars&order=desc&per_page=${perPage}`,
      { maxPages, allowMissing: true }
    )
    // The search endpoint wraps results in an object; paginate() flattens the
    // page objects, so the items are one level in.
    return items.flatMap(page => page.items ?? [])
  }

  /** One search result to a reviewable candidate row. */
  static toCandidate (item) {
    const spdxId = item.license?.spdx_id ?? null
    const licence = (!spdxId || spdxId === 'NOASSERTION')
      ? 'unknown'
      : (spdxId in LICENCES ? spdxId : 'unknown')
    const [owner, repo] = item.full_name.split('/')
    const candidate = {
      owner,
      repo,
      licence,
      spdxId,
      description: item.description ?? null,
      topics: item.topics ?? [],
      stars: item.stargazers_count ?? 0,
      archived: item.archived === true,
      pushedAt: item.pushed_at ?? null,
      graph: `graph:source/${graphIdFor(owner, repo)}`
    }
    candidate.include = shouldInclude(candidate)
    return candidate
  }

  /**
   * Discover candidates across several topics, de-duplicated by full name.
   *
   * @param {string[]} topics
   * @param {object} [options]
   * @param {number} [options.limit] - stop after this many distinct repositories
   */
  async discover (topics = DEFAULT_TOPICS, { limit = 200, maxPages = 2 } = {}) {
    const byName = new Map()
    for (const topic of topics) {
      if (byName.size >= limit) break
      let items = []
      try {
        items = await this.searchByTopic(topic, { maxPages })
      } catch (error) {
        // One topic failing should not lose the topics already searched.
        logger.warn(`[github] topic ${topic} search failed: ${error.message}`)
        continue
      }
      logger.info(`[github] topic ${topic}: ${items.length} repositories`)
      for (const item of items) {
        if (!item?.full_name || byName.has(item.full_name)) continue
        if (byName.size >= limit) break
        byName.set(item.full_name, GitHubDiscovery.toCandidate(item))
      }
    }
    return [...byName.values()].sort((a, b) => b.stars - a.stars)
  }
}

export default GitHubDiscovery
