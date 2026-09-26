import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'fs'
import DownspoutHarvester from '../../src/harvest/DownspoutHarvester.js'
import JigDawHarvester from '../../src/harvest/JigDawHarvester.js'
import Lv2Harvester from '../../src/harvest/Lv2Harvester.js'
import { Harvester, HarvestError } from '../../src/harvest/Harvester.js'
import { NAMESPACES } from '../../src/rdf/NamespaceManager.js'
import { LINUX } from '../../src/harvest/Platforms.js'

// Harvesters are tested against the real seed repositories. They exist to read
// one specific corpus correctly, so a synthetic fixture would test nothing.

const DOWNSPOUT = process.env.DOWNSPOUT_PATH ?? '/home/danny/github/downspout'
const FLUES = process.env.FLUES_PATH ?? '/home/danny/github/flues'
const JIGDAW = process.env.JIGDAW_PATH ?? '/home/danny/github/jigdaw'
const trn = NAMESPACES.trn
const pu = NAMESPACES.pu

const haveSeed = fs.existsSync(DOWNSPOUT) && fs.existsSync(FLUES)
const haveJigdaw = fs.existsSync(JIGDAW)

describe('the harvester contract', () => {
  it('requires a licence to be declared, with no default', () => {
    expect(() => new Harvester({ id: 'x', kind: 'source', derivedFrom: 'y' })).toThrow(HarvestError)
  })

  it('requires provenance', () => {
    expect(() => new Harvester({ id: 'x', kind: 'source', licence: 'CC0-1.0' })).toThrow(HarvestError)
  })

  it('does not pretend to collect', async () => {
    const bare = new Harvester({ id: 'x', kind: 'source', licence: 'CC0-1.0', derivedFrom: 'y' })
    await expect(bare.collect()).rejects.toThrow(HarvestError)
  })
})

describe.skipIf(!haveSeed)('DownspoutHarvester', () => {
  let result
  beforeAll(async () => {
    result = await new DownspoutHarvester({ repoPath: DOWNSPOUT }).harvest()
  })

  it('reads every plugin directory with a profile, rejecting none', () => {
    expect(result.plugins.length).toBeGreaterThanOrEqual(50)
    expect(result.rejected).toEqual([])
  })

  it('reads the odd one out that is LV2/DOAP-shaped rather than a trn:PluginProfile', () => {
    // plugins/worms uses lv2:Plugin + doap:name. A hand-maintained corpus
    // drifts; the harvester reads both shapes.
    const worms = result.plugins.find(p => p.name === 'ToneWorm')
    expect(worms).toBeDefined()
    expect(worms.description).toContain('Tonnetz')
  })

  it('normalises both min/max spellings onto one', () => {
    const bassops = result.plugins.find(p => p.name === 'Bassops')
    const duck = bassops.parameters.find(p => p.symbol === 'duck_depth')
    expect(duck.minimum).toBe(0)
    expect(duck.maximum).toBe(100)
    expect(duck.unitIri).toBe(`${NAMESPACES.units}pc`)
  })

  it('carries curated behaviour that no scanner could produce', () => {
    const drift = result.plugins.find(p => p.name === 'Drift')
    expect(drift.roles).toContain(`${trn}MidiGenerator`)
    expect(drift.produces).toContain(`${trn}ControlMidi`)
    expect(drift.requires).toContain(`${trn}HostTransport`)
    expect(drift.cautions.length).toBeGreaterThan(0)
  })

  it('reads CC mappings', () => {
    const withCc = result.plugins.filter(p => p.ccMappings.length > 0)
    expect(withCc.length).toBeGreaterThan(0)
    const mapping = withCc[0].ccMappings[0]
    expect(typeof mapping.ccNumber).toBe('number')
  })

  it('marks every plugin as VST3', () => {
    expect(result.plugins.every(p => p.formats.includes(`${trn}VST3`))).toBe(true)
  })

  it('reads the platforms the profiles state, in both shapes', () => {
    // The read half of the 2026-09-15 change. `pu:supportedPlatform` was added
    // to all 52 profile.ttl files, and `readProfile` returned a fixed set of
    // fields that did not include it — so without this the statement would have
    // been in the repository, in the author's own files, and in no harvest.
    // That is the failure at the top of CLAUDE.md, in the one place where the
    // write and the read are in different repositories and nothing at all
    // connects them.
    expect(result.plugins.length).toBeGreaterThanOrEqual(50)
    for (const plugin of result.plugins) {
      expect(plugin.platforms, `${plugin.name} states no platforms`)
        .toEqual([`${pu}Windows`, `${pu}MacOS`, `${pu}Linux`])
    }
  })

  it('reads them from the one DOAP-shaped profile too', () => {
    // plugins/worms is lv2:Plugin rather than trn:PluginProfile, read by the
    // fallback shape — one plugin in fifty-two, and the one a second reader is
    // most likely to be forgotten in.
    const worms = result.plugins.find(p => p.name === 'ToneWorm')
    expect(worms, 'the DOAP-shaped profile was not harvested at all').toBeTruthy()
    expect(worms.platforms).toContain(`${pu}Windows`)
  })
})

describe.skipIf(!haveSeed)('Lv2Harvester', () => {
  let result
  beforeAll(async () => {
    result = await new Lv2Harvester({
      repoPath: FLUES, id: 'flues', licence: 'MIT',
      derivedFrom: 'https://github.com/danja/flues', vendor: 'Danny Ayers'
    }).harvest()
  })

  it('reads every source bundle, rejecting none', () => {
    expect(result.plugins.length).toBeGreaterThanOrEqual(36)
    expect(result.rejected).toEqual([])
  })

  it('skips build, staging and release copies of the same bundle', async () => {
    // flues carries each bundle up to four times: lv2/<n>/<n>.lv2 plus
    // build-output/, releases/ and build/staging/. Harvesting all of them
    // produced 57 records for 36 plugins.
    const bundles = await new Lv2Harvester({
      repoPath: FLUES, id: 'flues', licence: 'MIT', derivedFrom: 'x'
    }).findBundles(FLUES)
    expect(bundles.every(b => !/\/(build|build-output|releases|staging|dist)\//.test(b))).toBe(true)
  })

  it('yields one record per canonical IRI', () => {
    const iris = result.plugins.map(p => p.sourceIri)
    expect(new Set(iris).size).toBe(iris.length)
  })

  it('preserves the upstream canonical IRI', () => {
    const shifty = result.plugins.find(p => p.name === 'Shifty')
    expect(shifty.sourceIri).toBe('https://danja.github.io/flues/plugins/shifty')
  })

  it('says nothing about platforms unless the caller states them', () => {
    // The assertion that keeps this honest. An LV2 bundle declares no
    // platforms — LV2 builds for Windows and macOS too — so reading the format
    // as an operating system would be a guess written into the graph, and it
    // would be wrong for several of the repositories this catalogue harvests.
    // `bin/ingest.js` states Linux for flues because its author does; the
    // harvester is generic and must keep silent on its own.
    expect(result.plugins.every(p => (p.platforms ?? []).length === 0)).toBe(true)
  })

  it('carries a stated platform onto every plugin in the repository', async () => {
    // A property of the repository, like its licence, its vendor and its
    // pricing — asserted at the call site that names it, and applied to all 36.
    const stated = await new Lv2Harvester({
      repoPath: FLUES, id: 'flues', licence: 'MIT', derivedFrom: 'x',
      platforms: [LINUX]
    }).harvest()
    expect(stated.plugins.length).toBeGreaterThanOrEqual(36)
    expect(stated.plugins.every(p => p.platforms.includes(LINUX))).toBe(true)
    // Linux only. "Built on Linux" and "runs everywhere" are different claims.
    expect(stated.plugins.every(p => p.platforms.length === 1)).toBe(true)
  })

  it('reads ports as parameters with no translation', () => {
    const shifty = result.plugins.find(p => p.name === 'Shifty')
    const blockBars = shifty.parameters.find(p => p.symbol === 'block_bars')
    expect(blockBars.minimum).toBe(1)
    expect(blockBars.maximum).toBe(8)
    expect(blockBars.default).toBe(2)
    expect(blockBars.integer).toBe(true)
  })

  it('ignores audio and atom ports, which are connectivity not parameters', () => {
    const shifty = result.plugins.find(p => p.name === 'Shifty')
    expect(shifty.parameters.some(p => p.symbol === 'in_l')).toBe(false)
    expect(shifty.parameters.some(p => p.symbol === 'control')).toBe(false)
  })

  it('derives signal types from the port list', () => {
    const shifty = result.plugins.find(p => p.name === 'Shifty')
    expect(shifty.accepts).toContain(`${trn}Audio`)
    expect(shifty.produces).toContain(`${trn}Audio`)
  })

  it('infers a host transport requirement from a time:Position port', () => {
    const shifty = result.plugins.find(p => p.name === 'Shifty')
    expect(shifty.requires).toContain(`${trn}HostTransport`)
  })

  it('preserves scale points as enumerations', () => {
    const withScale = result.plugins.find(p => p.parameters.some(x => x.scalePoints.length > 0))
    expect(withScale).toBeDefined()
    const param = withScale.parameters.find(p => p.scalePoints.length > 0)
    expect(param.scalePoints[0].label).toBeTruthy()
    expect(typeof param.scalePoints[0].value).toBe('number')
  })

  it('records the per-repository licence from the bundle itself', () => {
    expect(result.plugins.every(p => p.licence?.includes('MIT'))).toBe(true)
  })

  it('output ports are marked as such, not treated as controls to set', () => {
    const shifty = result.plugins.find(p => p.name === 'Shifty')
    const active = shifty.parameters.find(p => p.symbol === 'active_division')
    expect(active.direction).toBe('output')
  })
})

describe.skipIf(!haveJigdaw)('JigDawHarvester', () => {
  let result
  beforeAll(async () => {
    result = await new JigDawHarvester({ repoPath: JIGDAW }).harvest()
  })

  it('reads every plugin directory with a profile, rejecting none', () => {
    expect(result.plugins.length).toBeGreaterThanOrEqual(3)
    expect(result.rejected).toEqual([])
  })

  it('marks every plugin as a Jig web plugin, and as nothing else', () => {
    // The format is the whole reason trn:Jig and trn:WebAudio exist. A JigDAW
    // plugin is not a VST3, not an LV2 and not a native binary of any kind, so
    // a native format here would be a false claim rather than extra
    // information. The two it carries say different things: Jig names the
    // format, WebAudio the generic technology it is built on. Declared in that
    // order by the profiles themselves.
    for (const plugin of result.plugins) {
      expect(plugin.formats, plugin.name).toEqual([`${trn}Jig`, `${trn}WebAudio`])
    }
  })

  it('says nothing about operating systems, because the platform is a browser', () => {
    // Not an omission. pu:supportedPlatform enumerates three desktop operating
    // systems and a web plugin runs on none of them in particular; the format
    // carries what a platform list would have been asked to say.
    expect(result.plugins.every(p => p.platforms.length === 0)).toBe(true)
  })

  it('keeps the plugin IRI it is published under', () => {
    // These are dereferenceable by design — fetching the IRI *is* installing
    // the plugin — so the upstream IRI is both the identity URIMinter hashes
    // and what owl:sameAs preserves.
    const cascade = result.plugins.find(p => p.name === 'Cascade')
    expect(cascade.sourceIri).toBe('https://strandz.it/jigdaw/plugins/cascade/')
    expect(cascade.homepage).toBe('https://strandz.it/jigdaw/plugins/cascade/')
  })

  it('reads ports as parameters, with units and scale points', () => {
    const cascade = result.plugins.find(p => p.name === 'Cascade')
    const size = cascade.parameters.find(p => p.symbol === 'size')
    expect(size.minimum).toBe(2)
    expect(size.maximum).toBe(60)
    expect(size.unitIri).toBe(`${NAMESPACES.units}ms`)
    const mode = cascade.parameters.find(p => p.symbol === 'mode')
    expect(mode.scalePoints.map(point => point.label)).toEqual(['Plate', 'Hall', 'Bloom'])
  })

  it('reads a host requirement stated in the jigdaw vocabulary', () => {
    // trn:requires carries a capability, and jig:MidiEvents is one. The shapes
    // stopped insisting on the trn: namespace for exactly this; a harvester
    // that dropped the value instead would have made that change pointless.
    const bassgen = result.plugins.find(p => p.name === 'BassGen')
    expect(bassgen.requires).toContain(`${NAMESPACES.jig}MidiEvents`)
    expect(bassgen.requires).toContain(`${trn}HostTransport`)
  })

  it('reads the behaviour a scanner could not produce', () => {
    const bassgen = result.plugins.find(p => p.name === 'BassGen')
    expect(bassgen.roles).toContain(`${trn}MidiGenerator`)
    expect(bassgen.produces).toContain(`${trn}BassMidi`)
    expect(bassgen.cautions.length).toBeGreaterThan(0)
    expect(bassgen.genres).toContain('Techno')
  })

  it('records the licence the profile states, and that the plugin is free', () => {
    for (const plugin of result.plugins) {
      expect(plugin.licenceId, plugin.name).toBe('Apache-2.0')
      expect(plugin.pricing, plugin.name).toBe(`${pu}Free`)
    }
  })

  it('lands in a category, so the plugin is findable by more than its name', () => {
    // Roles map to categories in the normaliser. A source that produced none
    // would put its plugins in the catalogue and out of every browse listing.
    expect(result.plugins.every(p => p.categories.length > 0)).toBe(true)
  })
})
