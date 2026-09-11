import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { IMAGE_CONFIG } from '../../config/preferences.js'

/**
 * Uploaded images: deciding what they are, and putting them somewhere safe.
 *
 * The first bytes this project accepts from a stranger, and the first thing it
 * stores that is not a triple. Four rules, each of which closes a hole that is
 * routinely left open:
 *
 * **What it is, is what the bytes say.** Not the `Content-Type` header, not the
 * extension — both are supplied by whoever is uploading. A file claiming to be
 * a PNG and beginning `<?xml` is not a PNG, and the only way to know is to
 * look.
 *
 * **SVG is refused, and must stay refused.** It is a script container. An SVG
 * served from this origin is a stored cross-site scripting hole wearing a
 * picture's file extension, and no amount of sanitising makes that a good
 * trade for a screenshot.
 *
 * **The filename is the hash of the content.** Nothing a person typed reaches
 * the filesystem, so `../` cannot be spelled; and two uploads of one picture
 * become one file rather than two.
 *
 * **The size limit is enforced while reading.** A cap applied once the file is
 * in memory is not a cap — the memory is already spent.
 */

export class ImageError extends Error {
  constructor (message) {
    super(message)
    this.name = 'ImageError'
  }
}

/**
 * What these bytes actually are, or null.
 *
 * Reads only the first few bytes, and recognises exactly the four formats every
 * browser renders and none that can carry script.
 */
export function sniff (buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null
  const head = buffer.subarray(0, 12).toString('hex')

  for (const [name, spec] of Object.entries(IMAGE_CONFIG.accepted)) {
    if (name === 'webp') continue
    if (head.startsWith(spec.magic)) {
      return { type: spec.type, extension: name === 'gif87' ? 'gif' : (name === 'jpeg' ? 'jpg' : name) }
    }
  }
  // WebP is "RIFF", four bytes of length, then "WEBP" — so the signature is
  // split and a prefix match cannot express it.
  if (head.startsWith(IMAGE_CONFIG.accepted.webp.magic) &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { type: 'image/webp', extension: 'webp' }
  }
  return null
}

/**
 * Why these bytes are not acceptable, or null if they are.
 *
 * Separate from sniff so the message can name the likely cause. "Not an image"
 * is true of an SVG and unhelpful to the person who chose one.
 */
export function reasonRefused (buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return 'No file arrived.'
  if (buffer.length > IMAGE_CONFIG.maxBytes) {
    return `That is larger than ${Math.round(IMAGE_CONFIG.maxBytes / 1024)} kB.`
  }
  if (sniff(buffer)) return null

  const start = buffer.subarray(0, 400).toString('utf8').trimStart().toLowerCase()
  if (start.startsWith('<?xml') || start.startsWith('<svg')) {
    return 'SVG is not accepted. It can carry script, so it is not a picture this site will serve. ' +
      'Export it as a PNG.'
  }
  if (start.startsWith('%pdf')) return 'That is a PDF, not an image.'
  return 'That is not a PNG, JPEG, GIF or WebP. Those are the four this site serves.'
}

export class ImageStore {
  /**
   * @param {object} [options]
   * @param {string} [options.directory] - where the files go
   * @param {string} [options.baseUri] - the site origin, for the IRI an image gets
   */
  constructor ({ directory = IMAGE_CONFIG.directory, origin = '' } = {}) {
    this.directory = directory
    this.origin = origin.replace(/\/$/, '')
  }

  /** The path a stored image occupies. Derived, never taken from a request. */
  fileFor (name) {
    if (!/^[0-9a-f]{64}\.(png|jpg|gif|webp)$/.test(name)) {
      throw new ImageError(`"${name}" is not the name of a stored image.`)
    }
    return path.join(this.directory, name)
  }

  /** The URL an image is served at. Same-origin, so nothing is fetched from elsewhere. */
  urlFor (name) {
    return `${this.origin}/image/${name}`
  }

  /**
   * Store the bytes, and say what they became.
   *
   * Content-addressed, so storing the same picture twice is one file and the
   * second store is a no-op rather than an overwrite.
   */
  async store (buffer) {
    const refused = reasonRefused(buffer)
    if (refused) throw new ImageError(refused)

    const { type, extension } = sniff(buffer)
    const digest = crypto.createHash('sha256').update(buffer).digest('hex')
    const name = `${digest}.${extension}`
    const file = this.fileFor(name)

    await fs.promises.mkdir(this.directory, { recursive: true })
    // wx: refuse to overwrite. An existing file with this name has the same
    // content by construction, so there is nothing to write and nothing lost.
    try {
      await fs.promises.writeFile(file, buffer, { flag: 'wx' })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    return { name, type, bytes: buffer.length, url: this.urlFor(name), file }
  }

  /** Read one back, with the type sniffed again rather than trusted from the name. */
  async read (name) {
    const buffer = await fs.promises.readFile(this.fileFor(name))
    const sniffed = sniff(buffer)
    if (!sniffed) throw new ImageError(`${name} is on disk and is not an image; refusing to serve it.`)
    return { buffer, type: sniffed.type }
  }

  /** Every stored image, for the backup to carry. */
  async list () {
    try {
      return (await fs.promises.readdir(this.directory))
        .filter(name => /^[0-9a-f]{64}\.(png|jpg|gif|webp)$/.test(name))
        .sort()
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }
}

export default ImageStore
