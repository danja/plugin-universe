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
 * A form post as a map.
 *
 * `URLSearchParams` handles the decoding, including the `+`-for-space rule that
 * a hand-rolled parser gets wrong. Repeated keys collapse to the first: no form
 * here wants a list, and silently taking the last value is how a validated
 * field gets replaced by an unvalidated one.
 */
export async function readForm (request, options = {}) {
  const type = String(request.headers['content-type'] ?? '')
  if (!type.startsWith('application/x-www-form-urlencoded')) {
    throw new BodyError('Expected a form submission.', { status: 415 })
  }
  const params = new URLSearchParams(await readBody(request, options))
  const form = new Map()
  for (const [key, value] of params) {
    if (!form.has(key)) form.set(key, value)
  }
  return form
}

export default readForm
