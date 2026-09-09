import { describe, it, expect } from 'vitest'
import { negotiate } from '../../src/api/server.js'
import { escape } from '../../src/api/render.js'
import { pluginJsonLd, pluginTurtle } from '../../src/api/serialise.js'
import { parseTurtle } from '../../src/harvest/TurtleReader.js'

const doc = {
  iri: 'http://purl.org/stuff/plugin-universe/plugin/drift-88b3b09d',
  name: 'Drift',
  vendor: 'danja',
  description: 'Four-lane transport-synchronised MIDI CC modulator.',
  formats: ['VST3'],
  categories: ['midi', 'modulation'],
  roles: ['MidiGenerator'],
  parameters: ['Rate', 'Depth']
}

describe('content negotiation', () => {
  it('lets an explicit suffix win over the Accept header', () => {
    expect(negotiate('.ttl', 'text/html')).toBe('turtle')
    expect(negotiate('.jsonld', 'text/html')).toBe('jsonld')
  })

  it('honours the Accept header when there is no suffix', () => {
    expect(negotiate(undefined, 'text/turtle')).toBe('turtle')
    expect(negotiate(undefined, 'application/ld+json')).toBe('jsonld')
    expect(negotiate(undefined, 'application/json')).toBe('json')
  })

  it('defaults to HTML, because the common case is a person following a link', () => {
    expect(negotiate(undefined, '')).toBe('html')
    expect(negotiate(undefined, '*/*')).toBe('html')
  })
})

describe('RDF representations', () => {
  it('emits Turtle that names the plugin and its licence', () => {
    const ttl = pluginTurtle(doc)
    expect(ttl).toContain(`<${doc.iri}>`)
    expect(ttl).toContain('trn:PluginProfile')
    expect(ttl).toContain('"Drift"')
    expect(ttl).toContain('creativecommons.org/publicdomain/zero/1.0/')
  })

  it('escapes literals in Turtle so a quote cannot break the syntax', () => {
    const ttl = pluginTurtle({ ...doc, description: 'A "warm" sound' })
    expect(ttl).toContain('\\"warm\\"')
  })

  it('emits Turtle that actually parses', async () => {
    // A prefixed name may not contain a slash, so category IRIs must be
    // written out in full. Serving unparseable RDF from a dereferenceable IRI
    // would be worse than serving none.
    const dataset = await parseTurtle(pluginTurtle(doc))
    expect(dataset.size).toBeGreaterThan(0)
  })

  it('emits parseable Turtle for text containing quotes and newlines', async () => {
    const awkward = { ...doc, description: 'A "warm" sound.\nSecond line with \\ backslash.' }
    const dataset = await parseTurtle(pluginTurtle(awkward))
    expect(dataset.size).toBeGreaterThan(0)
  })

  it('emits schema.org JSON-LD for crawlers', () => {
    const ld = pluginJsonLd(doc)
    expect(ld['@context']).toBe('https://schema.org')
    expect(ld['@type']).toBe('SoftwareApplication')
    expect(ld['@id']).toBe(doc.iri)
    expect(ld.author.name).toBe('danja')
    expect(ld.license).toContain('publicdomain/zero')
  })

  it('omits absent fields rather than emitting nulls', () => {
    const ld = pluginJsonLd({ iri: 'urn:x', name: 'X' })
    expect('author' in ld).toBe(false)
    expect('description' in ld).toBe(false)
  })
})

describe('HTML escaping', () => {
  it('neutralises markup in plugin-supplied text', () => {
    expect(escape('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(escape('a & b')).toBe('a &amp; b')
    expect(escape('say "hi"')).toBe('say &quot;hi&quot;')
  })
})
