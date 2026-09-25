/**
 * Reading a document's fields: which picture, and whose vendor.
 *
 * Small decisions about the shape of a loaded document, kept out of the
 * service because they are pure and because several of them are the kind of
 * thing a test wants to call directly.
 */

import { PLATFORMS, toPlatform } from '../harvest/Platforms.js'

export function pickImage (images, origin = '') {
  if (!images) return null
  const candidates = String(images).split(' ').filter(Boolean)
  if (candidates.length === 0) return null
  const local = candidates.find(url => isLocalImage(url, origin))
  return local ?? candidates[0]
}

/**
 * Is this depiction one the catalogue itself stores?
 *
 * Decided here, where the origin is known, and carried on the document — the
 * renderer has no origin and would have to be given one to work it out again.
 * It changes what a reader is told: an image served from here *is* copied here,
 * and the caption saying it was not is then simply false.
 */
export function isLocalImage (url, origin = '') {
  return Boolean(origin) && typeof url === 'string' && url.startsWith(`${origin}/image/`)
}

/**
 * A vendor's name as it appears in a URL: lower case, hyphen-separated.
 *
 * Readable, because a person reads it — `/vendor/chowdhury-dsp` says who it is
 * and `/vendor/chowdhurydsp` makes them guess.
 */
export function vendorSlug (name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The key two spellings of one vendor have in common.
 *
 * Stricter than the slug: punctuation and spacing are dropped rather than
 * turned into hyphens, so "SFZ Tools" and "SFZTools" land on `sfztools` and are
 * recognised as one vendor. Slugging alone keeps them apart, which is why there
 * are two functions — the URL wants the separators and the grouping does not.
 *
 * Of 365 vendor strings in the catalogue this merges exactly two pairs, both of
 * them genuine: "SFZ Tools"/"SFZTools" and "olegkapitonov"/"Oleg Kapitonov".
 *
 * **It is a grouping, not an identity**, and the difference is the whole of why
 * a paid vendor profile is not simply this with an edit button. "danja" and
 * "Danny Ayers" are one person and 86 plugins, and nothing derivable from the
 * strings will ever say so; a vendor who renames gets a new key and loses
 * whatever was attached to the old one. A profile somebody pays for needs a
 * minted IRI that names point at, rather than a key computed from a name — see
 * the note in TODO.md.
 */
export function vendorKey (name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * Download rows grouped by plugin.
 *
 * From `plugin/downloads.sparql`: one row per package file, with the source's
 * own operating-system tokens concatenated. Pure, so the grouping is testable
 * without a store: the service only stamps the result onto its documents.
 *
 * @param {object[]} rows - each with plugin, url and systems ("win|mac" or "")
 * @returns {Map<string, {url: string, systems: string[]}[]>}
 */
export function groupDownloads (rows) {
  const grouped = new Map()
  for (const row of rows ?? []) {
    if (!row?.plugin || !row?.url) continue
    const systems = String(row.systems ?? '').split('|').filter(Boolean)
    if (!grouped.has(row.plugin)) grouped.set(row.plugin, [])
    const files = grouped.get(row.plugin)
    // One row per file, but a file repeated across packages would repeat its
    // URL: the second copy is the same artefact, not a second download.
    if (!files.some(file => file.url === row.url)) files.push({ url: row.url, systems })
  }
  return grouped
}

/**
 * What a download link says on the page.
 *
 * The file's stated systems, mapped through the same table the harvesters
 * derive platforms with — so "win" reads as Windows here exactly as it does a
 * row above in the Platforms list. A file the source said nothing about is a
 * plain Download rather than a guess: absent means nobody has said.
 */
export function downloadLabel (download) {
  const names = []
  for (const platform of PLATFORMS) {
    const local = platform.slice(platform.lastIndexOf('/') + 1)
    if ((download?.systems ?? []).some(system => toPlatform(system) === platform) &&
      !names.includes(local)) {
      names.push(local)
    }
  }
  return names.length ? `Download for ${names.join(' / ')}` : 'Download'
}
