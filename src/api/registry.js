import { LICENCES } from '../store/GraphRegistry.js'

/**
 * The catalogue as an Open Audio Stack registry.
 *
 * `docs/suggestions.md` argues federation over competition: publish a view the
 * tooling that already exists can consume, rather than asking it to learn a new
 * format. OwlPlug and StudioRack read the Open Audio Stack registry, so this
 * catalogue answers in that shape — the same shape `OpenAudioStackHarvester`
 * reads, which is what makes the compatibility testable rather than asserted.
 *
 * Two rules decide what appears.
 *
 * **Only what is installable.** A registry entry promises an artefact: a
 * version, a URL, a checksum. Plugins the catalogue knows about but has no
 * release for are omitted rather than given an invented version — a registry
 * that lists things a package manager cannot install is worse than a shorter
 * one. The count omitted is reported, so the gap is visible.
 *
 * **Only what may be republished.** Each plugin's graph carries the licence
 * flag set when it was harvested, and a graph flagged not redistributable is
 * excluded here by the same selection that excludes it from the public dump.
 * Publishing in a second format is still publishing.
 */

/** Their convention for licence identifiers is lowercase: `gpl-2.0`. */
function licenceFor (spdx) {
  return spdx ? String(spdx).toLowerCase() : undefined
}

/**
 * Their `type` is a single word for what a package is.
 *
 * Taken from our categories, which are a SKOS scheme rather than a single
 * value, so only the two that map unambiguously are emitted. A guess here would
 * be a claim about somebody else's plugin in somebody else's vocabulary.
 */
function typeFor (categories) {
  if (categories.includes('instrument')) return 'instrument'
  if (categories.includes('effect')) return 'effect'
  return undefined
}

const list = value => (value ? String(value).split('|').filter(Boolean) : [])

/** Drop undefined keys, so an absent fact is absent rather than null. */
function compact (object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))
}

function fileFor (row) {
  return compact({
    systems: list(row.systems).map(type => ({ type })),
    architectures: list(row.architectures),
    contains: list(row.contains),
    type: row.fileKind,
    size: row.fileSize === undefined ? undefined : Number(row.fileSize),
    sha256: row.sha256,
    url: row.downloadUrl
  })
}

/**
 * Build the registry index from the query rows.
 *
 * @param {object[]} rows - from sparql/queries/plugin/registry.sparql
 * @param {Map<string,object>} sources - graph IRI to its provenance, for the licence flag
 */
export function buildRegistry (rows, sources = new Map()) {
  const plugins = new Map()
  const withheld = new Set()

  for (const row of rows) {
    const licence = sources.get(row.g)?.licence
    // Unknown is withheld, not assumed publishable: republishing is the thing
    // that cannot be taken back.
    if (!licence || !LICENCES[licence]?.redistributable) {
      withheld.add(row.plugin)
      continue
    }

    // Their slug where the plugin came with one, ours otherwise. Ours is a
    // content hash over the identifying tuple, so it is unique by construction
    // — which a registry key has to be.
    const slug = row.registrySlug || row.plugin.split('/').pop()
    if (!plugins.has(slug)) plugins.set(slug, { slug, versions: {} })
    const entry = plugins.get(slug)

    if (!entry.versions[row.version]) {
      entry.versions[row.version] = compact({
        name: row.name,
        author: row.vendor,
        description: row.description,
        license: licenceFor(row.licenceId),
        type: typeFor(list(row.categories)),
        tags: list(row.tags).length ? list(row.tags) : undefined,
        url: row.homepage,
        image: row.image,
        date: row.released,
        changes: row.changes,
        verified: row.verified === 'true' ? true : undefined,
        downloads: row.downloads === undefined ? undefined : Number(row.downloads),
        files: []
      })
    }
    if (row.file) entry.versions[row.version].files.push(fileFor(row))
  }

  const index = {}
  for (const [slug, entry] of [...plugins].sort(([a], [b]) => a.localeCompare(b))) {
    // "Latest" by release date where the source gave one, because a registry's
    // version strings are not reliably comparable and guessing an order would
    // point a package manager at the wrong release.
    const versions = Object.entries(entry.versions)
    const latest = versions
      .slice()
      .sort(([, a], [, b]) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
      .pop()
    index[slug] = compact({
      slug,
      version: latest[0],
      versions: entry.versions,
      downloads: latest[1].downloads
    })
  }
  return { index, withheld: [...withheld] }
}

export default buildRegistry
