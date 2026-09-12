import { describe, it, expect } from 'vitest'
import { draftFrom, checkFetchable, PageReadError } from '../../src/contrib/PageReader.js'
import { SUBMITTABLE, validate } from '../../src/contrib/Submissions.js'

/**
 * Reading one page, at a moderator's request.
 *
 * Two things are being tested and they are not the same. One is the extraction:
 * given a page, does a sensible draft come out. The other is the refusals —
 * `docs/resources.md` §4 rule 8 says a fetch at a person's request must not be
 * allowed to become a crawl, and names the four things that would turn it into
 * one. Those are the tests that matter, because the extraction being poor
 * produces a draft a moderator corrects, and the refusals failing produces an
 * open proxy.
 */

const PAGE = `<!doctype html><html><head>
  <title>Dragonfly Reverb</title>
  <meta property="og:description" content="Free reverb plugins.">
  <script type="application/ld+json">
  {"@type":"SoftwareApplication","name":"Dragonfly Reverb",
   "author":{"name":"Michael Willis"},
   "description":"Hall, plate and room reverbs.",
   "license":"https://spdx.org/licenses/GPL-3.0-or-later"}
  </script>
</head><body><p>Builds for VST3, LV2 and CLAP.</p></body></html>`

const URL_ = 'https://example.org/dragonfly/'

describe('what a page is asked for', () => {
  it('prefers what the page published for machines over what it wrote for people', () => {
    const { fields, sources } = draftFrom(PAGE, URL_)
    expect(fields.name).toBe('Dragonfly Reverb')
    expect(sources.name).toBe('schema.org name')
    // The <title> would also have given a name. JSON-LD is the only part of a
    // page written to be read this way, so it wins.
    expect(fields.description).toBe('Hall, plate and room reverbs.')
    expect(sources.description).toBe('schema.org description')
  })

  it('falls back through og: to <title> when there is no JSON-LD', () => {
    const bare = '<html><head><title>Surge XT</title>' +
      '<meta name="description" content="A synth."></head><body></body></html>'
    const { fields, sources } = draftFrom(bare, URL_)
    expect(fields.name).toBe('Surge XT')
    expect(sources.name).toBe('<title>')
    expect(sources.description).toBe('<meta name="description">')
  })

  it('says where every field came from, because they are not equally trustworthy', () => {
    const { fields, sources } = draftFrom(PAGE, URL_)
    for (const key of Object.keys(fields)) {
      expect(sources[key], key).toBeTruthy()
    }
  })

  it('keeps the URL that was pasted as the homepage, not one found in the page', () => {
    // It is what the person is vouching for. A canonical link is the page
    // talking about itself, which is the thing being checked.
    const withCanonical = PAGE.replace('</head>',
      '<link rel="canonical" href="https://elsewhere.invalid/"></head>')
    expect(draftFrom(withCanonical, URL_).fields.homepage).toBe(URL_)
  })

  it('survives JSON-LD that does not parse', () => {
    const broken = PAGE.replace('"@type"', '"@type" oops,')
    // A page with broken JSON-LD still has og: and <title>. Not an error —
    // nothing in the draft is required.
    expect(draftFrom(broken, URL_).fields.name).toBe('Dragonfly Reverb')
  })

  it('does not read a format name out of a <script> or a <style>', () => {
    const scripted = '<html><head><title>T</title>' +
      '<script>const formats = ["VST3", "LADSPA"]</script>' +
      '<style>.aax { color: red }</style></head><body><p>An LV2 plugin.</p></body></html>'
    expect(draftFrom(scripted, URL_).fields.format).toEqual(['LV2'])
  })

  it('does not guess a format from an ambiguous word', () => {
    // "AU" is half the prose in several languages and "standalone" is an
    // adjective. Neither is a claim that such a build exists.
    const prose = '<html><head><title>T</title></head><body>' +
      '<p>Ein Plugin, das au&szlig;erdem standalone l&auml;uft.</p></body></html>'
    expect(draftFrom(prose, URL_).fields.format).toBeUndefined()
  })

  it('normalises a licence through the same function a harvest uses', () => {
    const { fields } = draftFrom(PAGE, URL_)
    expect(fields.licenceId).toBe('GPL-3.0-or-later')
  })

  it('finds a licence stated only as a link', () => {
    const linked = '<html><head><title>T</title></head><body>' +
      '<a href="https://www.gnu.org/licenses/gpl-3.0.html">Licence</a></body></html>'
    expect(draftFrom(linked, URL_).fields.licenceId).toBe('GPL-3.0')
  })

  it('decodes entities rather than storing them', () => {
    const entity = '<html><head><title>Hall &amp; Plate &#8212; Reverb</title></head><body></body></html>'
    expect(draftFrom(entity, URL_).fields.name).toBe('Hall & Plate — Reverb')
  })
})

describe('what the moderator is told to check', () => {
  it('says when a required field could not be read', () => {
    const { notes } = draftFrom('<html><head><title>A</title></head><body></body></html>', URL_)
    expect(notes.join(' ')).toMatch(/Vendor/)
  })

  it('says when the page describes more than one piece of software', () => {
    const listing = '<html><head><title>Plugins</title>' +
      '<script type="application/ld+json">[' +
      '{"@type":"SoftwareApplication","name":"One"},' +
      '{"@type":"SoftwareApplication","name":"Two"}]</script></head><body></body></html>'
    const { notes, fields } = draftFrom(listing, URL_)
    expect(fields.name).toBe('One')
    expect(notes.join(' ')).toMatch(/2 pieces of software/)
  })

  it('says when no format was found, rather than leaving an empty required field', () => {
    const { notes } = draftFrom('<html><head><title>A</title></head><body></body></html>', URL_)
    expect(notes.join(' ')).toMatch(/format/i)
  })

  it('produces fields the submission validator recognises', () => {
    // A draft that cannot be submitted is not a draft. This is the binding
    // between the reader and SUBMITTABLE — the two would otherwise drift.
    const { fields } = draftFrom(PAGE, URL_)
    for (const key of Object.keys(fields)) {
      expect(Object.keys(SUBMITTABLE), `${key} is not a submittable field`).toContain(key)
    }
    const complete = { ...fields, vendor: fields.vendor ?? 'Someone' }
    expect(() => validate(complete)).not.toThrow()
  })
})

/**
 * The refusals. These are rule 8 as code.
 *
 * The feature makes this server issue a request chosen by somebody else, which
 * is the shape of every SSRF. What is nearby and worth protecting is specific:
 * Fuseki's update endpoint binds to 127.0.0.1, and CLAUDE.md names publishing
 * it by accident as the worst mistake available here.
 */
describe('addresses this server refuses to be pointed at', () => {
  const refuses = url => expect(checkFetchable(url)).rejects.toThrow(PageReadError)

  it('refuses loopback, however it is spelled', async () => {
    await refuses('http://127.0.0.1:3030/plugin-universe/update')
    await refuses('http://localhost:3030/')
    await refuses('http://[::1]:3030/')
    // 2130706433 is 127.0.0.1 as a single integer, which some parsers accept.
    await refuses('http://127.1/')
  })

  it('refuses the private ranges', async () => {
    await refuses('http://10.0.0.5/')
    await refuses('http://192.168.1.1/')
    await refuses('http://172.16.0.1/')
    await refuses('http://172.31.255.255/')
  })

  it('refuses link-local, which is where cloud metadata lives', async () => {
    await refuses('http://169.254.169.254/latest/meta-data/')
  })

  it('refuses an IPv4 address wearing an IPv6 hat', async () => {
    await refuses('http://[::ffff:127.0.0.1]/')
  })

  it('allows a public address through', async () => {
    const url = await checkFetchable('https://93.184.216.34/some/page')
    expect(url.hostname).toBe('93.184.216.34')
  })

  it('refuses a scheme that is not http', async () => {
    await refuses('file:///etc/passwd')
    await refuses('ftp://example.org/')
    await refuses('gopher://example.org/')
  })

  it('refuses credentials in the URL', async () => {
    // This fetch does not sign in as anyone, and a URL that carries a password
    // would put one in a log.
    await refuses('http://user:secret@93.184.216.34/')
  })

  it('refuses something that is not a URL at all', async () => {
    await refuses('not a url')
    await refuses('')
    await refuses(null)
  })
})
