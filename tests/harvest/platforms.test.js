import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  PLATFORMS, PLATFORM_TOKENS, WINDOWS, MACOS, LINUX,
  toPlatform, platformsInName, platformsFromPackages
} from '../../src/harvest/Platforms.js'
import { loadPlatformVocabulary } from '../../src/rdf/ProfileVocabulary.js'
import { FACET_PATTERNS } from '../../src/search/SearchService.js'
import normalisePlugin from '../../src/harvest/Normaliser.js'
import { serialisePlugin } from '../../src/harvest/PluginSerialiser.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'

const pu = NAMESPACES.pu

/**
 * Four places have to agree about three platforms.
 *
 * The constant, the vocabulary, the SHACL enumeration and the facet. CLAUDE.md
 * has a table of what happens when two such lists drift — the `sh:in` on
 * `pu:licenceId` produced 136 violations after one GitHub sweep, because the
 * licence list moved and the shape did not. That row was written after the
 * event; this file is the same binding written before.
 *
 * `LICENCES`/`shapes.ttl` and `FACET_NAMES`/`FACET_PATTERNS` both have one of
 * these now and both stopped recurring.
 */
describe('the platform list is one list', () => {
  it('names the same three individuals the vocabulary defines', async () => {
    const { platforms } = await loadPlatformVocabulary()
    expect(platforms.map(one => one.iri)).toEqual([...PLATFORMS])
  })

  it('enumerates the same three in the SHACL shape', () => {
    // Parsed out of the file rather than compared against a second copy: the
    // shape is the thing that refuses a write, so it is the thing to read.
    const shapes = readFileSync('vocabs/shapes.ttl', 'utf8')
    const block = shapes.match(/sh:path pu:supportedPlatform ;[\s\S]*?sh:in \(([^)]*)\)/)
    expect(block, 'could not find the sh:in list on pu:supportedPlatform').not.toBeNull()
    const listed = block[1].trim().split(/\s+/).map(name => name.replace(/^pu:/, `${pu}`))
    expect(listed).toEqual([...PLATFORMS])
  })

  it('takes a facet value back to the same IRI', () => {
    // The round trip a URL makes: `?platform=Windows` is the local name, and
    // the pattern has to mint the individual the serialiser wrote.
    for (const platform of PLATFORMS) {
      expect(FACET_PATTERNS.platform(platform.replace(pu, ''))).toContain(`<${platform}>`)
    }
  })

  it('maps every alias to a platform on the list', () => {
    // A token mapping to a fourth IRI would be a platform with no individual,
    // no label and no shape — written, and refused by validation afterwards.
    for (const [token, platform] of Object.entries(PLATFORM_TOKENS)) {
      expect(PLATFORMS, `"${token}" maps to ${platform}, which is not a platform`)
        .toContain(platform)
    }
  })

  it('labels macOS the way Apple spells it, not the way Turtle does', async () => {
    // The local name has to be `MacOS` — a Turtle local name cannot start with
    // a lowercase letter and mean the same thing to a reader — and the label
    // has to be `macOS`. Deriving one from the other gives the wrong answer,
    // which is the `trn:ControlMidi` defect exactly.
    const { platforms } = await loadPlatformVocabulary()
    const macos = platforms.find(one => one.iri === MACOS)
    expect(macos.value).toBe('MacOS')
    expect(macos.label).toBe('macOS')
  })
})

describe('recognising a platform in what a source said', () => {
  it('reads the three words the Open Audio Stack manifest uses', () => {
    // 628, 564 and 578 package files in the catalogue carry these exact
    // strings, and no fourth string.
    expect(toPlatform('win')).toBe(WINDOWS)
    expect(toPlatform('mac')).toBe(MACOS)
    expect(toPlatform('linux')).toBe(LINUX)
  })

  it('is not case-sensitive, and answers null rather than guessing', () => {
    expect(toPlatform('Windows')).toBe(WINDOWS)
    expect(toPlatform('  LINUX ')).toBe(LINUX)
    expect(toPlatform('haiku')).toBeNull()
    expect(toPlatform('')).toBeNull()
    expect(toPlatform(null)).toBeNull()
  })

  it('matches whole tokens in a filename, not substrings', () => {
    // The naive version classifies a plugin called MacroFilter as macOS and a
    // release called "winter-update" as Windows.
    expect(platformsInName('MacroFilter-1.0.zip')).toEqual([])
    expect(platformsInName('winter-edition.zip')).toEqual([])
    expect(platformsInName('dm-BigMuff-windows.zip')).toEqual([WINDOWS])
  })

  it('reads the real release assets in the catalogue', () => {
    // Every one of these is a filename taken from the store, not invented.
    expect(platformsInName('master_me-1.3.1-win64.zip')).toEqual([WINDOWS])
    expect(platformsInName('master_me-1.3.1-macos-universal.dmg')).toEqual([MACOS])
    expect(platformsInName('master_me-1.3.1-linux-riscv64.tar.xz')).toEqual([LINUX])
    expect(platformsInName('dm-BigMuff-ubuntu.zip')).toEqual([LINUX])
    expect(platformsInName('amsynth-2.0.0-windows.exe')).toEqual([WINDOWS])
    // A source tarball is not a platform. This is the case that makes the
    // difference between evidence and a default: amsynth ships one, and it
    // says nothing about what amsynth runs on.
    expect(platformsInName('amsynth-2.0.0.tar.gz')).toEqual([])
    expect(platformsInName('TheCloud.lv2.zip')).toEqual([])
  })

  it('does not read a MOD device build as Linux', () => {
    // They are embedded ARM appliances rather than a desktop anybody installs
    // a plugin on, and every repository shipping one also ships an ubuntu
    // asset — so including them would add no plugin and one wrong claim.
    expect(platformsInName('dm-BigMuff-moddwarf-new.zip')).toEqual([])
    expect(platformsInName('dm-DS1-modduox-new.zip')).toEqual([])
  })
})

describe('what a plugin runs on, derived from its packages', () => {
  const pkg = files => [{ version: '1.0', files }]

  it('prefers what the source stated over what a filename suggests', () => {
    const platforms = platformsFromPackages(pkg([
      { url: 'https://example.org/thing-macos.zip', systems: ['linux'] }
    ]))
    expect(platforms).toEqual([LINUX])
  })

  it('falls back to the filename only when the source said nothing', () => {
    expect(platformsFromPackages(pkg([
      { url: 'https://example.org/thing-windows.zip', systems: [] }
    ]))).toEqual([WINDOWS])
  })

  it('returns nothing rather than a default when there is no evidence', () => {
    // The 176 plugins this is the honest answer for. An empty list means
    // nobody has said, which is not the same as "runs on nothing" — and a
    // guess here would reach a page as a fact.
    expect(platformsFromPackages([])).toEqual([])
    expect(platformsFromPackages(pkg([{ url: 'https://example.org/src.tar.gz', systems: [] }])))
      .toEqual([])
  })

  it('is in a fixed order, so re-harvesting is a no-op', () => {
    const one = platformsFromPackages(pkg([
      { url: 'https://example.org/a.zip', systems: ['linux'] },
      { url: 'https://example.org/b.zip', systems: ['win'] }
    ]))
    const other = platformsFromPackages(pkg([
      { url: 'https://example.org/b.zip', systems: ['win'] },
      { url: 'https://example.org/a.zip', systems: ['linux'] }
    ]))
    expect(one).toEqual(other)
    expect(one).toEqual([WINDOWS, LINUX])
  })
})

describe('from a harvested record to a triple', () => {
  const record = extra => normalisePlugin({ name: 'A Plugin', ...extra })

  it('derives the platforms when the harvester did not state them', () => {
    const plugin = record({
      packages: [{ files: [{ url: 'https://example.org/x.zip', systems: ['win', 'mac'] }] }]
    })
    expect(plugin.platforms).toEqual([WINDOWS, MACOS])
  })

  it('keeps a harvester\'s own assertion and drops anything not on the list', () => {
    const plugin = record({ platforms: [LINUX, `${pu}Haiku`] })
    expect(plugin.platforms).toEqual([LINUX])
  })

  it('writes pu:supportedPlatform onto the plugin, not onto a file', () => {
    // The whole point. `pu:operatingSystem` stays where it is, on the package
    // file, and this is the same fact somewhere a query can reach it.
    const triples = serialisePlugin(
      record({ packages: [{ files: [{ url: 'https://example.org/x.zip', systems: ['win'] }] }] }),
      `${pu}plugin/a-plugin-00000000`
    ).join('\n')
    expect(triples).toContain(`<${pu}supportedPlatform> <${WINDOWS}>`)
    // Both, not one instead of the other: the file-level string is what the
    // registry index publishes and what a downloader needs.
    expect(triples).toContain(`<${pu}operatingSystem> "win"`)
  })

  it('writes nothing when there is no evidence', () => {
    const triples = serialisePlugin(record({}), `${pu}plugin/a-plugin-00000000`).join('\n')
    expect(triples).not.toContain('supportedPlatform')
  })
})
