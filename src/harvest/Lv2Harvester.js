import fs from 'fs'
import path from 'path'
import { Harvester, HarvestError } from './Harvester.js'
import { parseTurtleFile } from './TurtleReader.js'
import { readBundleDataset, SKIP_DIRECTORIES } from './Lv2Bundle.js'
import { FREE } from './Licensing.js'

/**
 * Harvests LV2 bundles from a directory tree by reading their Turtle directly.
 *
 * The interpretation lives in Lv2Bundle.js and is shared with the GitHub
 * harvester, which reads the same bundles over the API. This class is only
 * about finding them on disk.
 *
 * Written against flues but not specific to it: any tree of *.lv2 bundles works.
 */
export class Lv2Harvester extends Harvester {
  /**
   * @param {object} spec
   * @param {string} spec.repoPath - directory to search for .lv2 bundles
   * @param {string} spec.id
   * @param {string} spec.licence - the repository's licence, checked per repo
   *   at harvest time rather than assumed (docs/sources.md §4)
   */
  /**
   * @param {string|null} [spec.pricing] - a Licensing pricing IRI, where the
   *   repository's terms are known. Not derived from the bundle's licence: an
   *   open-source licence grants source, not a free build.
   * @param {string[]} [spec.platforms] - pu:Platform IRIs the repository's
   *   maintainer says these bundles run on.
   *
   *   **Stated per repository, never inferred from the format.** An LV2 bundle
   *   declares nothing about platforms — LV2 builds for Windows and macOS as
   *   well — so a harvester that read "LV2" as "Linux" would be writing a guess
   *   into the graph, and the guess would be wrong for several repositories in
   *   this catalogue. This is here so that somebody who *knows*, and who is
   *   naming the repository anyway to state its licence, can say so in the same
   *   place. Empty by default, which is the honest answer for a tree of bundles
   *   nobody has said anything about.
   */
  constructor ({
    repoPath, id, licence, derivedFrom, vendor = null, pricing = null, platforms = []
  }) {
    super({ id, kind: 'source', licence, derivedFrom: derivedFrom ?? repoPath })
    if (!repoPath) throw new HarvestError('Lv2Harvester needs repoPath')
    this.repoPath = repoPath
    this.vendor = vendor
    this.pricing = pricing
    this.platforms = platforms
  }

  static SKIP_DIRECTORIES = SKIP_DIRECTORIES

  /** Recursively find *.lv2 bundle directories in the source tree. */
  async findBundles (dir, found = []) {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = path.join(dir, entry.name)
      if (entry.name.endsWith('.lv2')) {
        found.push(full)
        continue
      }
      if (entry.name.startsWith('.')) continue
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      await this.findBundles(full, found)
    }
    return found
  }

  async readBundle (bundleDir) {
    const files = (await fs.promises.readdir(bundleDir)).filter(f => f.endsWith('.ttl'))
    if (files.length === 0) return []

    let dataset = null
    for (const file of files) {
      const parsed = await parseTurtleFile(path.join(bundleDir, file))
      dataset = dataset ? dataset.merge(parsed) : parsed
    }
    // What the repository says, as against what the bundle says. Both are
    // added only when there is something to add, so a caller that names neither
    // gets records exactly as the bundle described them.
    const repository = {
      ...(this.pricing ? { pricing: this.pricing } : {}),
      ...(this.platforms.length ? { platforms: this.platforms } : {})
    }
    return readBundleDataset(dataset, { vendor: this.vendor })
      .map(record => ({ ...record, ...repository }))
  }

  async collect () {
    if (!fs.existsSync(this.repoPath)) {
      throw new HarvestError(`No such directory: ${this.repoPath}`, { source: this.repoPath })
    }
    // An LV2 plugin's IRI is its identity, so two bundles declaring the same
    // IRI are the same plugin however many copies of it exist on disk. Skipping
    // build directories removes most of these; this is the backstop, and it
    // deduplicates rather than erroring because these really are one plugin.
    const byIri = new Map()
    for (const bundle of await this.findBundles(this.repoPath)) {
      for (const record of await this.readBundle(bundle)) {
        if (!byIri.has(record.sourceIri)) byIri.set(record.sourceIri, record)
      }
    }
    return [...byIri.values()]
  }
}

export default Lv2Harvester
