import fs from 'fs'
import path from 'path'
import GraphRegistry, { LICENCES } from './GraphRegistry.js'
import QueryService from './QueryService.js'
import { iri } from './SPARQLHelper.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * Assembling the public dataset.
 *
 * This is what the per-graph licensing design was for: publication is a
 * **selection over a flag set at harvest time**, not a review of individual
 * statements. Every graph carries a licence; the licence says whether the graph
 * may leave the building at all, whether it belongs in the CC0 dataset, and
 * whether a notice travels with it. Nothing here makes a judgement — it reads
 * flags and sorts.
 *
 * Three parts, because three different sets of terms cannot honestly be mixed
 * into one file:
 *
 *  - **cc0** — public-domain-equivalent, redistributable with nothing attached
 *  - **notice** — permissive but the notice travels: MIT, ISC, Apache and the
 *    rest, published separately with the notices beside them
 *  - **prose** — CC BY-SA user-authored text, share-alike and attributed, which
 *    must never be folded into a dump labelled CC0
 *
 * And a fourth set that is never written at all: graphs flagged
 * `redistributable: false`, which is how personal data is kept out of every
 * dump by the same mechanism that keeps a copyleft source out of the CC0 one.
 *
 * **One file per graph**, rather than one file per section. Turtle carries no
 * graph name, so a merged file would lose exactly the provenance the design
 * exists to keep; the manifest names each file's graph, licence and source, so
 * a consumer can reload the dataset into the same graphs it came from.
 */

const pu = NAMESPACES.pu

export class DumpError extends Error {
  constructor (message) {
    super(message)
    this.name = 'DumpError'
  }
}

/** Which part of the dump a graph belongs in, or null to withhold it. */
export function sectionFor (licence) {
  const terms = LICENCES[licence]
  // An unrecognised licence is withheld by throwing rather than by guessing.
  // The failure mode of guessing here is publishing something that should not
  // have been published, which cannot be taken back.
  if (!terms) throw new DumpError(`Graph carries an unknown licence "${licence}"; refusing to publish it.`)
  if (!terms.redistributable) return null
  if (terms.cc0Dump) return 'cc0'
  // Share-alike before notice: CC BY-SA carries a notice *and* governs what a
  // consumer may build from it, and only the second decides which dataset it
  // belongs to.
  if (terms.shareAlike) return 'prose'
  return 'notice'
}

/** A graph IRI as a filename: graph:source/downspout → source-downspout.ttl */
export function fileNameFor (graph) {
  const name = graph.replace(/^graph:/, '').replace(/[^A-Za-z0-9._-]+/g, '-')
  if (!name || name.includes('..')) throw new DumpError(`Cannot make a filename from ${graph}`)
  return `${name}.ttl`
}

export class DumpBuilder {
  constructor (client, {
    registry = new GraphRegistry(client),
    queries = new QueryService(),
    outputDir = 'data/dumps'
  } = {}) {
    if (!client) throw new DumpError('DumpBuilder needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.queries = queries
    this.outputDir = outputDir
  }

  /** Every registered graph, with the licensing facts a dump needs. */
  async graphs () {
    return this.client.select(this.queries.get('graph/dump-graphs', {
      metadataGraph: iri(this.registry.metadataGraph)
    }))
  }

  /**
   * Write the dataset.
   *
   * Returns a report naming what was written and, as importantly, what was
   * withheld and why — a dump that silently omits something is as hard to trust
   * as one that silently includes it.
   */
  async build ({ now = new Date() } = {}) {
    const rows = await this.graphs()
    if (rows.length === 0) throw new DumpError('The graph registry is empty; there is nothing to publish.')

    // Clear the sections before writing them.
    //
    // Without this a graph that changes licence leaves its old file behind in
    // the section it used to belong to, and a graph that is dropped is
    // published forever. It happened on the second run here: reclassifying
    // CC BY-SA prose out of `notice` left a copy of it there, so the same text
    // was published twice under two different sets of terms.
    await this.#clearSections()

    const parts = { cc0: [], notice: [], prose: [] }
    const withheld = []

    for (const row of rows) {
      const section = sectionFor(row.licence)
      if (!section) {
        withheld.push({ graph: row.graph, licence: row.licence, reason: 'not redistributable' })
        continue
      }
      const turtle = await this.client.construct(
        this.queries.get('graph/contents', { graph: iri(row.graph) }))
      const file = path.join(section, fileNameFor(row.graph))
      await this.#write(file, turtle)
      parts[section].push({
        ...row,
        file,
        bytes: Buffer.byteLength(turtle),
        // Counted from the store rather than from the serialisation, so the
        // figure in the VoID description is the graph's size and not an
        // artefact of how it was written out.
        triples: await this.#countTriples(row.graph)
      })
    }

    await this.#write('notice/NOTICES.txt', this.#notices(parts.notice))
    await this.#write('README.md', this.#readme(parts, withheld, now))
    await this.#write('void.ttl', this.#void(parts, now))
    const manifest = {
      generatedAt: now.toISOString(),
      catalogue: pu,
      parts: Object.fromEntries(Object.entries(parts).map(([name, graphs]) => [name, {
        licence: name === 'cc0' ? 'CC0-1.0' : name === 'prose' ? 'CC-BY-SA-4.0' : 'various permissive',
        graphs: graphs.map(({ graph, licence, file, triples, derivedFrom }) =>
          ({ graph, licence, file, triples, derivedFrom: derivedFrom ?? null }))
      }])),
      withheld
    }
    await this.#write('MANIFEST.json', JSON.stringify(manifest, null, 2))
    return { ...manifest, outputDir: this.outputDir }
  }

  /**
   * Empty the section directories, and only those.
   *
   * Scoped to the three names this builder writes, so a mistyped `--out` cannot
   * turn a publish step into a delete of somebody's directory.
   */
  async #clearSections () {
    for (const section of ['cc0', 'notice', 'prose']) {
      const dir = path.join(this.outputDir, section)
      if (!fs.existsSync(dir)) continue
      for (const entry of await fs.promises.readdir(dir)) {
        if (entry.endsWith('.ttl') || entry === 'NOTICES.txt') {
          await fs.promises.unlink(path.join(dir, entry))
        }
      }
    }
  }

  async #countTriples (graph) {
    const [row] = await this.client.select(
      this.queries.get('graph/triple-count', { graph: iri(graph) }))
    return Number(row?.n ?? 0)
  }

  async #write (relative, contents) {
    const file = path.join(this.outputDir, relative)
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(file, contents)
    return file
  }

  /**
   * The notices that travel with the permissive graphs.
   *
   * A file listing which source each graph came from, so that redistributing
   * them carries the attribution their licences require. Empty is fine and is
   * still written: an absent notices file reads as an oversight, a present one
   * saying "none" reads as an answer.
   */
  #notices (graphs) {
    const lines = [
      'Notices for the permissively-licensed part of the Plugin Universe dataset.',
      '',
      'These graphs are redistributable and carry their own terms. They are',
      'published separately from the CC0 dataset for exactly that reason.',
      ''
    ]
    if (graphs.length === 0) lines.push('No graph in this dataset currently requires a notice.')
    for (const graph of graphs) {
      lines.push(`${graph.graph}`)
      lines.push(`  licence:     ${graph.licence}`)
      lines.push(`  derived from: ${graph.derivedFrom ?? 'unrecorded'}`)
      lines.push(`  file:        ${graph.file}`)
      lines.push('')
    }
    return lines.join('\n')
  }

  /**
   * What this dump is, in prose, for whoever finds the directory.
   *
   * Including what it does *not* contain. A dataset that quietly omits
   * something is as hard to trust as one that quietly includes it, and the
   * attribution gap below is a real limitation a consumer needs to know about
   * rather than discover.
   */
  #readme (parts, withheld, now) {
    const counted = section => parts[section].reduce((total, graph) => total + graph.triples, 0)
    return `# Plugin Universe — published dataset

Generated ${now.toISOString()}.

An open catalogue of audio plugins. Three parts, because three sets of terms
cannot honestly be merged into one file.

| Part | Terms | Graphs | Triples |
|---|---|---|---|
| \`cc0/\` | CC0 1.0, public domain | ${parts.cc0.length} | ${counted('cc0')} |
| \`notice/\` | permissive, notices in \`NOTICES.txt\` | ${parts.notice.length} | ${counted('notice')} |
| \`prose/\` | CC BY-SA 4.0, share-alike | ${parts.prose.length} | ${counted('prose')} |

One file per graph. Turtle carries no graph name, so a merged file would lose
the provenance this catalogue is built around; \`MANIFEST.json\` names each
file's graph, licence and source, and \`void.ttl\` describes the dataset.

## What is not here

${withheld.length} graph(s) are withheld because they are flagged not
redistributable — accounts and pending contributions, which are personal data.
They are excluded by the same selection over the same flag that decides
everything else, rather than by anybody remembering.

**A limitation worth stating plainly.** The prose in \`prose/\` is CC BY-SA and
therefore requires attribution, and each revision records the account it is
attributed to — but the mapping from that account IRI to a person's name is in
a withheld graph, so this dump alone does not tell you whom to credit. Resolve
the account IRI against https://plugin-universe.com, or ask. Closing that
properly means publishing a minimal public attribution record, which is a
decision about personal data and not one to take silently.

## Reusing it

Attribution for the CC0 part is requested, not required:
Plugin Universe — https://plugin-universe.com
`
  }

  /** A VoID description, so the dump describes itself. */
  #void (parts, now) {
    const dataset = `${pu}dataset`
    const lines = [
      `@prefix void: <${NAMESPACES.void}> .`,
      `@prefix dcterms: <${NAMESPACES.dcterms}> .`,
      `@prefix rdfs: <${NAMESPACES.rdfs}> .`,
      `@prefix pu: <${pu}> .`,
      '',
      '# The Plugin Universe dataset, as published.',
      '#',
      '# Three subsets, because three sets of terms cannot honestly be merged into',
      '# one file. Graphs holding personal data are not here at all: they carry a',
      '# licence flagged not redistributable, and the same selection that builds',
      '# this description excludes them.',
      '',
      `<${dataset}> a void:Dataset ;`,
      '    rdfs:label "Plugin Universe" ;',
      `    dcterms:modified "${now.toISOString()}"^^<${NAMESPACES.xsd}dateTime> ;`,
      `    void:uriSpace "${pu}" ;`,
      ...Object.keys(parts).map(name => `    void:subset <${dataset}/${name}> ;`),
      `    dcterms:license <https://creativecommons.org/publicdomain/zero/1.0/> .`,
      ''
    ]

    const LICENCE_IRI = {
      cc0: 'https://creativecommons.org/publicdomain/zero/1.0/',
      prose: 'https://creativecommons.org/licenses/by-sa/4.0/',
      notice: 'https://spdx.org/licenses/'
    }
    const DESCRIPTION = {
      cc0: 'Catalogue facts, dedicated to the public domain. Attribution requested, not required.',
      notice: 'Facts drawn from permissively-licensed sources. Redistributable, with the notices in notice/NOTICES.txt.',
      prose: 'Contributor-authored prose, share-alike and attributed to its authors.'
    }
    for (const [name, graphs] of Object.entries(parts)) {
      lines.push(
        `<${dataset}/${name}> a void:Dataset ;`,
        `    rdfs:label "Plugin Universe — ${name}" ;`,
        `    dcterms:description "${DESCRIPTION[name]}" ;`,
        `    dcterms:license <${LICENCE_IRI[name]}> ;`,
        `    void:triples ${graphs.reduce((total, graph) => total + graph.triples, 0)} ;`,
        ...graphs.map(graph => `    void:dataDump <${graph.file}> ;`),
        `    void:uriSpace "${pu}" .`,
        ''
      )
    }
    return lines.join('\n')
  }
}

export default DumpBuilder
