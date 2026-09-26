import { describe, it, expect } from 'vitest'
import { JigReader, JigReadError } from '../../src/contrib/JigReader.js'

/**
 * Fetching a JigDAW plugin or collection by URL, into drafts.
 *
 * Nothing here touches the network: the reader takes its HTTP layer as an
 * argument, and every address is a bare IP so even the SSRF vetting resolves
 * numerically — the same arrangement `submit-read.test.js` uses to keep the
 * core suite free of services.
 */

const PROFILE = `@base <https://93.184.216.34/plugins/pulse/> .
@prefix jig: <http://purl.org/stuff/jigdaw/> .
@prefix trn: <http://purl.org/stuff/transmissions/> .
@prefix pu: <http://purl.org/stuff/plugin-universe/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<>
    a jig:WebPlugin , trn:PluginProfile ;
    rdfs:label "Pulse" ;
    rdfs:comment "Eight voice subtractive synthesiser." ;
    trn:vendor "danja" ;
    foaf:homepage <> ;
    trn:role trn:Instrument , trn:AudioInstrument ;
    trn:accepts trn:Midi ;
    trn:produces trn:Audio ;
    trn:format trn:WebAudio ;
    pu:licenceId "Apache-2.0" .`

const PLAIN_PROFILE = `@prefix trn: <http://purl.org/stuff/transmissions/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<https://93.184.216.34/plain/> a trn:PluginProfile ;
  rdfs:label "Plain" ; trn:vendor "Someone" ;
  foaf:homepage <https://93.184.216.34/plain/> ; trn:format trn:LV2 .`

const COLLECTION = `@prefix jig: <http://purl.org/stuff/jigdaw/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
<> a jig:PluginCollection ;
    rdfs:label "Two plugins" ;
    rdfs:comment "A pair for testing." ;
    dcterms:hasPart <https://93.184.216.34/plugins/a/> , <https://93.184.216.34/plugins/b/> .
<https://93.184.216.34/plugins/a/> rdfs:label "Alpha" .
<https://93.184.216.34/plugins/b/> rdfs:label "Beta" .`

const memberProfile = name => `@prefix trn: <http://purl.org/stuff/transmissions/> .
@prefix jig: <http://purl.org/stuff/jigdaw/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<https://93.184.216.34/plugins/${name === 'Alpha' ? 'a' : 'b'}/> a jig:WebPlugin , trn:PluginProfile ;
  rdfs:label "${name}" ; trn:vendor "danja" ;
  foaf:homepage <https://93.184.216.34/plugins/${name === 'Alpha' ? 'a' : 'b'}/> ;
  trn:format trn:WebAudio .`

/** A reader whose fetches return whatever the table says they do. */
const readerFor = (table, options) => new JigReader({
  http: {
    fetchText: async url => {
      if (!(url in table)) throw new Error(`no fixture for ${url}`)
      const body = table[url]
      if (body instanceof Error) throw body
      return body
    }
  },
  ...options
})

describe('a single plugin address', () => {
  it('drafts the profile it serves, resolved against the address', async () => {
    const reader = readerFor({ 'https://93.184.216.34/plugins/pulse/': PROFILE })
    const result = await reader.read('https://93.184.216.34/plugins/pulse/')
    expect(result.kind).toBe('plugin')
    expect(result.draft.fields.name).toBe('Pulse')
    // `<>` and a relative homepage resolve to the plugin's own IRI, which is
    // what identifies the submission — the failure this baseIRI exists to stop.
    expect(result.draft.fields.homepage).toBe('https://93.184.216.34/plugins/pulse/')
    expect(result.draft.url).toBe('https://93.184.216.34/plugins/pulse/')
  })

  it('labels a web plugin as Jig and keeps what it declared', async () => {
    const reader = readerFor({ 'https://93.184.216.34/plugins/pulse/': PROFILE })
    const { draft } = await reader.read('https://93.184.216.34/plugins/pulse/')
    expect(draft.fields.format).toContain('Jig')
    expect(draft.fields.format).toContain('WebAudio')
    expect(draft.sources.format).toMatch(/jig:WebPlugin/)
  })

  it('adds no format to a profile that is not a web plugin', async () => {
    const reader = readerFor({ 'https://93.184.216.34/plain/': PLAIN_PROFILE })
    const { draft } = await reader.read('https://93.184.216.34/plain/')
    expect(draft.fields.format).toEqual(['LV2'])
  })

  it('reports a document that is not a profile as one', async () => {
    // No typed subject and no label: there is nothing to draft rather than
    // something to forgive, so this is a refusal rather than a thin draft.
    const reader = readerFor({ 'https://93.184.216.34/empty.ttl': '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n<https://93.184.216.34/x/> rdfs:comment "Just a note." .' })
    await expect(reader.read('https://93.184.216.34/empty.ttl')).rejects.toThrow(/not a plugin profile/)
  })
})

describe('a collection address', () => {
  const table = {
    'https://93.184.216.34/collections/two.ttl': COLLECTION,
    'https://93.184.216.34/plugins/a/': memberProfile('Alpha'),
    'https://93.184.216.34/plugins/b/': memberProfile('Beta')
  }

  it('returns one draft per member', async () => {
    const result = await readerFor(table).read('https://93.184.216.34/collections/two.ttl')
    expect(result.kind).toBe('collection')
    expect(result.collection.label).toBe('Two plugins')
    expect(result.members).toHaveLength(2)
    expect(result.members[0].draft.fields.name).toBe('Alpha')
    expect(result.members[1].draft.fields.name).toBe('Beta')
    for (const member of result.members) {
      expect(member.draft.fields.format).toContain('Jig')
    }
  })

  it('reports a dead member beside its name rather than stopping', async () => {
    const broken = { ...table, 'https://93.184.216.34/plugins/b/': new Error('gone') }
    const result = await readerFor(broken).read('https://93.184.216.34/collections/two.ttl')
    expect(result.members[0].draft.fields.name).toBe('Alpha')
    expect(result.members[1].draft).toBeUndefined()
    expect(result.members[1].error).toMatch(/gone/)
    expect(result.members[1].name).toBe('Beta')
  })

  it('resolves members named relatively against the collection address', async () => {
    const relative = `@prefix jig: <http://purl.org/stuff/jigdaw/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
<> a jig:PluginCollection ;
    rdfs:label "Relative" ;
    dcterms:hasPart <../plugins/a/> .
<../plugins/a/> rdfs:label "Alpha" .`
    const reader = readerFor({
      'https://93.184.216.34/collections/rel.ttl': relative,
      'https://93.184.216.34/plugins/a/': memberProfile('Alpha')
    })
    const result = await reader.read('https://93.184.216.34/collections/rel.ttl')
    expect(result.members).toHaveLength(1)
    expect(result.members[0].url).toBe('https://93.184.216.34/plugins/a/')
    expect(result.members[0].draft.fields.name).toBe('Alpha')
  })

  it('refuses a collection past the member bound whole', async () => {
    const parts = ['https://93.184.216.34/plugins/a/', 'https://93.184.216.34/plugins/b/']
    const doc = `@prefix jig: <http://purl.org/stuff/jigdaw/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
<> a jig:PluginCollection ; rdfs:label "Big" ;
   dcterms:hasPart <${parts.join('> , <')}> .`
    const reader = readerFor({ 'https://93.184.216.34/collections/big.ttl': doc }, {})
    reader.maxMembers = 1
    await expect(reader.read('https://93.184.216.34/collections/big.ttl'))
      .rejects.toThrow(/over the 1 this reads/)
  })

  it('refuses a collection that names nothing', async () => {
    const doc = `@prefix jig: <http://purl.org/stuff/jigdaw/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<> a jig:PluginCollection ; rdfs:label "Empty" .`
    const reader = readerFor({ 'https://93.184.216.34/collections/empty.ttl': doc })
    await expect(reader.read('https://93.184.216.34/collections/empty.ttl'))
      .rejects.toThrow(/names no plugins/)
  })
})

describe('what it refuses without fetching', () => {
  it('refuses a page, and says what to paste instead', async () => {
    const reader = readerFor({ 'https://93.184.216.34/page/': '<!doctype html><html><head><title>T</title></head><body></body></html>' })
    await expect(reader.read('https://93.184.216.34/page/')).rejects.toThrow(/returned a page, not a profile/)
  })

  it('refuses a private address before any fetch', async () => {
    let fetched = 0
    const reader = new JigReader({ http: { fetchText: async () => { fetched++; return PROFILE } } })
    await expect(reader.read('http://127.0.0.1:3030/plugin-universe/update'))
      .rejects.toThrow(JigReadError)
    expect(fetched).toBe(0)
  })

  it('asks for Turtle rather than HTML', async () => {
    let asked = null
    const reader = new JigReader({
      http: { fetchText: async (url, options) => { asked = options.accept; return PROFILE } }
    })
    await reader.read('https://93.184.216.34/plugins/pulse/')
    expect(asked).toContain('text/turtle')
    expect(asked).not.toContain('text/html')
  })
})
