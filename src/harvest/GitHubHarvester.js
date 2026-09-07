import logger from 'loglevel'
import { Harvester, HarvestError } from './Harvester.js'
import GitHubClient from './GitHubClient.js'
import { parseTurtle } from './TurtleReader.js'
import { readBundleDataset, isBuildPath } from './Lv2Bundle.js'
import { LICENCES } from '../store/GraphRegistry.js'

/**
 * Harvests the LV2 bundles in one GitHub repository.
 *
 * **One repository, one graph.** Not one graph for "GitHub": a repository's
 * licence is a property of that repository, and the licence flag is what
 * decides whether the graph's content reaches the public dump. Rolling a
 * hundred repositories into one graph would mean one licence flag for a hundred
 * different answers, which is exactly the catch-all this project's graph model
 * exists to avoid. It also makes re-harvesting one repository a DROP of its
 * graph alone.
 *
 * **Scoped to what the registries miss.** The Open Audio Stack registry already
 * covers open-source plugins that publish releases. What it cannot see is the
 * LV2 bundle living in a source tree with a `manifest.ttl` and no release
 * artefact — which is a large part of the LV2 world. So this harvester looks
 * for `.lv2` bundles and nothing else: a repository without one yields no
 * plugins rather than a speculative record built from a README.
 *
 * **API only, never HTML.** GitHub's acceptable use policy exempts API
 * collection from its definition of scraping and does not exempt anything else
 * (docs/resources.md §4).
 *
 * **Project data, not people data.** The repository owner's login and the
 * maintainer name a bundle states about itself are catalogue data. Email
 * addresses are not, and the endpoints that would expose them — commits,
 * contributors, users — are never called.
 */

/** GitHub reports SPDX ids; these are the ones the graph registry knows. */
function graphLicenceFor (spdxId) {
  if (!spdxId || spdxId === 'NOASSERTION') return 'unknown'
  return spdxId in LICENCES ? spdxId : 'unknown'
}

/** Turn owner/repo into a graph id: lowercase alphanumeric and hyphens. */
export function graphIdFor (owner, repo) {
  const slug = `${owner}-${repo}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) throw new HarvestError(`Cannot build a graph id from ${owner}/${repo}`)
  return `github-${slug}`
}

export class GitHubHarvester extends Harvester {
  /**
   * @param {object} spec
   * @param {string} spec.owner
   * @param {string} spec.repo
   * @param {string} spec.licence - the repository's licence as a LICENCES key.
   *   Required, and read from the API by `describe()` before construction — a
   *   harvester never guesses its own licence.
   * @param {GitHubClient} spec.client
   * @param {number} [spec.maxBundleFiles] - a bound on how many Turtle files
   *   one repository may cost. A repository with four hundred of them is
   *   reported rather than fetched. The default accommodates a genuine
   *   multi-plugin repository — flues is 36 bundles and 72 files — while still
   *   refusing to spend a whole rate-limit window on one name.
   */
  constructor ({ owner, repo, licence, client, maxBundleFiles = 120, defaultBranch = null }) {
    if (!owner || !repo) throw new HarvestError('GitHubHarvester needs owner and repo')
    super({
      id: graphIdFor(owner, repo),
      kind: 'source',
      licence,
      derivedFrom: `https://github.com/${owner}/${repo}`
    })
    if (!client) throw new HarvestError('GitHubHarvester needs a GitHubClient')
    this.owner = owner
    this.repo = repo
    this.client = client
    this.maxBundleFiles = maxBundleFiles
    this.defaultBranch = defaultBranch
    this.notes = []
  }

  /**
   * Look a repository up and report what harvesting it would involve.
   *
   * Separate from construction because the licence is not optional and is not
   * knowable without asking: `new GitHubHarvester()` cannot be called until the
   * API has said what the repository is licensed under.
   *
   * @returns {Promise<object|null>} null when the repository is gone or private
   */
  static async describe (owner, repo, client) {
    const info = await client.get(`/repos/${owner}/${repo}`, { allowMissing: true })
    if (!info) return null
    return {
      owner,
      repo,
      fullName: info.full_name,
      description: info.description ?? null,
      homepage: info.homepage || info.html_url,
      htmlUrl: info.html_url,
      // The owner's public login and display name. Never their email.
      ownerLogin: info.owner?.login ?? owner,
      spdxId: info.license?.spdx_id ?? null,
      licence: graphLicenceFor(info.license?.spdx_id ?? null),
      topics: info.topics ?? [],
      archived: info.archived === true,
      defaultBranch: info.default_branch ?? 'HEAD',
      stars: info.stargazers_count ?? 0,
      pushedAt: info.pushed_at ?? null
    }
  }

  /**
   * Group a repository's file list into LV2 bundles.
   *
   * A bundle is a `.lv2` directory, which is what the LV2 specification says it
   * is. Build, staging and release copies are skipped: a repository commonly
   * holds the same bundle four times over, and harvesting all of them produced
   * 57 records for 36 plugins once already.
   */
  static bundlesFrom (paths) {
    const bundles = new Map()
    for (const filePath of paths) {
      if (!filePath.endsWith('.ttl')) continue
      if (isBuildPath(filePath)) continue
      const segments = filePath.split('/')
      const index = segments.findIndex(segment => segment.endsWith('.lv2'))
      if (index === -1) continue
      const bundle = segments.slice(0, index + 1).join('/')
      if (!bundles.has(bundle)) bundles.set(bundle, [])
      bundles.get(bundle).push(filePath)
    }
    return bundles
  }

  /**
   * Release assets as packages.
   *
   * Only for a repository that yields exactly one plugin. In a multi-plugin
   * repository an asset probably contains all of them, but "probably" is not a
   * fact, and asserting that this archive is that plugin's package would be a
   * guess written into the graph. Note also that the API publishes no checksum
   * for a release asset, so these packages carry a URL and a size and no
   * pu:sha256 — an absent checksum is honest, a fabricated one is not.
   */
  async #releasePackages () {
    const releases = await this.client.paginate(
      `/repos/${this.owner}/${this.repo}/releases?per_page=10`,
      { maxPages: 1, allowMissing: true }
    )
    const latest = releases.find(release => !release.draft && !release.prerelease) ?? releases[0]
    if (!latest) return []

    const files = (latest.assets ?? []).map(asset => ({
      url: asset.browser_download_url ?? null,
      sha256: null,
      size: typeof asset.size === 'number' ? asset.size : null,
      kind: 'archive',
      formats: [],
      artefacts: [],
      architectures: [],
      systems: [],
      attested: false,
      downloads: typeof asset.download_count === 'number' ? asset.download_count : null
    })).filter(file => file.url)

    if (files.length === 0) return []
    return [{
      version: latest.tag_name ?? null,
      releasedAt: latest.published_at ?? null,
      changes: latest.name ?? null,
      files
    }]
  }

  async collect () {
    const info = await GitHubHarvester.describe(this.owner, this.repo, this.client)
    if (!info) {
      throw new HarvestError(`${this.owner}/${this.repo} is not readable`, { source: this.derivedFrom })
    }

    const { paths, truncated } = await this.client.tree(this.owner, this.repo, info.defaultBranch)
    if (truncated) {
      // Reported, not swallowed: a partial listing that looks complete would
      // silently drop plugins and nothing downstream could tell.
      this.notes.push(`${this.owner}/${this.repo}: the git tree listing was truncated; some bundles may be missing`)
      logger.warn(`[github] ${this.owner}/${this.repo} tree truncated`)
    }

    const bundles = GitHubHarvester.bundlesFrom(paths)
    const fileCount = [...bundles.values()].reduce((total, files) => total + files.length, 0)
    if (fileCount > this.maxBundleFiles) {
      throw new HarvestError(
        `${this.owner}/${this.repo} has ${fileCount} bundle Turtle files, above the ${this.maxBundleFiles} limit. ` +
        'Raise maxBundleFiles deliberately rather than letting one repository consume a rate-limit window.',
        { source: this.derivedFrom }
      )
    }

    const records = []
    const rejected = []
    const byIri = new Map()

    for (const [bundle, files] of bundles) {
      let dataset = null
      try {
        for (const file of files) {
          const text = await this.client.fileText(this.owner, this.repo, file, info.defaultBranch)
          if (text === null) continue
          const parsed = await parseTurtle(text, { file: `${this.derivedFrom}/${file}` })
          dataset = dataset ? dataset.merge(parsed) : parsed
        }
      } catch (error) {
        rejected.push({ name: bundle, reason: error.message })
        continue
      }
      if (!dataset) continue

      for (const record of readBundleDataset(dataset, { homepage: info.homepage })) {
        if (byIri.has(record.sourceIri)) continue
        byIri.set(record.sourceIri, record)
        records.push({
          ...record,
          // The repository's stated licence, where the bundle does not state
          // its own. Both are facts about the software, not about the graph.
          licence: record.licence ?? info.spdxId,
          vendor: record.vendor ?? info.ownerLogin,
          description: record.description ?? info.description,
          tags: info.topics,
          seeAlso: info.htmlUrl
        })
      }
    }

    if (records.length === 1) {
      records[0].packages = await this.#releasePackages()
    } else if (records.length > 1) {
      this.notes.push(
        `${this.owner}/${this.repo}: ${records.length} plugins in one repository, so release assets ` +
        'were not attributed to any of them'
      )
    }

    return { records, rejected }
  }
}

export default GitHubHarvester
