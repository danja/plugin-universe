import { describe, it, expect } from 'vitest'
import { renderPluginPage } from '../../src/api/render.js'
import { UNVERSIONED, NOASSERTION } from '../../src/harvest/Licensing.js'

/**
 * A plugin page's identifiers resolve.
 *
 * The catalogue's argument is that identifiers should dereference — it is the
 * reason plugin IRIs are minted under a PURL, the reason an LV2 plugin's own
 * IRI is preserved with `owl:sameAs` rather than replaced, and the reason
 * categories are a concept scheme. The profile page stated all of those as
 * plain text while a search result linked the same values, so the page *about*
 * one plugin was the only place you could not get anywhere from.
 *
 * These rows carry HTML this code built rather than text the template escapes,
 * which is the one place the default is reversed — so the escaping is asserted
 * here too.
 */

const base = {
  iri: 'http://purl.org/stuff/plugin-universe/plugin/achord-1a2b',
  name: 'Achord', vendor: 'danja', vendorSlug: 'danja',
  formats: [], roles: [], categories: [], tags: [], parameters: [], sameAs: []
}
const page = extra => renderPluginPage({ ...base, ...extra })

describe('what a plugin page links to', () => {
  it('resolves its own IRI, through the PURL it was minted under', () => {
    // The whole reason IRIs are not minted on the serving domain.
    expect(page({})).toContain(`<a href="${base.iri}">${base.iri}</a>`)
  })

  it('keeps the author\'s own identifier for the plugin, and links it', () => {
    // 86 plugins carry one. LV2 plugins are identified by their authors, so the
    // catalogue preserves that with owl:sameAs — and showed it nowhere.
    const html = page({ sameAs: ['https://danja.github.io/flues/plugins/achord'] })
    expect(html).toContain('Also known as')
    expect(html).toContain('href="https://danja.github.io/flues/plugins/achord"')
  })

  it('says nothing about an upstream IRI when there is none', () => {
    expect(page({})).not.toContain('Also known as')
  })

  it('links a licence to SPDX\'s description of it', () => {
    expect(page({ licenceId: 'MIT' })).toContain('href="https://spdx.org/licenses/MIT.html"')
    expect(page({ licenceId: 'GPL-3.0-or-later' }))
      .toContain('href="https://spdx.org/licenses/GPL-3.0-or-later.html"')
  })

  it('does not link a token SPDX has no page for', () => {
    // The unversioned forms and NOASSERTION are this catalogue's honest record
    // of what a source said, and deliberately not SPDX identifiers. A link that
    // 404s is worse than a plain word.
    for (const token of [...UNVERSIONED, NOASSERTION]) {
      const html = page({ licenceId: token })
      expect(html, token).not.toContain('spdx.org/licenses/')
    }
    // And an unrecognised string never becomes a URL.
    expect(page({ licenceId: 'some-bespoke-licence' })).not.toContain('spdx.org')
  })

  it('links formats and roles to the filtered search, as a result row does', () => {
    const html = page({ formats: ['LV2', 'VST3'], roles: ['Harmoniser'] })
    expect(html).toContain('href="/?format=LV2"')
    expect(html).toContain('href="/?format=VST3"')
    expect(html).toContain('href="/?role=Harmoniser"')
  })

  it('links a category to its page, which is where a concept is described', () => {
    expect(page({ categories: ['reverb'] })).toContain('href="/category/reverb"')
  })

  it('lists several values without running them together', () => {
    const html = page({ categories: ['harmony', 'midi'] })
    expect(html).toContain('>harmony</a>, <a ')
  })
})

describe('the rows that carry markup still escape their values', () => {
  // These rows take HTML this code built, which reverses the template's
  // default. Everything interpolated into them has to be escaped here instead.

  it('escapes a value that looks like markup', () => {
    const html = page({ formats: ['<script>alert(1)</script>'] })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes a value that would break out of the href', () => {
    const html = page({ categories: ['" onmouseover="alert(1)'] })
    expect(html).not.toContain('onmouseover="alert(1)"')
  })

  it('percent-encodes a value into the URL rather than pasting it in', () => {
    const html = page({ formats: ['a b&c'] })
    expect(html).toContain('/?format=a%20b%26c')
  })

  it('escapes an upstream IRI, which came from a harvested source', () => {
    // Not ours, and not validated beyond being an IRI in somebody's bundle.
    const html = page({ sameAs: ['https://x.invalid/"><img src=x onerror=alert(1)>'] })
    expect(html).not.toContain('<img src=x')
  })
})

/**
 * The JSON-LD block at the foot of the page.
 *
 * Found while testing the escaping above, and it pre-dated that work: every
 * plugin page embeds `JSON.stringify(pluginJsonLd(doc))` inside a `<script>`,
 * and `<` is not special in JSON, so `JSON.stringify` leaves it alone. A value
 * containing `</script>` closed the block and everything after it parsed as
 * markup. Harvested strings reach those fields; so does anything typed into
 * `/submit`.
 */
describe('the embedded JSON-LD cannot close its own script tag', () => {
  const withField = field => renderPluginPage({ ...base, ...field })
  const block = html => {
    const at = html.indexOf('application/ld+json')
    return html.slice(at, html.indexOf('</script>', at) + 9)
  }

  it('escapes a closing tag in any field a source or a person can set', () => {
    for (const field of [
      { name: 'X</script><img src=x onerror=alert(1)>' },
      { description: 'X</script><img src=x onerror=alert(1)>' },
      { formats: ['</script><img src=x onerror=alert(1)>'] },
      { categories: ['</script><img src=x onerror=alert(1)>'] },
      { vendor: '</script><img src=x onerror=alert(1)>' }
    ]) {
      const html = withField(field)
      expect(html, JSON.stringify(field)).not.toContain('<img src=x onerror')
      expect(html, JSON.stringify(field)).toContain('\\u003c/script>')
    }
  })

  it('leaves the block valid JSON, because \\u003c is the same string', () => {
    const html = withField({ name: 'A</script>B' })
    const body = block(html)
    const json = body.slice(body.indexOf('>') + 1, body.lastIndexOf('</script>'))
    expect(() => JSON.parse(json)).not.toThrow()
    expect(JSON.parse(json).name).toBe('A</script>B')
  })

  it('closes the block exactly once', () => {
    // The symptom, stated directly: a second </script> in the document between
    // the opening tag and where the block should end is the break-out.
    const html = withField({ name: 'A</script>B' })
    const at = html.indexOf('application/ld+json')
    const rest = html.slice(at)
    expect((rest.match(/<\/script>/g) ?? []).length).toBe(1)
  })
})
