import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  typeAsPlugins, additions, summarise, describesBehaviour, BundleReader, BundleReadError
} from '../../src/contrib/BundleReader.js'
import { parseTurtle, parseTurtleFile } from '../../src/harvest/TurtleReader.js'
import { readBundleDataset } from '../../src/harvest/Lv2Bundle.js'
import { portTriples } from '../../src/harvest/PluginSerialiser.js'
import { iri } from '../../src/store/SPARQLHelper.js'

/**
 * "Send us the URL of your bundle and it is read from there."
 *
 * `/about/profiles` has told plugin authors that since the profile form
 * shipped. This is the code that makes the sentence true, and the test that
 * matters most is the one about the shape of a real bundle — because the
 * obvious implementation fails on every LV2 plugin in existence.
 *
 * An LV2 bundle is two files. `manifest.ttl` says `a lv2:Plugin` and points at
 * the real description; that description carries the ports and types the plugin
 * by *subclass* — `lv2:AudioPlugin` — never as the bare class. A reader that
 * looks for `lv2:Plugin`, which is right when the harvester has read the whole
 * bundle from disk, finds nothing whatever in the file that has the data.
 *
 * The fixtures are deliberately in that shape, comments and all, so this cannot
 * be "fixed" by making the test data easier than the world.
 */

const PLUGIN_TTL = 'tests/fixtures/lv2/plugin.ttl'
const MANIFEST_TTL = 'tests/fixtures/lv2/manifest.ttl'

const readFixture = async file => readBundleDataset(typeAsPlugins(await parseTurtleFile(file)))

describe('reading one file out of a bundle', () => {
  it('finds nothing without the missing type, which is the whole problem', async () => {
    // The unpatched path, asserted so the fix cannot be quietly removed: this
    // is what `readBundleDataset` sees in a real plugin's own .ttl.
    const bare = readBundleDataset(await parseTurtleFile(PLUGIN_TTL))
    expect(bare, 'the fixture no longer has the shape a real bundle has').toHaveLength(0)
  })

  it('finds the plugin once ports imply the type', async () => {
    const [record] = await readFixture(PLUGIN_TTL)
    expect(record).toBeTruthy()
    expect(record.name).toBe('Fixture Delay')
  })

  it('reads the ports, with ranges, units and scale points', async () => {
    const [record] = await readFixture(PLUGIN_TTL)
    // Control ports only: audio and atom ports are the plugin's wiring, not its
    // parameters, and `readPort` already draws that line.
    expect(record.parameters).toHaveLength(2)

    const feedback = record.parameters.find(one => one.symbol === 'feedback')
    expect(feedback.name).toBe('Feedback')
    expect(feedback.default).toBe(0.4)
    expect(feedback.minimum).toBe(0)
    expect(feedback.maximum).toBe(1)
    expect(feedback.direction).toBe('input')

    const mode = record.parameters.find(one => one.symbol === 'mode')
    expect(mode.integer).toBe(true)
    expect(mode.scalePoints.map(point => point.label)).toEqual(['Clean', 'Tape'])
  })

  it('reads the signal types and the host requirement from the ports', async () => {
    // The things a vendor would otherwise have to tick on a form, derived from
    // what the bundle already says: an audio in and an audio out, and an atom
    // port that supports time:Position, which is what needing transport means.
    const [record] = await readFixture(PLUGIN_TTL)
    expect(record.accepts).toContain('http://purl.org/stuff/transmissions/Audio')
    expect(record.produces).toContain('http://purl.org/stuff/transmissions/Audio')
    expect(record.requires).toContain('http://purl.org/stuff/transmissions/HostTransport')
  })

  it('sees through a manifest, which parses fine and says nothing', async () => {
    // The trap. A manifest is where `a lv2:Plugin` lives, so it *does* produce
    // a record — with no ports, no signals and no requirements. Passing that
    // through would tell a moderator "nothing new", which is true and useless;
    // the reader has to recognise it and say where the ports actually are.
    const records = await readFixture(MANIFEST_TTL)
    expect(records, 'a manifest names the plugin, so a record is expected').toHaveLength(1)
    expect(describesBehaviour(records[0])).toBe(false)
    expect(records.filter(describesBehaviour)).toHaveLength(0)
  })

  it('keeps a plugin description, which does say something', async () => {
    const records = await readFixture(PLUGIN_TTL)
    expect(records.every(describesBehaviour)).toBe(true)
  })

  it('does not invent a type for a subject that merely mentions a port', async () => {
    // `lv2:port` as an object, not a predicate. Typing that subject would make
    // a plugin out of a sentence about one.
    const dataset = typeAsPlugins(await parseTurtle(
      '@prefix lv2: <http://lv2plug.in/ns/lv2core#> .\n' +
      '<urn:doc> <http://www.w3.org/2000/01/rdf-schema#seeAlso> lv2:port .'))
    expect(readBundleDataset(dataset)).toHaveLength(0)
  })
})

describe('what a read would add', () => {
  const record = {
    parameters: [{ symbol: 'a' }, { symbol: 'b' }],
    accepts: ['urn:audio'],
    produces: ['urn:audio'],
    requires: ['urn:transport']
  }

  it('fills in only what the plugin has not got', async () => {
    const empty = { parameters: [], accepts: [], produces: [], requires: [] }
    const added = additions(record, empty)
    expect(added.parameters).toHaveLength(2)
    expect(added.accepts).toEqual(['urn:audio'])
  })

  it('leaves a fact the catalogue already holds alone, and counts it', () => {
    // Additive only. A bundle is a better source than a scrape for technical
    // facts, but a URL somebody emailed in is not discovery, and overwriting a
    // harvested or measured fact on the strength of one is not a silent trade.
    const held = { parameters: [{ symbol: 'existing' }], accepts: ['urn:midi'], produces: [], requires: [] }
    const added = additions(record, held)
    expect(added.parameters).toEqual([])
    expect(added.accepts).toEqual([])
    expect(added.produces).toEqual(['urn:audio'])
    expect(added.skipped.parameters).toBe(1)
    expect(added.skipped.accepts).toBe(1)
  })

  it('says what it did in a sentence a moderator can read', () => {
    const empty = { parameters: [], accepts: [], produces: [], requires: [] }
    expect(summarise(additions(record, empty))).toBe('2 parameters, accepts 1, produces 1, 1 host requirement')
    expect(summarise(additions(record, record))).toBe('nothing the catalogue does not already have')
  })
})

describe('the ports become triples', () => {
  it('writes one plugin\'s ports as blank nodes hanging off it', async () => {
    const [record] = await readFixture(PLUGIN_TTL)
    const triples = portTriples(iri('urn:plugin'), record.parameters)
    const joined = triples.join('\n')
    expect(joined).toContain('<urn:plugin> <http://lv2plug.in/ns/lv2core#port>')
    expect(joined).toContain('"feedback"')
    expect(joined).toContain('"Tape"')
    // A port has no identity outside its plugin, so every one is a blank node.
    expect(joined).toMatch(/_:p\d+/)
  })

  it('writes nothing at all for no parameters', () => {
    expect(portTriples(iri('urn:plugin'), [])).toEqual([])
    expect(portTriples(iri('urn:plugin'), undefined)).toEqual([])
  })
})

describe('the fetch is bounded the way rule 8 requires', () => {
  const source = readFileSync('src/contrib/BundleReader.js', 'utf8')

  it('goes through the same defences as the submission form\'s reader', () => {
    // One implementation of the answer to "the server issues a request somebody
    // else chose", not two. `checkFetchable` is that implementation.
    expect(source).toContain('checkFetchable')
  })

  it('fetches exactly once and follows no redirect', () => {
    expect(source.match(/fetchText\(/g) ?? []).toHaveLength(1)
    expect(source).toContain("redirect: 'manual'")
  })

  it('refuses a URL the defences reject, as a BundleReadError', async () => {
    // Translated rather than leaked: a caller catching BundleReadError should
    // not also have to know about PageReadError.
    const reader = new BundleReader()
    await expect(reader.read('file:///etc/passwd')).rejects.toThrow(BundleReadError)
    await expect(reader.read('not a url')).rejects.toThrow(BundleReadError)
  })
})
