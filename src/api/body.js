/**
 * Reading a form post.
 *
 * The first time this application accepts input from outside, so the limits
 * come first and the parsing second.
 *
 * A body is bounded before it is read, not after: an unbounded read is a way to
 * exhaust a 384 MB container with one request, and "reject once it is too big"
 * still means having received it. `Content-Length` is a claim rather than a
 * fact, so the running total is what actually stops it.
 */

export class BodyError extends Error {
  constructor (message, { status = 400 } = {}) {
    super(message)
    this.name = 'BodyError'
    this.status = status
  }
}

/** Generous for a correction with a rationale, useless for anything else. */
export const MAX_BODY_BYTES = 16 * 1024

export function readBody (request, { limit = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      reject(new BodyError('That is too large.', { status: 413 }))
      return
    }

    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        // Stop reading rather than accumulate and complain afterwards.
        request.destroy()
        reject(new BodyError('That is too large.', { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    request.on('error', reject)
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

/**
 * A form post.
 *
 * `URLSearchParams` handles the decoding, including the `+`-for-space rule that
 * a hand-rolled parser gets wrong.
 *
 * **`get` returns the first value for a repeated key, and that is a rule rather
 * than an accident**: silently taking the last is how a validated field gets
 * replaced by an unvalidated one appended to the body.
 *
 * `getAll` returns every value, for the one shape of field that genuinely wants
 * several — a checkbox group, where each box posts under the same name. It is
 * safe there and only there, because the caller matches each value against a
 * whitelist; a field that took `getAll` and trusted the result would have given
 * back exactly the hole `get` exists to close.
 */
class Form extends Map {
  #params
  constructor (params) {
    super()
    this.#params = params
    for (const [key, value] of params) {
      if (!this.has(key)) this.set(key, value)
    }
  }

  getAll (key) {
    return this.#params.getAll(key)
  }
}

/**
 * A form post that carries a file.
 *
 * `multipart/form-data` is the only way a form without script can send bytes,
 * and Node has no parser for it — which is why busboy is here rather than a
 * hand-rolled one. This module already carries a note about why
 * `URLSearchParams` does the urlencoded decoding: boundary handling and CRLF
 * edge cases are the same kind of thing, on input an attacker controls.
 *
 * Two limits are enforced **while reading**, not after. A cap applied once the
 * body is in memory is not a cap, and the shape of attack it exists to stop is
 * a body that never ends.
 *
 * Returns the same `Form` the urlencoded path returns, plus `files`.
 */
export async function readMultipart (request, { maxBytes, maxFiles = 1, maxFields = 20 } = {}) {
  const type = String(request.headers['content-type'] ?? '')
  if (!type.startsWith('multipart/form-data')) {
    throw new BodyError('Expected a file upload.', { status: 415 })
  }
  if (!maxBytes) throw new BodyError('readMultipart needs a size limit.', { status: 500 })

  const { default: busboy } = await import('busboy')
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams()
    const files = new Map()
    let settled = false

    const fail = (message, status = 400) => {
      if (settled) return
      settled = true
      request.unpipe?.(parser)
      reject(new BodyError(message, { status }))
    }

    const parser = busboy({
      headers: request.headers,
      limits: { fileSize: maxBytes, files: maxFiles, fields: maxFields, fieldSize: 100000 }
    })

    parser.on('field', (name, value) => params.append(name, value))

    parser.on('file', (name, stream, info) => {
      const chunks = []
      let bytes = 0
      stream.on('data', chunk => {
        bytes += chunk.length
        chunks.push(chunk)
      })
      // busboy reports the limit rather than erroring, so the truncated file
      // has to be rejected explicitly — otherwise a 3 MB upload arrives as a
      // valid-looking 2 MB one and is stored as a corrupt image.
      stream.on('limit', () => fail(`That file is larger than ${Math.round(maxBytes / 1024)} kB.`, 413))
      stream.on('end', () => {
        if (settled) return
        files.set(name, { buffer: Buffer.concat(chunks), filename: info.filename, bytes })
      })
    })

    parser.on('filesLimit', () => fail('One file at a time.'))
    parser.on('fieldsLimit', () => fail('That form has too many fields.'))
    parser.on('error', error => fail(`That upload could not be read: ${error.message}`))
    parser.on('close', () => {
      if (settled) return
      settled = true
      const form = new Form(params)
      form.files = files
      resolve(form)
    })

    request.pipe(parser)
  })
}

export async function readForm (request, options = {}) {
  const type = String(request.headers['content-type'] ?? '')
  if (!type.startsWith('application/x-www-form-urlencoded')) {
    throw new BodyError('Expected a form submission.', { status: 415 })
  }
  return new Form(new URLSearchParams(await readBody(request, options)))
}

export default readForm
