/**
 * Reading a document's fields: which picture, and whose vendor.
 *
 * Small decisions about the shape of a loaded document, kept out of the
 * service because they are pure and because several of them are the kind of
 * thing a test wants to call directly.
 */

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
