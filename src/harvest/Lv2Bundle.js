import { GraphView } from './TurtleReader.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * Reading an LV2 bundle, wherever its Turtle came from.
 *
 * Extracted from Lv2Harvester so that a bundle fetched over the GitHub API and
 * a bundle read off disk go through exactly one interpretation. They are the
 * same bundles; only the transport differs, and a second copy of this logic
 * would drift from the first.
 *
 * LV2 is the one format that ships machine-readable metadata by design, so
 * there is almost no interpretation here: the bundle already says what the
 * catalogue wants to know, in the vocabulary the catalogue uses. That is the
 * payoff of describing parameters with lv2:port (docs/architecture.md §2.3).
 */

const lv2 = NAMESPACES.lv2
const rdf = NAMESPACES.rdf
const rdfs = NAMESPACES.rdfs
const doap = NAMESPACES.doap
const foaf = NAMESPACES.foaf
const trn = NAMESPACES.trn
const atom = NAMESPACES.atom
const midi = NAMESPACES.midi
const time = NAMESPACES.time
const units = NAMESPACES.units

/**
 * One port node. Only control ports are parameters; audio and atom ports
 * describe connectivity, which is captured as accepts/produces instead.
 */
export function readPort (view, node) {
  const types = view.values(node, `${rdf}type`)
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
    unit: view.value(node, `${units}unit`),
    integer: properties.includes(`${lv2}integer`),
    scalePoints,
    direction: types.includes(`${lv2}OutputPort`) ? 'output' : 'input'
  }
}

/** Signal types a plugin accepts and produces, from its port list. */
export function readSignals (view, ports) {
  const accepts = new Set()
  const produces = new Set()
  for (const port of ports) {
    const types = view.values(port, `${rdf}type`)
    const target = types.includes(`${lv2}OutputPort`) ? produces : accepts

    if (types.includes(`${lv2}AudioPort`)) target.add(`${trn}Audio`)
    if (types.includes(`${atom}AtomPort`)) {
      if (view.values(port, `${atom}supports`).includes(`${midi}MidiEvent`)) {
        target.add(`${trn}Midi`)
      }
    }
  }
  return { accepts: [...accepts], produces: [...produces] }
}

/**
 * Every lv2:Plugin described by a dataset, as raw harvest records.
 *
 * @param {import('@rdfjs/types').DatasetCore} dataset - the bundle's Turtle,
 *   all files merged. A manifest points at further files with rdfs:seeAlso;
 *   reading every .ttl in the bundle into one view is equivalent and simpler.
 * @param {object} [context]
 * @param {string|null} [context.vendor] - overrides the maintainer name when
 *   the harvest knows better than the bundle does
 * @param {string|null} [context.homepage] - where the bundle was found
 */
export function readBundleDataset (dataset, { vendor = null, homepage = null } = {}) {
  const view = new GraphView(dataset)
  const records = []

  for (const subject of view.subjectsOfType(`${lv2}Plugin`)) {
    const ports = view.objects(subject, `${lv2}port`)
    const { accepts, produces } = readSignals(view, ports)
    const maintainerNode = view.objects(subject, `${doap}maintainer`)[0]
    const requiresTransport = ports.some(port =>
      view.values(port, `${atom}supports`).includes(`${time}Position`))

    // LV2 bundles use foaf:name inside the maintainer node; some hand-written
    // profiles use doap:name there instead. Both are read, neither guessed.
    const maintainer = maintainerNode
      ? (view.value(maintainerNode, `${foaf}name`) ?? view.value(maintainerNode, `${doap}name`))
      : null

    records.push({
      // LV2 plugins carry a canonical, dereferenceable IRI already. It is
      // preserved with owl:sameAs rather than replaced.
      sourceIri: subject.value,
      name: view.value(subject, `${doap}name`) ?? view.value(subject, `${rdfs}label`),
      description: view.value(subject, `${rdfs}comment`),
      vendor: vendor ?? maintainer,
      maintainer,
      homepage: (maintainerNode ? view.value(maintainerNode, `${foaf}homepage`) : null) ?? homepage,
      project: view.value(subject, `${lv2}project`),
      licence: view.value(subject, `${doap}license`),
      formats: [`${trn}LV2`],
      lv2Classes: view.values(subject, `${rdf}type`),
      accepts,
      produces,
      requires: requiresTransport ? [`${trn}HostTransport`] : [],
      parameters: ports.map(port => readPort(view, port)).filter(Boolean)
    })
  }
  return records
}

/**
 * Directories that hold copies of bundles rather than sources.
 *
 * A repository typically contains the same bundle several times over: the
 * source tree, a build directory, a staging directory and a tagged release.
 * Harvesting all of them yields the same plugin repeatedly, which then either
 * collides on its IRI or inflates the catalogue.
 */
export const SKIP_DIRECTORIES = Object.freeze(new Set([
  'build', 'builddir', 'build-output', 'staging', 'releases', 'dist',
  'target', 'out', 'node_modules'
]))

/** True when a repository path lies inside a build or release copy. */
export function isBuildPath (relativePath) {
  return relativePath.split('/').some(segment => SKIP_DIRECTORIES.has(segment))
}

export default readBundleDataset
