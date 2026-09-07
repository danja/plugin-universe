import fs from 'fs'
import path from 'path'
import { Harvester, HarvestError } from './Harvester.js'
import { parseTurtleFile } from './TurtleReader.js'
import { readBundleDataset, SKIP_DIRECTORIES } from './Lv2Bundle.js'

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
   *   at harvest time rather than assumed (docs/resources.md §4)
   */
  constructor ({ repoPath, id, licence, derivedFrom, vendor = null }) {
    super({ id, kind: 'source', licence, derivedFrom: derivedFrom ?? repoPath })
    if (!repoPath) throw new HarvestError('Lv2Harvester needs repoPath')
    this.repoPath = repoPath
    this.vendor = vendor
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
    return readBundleDataset(dataset, { vendor: this.vendor })
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
