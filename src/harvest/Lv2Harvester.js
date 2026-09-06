import fs from 'fs'
import path from 'path'
import { Harvester, HarvestError } from './Harvester.js'
import { parseTurtleFile, GraphView } from './TurtleReader.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

const lv2 = NAMESPACES.lv2
const rdf = NAMESPACES.rdf
const rdfs = NAMESPACES.rdfs
const doap = NAMESPACES.doap
const foaf = NAMESPACES.foaf
const trn = NAMESPACES.trn

/**
 * Harvests LV2 bundles by reading their Turtle directly.
 *
 * LV2 is the one format that ships machine-readable metadata by design, so this
 * harvester does almost no interpretation: the bundle already says what the
 * catalogue wants to know, in the vocabulary the catalogue uses. That is the
 * payoff of the decision in docs/architecture.md §2.3 to describe parameters
 * with lv2:port rather than a bespoke term — these ports need no translation.
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

  /**
   * Directories that hold copies of bundles rather than sources.
   *
   * A repository typically contains the same bundle several times over: the
   * source tree, a build directory, a staging directory and a tagged release.
   * Harvesting all of them yields the same plugin repeatedly, which then either
   * collides on its IRI or inflates the catalogue. Skipping them is also much
   * faster than parsing four copies of every bundle.
   */
  static SKIP_DIRECTORIES = Object.freeze(new Set([
    'build', 'builddir', 'build-output', 'staging', 'releases', 'dist',
    'target', 'out', 'node_modules'
  ]))

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
      if (Lv2Harvester.SKIP_DIRECTORIES.has(entry.name)) continue
      await this.findBundles(full, found)
    }
    return found
  }

  /**
   * Read one port node. LV2 port descriptions map straight onto the
   * catalogue's parameter shape.
   */
  #readPort (view, node) {
    const types = view.values(node, `${rdf}type`)
    // Only control ports are parameters. Audio and atom ports describe
    // connectivity, which is captured as accepts/produces instead.
    if (!types.includes(`${lv2}ControlPort`)) return null

    const properties = view.values(node, `${lv2}portProperty`)
    const scalePoints = view.objects(node, `${lv2}scalePoint`).map(point => ({
      label: view.value(point, `${rdfs}label`),
      value: view.number(point, `${rdf}value`)
    }))

    return {
      symbol: view.value(node, `${lv2}symbol`),
      name: view.value(node, `${lv2}name`),
      comment: view.value(node, `${rdfs}comment`),
      default: view.scalar(node, `${lv2}default`),
      minimum: view.number(node, `${lv2}minimum`),
      maximum: view.number(node, `${lv2}maximum`),
      unit: view.value(node, `${NAMESPACES.units}unit`),
      integer: properties.includes(`${lv2}integer`),
      scalePoints,
      direction: types.includes(`${lv2}OutputPort`) ? 'output' : 'input'
    }
  }

  /** Signal types a plugin accepts and produces, from its port list. */
  #signals (view, ports) {
    const accepts = new Set()
    const produces = new Set()
    for (const port of ports) {
      const types = view.values(port, `${rdf}type`)
      const isOutput = types.includes(`${lv2}OutputPort`)
      const target = isOutput ? produces : accepts

      if (types.includes(`${lv2}AudioPort`)) target.add(`${trn}Audio`)
      if (types.includes(`${NAMESPACES.atom}AtomPort`)) {
        const supports = view.values(port, `${NAMESPACES.atom}supports`)
        if (supports.includes(`${NAMESPACES.midi}MidiEvent`)) target.add(`${trn}Midi`)
      }
    }
    return { accepts: [...accepts], produces: [...produces] }
  }

  async readBundle (bundleDir) {
    const files = (await fs.promises.readdir(bundleDir)).filter(f => f.endsWith('.ttl'))
    if (files.length === 0) return []

    // A bundle's manifest points at further files with rdfs:seeAlso; reading
    // every .ttl in the bundle into one view is equivalent and simpler.
    let dataset = null
    for (const file of files) {
      const parsed = await parseTurtleFile(path.join(bundleDir, file))
      dataset = dataset ? dataset.merge(parsed) : parsed
    }
    const view = new GraphView(dataset)

    const records = []
    for (const subject of view.subjectsOfType(`${lv2}Plugin`)) {
      const ports = view.objects(subject, `${lv2}port`)
      const { accepts, produces } = this.#signals(view, ports)

      const maintainerNode = view.objects(subject, `${doap}maintainer`)[0]
      const requiresTransport = ports.some(port =>
        view.values(port, `${NAMESPACES.atom}supports`).includes(`${NAMESPACES.time}Position`))

      records.push({
        // LV2 plugins carry a canonical, dereferenceable IRI already. It is
        // preserved with owl:sameAs rather than replaced.
        sourceIri: subject.value,
        name: view.value(subject, `${doap}name`) ?? view.value(subject, `${rdfs}label`),
        description: view.value(subject, `${rdfs}comment`),
        vendor: this.vendor ?? (maintainerNode ? view.value(maintainerNode, `${foaf}name`) : null),
        maintainer: maintainerNode ? view.value(maintainerNode, `${foaf}name`) : null,
        homepage: maintainerNode ? view.value(maintainerNode, `${foaf}homepage`) : null,
        project: view.value(subject, `${lv2}project`),
        licence: view.value(subject, `${doap}license`),
        formats: [`${trn}LV2`],
        lv2Classes: view.values(subject, `${rdf}type`),
        accepts,
        produces,
        requires: requiresTransport ? [`${trn}HostTransport`] : [],
        parameters: ports.map(port => this.#readPort(view, port)).filter(Boolean)
      })
    }
    return records
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
