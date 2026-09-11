import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { sniff, reasonRefused, ImageStore, ImageError } from '../../src/api/ImageStore.js'
import { IMAGE_CONFIG } from '../../config/preferences.js'

/**
 * Accepting bytes from a stranger.
 *
 * The first binary this project takes from outside. Every assertion here is
 * about a hole that is routinely left open: trusting the declared type,
 * trusting the filename, accepting SVG, and applying a size limit after the
 * file is already in memory.
 */

const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  Buffer.from('0000000d49484452', 'hex'),
  Buffer.alloc(64)
])
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a46494600', 'hex'), Buffer.alloc(64)])
const GIF = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(64)])
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'), Buffer.from('24000000', 'hex'),
  Buffer.from('WEBP', 'ascii'), Buffer.alloc(64)
])
const SVG = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

let directory

afterAll(async () => {
  if (directory) await fs.promises.rm(directory, { recursive: true, force: true })
})

describe('deciding what a file is', () => {
  it('recognises the four formats every browser renders', () => {
    expect(sniff(PNG)).toEqual({ type: 'image/png', extension: 'png' })
    expect(sniff(JPEG)).toEqual({ type: 'image/jpeg', extension: 'jpg' })
    expect(sniff(GIF)).toEqual({ type: 'image/gif', extension: 'gif' })
    expect(sniff(WEBP)).toEqual({ type: 'image/webp', extension: 'webp' })
  })

  it('reads the bytes, not the name or the declared type', () => {
    // Both are supplied by whoever is uploading.
    const liar = Buffer.concat([Buffer.from('not an image at all'), Buffer.alloc(64)])
    expect(sniff(liar)).toBeNull()
  })

  it('refuses SVG, and says why rather than calling it "not an image"', () => {
    expect(sniff(SVG)).toBeNull()
    expect(reasonRefused(SVG)).toMatch(/SVG is not accepted/)
    expect(reasonRefused(SVG)).toMatch(/script/)
  })

  it('does not mistake RIFF for WebP', () => {
    // A WAV file is RIFF too, and a prefix match would have taken it.
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'), Buffer.from('24000000', 'hex'),
      Buffer.from('WAVE', 'ascii'), Buffer.alloc(64)
    ])
    expect(sniff(wav)).toBeNull()
  })

  it('names a PDF as a PDF', () => {
    expect(reasonRefused(Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(64)])))
      .toMatch(/PDF/)
  })

  it('refuses anything over the cap', () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(IMAGE_CONFIG.maxBytes)])
    expect(reasonRefused(huge)).toMatch(/larger than/)
  })

  it('refuses an empty upload', () => {
    expect(reasonRefused(Buffer.alloc(0))).toMatch(/No file/)
  })
})

describe('storing one', () => {
  it('names the file after its content, so nothing typed reaches the filesystem', async () => {
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pu-images-'))
    const store = new ImageStore({ directory, origin: 'https://example.test' })

    const stored = await store.store(PNG)
    expect(stored.name).toMatch(/^[0-9a-f]{64}\.png$/)
    expect(stored.type).toBe('image/png')
    expect(stored.url).toBe(`https://example.test/image/${stored.name}`)
    expect(fs.existsSync(path.join(directory, stored.name))).toBe(true)
  })

  it('stores one picture once, however many times it is uploaded', async () => {
    const store = new ImageStore({ directory, origin: 'https://example.test' })
    const first = await store.store(PNG)
    const second = await store.store(PNG)
    expect(second.name).toBe(first.name)
    expect(await store.list()).toHaveLength(1)
  })

  it('refuses to build a path out of anything but a hash', async () => {
    const store = new ImageStore({ directory })
    // `../` cannot be spelled in a 64-character hex string, and this is what
    // makes that true rather than hoped.
    for (const name of ['../../etc/passwd', 'a.png', '..%2Fx.png', 'abc.svg', `${'a'.repeat(64)}.svg`]) {
      expect(() => store.fileFor(name), name).toThrow(ImageError)
    }
    expect(() => store.fileFor(`${'a'.repeat(64)}.png`)).not.toThrow()
  })

  it('refuses to store what it would refuse to serve', async () => {
    const store = new ImageStore({ directory })
    await expect(store.store(SVG)).rejects.toThrow(/SVG/)
    await expect(store.store(Buffer.alloc(0))).rejects.toThrow(/No file/)
  })

  it('sniffs again on the way out, rather than trusting the extension', async () => {
    const store = new ImageStore({ directory })
    const stored = await store.store(JPEG)
    const read = await store.read(stored.name)
    expect(read.type).toBe('image/jpeg')

    // A file that got onto disk some other way, with a name that says png.
    const planted = `${'b'.repeat(64)}.png`
    await fs.promises.writeFile(path.join(directory, planted), SVG)
    await expect(store.read(planted)).rejects.toThrow(/refusing to serve/)
  })
})

describe('what may be accepted at all', () => {
  it('has no entry that can carry script', () => {
    // The list is short on purpose and this is what keeps it short.
    for (const spec of Object.values(IMAGE_CONFIG.accepted)) {
      expect(spec.type).toMatch(/^image\//)
      expect(spec.type).not.toContain('svg')
    }
  })
})

/**
 * Reading a multipart body.
 *
 * The limits are enforced while reading, not after — a cap applied once the
 * body is in memory is not a cap. busboy reports an over-length file by
 * emitting `limit` and then ending the stream normally, so a parser that only
 * listens for `end` receives a silently truncated file and stores a corrupt
 * image that looks fine.
 */
describe('reading an upload', () => {
  const BOUNDARY = '----pluginuniversetest'

  const body = (parts) => Buffer.concat([
    ...parts.map(part => Buffer.concat([
      Buffer.from(`--${BOUNDARY}\r\n`),
      Buffer.from(part.filename
        ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
        : `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`),
      Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value)),
      Buffer.from('\r\n')
    ])),
    Buffer.from(`--${BOUNDARY}--\r\n`)
  ])

  const request = async (parts) => {
    const { Readable } = await import('stream')
    const buffer = body(parts)
    return Object.assign(Readable.from([buffer]), {
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        'content-length': String(buffer.length)
      }
    })
  }

  it('reads fields and the file together', async () => {
    const { readMultipart } = await import('../../src/api/body.js')
    const form = await readMultipart(
      await request([{ name: 'csrf', value: 'tok' }, { name: 'image', filename: 'a.png', value: PNG }]),
      { maxBytes: IMAGE_CONFIG.maxBytes })
    expect(form.get('csrf')).toBe('tok')
    expect(form.files.get('image').buffer.equals(PNG)).toBe(true)
  })

  it('refuses a file over the cap rather than truncating it', async () => {
    const { readMultipart } = await import('../../src/api/body.js')
    const oversized = Buffer.concat([PNG, Buffer.alloc(5000)])
    await expect(readMultipart(
      await request([{ name: 'image', filename: 'a.png', value: oversized }]),
      { maxBytes: 1000 })).rejects.toThrow(/larger than/)
  })

  it('refuses a body that is not multipart at all', async () => {
    const { readMultipart } = await import('../../src/api/body.js')
    const { Readable } = await import('stream')
    const plain = Object.assign(Readable.from([Buffer.from('a=b')]),
      { headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    await expect(readMultipart(plain, { maxBytes: 1000 })).rejects.toThrow(/Expected a file upload/)
  })

  it('will not read without a limit, rather than defaulting to one', async () => {
    const { readMultipart } = await import('../../src/api/body.js')
    await expect(readMultipart(await request([{ name: 'a', value: 'b' }]), {}))
      .rejects.toThrow(/needs a size limit/)
  })

  it('takes one file, not many', async () => {
    const { readMultipart } = await import('../../src/api/body.js')
    await expect(readMultipart(
      await request([
        { name: 'image', filename: 'a.png', value: PNG },
        { name: 'other', filename: 'b.png', value: PNG }
      ]),
      { maxBytes: IMAGE_CONFIG.maxBytes })).rejects.toThrow(/One file at a time/)
  })
})

/**
 * The form has to be reachable, which is a different question from whether the
 * route works.
 *
 * The upload route worked from the day it was written and nothing on the site
 * linked to it: `mayUploadImage` was set only inside the POST handler, so a
 * plugin page never showed the form. This is the fifth instance of the pattern
 * in CLAUDE.md — a route with nothing reaching it — and the previous one was a
 * moderation queue that could only be opened by typing its URL.
 */
describe('reaching the upload form', () => {
  const source = () => fs.readFileSync('src/api/server.js', 'utf8')

  it('is offered on a plugin page, not only inside the POST that handles it', () => {
    const server = source()
    // The GET branch that renders a plugin page for a reader.
    const view = server.slice(server.indexOf("const match = path.match(/^\\/plugin\\/([A-Za-z0-9-]+?)"))
    expect(view, 'the plugin page never sets mayUploadImage, so the form never appears')
      .toContain('mayUploadImage')
  })

  it('is offered on the strength of trust, not of being signed in', () => {
    const server = source()
    const view = server.slice(server.indexOf("const match = path.match(/^\\/plugin\\/([A-Za-z0-9-]+?)"))
    const clause = view.slice(view.indexOf('mayUploadImage'), view.indexOf('mayUploadImage') + 300)
    expect(clause).toContain('TRUSTED')
    expect(clause).toContain('MODERATOR')
  })

  it('renders the form for a trusted account and not for a new one', async () => {
    const { renderPluginPage } = await import('../../src/api/render.js')
    const DOC = {
      iri: 'http://purl.org/stuff/plugin-universe/plugin/x-1234',
      name: 'X', vendor: 'v', formats: [], categories: [], roles: [], tags: [], parameters: []
    }
    const trusted = renderPluginPage(DOC, {}, {
      mayUploadImage: true, csrfToken: 'tok', correctable: {}
    })
    expect(trusted).toContain('enctype="multipart/form-data"')
    expect(trusted).toContain('/image')

    const newcomer = renderPluginPage(DOC, {}, {
      mayUploadImage: false, csrfToken: 'tok', correctable: {}
    })
    expect(newcomer, 'a form shown to somebody who will be refused is a promise the page cannot keep')
      .not.toContain('enctype=')
  })
})
