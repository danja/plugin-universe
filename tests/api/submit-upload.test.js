import { describe, it, expect } from 'vitest'
import { Readable } from 'stream'
import { readMultipart } from '../../src/api/body.js'
import { countableFields } from '../../src/contrib/routes.js'
import { loadSubmittable, SUBMITTABLE } from '../../src/contrib/Submissions.js'

/**
 * The submission form carrying a picture.
 *
 * Adding a file input turned `/submit` into a `multipart/form-data` post, and
 * multipart is counted rather than measured: busboy caps the *number* of fields
 * separately from their size, and stops when the cap is passed. A checkbox
 * group sends one field per ticked box — nine formats, eleven roles, ten signal
 * types twice over — so a thoroughly filled-in profile passes the default
 * twenty without trying, and the submission would have been refused with a
 * message about form size and nothing to connect it to the roles they ticked.
 *
 * That is a failure nobody would have seen in a test that submits a name and a
 * homepage, which is what a test of a form usually does.
 */

const FIELDS = await loadSubmittable()

/** A multipart body with these fields and, optionally, a file. */
function multipart (parts, file = null) {
  const boundary = '----PluginUniverseTest'
  let text = ''
  for (const [name, value] of parts) {
    text += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  }
  const chunks = [Buffer.from(text)]
  if (file) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${file.name}"\r\n` +
      'Content-Type: image/png\r\n\r\n'))
    chunks.push(file.bytes)
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  const request = Readable.from([Buffer.concat(chunks)])
  request.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` }
  return request
}

/** Every field a completely filled-in form would send. */
function everything () {
  const parts = [
    ['csrf', 't'], ['name', 'Zing'],
    ['homepage', 'https://example.org/zing/'], ['vendor', 'Acme']
  ]
  for (const [name, spec] of Object.entries(FIELDS)) {
    if (!spec.multiple) continue
    for (const choice of spec.choices) parts.push([name, choice])
  }
  return parts
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

describe('the field allowance', () => {
  it('is larger than a completely filled-in form actually sends', () => {
    expect(countableFields(FIELDS)).toBeGreaterThan(everything().length)
  })

  it('is well above the twenty multipart allows by default', () => {
    // The number that would have bitten. Stated so that shrinking the
    // allowance, or a default changing under us, fails here.
    expect(countableFields(FIELDS)).toBeGreaterThan(20)
  })

  it('grows when the vocabulary does, because it is counted not written down', () => {
    // A role added to `vocabs/trn-profile.ttl` is a field the form can send.
    // Derived, so nobody has to remember this.
    const more = { ...FIELDS, role: { ...FIELDS.role, choices: [...FIELDS.role.choices, 'Extra'] } }
    expect(countableFields(more)).toBe(countableFields(FIELDS) + 1)
  })
})

describe('reading the form a browser actually sends', () => {
  it('keeps every ticked box when the form is filled in completely', async () => {
    const form = await readMultipart(multipart(everything()), {
      maxBytes: 2 * 1024 * 1024, maxFields: countableFields(FIELDS)
    })
    for (const [name, spec] of Object.entries(FIELDS)) {
      if (!spec.multiple) continue
      expect(form.getAll(name), name).toHaveLength(spec.choices.length)
    }
    expect(form.get('name')).toBe('Zing')
  })

  it('would refuse that same form at the default allowance', async () => {
    // Not a hypothetical: this is what the route did before `countableFields`,
    // and the message a person would have got says nothing about roles.
    await expect(readMultipart(multipart(everything()), { maxBytes: 1024 }))
      .rejects.toThrow(/too many fields/)
  })

  it('carries the picture alongside the fields', async () => {
    const form = await readMultipart(multipart(everything(), { name: 'shot.png', bytes: PNG }), {
      maxBytes: 2 * 1024 * 1024, maxFields: countableFields(FIELDS)
    })
    expect(form.files.get('image').bytes).toBe(PNG.length)
    expect(form.files.get('image').filename).toBe('shot.png')
    expect(form.get('name'), 'the fields must survive the file').toBe('Zing')
  })

  it('reads a form with no picture at all, which is the ordinary case', async () => {
    const form = await readMultipart(multipart(everything()), {
      maxBytes: 2 * 1024 * 1024, maxFields: countableFields(FIELDS)
    })
    expect(form.files.get('image')).toBeUndefined()
  })
})

describe('the picture as a submittable fact', () => {
  it('is a field like any other, so the serialiser needs no special case', () => {
    expect(SUBMITTABLE.depiction.predicate).toContain('depiction')
    expect(SUBMITTABLE.depiction.kind).toBe('url')
  })

  it('is optional, so a submission without one is complete', () => {
    // It is drawn only for somebody trusted to upload. Required, it would make
    // the form impossible for everybody else.
    expect(SUBMITTABLE.depiction.required).toBe(false)
  })

  it('is uploaded rather than typed, so no URL box invites a hotlink', () => {
    // A hotlinked screenshot is somebody else's server: it can vanish, change,
    // or refuse to load. `Corrections` marks the same predicate viaForm: false
    // for the same reason.
    expect(SUBMITTABLE.depiction.upload).toBe(true)
  })
})
