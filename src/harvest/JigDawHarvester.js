import fs from 'fs'
import path from 'path'
import { Harvester, HarvestError } from './Harvester.js'
import { parseTurtleFile, GraphView } from './TurtleReader.js'
import { readPort } from './Lv2Bundle.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { FREE } from './Licensing.js'
import JigDawScreenshots from './JigDawScreenshots.js'

const trn = NAMESPACES.trn
const pu = NAMESPACES.pu
const jig = NAMESPACES.jig
const rdfs = NAMESPACES.rdfs
const foaf = NAMESPACES.foaf
const lv2 = NAMESPACES.lv2

/**
 * Harvests the JigDAW plugins: one generated `profile.ttl` per directory under
 * `plugins/<name>/`, three of them as of 2026-09-18.
 *
 * JigDAW plugins run in a browser — an AudioWorklet processor over a
 * WebAssembly module, fetched from the plugin's own IRI — which is why
 * `trn:Jig` exists (see vocabs/trn-extensions.ttl). Nothing else about
 * them is new: the profiles extend the format published at /about/profiles, so
 * this reads `trn:` and `lv2:` exactly as the other sources do and the ports go
 * through `readPort`, the same interpretation an LV2 bundle gets.
 *
 * Unlike downspout's, these files are generated from `profile.json` by the
 * upstream build, so the spellings are consistent and there is no drift to
 * tolerate. What the profile does not say, this harvester does not invent.
 *
 * **The `jig:` half is deliberately not harvested.** A profile also carries the
 * module and processor locations with their SRI digests, the render quantum,
 * the declared latency and the channel counts. They are real and they are
 * useful — to a host. Nothing in `sparql/queries/` selects them, no page shows
 * them and no facet filters on them, and writing a predicate that nothing reads
 * back is the failure at the top of CLAUDE.md, three times over. When something
 * is built that reads them, the write path is four lines here and the read path
 * is the work. It is in INBOX.md so it is not lost.
 */
export class JigDawHarvester extends Harvester {
  /**
   * @param {object} options
   * @param {string} options.repoPath - the jigdaw checkout
   * @param {string} [options.id]
   * @param {object} [options.screenshots] - a `JigDawScreenshots`, when the
   *   caller wants pictures. A harvester is otherwise a reader of files, and a
   *   browser on the harvest path would be a surprise; so pictures are opt-in
   *   and `bin/harvest-jigdaw.js` is what asks for them.
   * @param {object} [options.imageStore] - where a rendered panel is kept, and
   *   what URL it is served at. An `ImageStore`. Needed whenever screenshots
   *   are, because `foaf:depiction` takes an IRI and a picture on this
   *   machine's disk has none until it is given one.
   */
  constructor ({ repoPath, id = 'jigdaw', screenshots = null, imageStore = null } = {}) {
    super({
      id,
      kind: 'source',
      // The user's own repository, like downspout: owned outright, so the facts
      // can be released CC0 whatever the code licence says. Apache-2.0 covers
      // the plugins themselves and travels with each one as pu:licenceId below.
      licence: 'CC0-1.0',
      // The public origin, not the local checkout this happens to be read from.
      derivedFrom: 'https://github.com/danja/jigdaw'
    })
    this.repoPath = repoPath
    if (!repoPath) throw new HarvestError('JigDawHarvester needs repoPath')
    if (screenshots && !imageStore) {
      throw new HarvestError(
        'JigDawHarvester: screenshots were asked for without an imageStore. ' +
        'A panel rendered here has no URL of its own, and foaf:depiction needs one.'
      )
    }
    this.screenshots = screenshots
    this.imageStore = imageStore
    // Read at run time, not declared at construction: bin/ingest.js prints
    // these after a harvest, and a harvester that cannot report why five
    // plugins have no picture is the silent-gap failure CLAUDE.md is about.
    this.notes = []
  }

  /**
   * Read one profile.ttl into a raw record.
   *
   * A file with no `trn:PluginProfile` in it is an error rather than a skip:
   * these are generated, so the shape is not a matter of an author's habits,
   * and a plugin quietly missing from the catalogue is the hardest kind of gap
   * to notice.
   */
  async readProfile (file) {
    const dataset = await parseTurtleFile(file)
    const view = new GraphView(dataset)
    const [subject] = view.subjectsOfType(`${trn}PluginProfile`)
    if (!subject) {
      throw new HarvestError(
        `${file} contains no trn:PluginProfile`,
        { source: file }
      )
    }

    // Declared in the profile, and `trn:Jig` regardless: a jig:WebPlugin is
    // one by definition, and the type is the evidence rather than a default
    // standing in for a missing value. Profiles in the wild also declare the
    // retired `trn:WebAudio`; the normaliser maps that to Jig on the way in,
    // so it is kept here rather than stripped.
    const formats = new Set(view.values(subject, `${trn}format`))
    if (view.hasType(subject, `${jig}WebPlugin`)) {
      formats.add(`${trn}Jig`)
    }

    return {
      // JigDAW plugins are identified by a dereferenceable IRI of their own —
      // that is the whole design — so it is the identity `URIMinter` uses and
      // is preserved with owl:sameAs, as an LV2 plugin's is.
      sourceIri: subject.value,
      name: view.value(subject, `${rdfs}label`),
      description: view.value(subject, `${rdfs}comment`),
      vendor: view.value(subject, `${trn}vendor`),
      homepage: view.value(subject, `${foaf}homepage`),
      // The profile states its own SPDX identifier, so nothing is inferred from
      // the repository here; `#repositoryTerms` only fills a silence.
      licence: view.value(subject, `${pu}licenceId`),
      formats: [...formats],
      roles: view.values(subject, `${trn}role`),
      accepts: view.values(subject, `${trn}accepts`),
      produces: view.values(subject, `${trn}produces`),
      requires: view.values(subject, `${trn}requires`),
      recommendedBefore: view.values(subject, `${trn}recommendedBefore`),
      recommendedAfter: view.values(subject, `${trn}recommendedAfter`),
      cautions: view.values(subject, `${trn}caution`),
      genres: view.values(subject, `${trn}genre`),
      // No pu:supportedPlatform, and not an omission: the platform is the
      // browser, which is not one of the three operating systems that predicate
      // enumerates. trn:Jig carries what a platform list would have said.
      platforms: [],
      ccMappings: [],
      parameters: view.objects(subject, `${lv2}port`)
        .map(port => readPort(view, port))
        .filter(Boolean)
    }
  }

  /**
   * The repository's own terms, for the facts a profile does not carry.
   *
   * jigdaw is Apache-2.0 (its LICENSE file and package.json), and the plugins
   * are served from the author's own site at no charge. Both are facts about
   * the user's own work rather than inferences, which is the only reason they
   * can be asserted here at all — see docs/sources.md §4.
   */
  #repositoryTerms (record) {
    return { ...record, licence: record.licence ?? 'Apache-2.0', pricing: FREE }
  }

  /**
   * Store a panel screenshot and return the IRI to depict the plugin with.
   *
   * Through `ImageStore` rather than a path assembled here, because the name is
   * the SHA-256 of the bytes and the URL is the site's own — and because
   * `documents.js` decides a depiction is "ours" by exactly that prefix. A URL
   * written by hand would look right in a page and be captioned as somebody
   * else's picture.
   *
   * A failure is a note, not a rejection: the plugin is real, its panel could
   * not be photographed, and dropping the plugin would be a far worse answer
   * than publishing it without a picture. Reported so the gap is visible.
   */
  async #depiction (name, record) {
    try {
      const { buffer, source } = await this.screenshots.forPlugin(name, {
        ports: record.parameters.length
      })
      const stored = await this.imageStore.store(buffer)
      return { image: stored.url, note: `${name}: ${source} panel, ${stored.name}` }
    } catch (error) {
      return { image: null, note: `${name}: no screenshot — ${error.message}` }
    }
  }

  async collect () {
    const pluginsDir = path.join(this.repoPath, 'plugins')
    if (!fs.existsSync(pluginsDir)) {
      throw new HarvestError(`No plugins directory at ${pluginsDir}`, { source: this.repoPath })
    }

    const records = []
    // Reset rather than appended to: one harvester, one run, and a second
    // collect() must not report the first run's notes again.
    this.notes = []
    for (const entry of await fs.promises.readdir(pluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = path.join(pluginsDir, entry.name, 'profile.ttl')
      if (!fs.existsSync(file)) continue
      const record = this.#repositoryTerms(await this.readProfile(file))

      if (this.screenshots) {
        const { image, note } = await this.#depiction(entry.name, record)
        record.image = image
        this.notes.push(note)
      }
      records.push(record)
    }
    return records
  }
}

/** Re-exported so a caller can build one without a second import line. */
export { JigDawScreenshots }

export default JigDawHarvester
