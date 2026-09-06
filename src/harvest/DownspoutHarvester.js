import fs from 'fs'
import path from 'path'
import { Harvester, HarvestError } from './Harvester.js'
import { parseTurtleFile, GraphView } from './TurtleReader.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

const trn = NAMESPACES.trn
const rdfs = NAMESPACES.rdfs
const foaf = NAMESPACES.foaf
const doap = NAMESPACES.doap

/**
 * Harvests the curated behaviour profiles from the downspout repository:
 * one profile.ttl per plugin directory, 50 of them.
 *
 * These are hand-authored, which is why this harvester tolerates the two
 * spellings of min/max and the stray typos — it reads what is there and the
 * normaliser decides what it means. See docs/suggestions.md §2 on generating
 * these rather than writing them.
 */
export class DownspoutHarvester extends Harvester {
  constructor ({ repoPath, id = 'downspout' } = {}) {
    super({
      id,
      kind: 'source',
      // The user's own repository. Owned outright, so it can be released CC0
      // regardless of the code licence, which covers the code not the facts.
      licence: 'CC0-1.0',
      derivedFrom: repoPath ?? 'https://github.com/danja/downspout'
    })
    this.repoPath = repoPath
    if (!repoPath) throw new HarvestError('DownspoutHarvester needs repoPath')
  }

  /**
   * Read one profile.ttl into a raw record.
   *
   * Two shapes occur. 49 files are trn:PluginProfile as documented; one
   * (plugins/worms) is LV2/DOAP-shaped instead. A hand-maintained corpus drifts,
   * so the harvester reads whichever shape is present rather than rejecting the
   * odd one out — a plugin silently missing from the catalogue is worse than a
   * slightly more forgiving reader.
   */
  async readProfile (file) {
    const dataset = await parseTurtleFile(file)
    const view = new GraphView(dataset)
    const [subject] = view.subjectsOfType(`${trn}PluginProfile`)
    if (!subject) return this.#readDoapShape(view, file)

    const parameters = view.objects(subject, `${trn}parameter`).map(node => ({
      name: view.value(node, `${rdfs}label`) ?? view.value(node, `${trn}label`),
      symbol: view.value(node, `${trn}symbol`),
      comment: view.value(node, `${rdfs}comment`),
      // Both spellings are read here; the normaliser collapses them onto lv2:.
      // Not always numeric: the corpus has floats, "false" and a file path.
      default: view.scalar(node, `${trn}default`),
      min: view.number(node, `${trn}min`),
      minimum: view.number(node, `${trn}minimum`),
      max: view.number(node, `${trn}max`),
      maximum: view.number(node, `${trn}maximum`),
      unit: view.value(node, `${trn}unit`)
    }))

    const ccMappings = view.objects(subject, `${trn}ccMapping`).map(node => ({
      ccNumber: view.number(node, `${trn}ccNumber`),
      ccRole: view.value(node, `${trn}ccRole`),
      targetParameter: view.value(node, `${trn}targetParameter`),
      triggerValue: view.number(node, `${trn}ccTriggerValue`),
      comment: view.value(node, `${rdfs}comment`)
    }))

    return {
      sourceIri: subject.value,
      name: view.value(subject, `${rdfs}label`),
      description: view.value(subject, `${rdfs}comment`),
      vendor: view.value(subject, `${trn}vendor`),
      bundleName: view.value(subject, `${trn}bundleName`),
      classId: view.value(subject, `${trn}vstClassId`),
      homepage: view.value(subject, `${foaf}homepage`),
      // Every downspout plugin is a VST3 built with DPF.
      formats: [`${trn}VST3`],
      roles: view.values(subject, `${trn}role`),
      accepts: view.values(subject, `${trn}accepts`),
      produces: view.values(subject, `${trn}produces`),
      requires: view.values(subject, `${trn}requires`),
      recommendedBefore: view.values(subject, `${trn}recommendedBefore`),
      recommendedAfter: view.values(subject, `${trn}recommendedAfter`),
      cautions: view.values(subject, `${trn}caution`),
      genres: view.values(subject, `${trn}genre`),
      ccMappings,
      parameters
    }
  }

  /**
   * The LV2/DOAP fallback shape. Note that this file uses doap:name inside the
   * maintainer node where the LV2 bundles use foaf:name, so both are read.
   */
  #readDoapShape (view, file) {
    const [subject] = view.subjectsOfType(`${NAMESPACES.lv2}Plugin`)
    if (!subject) {
      throw new HarvestError(
        `${file} contains neither a trn:PluginProfile nor an lv2:Plugin`,
        { source: file }
      )
    }
    const maintainer = view.objects(subject, `${doap}maintainer`)[0]
    return {
      sourceIri: subject.value,
      name: view.value(subject, `${doap}name`) ?? view.value(subject, `${rdfs}label`),
      description: view.value(subject, `${doap}description`) ?? view.value(subject, `${doap}shortdesc`),
      vendor: maintainer
        ? (view.value(maintainer, `${doap}name`) ?? view.value(maintainer, `${foaf}name`))
        : null,
      homepage: maintainer
        ? (view.value(maintainer, `${doap}homepage`) ?? view.value(maintainer, `${foaf}homepage`))
        : null,
      bundleName: `${path.basename(path.dirname(file))}.vst3`,
      formats: [`${trn}VST3`],
      lv2Classes: view.values(subject, `${NAMESPACES.rdf}type`),
      roles: [],
      parameters: [],
      ccMappings: []
    }
  }

  async collect () {
    const pluginsDir = path.join(this.repoPath, 'plugins')
    if (!fs.existsSync(pluginsDir)) {
      throw new HarvestError(`No plugins directory at ${pluginsDir}`, { source: this.repoPath })
    }

    const records = []
    for (const entry of await fs.promises.readdir(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = path.join(pluginsDir, entry.name, 'profile.ttl')
      if (!fs.existsSync(file)) continue
      records.push(await this.readProfile(file))
    }
    return records
  }
}

export default DownspoutHarvester
